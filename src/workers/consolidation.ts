// ============================================================
// CONSOLIDATION WORKER — Background memory consolidation
//
// Spec: L3 Hippocampal Consolidation cadence
//   1. Summarize session transcript → key_facts[]
//   2. Extract semantic memory candidates
//   3. Update decay scores for unused items
//   4. Return MemoryDiff (added, updated, removed)
//
// Trigger:
//   - token_pressure: ≥80% budget used
//   - session_end: triggered when session closes
//   - manual: admin / test trigger
// ============================================================

import type {
  ConsolidationJob,
  MemoryItem,
  MemorySummary,
  SlidingWindowEntry,
  InsularPermissions,
  MemoryDiff,
} from '../types'
import { StorageService } from '../services/storage'
import { InsulaService } from '../services/insula'
import { EmbeddingService } from '../services/embeddings'
import { estimateTokens, computeDecay } from '../config'

export class ConsolidationWorker {
  private insula:     InsulaService
  private embeddings: EmbeddingService

  constructor(
    private storage:  StorageService,
    private apiKey:   string,
    private baseUrl?: string,
    ai?: Ai | null,
  ) {
    this.insula     = new InsulaService()
    this.embeddings = new EmbeddingService(ai ?? null)
  }

  async processJob(job: ConsolidationJob): Promise<void> {
    await this.storage.updateJobStatus(job.job_id, 'processing')
    try {
      const results = await this.runConsolidation(job)
      await this.storage.updateJobStatus(job.job_id, 'done', results)
    } catch (err: any) {
      await this.storage.updateJobStatus(job.job_id, 'failed', undefined, err.message)
    }
  }

  async processPendingJobs(): Promise<{ processed: number; errors: number }> {
    const jobs = await this.storage.getPendingJobs(5)
    let processed = 0
    let errors = 0

    for (const job of jobs) {
      try {
        await this.processJob(job as ConsolidationJob)
        processed++
      } catch {
        errors++
      }
    }

    return { processed, errors }
  }

