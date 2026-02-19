// ============================================================
// RETRIEVAL — L2 memory scoring + candidate building
// Feeds into Thalamus alongside RAG results.
// ============================================================

import type { MemoryItem, ContextCandidate, WernickeDecision, Citation } from '../types'
import { estimateTokens, computeDecay } from '../config'
import { StorageService } from './storage'

export class RetrievalService {
  constructor(private storage: StorageService) {}

  async retrieve(params: {
    user_id: string
    session_id: string
    project_id?: string
    query: string
    decision: WernickeDecision
    limit?: number
  }): Promise<ContextCandidate[]> {
    const { user_id, session_id, project_id, query, decision, limit = 30 } = params

    // Fetch raw memory items from storage
    // Respect project namespace: if project_id set, scope to it + global
    const rawItems = await this.storage.queryMemory({
      user_id,
      session_id,
      project_id,
      exclude_high_decay: true,
      limit: limit * 2,
    })

    if (rawItems.length === 0) return []

    // Score each item across 6 dimensions
    const scored = rawItems.map((item): ContextCandidate => {
      const relevanceScore = this.computeTextRelevance(query, item.content)
      const recencyScore   = this.computeRecency(item.last_accessed)
      const scopeScore     = this.computeScopeMatch(item.scope, decision.memory_scopes)
      const typeScore      = this.computeTypeScore(item.type)
      const decayPenalty   = item.decay_score ?? 0
      const skillWeight    = this.computeSkillWeight(
        item.tags,
        decision.activated_skills.map((s) => s.id),
      )

      const finalScore =
        0.35 * relevanceScore +
        0.20 * recencyScore +
        0.15 * scopeScore +
        0.10 * typeScore +
        0.10 * (1 - decayPenalty) +
        0.10 * skillWeight

      // Build citation for provenance
      const citation: Citation = {
        source:          `memory_${item.type}_${item.id.slice(0, 8)}`,
        source_type:     'memory',
        memory_id:       item.id,
        relevance:       finalScore,
        content_snippet: item.content.slice(0, 120),
      }

      return {
        id: item.id,
        source: 'l2_memory',
        content: item.content,
        label: `[${item.type}:${item.scope}] ${(item.tags ?? []).join(', ') || 'memory'}`,
        token_count: item.token_count || estimateTokens(item.content),
        citation,
        scores: {
          relevance:     relevanceScore,
          recency:       recencyScore,
          scope_match:   scopeScore,
          type_priority: typeScore,
          decay_penalty: decayPenalty,
          skill_weight:  skillWeight,
          final:         finalScore,
        },
        metadata: {
          memory_id:   item.id,
          type:        item.type,
          scope:       item.scope,
          tags:        item.tags,
          confidence:  item.confidence,
          created_at:  item.created_at,
          project_id:  item.project_id,
        },
        dropped: false,
      }
    })

    // Sort by score descending
    scored.sort((a, b) => b.scores.final - a.scores.final)

    // Touch accessed items (fire and forget)
    const topItems = scored.slice(0, limit)
    topItems.forEach((c) => {
      this.storage.touchMemoryItem(c.id).catch(() => {})
    })

    return topItems
  }

  // ── Scoring Components ────────────────────────────────────

  private computeTextRelevance(query: string, content: string): number {
    if (!content || !query) return 0
    const qTokens = this.tokenize(query)
    const cTokens = new Set(this.tokenize(content))
    if (qTokens.length === 0) return 0
    const matches = qTokens.filter((t) => cTokens.has(t)).length
    return Math.min(1, matches / qTokens.length)
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
  }

  private computeRecency(lastAccessed: string): number {
    const hoursAgo = (Date.now() - new Date(lastAccessed).getTime()) / (1000 * 60 * 60)
    // Exponential decay: full at 0h, 0.5 at 24h, ~0.1 at 72h
    return Math.exp(-0.028 * hoursAgo)
  }

  private computeScopeMatch(itemScope: string, requestedScopes: string[]): number {
    if (itemScope === 'global')                    return 1.0
    if (requestedScopes.includes(itemScope))       return 0.9
    return 0.3
  }

  private computeTypeScore(type: string): number {
    const scores: Record<string, number> = {
      summary:  1.0,
      semantic: 0.85,
      episodic: 0.65,
    }
    return scores[type] ?? 0.5
  }

  private computeSkillWeight(tags: string[], activeSkillIds: string[]): number {
    if (!tags || tags.length === 0 || activeSkillIds.length === 0) return 0
    const overlap = tags.filter((t) => activeSkillIds.includes(t)).length
    return Math.min(1, overlap / Math.max(1, activeSkillIds.length))
  }
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his',
  'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy',
  'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'that', 'with',
  'this', 'they', 'have', 'from', 'will', 'been', 'said', 'each', 'about',
  'your', 'more', 'also', 'into', 'just', 'like', 'than', 'then', 'them',
  'some', 'what', 'when', 'which', 'there', 'their', 'would', 'make', 'could',
])
