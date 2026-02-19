// ============================================================
// THALAMUS — Context scoring, ranking, token-budget packing
//
// The gating layer that decides what Claude gets to see.
// Spec: https://www.basecampgrounds.com (Thalamus node)
//
// Scoring formula (6 dimensions):
//   relevance   0.35  — keyword / semantic overlap
//   recency     0.20  — how recently was this accessed
//   scope_match 0.15  — session > project > global boost
//   type_priority 0.10 — summary > semantic > episodic
//   decay_penalty 0.10 — higher decay = lower score
//   skill_weight 0.10  — overlap with active skill tags
//
// Spec: thalamus_threshold default = 0.72 (drop below this)
// Spec: strategy = top_k_greedy (pack by descending score)
// ============================================================

import type {
  ContextCandidate,
  SessionState,
  SlidingWindowEntry,
  SkillPackage,
  Loadout,
  AssembledPrompt,
  Citation,
} from '../types'
import { estimateTokens } from '../config'

export class ThalamusService {
  /**
   * Pack context items into the available token budget.
   *
   * Input  → scored ContextCandidates from Retrieval + RAG
   * Output → packed candidates, dropped log, window entries, prompt
   */
  pack(params: {
    session: SessionState
    loadout: Loadout
    retrievedCandidates: ContextCandidate[]   // from Retrieval service
    ragCandidates: ContextCandidate[]          // from RAG search service
    activatedSkills: SkillPackage[]
    userMessage: string
    baseSystem: string
  }): {
    packed: ContextCandidate[]
    dropped: ContextCandidate[]
    windowEntries: SlidingWindowEntry[]
    prompt: AssembledPrompt
    citations: Citation[]
  } {
    const {
      session, loadout, retrievedCandidates, ragCandidates,
      activatedSkills, userMessage, baseSystem,
    } = params
    const { budgets, thresholds } = loadout

    const threshold = thresholds.thalamus_threshold  // spec: 0.72

    // ── 1. L1 Sliding Window ──────────────────────────────────
    const windowEntries = this.selectSlidingWindow(
      session.sliding_window,
      budgets.l1_window_tokens,
    )
    const windowTokens = windowEntries.reduce((sum, e) => sum + e.token_count, 0)

    // ── 2. Skill Candidates ────────────────────────────────────
    const skillCandidates: ContextCandidate[] = activatedSkills.map((skill) => {
      const tokenCount = estimateTokens(skill.system_fragment)
      return {
        id: `skill:${skill.id}`,
        source: 'skill' as const,
        content: skill.system_fragment,
        label: `[skill:${skill.name}]`,
        token_count: Math.min(tokenCount, skill.token_budget),
        scores: {
          relevance:     1.0,
          recency:       1.0,
          scope_match:   1.0,
          type_priority: 1.0,
          decay_penalty: 0,
          skill_weight:  1.0,
          final:         1.0 + skill.priority * 0.01,
        },
        metadata: { skill_id: skill.id, priority: skill.priority },
        dropped: false,
      }
    })

    // ── 3. Merge memory + RAG candidates ─────────────────────
    // Deduplicate by id: prefer higher-scored duplicate
    const allMemory = [...retrievedCandidates, ...ragCandidates]
    const deduped = new Map<string, ContextCandidate>()
    for (const c of allMemory) {
      const existing = deduped.get(c.id)
      if (!existing || c.scores.final > existing.scores.final) {
        deduped.set(c.id, c)
      }
    }
    const memoryCandidates = Array.from(deduped.values())

    // ── 4. Apply Thalamus Gate (spec: thalamus_threshold) ─────
    const viable   = memoryCandidates.filter((c) => c.scores.final >= threshold)
    const filtered = memoryCandidates.filter((c) => c.scores.final < threshold)

    // Mark filtered items as dropped with reason
    const belowThreshold: ContextCandidate[] = filtered.map((c) => ({
      ...c,
      dropped: true,
      drop_reason: `below_thalamus_threshold(${threshold})`,
    }))

    // ── 5. Sort by score descending (top_k_greedy strategy) ───
    const sortedMemory = [...viable].sort((a, b) => b.scores.final - a.scores.final)
    const sortedSkills = [...skillCandidates].sort((a, b) => b.scores.final - a.scores.final)

    // ── 6. Greedy Pack within budgets ─────────────────────────
    let skillTokensUsed  = 0
    let memoryTokensUsed = 0
    const packed:  ContextCandidate[] = []
    const dropped: ContextCandidate[] = [...belowThreshold]

    for (const candidate of sortedSkills) {
      if (skillTokensUsed + candidate.token_count <= budgets.skills) {
        packed.push({ ...candidate, dropped: false })
        skillTokensUsed += candidate.token_count
      } else {
        dropped.push({ ...candidate, dropped: true, drop_reason: 'skill_budget_exceeded' })
      }
    }

    for (const candidate of sortedMemory) {
      if (memoryTokensUsed + candidate.token_count <= budgets.l2_budget_tokens) {
        packed.push({ ...candidate, dropped: false })
        memoryTokensUsed += candidate.token_count
      } else {
        dropped.push({ ...candidate, dropped: true, drop_reason: 'l2_budget_exceeded' })
      }
    }

    // ── 7. Assemble Prompt ────────────────────────────────────
    const skillBlocks  = packed.filter((c) => c.source === 'skill')
    const memoryBlocks = packed.filter((c) => c.source !== 'skill')

    // Compose system: base + skill fragments
    const systemParts = [baseSystem]
    skillBlocks.forEach((s) => systemParts.push(s.content))
    const systemPrompt = systemParts.filter(Boolean).join('\n\n')
    const systemTokens = estimateTokens(systemPrompt)

    // Context blocks (memory + RAG) — with citations
    const contextBlocks = memoryBlocks.map((c) => ({
      label:       c.label,
      content:     c.content,
      token_count: c.token_count,
      source:      c.source,
      citation:    c.citation,
    }))
    const contextTokens = contextBlocks.reduce((s, b) => s + b.token_count, 0)

    // Messages from sliding window
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = windowEntries
      .filter((e) => e.role !== 'system')
      .map((e) => ({ role: e.role as 'user' | 'assistant', content: e.content }))

    const userMessageTokens = estimateTokens(userMessage)
    const totalUsed = systemTokens + contextTokens + windowTokens + userMessageTokens
    const totalBudget =
      budgets.l1_window_tokens +
      budgets.l2_budget_tokens +
      budgets.skills +
      budgets.response_reserve

    const prompt: AssembledPrompt = {
      system: systemPrompt,
      context_blocks: contextBlocks,
      messages,
      token_breakdown: {
        system:           systemTokens,
        context:          contextTokens,
        history:          windowTokens,
        user_message:     userMessageTokens,
        total:            totalUsed,
        budget_remaining: Math.max(0, totalBudget - totalUsed),
      },
    }

    // ── 8. Collect citations from packed candidates ───────────
    const citations: Citation[] = packed
      .filter((c) => c.citation && !c.dropped)
      .map((c) => c.citation!)

    return { packed, dropped, windowEntries, prompt, citations }
  }

