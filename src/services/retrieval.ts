// ============================================================
// RETRIEVAL — Semantic + keyword memory retrieval
// When a query embedding is available:
//   final_score = 0.40*semantic + 0.20*recency + 0.15*scope
//               + 0.10*type_priority + 0.10*(1-decay) + 0.05*skill_weight
// When no embedding (graceful fallback):
//   final_score = 0.45*relevance + 0.20*recency + 0.15*scope
//               + 0.10*type_priority + 0.05*(1-decay) + 0.05*skill_weight
// ============================================================

import type { ContextCandidate, RouterDecision } from '../types'
import { estimateTokens } from '../config'
import { StorageService } from './storage'
import { EmbeddingService } from './embeddings'

export class RetrievalService {
  constructor(private storage: StorageService) {}

  async retrieve(params: {
    user_id: string
    session_id: string
    project_id?: string
    query: string
    queryEmbedding: number[] | null   // pre-computed by orchestrator
    decision: RouterDecision
    limit?: number
  }): Promise<ContextCandidate[]> {
    const { user_id, session_id, project_id, query, queryEmbedding, decision, limit = 30 } = params

    // ── 1. Fetch all candidates ────────────────────────────────
    // Always fetch keyword-based pool
    const [keywordItems, semanticItems] = await Promise.all([
      this.storage.queryMemory({
        user_id,
        session_id,
        project_id,
        exclude_high_decay: true,
        limit: limit * 2,
      }),
      // Separately fetch items with embeddings for cosine ranking
      queryEmbedding
        ? this.storage.queryMemoryWithEmbeddings({
            user_id,
            session_id,
            project_id,
            limit: 150,
          })
        : Promise.resolve([]),
    ])

    if (keywordItems.length === 0 && semanticItems.length === 0) return []

    // ── 2. Build unified candidate set (deduplicated by id) ────
    const seen = new Set<string>()
    const allItems: any[] = []
    for (const item of [...keywordItems, ...semanticItems]) {
      if (!seen.has(item.id)) {
        seen.add(item.id)
        allItems.push(item)
      }
    }

    // ── 3. Pre-compute cosine similarities if we have a query embedding
    const similarityMap = new Map<string, number>()
    if (queryEmbedding && semanticItems.length > 0) {
      const ranked = EmbeddingService.rankBySimilarity(queryEmbedding, semanticItems)
      for (const r of ranked) {
        similarityMap.set(r.id, r.similarity)
      }
    }

    const hasEmbeddings = similarityMap.size > 0

    // ── 4. Score every candidate ───────────────────────────────
    const scored = allItems.map((item): ContextCandidate => {
      const semanticScore  = similarityMap.get(item.id) ?? 0
      const keywordScore   = this.computeTextRelevance(query, item.content)
      const recencyScore   = this.computeRecency(item.last_accessed)
      const scopeScore     = this.computeScopeMatch(item.scope, decision.memory_scopes)
      const typeScore      = this.computeTypeScore(item.type)
      const decayPenalty   = item.decay_score ?? 0
      const skillWeight    = this.computeSkillWeight(
        item.tags,
        decision.activated_skills.map((s) => s.id),
      )

      // Weighted blend — semantic dominates when available
      const finalScore = hasEmbeddings && semanticScore > 0
        ? (0.40 * semanticScore  +
           0.20 * recencyScore   +
           0.15 * scopeScore     +
           0.10 * typeScore      +
           0.10 * (1 - decayPenalty) +
           0.05 * skillWeight)
        : (0.45 * keywordScore   +
           0.20 * recencyScore   +
           0.15 * scopeScore     +
           0.10 * typeScore      +
           0.05 * (1 - decayPenalty) +
           0.05 * skillWeight)

      return {
        id: item.id,
        source: 'l2_memory',
        content: item.content,
        label: `[${item.type}:${item.scope}] ${item.tags?.join(', ') || 'memory'}`,
        token_count: item.token_count || estimateTokens(item.content),
        scores: {
          relevance:     hasEmbeddings ? semanticScore : keywordScore,
          recency:       recencyScore,
          scope_match:   scopeScore,
          type_priority: typeScore,
          decay_penalty: decayPenalty,
          skill_weight:  skillWeight,
          final:         finalScore,
        },
        metadata: {
          memory_id:    item.id,
          type:         item.type,
          scope:        item.scope,
          tags:         item.tags,
          confidence:   item.confidence,
          created_at:   item.created_at,
          has_embedding: semanticScore > 0,
          semantic_score: semanticScore,
          keyword_score:  keywordScore,
        },
        dropped: false,
      }
    })

    // ── 5. Sort, top-k, touch accessed items ──────────────────
    scored.sort((a, b) => b.scores.final - a.scores.final)
    const topItems = scored.slice(0, limit)

    topItems.forEach((c) => {
      this.storage.touchMemoryItem(c.id).catch(() => {})
    })

    return topItems
  }

  // ── Scoring helpers ───────────────────────────────────────────

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
    return Math.exp(-0.028 * hoursAgo)
  }

  private computeScopeMatch(itemScope: string, requestedScopes: string[]): number {
    if (itemScope === 'global') return 1.0
    if (requestedScopes.includes(itemScope)) return 0.9
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
    if (!tags || tags.length === 0) return 0
    const overlap = tags.filter((t) => activeSkillIds.includes(t)).length
    return Math.min(1, overlap / Math.max(1, activeSkillIds.length))
  }
}

const STOP_WORDS = new Set([
  'the','and','for','are','but','not','you','all','can','had','her','was',
  'one','our','out','day','get','has','him','his','how','man','new','now',
  'old','see','two','way','who','boy','did','its','let','put','say','she',
  'too','use','that','with','this','they','have','from','will','been','said',
  'each','about','your','more','also','into','just','like','than','then',
  'them','some','what','when','which','there','their','would','make','could',
])