  private async runConsolidation(job: ConsolidationJob): Promise<{
    summary?: any
    semantic_candidates: any[]
    decay_updates: Array<{ id: string; decay_score: number }>
    memory_diff: MemoryDiff
  }> {
    const { session_id, transcript, insula_permissions } = job
    const permissions = insula_permissions as InsularPermissions
    const consolidationType = job.consolidation_type ?? 'token_pressure'

    // Get user_id from trace
    const trace = await this.storage.getTrace(job.trace_id)
    const user_id  = trace?.user_id  ?? 'unknown'
    const project_id = trace?.project_id ?? null

    const memoryDiff: MemoryDiff = {
      added:   0,
      updated: 0,
      removed: 0,
      new_items:          [],
      updated_items:      [],
      key_facts_extracted: [],
    }

    const results: {
      summary?: MemoryItem
      semantic_candidates: MemoryItem[]
      decay_updates: Array<{ id: string; decay_score: number }>
      memory_diff: MemoryDiff
    } = { semantic_candidates: [], decay_updates: [], memory_diff: memoryDiff }

    // ── 1. Summarize transcript → key_facts[] ────────────────
    if (permissions.can_write_summary && transcript.length >= 3) {
      const summaryResult = await this.summarizeTranscript(
        transcript, user_id, session_id, project_id, consolidationType,
      )

      if (summaryResult) {
        results.summary = summaryResult.memoryItem

        // Embed summary for future semantic retrieval
        const summaryEmbedding = await this.embeddings.embed(summaryResult.memoryItem.content)
        if (summaryEmbedding) {
          summaryResult.memoryItem.embedding = summaryEmbedding
        }

        memoryDiff.key_facts_extracted = summaryResult.key_facts

        if (this.insula.shouldPersistToMemory(summaryResult.memoryItem.content, permissions, 'summary')) {
          await this.storage.insertMemoryItem(summaryResult.memoryItem)
          // Sync to pgvector
          if (summaryEmbedding && this.vectorStore?.isConfigured()) {
            await this.vectorStore.insert({
              content:  summaryResult.memoryItem.content,
              metadata: {
                memory_id:  summaryResult.memoryItem.id,
                type:       summaryResult.memoryItem.type,
                scope:      summaryResult.memoryItem.scope,
                user_id:    summaryResult.memoryItem.user_id,
                project_id: summaryResult.memoryItem.project_id,
                session_id,
                tags:       summaryResult.memoryItem.tags,
                confidence: summaryResult.memoryItem.confidence,
              },
              embedding: summaryEmbedding,
            })
          }
          memoryDiff.added++
          memoryDiff.new_items.push(summaryResult.memoryItem.id)
        }
      }
    }

    // ── 2. Extract semantic memories ─────────────────────────
    if (permissions.can_write_semantic) {
      const semanticItems = await this.extractSemanticMemories(
        transcript, user_id, session_id, project_id,
      )
      for (const item of semanticItems) {
        const classification = this.insula.classifyForWrite(item.content, permissions)
        if (classification.action === 'block') continue

        // Redact if needed
        const content = classification.action === 'redact'
          ? this.insula.redact(item.content)
          : item.content

        const finalItem = { ...item, content }

        // Embed semantic item for future retrieval
        const embedding = await this.embeddings.embed(content)
        if (embedding) finalItem.embedding = embedding
        if (this.insula.shouldPersistToMemory(finalItem.content, permissions, 'semantic')) {
          await this.storage.insertMemoryItem(finalItem)
          // Sync to pgvector
          if (embedding && this.vectorStore?.isConfigured()) {
            await this.vectorStore.insert({
              content:  finalItem.content,
              metadata: {
                memory_id:  finalItem.id,
                type:       finalItem.type,
                scope:      finalItem.scope,
                user_id:    finalItem.user_id,
                project_id: finalItem.project_id,
                session_id,
                tags:       finalItem.tags,
                confidence: finalItem.confidence,
              },
              embedding,
            })
          }
          results.semantic_candidates.push(finalItem)
          memoryDiff.added++
          memoryDiff.new_items.push(finalItem.id)
        }
      }
    }

    // ── 3. Decay updates for unused memories ─────────────────
    const existingMemories = await this.storage.queryMemory({
      user_id,
      session_id,
      project_id: project_id ?? undefined,
      exclude_high_decay: false,
      limit: 200,
    })

    for (const mem of existingMemories) {
      const newDecay = computeDecay(mem.last_accessed, mem.created_at)
      if (Math.abs(newDecay - mem.decay_score) > 0.05) {
        results.decay_updates.push({ id: mem.id, decay_score: newDecay })
      }
    }

    if (results.decay_updates.length > 0) {
      await this.storage.updateDecayScores(results.decay_updates)
      memoryDiff.updated += results.decay_updates.length
      memoryDiff.updated_items = results.decay_updates.map((u) => u.id).slice(0, 10)
    }

    results.memory_diff = memoryDiff
    return results
  }