  /**
   * Select the most recent sliding-window entries that fit in tokenBudget.
   * Newest entries are preferred (from tail).
   */
  private selectSlidingWindow(
    window: SlidingWindowEntry[],
    tokenBudget: number,
  ): SlidingWindowEntry[] {
    if (!window || window.length === 0) return []
    let tokensUsed = 0
    const selected: SlidingWindowEntry[] = []

    for (let i = window.length - 1; i >= 0; i--) {
      const entry = window[i]
      const tokens = entry.token_count || estimateTokens(entry.content)
      if (tokensUsed + tokens > tokenBudget) break
      selected.unshift(entry)
      tokensUsed += tokens
    }
    return selected
  }

  /**
   * Compute token pressure ratio: total used / total budget.
   * At 0.80 (80%) → trigger consolidation per spec.
   */
  computePressure(
    tokenBreakdown: AssembledPrompt['token_breakdown'],
    totalBudget: number,
  ): number {
    return tokenBreakdown.total / Math.max(1, totalBudget)
  }

  /**
   * L1 Compaction: evict oldest window entries until under targetTokens.
   * Called when pressure exceeds consolidation_trigger.
   * Returns the compacted window and evicted entries.
   */
  compactL1(
    window: SlidingWindowEntry[],
    targetTokens: number,
  ): { compacted: SlidingWindowEntry[]; evicted: SlidingWindowEntry[] } {
    const evicted: SlidingWindowEntry[] = []
    let current = [...window]
    let totalTokens = current.reduce(
      (sum, e) => sum + (e.token_count || estimateTokens(e.content)),
      0,
    )

    // Evict from the oldest (front) until under target
    while (totalTokens > targetTokens && current.length > 2) {
      const removed = current.shift()!
      evicted.push(removed)
      totalTokens -= removed.token_count || estimateTokens(removed.content)
    }

    return { compacted: current, evicted }
  }
}
