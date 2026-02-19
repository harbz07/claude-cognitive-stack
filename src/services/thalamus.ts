// ============================================================
// THALAMUS — Context scoring, ranking, budget packing
// The gateway that decides what Claude gets to see.
// ============================================================

import type {
  ContextCandidate,
  SessionState,
  SlidingWindowEntry,
  SkillPackage,
  Loadout,
  AssembledPrompt,
} from '../types'
import { estimateTokens } from '../config'

export class ThalamusService {
  pack(params: {
    session: SessionState
    loadout: Loadout
    retrievedCandidates: ContextCandidate[]
    activatedSkills: SkillPackage[]
    userMessage: string
    baseSystem: string
  }): {
    packed: ContextCandidate[]
    dropped: ContextCandidate[]
    windowEntries: SlidingWindowEntry[]
    prompt: AssembledPrompt
  } {
    const { session, loadout, retrievedCandidates, activatedSkills, userMessage, baseSystem } = params
    const { budgets, thresholds } = loadout

    const allCandidates: ContextCandidate[] = []

    // ── 1. Build L1 sliding window candidates ────────────────
    const windowEntries = this.selectSlidingWindow(session.sliding_window, budgets.l1)
    const windowTokens = windowEntries.reduce((sum, e) => sum + e.token_count, 0)

    // ── 2. Build skill candidates ─────────────────────────────
    const skillCandidates: ContextCandidate[] = activatedSkills.map((skill) => {
      const tokenCount = estimateTokens(skill.system_fragment)
      return {
        id: `skill:${skill.id}`,
        source: 'skill' as const,
        content: skill.system_fragment,
        label: `[skill:${skill.name}]`,
        token_count: Math.min(tokenCount, skill.token_budget),
        scores: {
          relevance: 1.0,
          recency: 1.0,
          scope_match: 1.0,
          type_priority: 1.0,
          decay_penalty: 0,
          skill_weight: 1.0,
          final: 1.0 + skill.priority * 0.01,
        },
        metadata: { skill_id: skill.id, priority: skill.priority },
        dropped: false,
      }
    })

    // ── 3. Add retrieved memory candidates ────────────────────
    // Filter out items below relevance threshold
    const viableMemory = retrievedCandidates.filter(
      (c) => c.scores.final >= thresholds.memory_relevance_min,
    )

    allCandidates.push(...skillCandidates, ...viableMemory)

    // ── 4. Sort all candidates by final score ─────────────────
    allCandidates.sort((a, b) => b.scores.final - a.scores.final)

    // ── 5. Pack within skill + L2 budgets ─────────────────────
    let skillTokensUsed = 0
    let memoryTokensUsed = 0
    const packed: ContextCandidate[] = []
    const dropped: ContextCandidate[] = []

    for (const candidate of allCandidates) {
      if (candidate.source === 'skill') {
        if (skillTokensUsed + candidate.token_count <= budgets.skills) {
          packed.push({ ...candidate, dropped: false })
          skillTokensUsed += candidate.token_count
        } else {
          dropped.push({ ...candidate, dropped: true, drop_reason: 'skill_budget_exceeded' })
        }
      } else {
        // L2 memory
        if (memoryTokensUsed + candidate.token_count <= budgets.l2) {
          packed.push({ ...candidate, dropped: false })
          memoryTokensUsed += candidate.token_count
        } else {
          dropped.push({ ...candidate, dropped: true, drop_reason: 'l2_budget_exceeded' })
        }
      }
    }

    // Mark below-threshold as dropped (for candidates already filtered out)
    const belowThreshold = retrievedCandidates.filter(
      (c) => c.scores.final < thresholds.memory_relevance_min,
    )
    const belowThresholdMarked = belowThreshold.map((c) => ({
      ...c,
      dropped: true,
      drop_reason: 'below_relevance_threshold',
    }))
    dropped.push(...belowThresholdMarked)

    // ── 6. Assemble the prompt ────────────────────────────────
    const skillBlocks = packed.filter((c) => c.source === 'skill')
    const memoryBlocks = packed.filter((c) => c.source !== 'skill')

    // Compose system prompt
    const systemParts = [baseSystem]
    skillBlocks.forEach((s) => systemParts.push(s.content))
    const systemPrompt = systemParts.filter(Boolean).join('\n\n')
    const systemTokens = estimateTokens(systemPrompt)

    // Context blocks
    const contextBlocks = memoryBlocks.map((c) => ({
      label: c.label,
      content: c.content,
      token_count: c.token_count,
      source: c.source,
    }))
    const contextTokens = contextBlocks.reduce((s, b) => s + b.token_count, 0)

    // Messages from sliding window
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = windowEntries
      .filter((e) => e.role !== 'system')
      .map((e) => ({ role: e.role as 'user' | 'assistant', content: e.content }))

    const userMessageTokens = estimateTokens(userMessage)
    const totalUsed = systemTokens + contextTokens + windowTokens + userMessageTokens
    const totalBudget = budgets.l1 + budgets.l2 + budgets.skills + budgets.response_reserve
    const budgetRemaining = Math.max(0, budgets.response_reserve - 0) // reserve stays

    const prompt: AssembledPrompt = {
      system: systemPrompt,
      context_blocks: contextBlocks,
      messages,
      token_breakdown: {
        system: systemTokens,
        context: contextTokens,
        history: windowTokens,
        user_message: userMessageTokens,
        total: totalUsed,
        budget_remaining: Math.max(0, totalBudget - totalUsed),
      },
    }

    return { packed, dropped, windowEntries, prompt }
  }

  private selectSlidingWindow(
    window: SlidingWindowEntry[],
    tokenBudget: number,
  ): SlidingWindowEntry[] {
    if (!window || window.length === 0) return []
    let tokensUsed = 0
    const selected: SlidingWindowEntry[] = []

    // Take most recent entries up to budget (from tail)
    for (let i = window.length - 1; i >= 0; i--) {
      const entry = window[i]
      const tokens = entry.token_count || estimateTokens(entry.content)
      if (tokensUsed + tokens > tokenBudget) break
      selected.unshift(entry)
      tokensUsed += tokens
    }
    return selected
  }

  computePressure(tokenBreakdown: AssembledPrompt['token_breakdown'], totalBudget: number): number {
    return tokenBreakdown.total / totalBudget
  }
}
