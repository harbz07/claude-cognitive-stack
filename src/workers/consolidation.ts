// ============================================================
// CONSOLIDATION WORKER — Background memory consolidation
// Summarizes sessions, extracts semantic memories, updates decay
// ============================================================

import type {
  ConsolidationJob,
  MemoryItem,
  SlidingWindowEntry,
  InsularPermissions,
} from '../types'
import { StorageService } from '../services/storage'
import { InsulaService } from '../services/insula'
import { estimateTokens, computeDecay } from '../config'

export class ConsolidationWorker {
  private insula: InsulaService

  constructor(
    private storage: StorageService,
    private apiKey: string,
  ) {
    this.insula = new InsulaService()
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

  private async runConsolidation(job: ConsolidationJob) {
    const { session_id, transcript, insula_permissions } = job
    const permissions = insula_permissions as InsularPermissions

    // Get user_id from job metadata (stored in consolidation_jobs via trace)
    const trace = await this.storage.getTrace(job.trace_id)
    const user_id = trace?.user_id ?? 'unknown'

    const results: {
      summary?: MemoryItem
      semantic_candidates: MemoryItem[]
      decay_updates: Array<{ id: string; decay_score: number }>
    } = { semantic_candidates: [], decay_updates: [] }

    // ── 1. Summarize the session transcript ──────────────────
    if (permissions.can_write_summary && transcript.length >= 3) {
      const summary = await this.summarizeTranscript(transcript, user_id, session_id)
      if (summary) {
        results.summary = summary
        if (this.insula.shouldPersistToMemory(summary.content, permissions, 'summary')) {
          await this.storage.insertMemoryItem(summary)
        }
      }
    }

    // ── 2. Extract semantic memory candidates ─────────────────
    if (permissions.can_write_semantic) {
      const semanticItems = await this.extractSemanticMemories(transcript, user_id, session_id)
      for (const item of semanticItems) {
        if (this.insula.shouldPersistToMemory(item.content, permissions, 'semantic')) {
          await this.storage.insertMemoryItem(item)
          results.semantic_candidates.push(item)
        }
      }
    }

    // ── 3. Update decay scores for existing memories ──────────
    const existingMemories = await this.storage.queryMemory({
      user_id,
      session_id,
      exclude_high_decay: false,
      limit: 100,
    })

    for (const mem of existingMemories) {
      const newDecay = computeDecay(mem.last_accessed, mem.created_at)
      if (Math.abs(newDecay - mem.decay_score) > 0.05) {
        results.decay_updates.push({ id: mem.id, decay_score: newDecay })
      }
    }

    if (results.decay_updates.length > 0) {
      await this.storage.updateDecayScores(results.decay_updates)
    }

    return results
  }

  private async summarizeTranscript(
    transcript: SlidingWindowEntry[],
    user_id: string,
    session_id: string,
  ): Promise<MemoryItem | null> {
    if (transcript.length === 0) return null

    const transcriptText = transcript
      .map((e) => `${e.role.toUpperCase()}: ${e.content}`)
      .join('\n')

    const summaryContent = await this.callClaude(
      `Summarize this conversation in 3-5 concise bullet points. 
Focus on: key decisions made, important facts mentioned, user preferences revealed, unresolved questions.
Format as bullets starting with "•". Be specific, not generic.

<conversation>
${transcriptText.slice(0, 4000)}
</conversation>`,
    )

    if (!summaryContent) return null

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    return {
      id,
      type: 'summary',
      scope: 'session',
      content: summaryContent,
      embedding: null,
      tags: ['summary', 'auto-generated'],
      confidence: 0.9,
      decay_score: 0.0,
      created_at: now,
      last_accessed: now,
      provenance: { session_id, source: 'consolidation' },
      token_count: estimateTokens(summaryContent),
    }
  }

  private async extractSemanticMemories(
    transcript: SlidingWindowEntry[],
    user_id: string,
    session_id: string,
  ): Promise<MemoryItem[]> {
    if (transcript.length === 0) return []

    const transcriptText = transcript
      .map((e) => `${e.role.toUpperCase()}: ${e.content}`)
      .join('\n')

    const extractedText = await this.callClaude(
      `Extract durable facts and preferences from this conversation.
Return ONLY a JSON array of objects with shape:
{ "content": string, "tags": string[], "confidence": number }

Rules:
- Only include facts likely to remain true across sessions
- Tags should be 1-3 relevant keywords
- Confidence: 0.5-1.0 (how certain/durable this fact is)
- Max 5 items
- Return empty array [] if nothing durable found

<conversation>
${transcriptText.slice(0, 3000)}
</conversation>

JSON:`,
    )

    if (!extractedText) return []

    try {
      const jsonMatch = extractedText.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []
      const items: Array<{ content: string; tags: string[]; confidence: number }> = JSON.parse(jsonMatch[0])

      const now = new Date().toISOString()
      return items.slice(0, 5).map((item) => ({
        id: crypto.randomUUID(),
        type: 'semantic' as const,
        scope: 'project' as const,
        content: item.content,
        embedding: null,
        tags: item.tags ?? [],
        confidence: Math.min(1, Math.max(0, item.confidence ?? 0.7)),
        decay_score: 0.0,
        created_at: now,
        last_accessed: now,
        provenance: { session_id, source: 'consolidation' as const },
        token_count: estimateTokens(item.content),
      }))
    } catch {
      return []
    }
  }

  private async callClaude(prompt: string): Promise<string | null> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
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
