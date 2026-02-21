// ============================================================
// RAG SEARCH — Retrieval-Augmented Generation search node
// Spec: https://www.basecampgrounds.com (RAG Search node)
//
// Sources:
//   1. chat_index   — L1 sliding-window history
//   2. knowledge_graph — L2 semantic + episodic memories
//   3. project_docs — project-scoped document chunks
//
// Returns ranked results with provenance / citations.
// ============================================================

import type {
  RagResult,
  Citation,
  ContextCandidate,
  SlidingWindowEntry,
  WernickeDecision,
} from '../types'
import { estimateTokens } from '../config'
import { StorageService } from './storage'

export class RagSearchService {
  constructor(private storage: StorageService) {}

  /**
   * Full RAG search across all configured sources.
   * Returns ContextCandidates tagged with source = 'rag' and citation info.
   */
  async search(params: {
    query: string
    user_id: string
    session_id: string
    project_id?: string
    decision: WernickeDecision
    sliding_window: SlidingWindowEntry[]
    top_k?: number
    min_score?: number
  }): Promise<{
    candidates: ContextCandidate[]
    citations: Citation[]
  }> {
    const {
      query,
      user_id,
      session_id,
      project_id,
      decision,
      sliding_window,
      top_k = decision.rag_top_k ?? 5,
      min_score = decision.min_score ?? 0.72,
    } = params

    const allResults: RagResult[] = []

    // ── Source 1: chat_index (L1 sliding window history) ─────
    if (decision.rag_sources.includes('chat_index') && sliding_window.length > 0) {
      const chatResults = this.searchChatIndex(query, sliding_window, session_id)
      allResults.push(...chatResults)
    }

    // ── Source 2: knowledge_graph (L2 memory items) ───────────
    if (decision.rag_sources.includes('knowledge_graph')) {
      const memoryResults = await this.searchKnowledgeGraph({
        query,
        user_id,
        session_id,
        project_id,
        limit: top_k * 3,
      })
      allResults.push(...memoryResults)
    }

    // ── Source 3: project_docs (document-sourced memories) ─────
    if (decision.rag_sources.includes('project_docs') && project_id) {
      const docResults = await this.searchProjectDocs({
        query,
        user_id,
        session_id,
        project_id,
        limit: top_k * 3,
      })
      allResults.push(...docResults)
    }

    // ── Deduplicate and score ─────────────────────────────────
    const seen = new Set<string>()
    const unique = allResults.filter((r) => {
      if (seen.has(r.id)) return false
      seen.add(r.id)
      return true
    })

    // Sort by relevance
    unique.sort((a, b) => b.relevance - a.relevance)

    // Apply min_score gate
    const above = unique.filter((r) => r.relevance >= min_score)
    const topResults = above.slice(0, top_k)

    // ── Build ContextCandidates with citations ─────────────────
    const candidates: ContextCandidate[] = topResults.map((result) => {
      const citation: Citation = {
        source: result.source,
        source_type: result.source_type,
        message_id: result.message_id,
        memory_id: (result.source_type === 'memory' || result.source_type === 'document')
          ? result.id
          : undefined,
        relevance: result.relevance,
        content_snippet: result.content.slice(0, 120),
      }

      return {
        id: `rag:${result.id}`,
        source: 'rag',
        content: result.content,
        label: `[rag:${result.source_type}] ${result.source}`,
        token_count: result.token_count,
        citation,
        scores: {
          relevance: result.relevance,
          recency: 0.8,   // RAG results are already ranked; use fixed recency boost
          scope_match: 1.0,
          type_priority: result.source_type === 'memory' ? 0.85 : 0.70,
          decay_penalty: 0,
          skill_weight: 0,
          final: result.relevance,
        },
        metadata: result.metadata,
        dropped: false,
      }
    })

    const citations: Citation[] = candidates
      .filter((c) => c.citation)
      .map((c) => c.citation!)

    return { candidates, citations }
  }

  // ── Chat Index Search ────────────────────────────────────────
  // Searches the in-memory L1 sliding window for relevant turns.
  private searchChatIndex(
    query: string,
    window: SlidingWindowEntry[],
    session_id: string,
  ): RagResult[] {
    const qTokens = this.tokenize(query)
    if (qTokens.length === 0) return []

    return window
      .filter((e) => e.role !== 'system')
      .map((entry): RagResult => {
        const cTokens = new Set(this.tokenize(entry.content))
        const matches = qTokens.filter((t) => cTokens.has(t)).length
        const relevance = Math.min(1, matches / Math.max(1, qTokens.length))

        // Recency bonus: more recent = higher score
        const ageMs = Date.now() - new Date(entry.timestamp).getTime()
        const recencyBonus = Math.exp(-ageMs / (1000 * 60 * 60 * 2)) * 0.15  // 2h half-life

        return {
          id: entry.message_id ?? `chat:${entry.timestamp}`,
          content: `[${entry.role.toUpperCase()}]: ${entry.content}`,
          source: `chat_${entry.role}_${entry.timestamp?.slice(0, 10)}`,
          source_type: 'chat',
          relevance: Math.min(1, relevance + recencyBonus),
          token_count: entry.token_count || estimateTokens(entry.content),
          message_id: entry.message_id,
          metadata: { role: entry.role, timestamp: entry.timestamp, session_id },
        }
      })
      .filter((r) => r.relevance > 0.1)   // Minimum threshold for chat index
      .sort((a, b) => b.relevance - a.relevance)
  }