  /**
   * Summarize session transcript with structured key_facts[].
   * Corresponds to MemorySummary schema in spec.
   */
  private async summarizeTranscript(
    transcript: SlidingWindowEntry[],
    user_id: string,
    session_id: string,
    project_id: string | null,
    consolidationType: string,
  ): Promise<{ memoryItem: MemoryItem; key_facts: string[] } | null> {
    if (transcript.length === 0) return null

    const transcriptText = transcript
      .map((e) => `${e.role.toUpperCase()}: ${e.content}`)
      .join('\n')

    const responseText = await this.callModel(
      `You are a memory consolidation engine. Analyze this conversation and extract a structured summary.

Return a JSON object with exactly this shape:
{
  "summary": "3-5 sentence summary of what was discussed",
  "key_facts": ["fact 1", "fact 2", "fact 3"],
  "consolidation_type": "${consolidationType}"
}

Rules for key_facts:
- Extract 3-7 durable facts that would be useful to remember in future sessions
- Format as short, declarative statements (e.g. "User prefers TypeScript over JavaScript")
- Only include facts likely to remain true across sessions
- Skip trivial or session-specific details

<conversation>
${transcriptText.slice(0, 4000)}
</conversation>

JSON:`,
    )

    if (!responseText) return null

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null
      const parsed = JSON.parse(jsonMatch[0])

      const summaryText = parsed.summary ?? responseText
      const keyFacts: string[] = Array.isArray(parsed.key_facts) ? parsed.key_facts.slice(0, 7) : []

      const id = crypto.randomUUID()
      const now = new Date().toISOString()

      const memoryItem: MemoryItem = {
        id,
        type: 'summary',
        scope: project_id ? 'project' : 'session',
        project_id,
        content: summaryText,
        embedding: null,
        source: {
          type:       'consolidation',
          session_id,
        },
        tags: ['summary', 'auto-generated', consolidationType],
        confidence: 0.9,
        decay_score: 0.0,
        created_at:    now,
        last_accessed: now,
        token_count: estimateTokens(summaryText),
        user_id,
      }

      return { memoryItem, key_facts: keyFacts }
    } catch {
      // Fallback: store the raw text
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      return {
        memoryItem: {
          id,
          type: 'summary',
          scope: 'session',
          project_id,
          content: responseText.slice(0, 2000),
          embedding: null,
          source: { type: 'consolidation', session_id },
          tags: ['summary', 'auto-generated'],
          confidence: 0.8,
          decay_score: 0.0,
          created_at: now,
          last_accessed: now,
          token_count: estimateTokens(responseText),
          user_id,
        },
        key_facts: [],
      }
    }
  }

  /**
   * Extract durable semantic facts from conversation.
   */
  private async extractSemanticMemories(
    transcript: SlidingWindowEntry[],
    user_id: string,
    session_id: string,
    project_id: string | null,
  ): Promise<MemoryItem[]> {
    if (transcript.length === 0) return []

    const transcriptText = transcript
      .map((e) => `${e.role.toUpperCase()}: ${e.content}`)
      .join('\n')

    const extractedText = await this.callModel(
      `Extract durable facts and preferences from this conversation.
Return ONLY a JSON array of objects:
[{"content": string, "tags": string[], "confidence": number, "scope": "session"|"project"|"global"}]

Rules:
- Only facts likely to remain true across sessions
- scope: "global" for universal user preferences; "project" for project-specific facts; "session" for one-time context
- Tags should be 1-3 relevant lowercase keywords
- Confidence: 0.5-1.0
- Max 5 items
- Return [] if nothing durable

<conversation>
${transcriptText.slice(0, 3000)}
</conversation>

JSON:`,
    )

    if (!extractedText) return []

    try {
      const jsonMatch = extractedText.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []
      const items: Array<{
        content: string
        tags: string[]
        confidence: number
        scope?: string
      }> = JSON.parse(jsonMatch[0])

      const now = new Date().toISOString()
      return items.slice(0, 5).map((item) => ({
        id: crypto.randomUUID(),
        type: 'semantic' as const,
        scope: (item.scope as any) ?? 'project',
        project_id,
        content: item.content,
        embedding: null,
        source: {
          type:       'consolidation' as const,
          session_id,
        },
        tags:        item.tags ?? [],
        confidence:  Math.min(1, Math.max(0, item.confidence ?? 0.7)),
        decay_score: 0.0,
        created_at:    now,
        last_accessed: now,
        token_count: estimateTokens(item.content),
        user_id,
      }))
    } catch {
      return []
    }
  }

  /**
   * Shared model call — uses OpenAI-compatible if baseUrl set, else Anthropic.
   */
  private async callModel(prompt: string): Promise<string | null> {
    try {
      if (this.baseUrl) {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model:      'gpt-5-mini',
            max_tokens: 2000,
            messages: [
              {
                role:    'system',
                content: 'You are a precise memory consolidation assistant. Return only valid JSON.',
              },
              { role: 'user', content: prompt },
            ],
          }),
        })
        if (!response.ok) return null
        const data = await response.json() as any
        return data.choices?.[0]?.message?.content ?? null
      }

      // Anthropic fallback
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'x-api-key':       this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5',
          max_tokens: 1024,
          messages:   [{ role: 'user', content: prompt }],
        }),
      })

      if (!response.ok) return null
      const data = await response.json() as any
      return data.content?.[0]?.text ?? null
    } catch {
      return null
    }
  }
}