  // ── Knowledge Graph Search ────────────────────────────────────
  // Searches L2 memory items (semantic + episodic + summary).
  private async searchKnowledgeGraph(params: {
    query: string
    user_id: string
    session_id: string
    project_id?: string
    limit: number
  }): Promise<RagResult[]> {
    const { query, user_id, session_id, project_id, limit } = params

    // Fetch memory items from storage
    const items = await this.storage.queryMemory({
      user_id,
      session_id,
      project_id,
      exclude_high_decay: true,
      limit,
    })

    // Document chunks are retrieved by project_docs source to keep provenance clean.
    const memoryItems = items.filter(
      (item) => String(item.source ?? '').toLowerCase() !== 'document',
    )

    if (memoryItems.length === 0) return []

    const qTokens = this.tokenize(query)
    if (qTokens.length === 0) return []

    return memoryItems.map((item): RagResult => {
      const cTokens = new Set(this.tokenize(item.content))
      const textMatches = qTokens.filter((t) => cTokens.has(t)).length
      const textScore = Math.min(1, textMatches / Math.max(1, qTokens.length))

      // Type boost: summaries and semantic memories get a bonus
      const typeBoost = item.type === 'summary' ? 0.15
                      : item.type === 'semantic' ? 0.10 : 0.0

      // Tag match boost
      const tags: string[] = item.tags ?? []
      const tagMatches = qTokens.filter((t) => tags.some((tag) => tag.toLowerCase().includes(t))).length
      const tagBoost = Math.min(0.15, tagMatches * 0.05)

      // Decay penalty
      const decayPenalty = (item.decay_score ?? 0) * 0.2

      const relevance = Math.min(1, textScore + typeBoost + tagBoost - decayPenalty)

      return {
        id: item.id,
        content: item.content,
        source: `memory_${item.type}_${item.scope}`,
        source_type: 'memory',
        relevance,
        token_count: item.token_count || estimateTokens(item.content),
        metadata: {
          memory_id: item.id,
          type: item.type,
          scope: item.scope,
          tags: item.tags,
          confidence: item.confidence,
          decay_score: item.decay_score,
          created_at: item.created_at,
        },
      }
    })
  }

  // ── Project Docs Search ────────────────────────────────────────
  // Retrieves document-sourced chunks scoped to the active project.
  private async searchProjectDocs(params: {
    query: string
    user_id: string
    session_id: string
    project_id: string
    limit: number
  }): Promise<RagResult[]> {
    const { query, user_id, session_id, project_id, limit } = params

    const items = await this.storage.queryMemory({
      user_id,
      session_id,
      project_id,
      exclude_high_decay: true,
      limit,
    })

    const docItems = items.filter(
      (item) => String(item.source ?? '').toLowerCase() === 'document',
    )
    if (docItems.length === 0) return []

    const qTokens = this.tokenize(query)
    if (qTokens.length === 0) return []

    return docItems.map((item): RagResult => {
      const cTokens = new Set(this.tokenize(item.content))
      const textMatches = qTokens.filter((t) => cTokens.has(t)).length
      const textScore = Math.min(1, textMatches / Math.max(1, qTokens.length))

      const tags: string[] = item.tags ?? []
      const tagMatches = qTokens.filter((t) =>
        tags.some((tag) => tag.toLowerCase().includes(t)),
      ).length
      const tagBoost = Math.min(0.2, tagMatches * 0.05)

      const projectBoost = item.project_id === project_id ? 0.08 : 0
      const decayPenalty = (item.decay_score ?? 0) * 0.2
      const relevance = Math.min(1, textScore + tagBoost + projectBoost - decayPenalty)

      return {
        id: item.id,
        content: item.content,
        source: `project_doc_${(item.project_id ?? 'unknown').toString().slice(0, 10)}`,
        source_type: 'document',
        relevance,
        token_count: item.token_count || estimateTokens(item.content),
        metadata: {
          memory_id: item.id,
          project_id: item.project_id,
          scope: item.scope,
          tags: item.tags,
          created_at: item.created_at,
        },
      }
    })
  }

  // ─── Tokenizer (shared with retrieval service) ────────────────
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
  }

  /**
   * Build citation annotations for a response.
   * Matches retrieved candidates to their source IDs.
   */
  buildCitations(candidates: ContextCandidate[]): Citation[] {
    return candidates
      .filter((c) => c.citation && !c.dropped)
      .map((c) => ({
        ...c.citation!,
        relevance: c.scores.final,
      }))
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
  'very', 'want', 'need', 'know', 'think', 'help', 'tell', 'show', 'give',
])
