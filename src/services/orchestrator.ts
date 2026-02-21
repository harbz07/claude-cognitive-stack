// ============================================================
// COGNITIVE ORCHESTRATOR — The nervous system
// Coordinates the full 8-stage request lifecycle:
//
//   1. Ingest      — session bootstrap, L1 update
//   2. Wernicke    — skill activation, model routing, RAG config
//   3. RAG         — chat_index + knowledge_graph search + citations
//   4. Thalamus    — score + pack within token budgets (threshold 0.72)
//   5. Insula      — PII redaction, sentiment, write gating
//   6. Assemble    — compose system + context + messages with citations
//   7. Generate    — call model via adapter
//   8. Consolidate — queue session_end or token_pressure job
//
// Also handles:
//   - L1 compaction when pressure ≥ 80%
//   - Project namespace isolation
//   - memory_diff tracking
// ============================================================

import type {
  ChatRequest,
  ChatResponse,
  SessionState,
  TraceEvent,
  SlidingWindowEntry,
  InsularPermissions,
  Citation,
  MemoryDiff,
} from '../types'
import { StorageService } from './storage'
import { WernickeRouter }  from './router'
import { RetrievalService } from './retrieval'
import { RagSearchService }  from './rag'
import { ThalamusService }  from './thalamus'
import { InsulaService }    from './insula'
import { ModelAdapter }     from './model-adapter'
import { EmbeddingService } from './embeddings'
import { ConsolidationWorker } from '../workers/consolidation'
import { DEFAULT_LOADOUT, LOADOUT_MAP, estimateTokens } from '../config'

export class CognitiveOrchestrator {
  private wernicke:   WernickeRouter
  private retrieval:  RetrievalService
  private rag:        RagSearchService
  private thalamus:   ThalamusService
  private insula:     InsulaService
  private model:      ModelAdapter
  private storage:    StorageService
  private embeddings: EmbeddingService

  constructor(storage: StorageService, ai?: Ai | null) {
    this.storage    = storage
    this.embeddings = new EmbeddingService(ai ?? null)
    this.wernicke   = new WernickeRouter()
    this.retrieval  = new RetrievalService(storage)
    this.rag        = new RagSearchService(storage)
    this.thalamus   = new ThalamusService()
    this.insula     = new InsulaService()
    this.model      = new ModelAdapter()
  }

  async process(
    req: ChatRequest,
    apiKey: string,
    baseUrl?: string,
  ): Promise<ChatResponse> {
    const traceId   = crypto.randomUUID()
    const requestAt = new Date().toISOString()
    const stages:   TraceEvent[] = []

    const addStage = (
      stage: TraceEvent['stage'],
      data: Record<string, unknown>,
      durationMs = 0,
    ) => {
      stages.push({
        trace_id:    traceId,
        session_id:  req.session_id ?? '',
        stage,
        timestamp:   new Date().toISOString(),
        duration_ms: durationMs,
        data,
      })
    }

    // ── STAGE 1: INGEST ───────────────────────────────────────
    const t0 = Date.now()
    const session = await this.ingestMessage(req)
    addStage('ingest', {
      session_id:  session.session_id,
      project_id:  session.project_id,
      message_len: req.message.length,
      window_size: session.sliding_window.length,
    }, Date.now() - t0)

    // ── STAGE 2: WERNICKE ROUTER ──────────────────────────────
    const t1 = Date.now()
    const loadout = LOADOUT_MAP[req.loadout_id ?? 'default'] ?? DEFAULT_LOADOUT

    // Merge project-level overrides into loadout if project exists
    let effectiveLoadout = { ...loadout }
    if (session.project_id) {
      try {
        const project = await this.storage.getProject(session.project_id)
        if (project) {
          effectiveLoadout = {
            ...loadout,
            thresholds: {
              ...loadout.thresholds,
              thalamus_threshold: project.thalamus_threshold ?? loadout.thresholds.thalamus_threshold,
            },
            insula_mode: project.insula_mode ?? loadout.insula_mode,
            rag_top_k:   project.rag_top_k   ?? loadout.rag_top_k,
          }
        }
      } catch { /* project not found — use defaults */ }
    }

    const decision = this.wernicke.decide(req.message, session, req.skill_hints)
    addStage('wernicke', {
      reasoning:    decision.reasoning,
      skills:       decision.activated_skills.map((s) => s.id),
      scopes:       decision.memory_scopes,
      model:        decision.model_profile,
      rag_sources:  decision.rag_sources,
      rag_top_k:    decision.rag_top_k,
      project_id:   session.project_id,
    }, Date.now() - t1)

    // ── STAGE 3: RAG SEARCH ───────────────────────────────────
    const t2 = Date.now()

    // 3a. Embed query for semantic retrieval (non-blocking fallback if AI unavailable)
    const queryEmbedding = await this.embeddings.embed(req.message)

    // 3b. L2 Memory retrieval (with semantic embedding if available)
    const memoryCandidates = await this.retrieval.retrieve({
      user_id:        req.user_id,
      session_id:     session.session_id,
      project_id:     req.project_id ?? session.project_id ?? undefined,
      query:          req.message,
      queryEmbedding: queryEmbedding,
      decision,
      limit: 25,
    })

    // 3b. RAG search (chat_index + knowledge_graph)
    const { candidates: ragCandidates, citations: ragCitations } = await this.rag.search({
      query:          req.message,
      user_id:        req.user_id,
      session_id:     session.session_id,
      project_id:     req.project_id ?? session.project_id ?? undefined,
      decision,
      sliding_window: session.sliding_window,
      top_k:          effectiveLoadout.rag_top_k,
      min_score:      effectiveLoadout.thresholds.thalamus_threshold,
    })

    addStage('rag', {
      memory_candidates: memoryCandidates.length,
      rag_candidates:    ragCandidates.length,
      citations_found:   ragCitations.length,
      semantic_enabled:  queryEmbedding !== null,
      embedding_dims:    queryEmbedding?.length ?? 0,
      top_rag_scores:    ragCandidates.slice(0, 3).map((c) => ({
        label: c.label,
        score: c.scores.final.toFixed(3),
      })),
    }, Date.now() - t2)

    // ── STAGE 4: THALAMUS ─────────────────────────────────────
    const t3 = Date.now()

    // System prompt injection — with optional multi-agent persona
    const agentName = req.metadata?.agent_name as string | undefined
    const agentPersona = req.metadata?.agent_persona as string | undefined
    const activeAgents = req.metadata?.active_agents as string[] | undefined

    let baseSystem: string
    if (agentPersona) {
      const otherAgents = activeAgents?.filter(a => a !== agentName) ?? []
      baseSystem = `${agentPersona}

${otherAgents.length > 0 ? `You are "${agentName}" in a multi-agent conversation. Other participants: ${otherAgents.join(', ')}. Messages from other agents appear in conversation history tagged with their name. Stay in character.\n\n` : ''}You have access to retrieved memories and conversation history.
When referencing retrieved information, cite it explicitly.
Current session: ${session.session_id.slice(0, 8)}...
${session.project_id ? `Project context: ${session.project_id}` : ''}`
    } else {
      baseSystem = `You are a helpful, memory-aware AI assistant with persistent context across conversations.
You have access to retrieved memories and conversation history.
When referencing retrieved information, cite it explicitly.
Current session: ${session.session_id.slice(0, 8)}...
${session.project_id ? `Project context: ${session.project_id}` : ''}`
    }

    const {
      packed,
      dropped,
      windowEntries,
      prompt,
      citations: thalCitations,
    } = this.thalamus.pack({
      session,
      loadout:            effectiveLoadout,
      retrievedCandidates: memoryCandidates,
      ragCandidates,
      activatedSkills:    decision.activated_skills,
      userMessage:        req.message,
      baseSystem,
    })

    const totalBudget =
      effectiveLoadout.budgets.l1_window_tokens +
      effectiveLoadout.budgets.l2_budget_tokens +
      effectiveLoadout.budgets.skills
    const pressure = this.thalamus.computePressure(prompt.token_breakdown, totalBudget)

    addStage('thalamus', {
      packed_count:    packed.length,
      dropped_count:   dropped.length,
      threshold_used:  effectiveLoadout.thresholds.thalamus_threshold,
      token_pressure:  pressure.toFixed(2),
      token_breakdown: prompt.token_breakdown,
      dropped_items:   dropped.slice(0, 5).map((d) => ({
        label:  d.label,
        reason: d.drop_reason,
        score:  d.scores.final.toFixed(3),
      })),
    }, Date.now() - t3)

    // ── STAGE 5: INSULA ───────────────────────────────────────
    const t4 = Date.now()
    const permissions = this.insula.analyze(
      req.message,
      req.metadata,
      effectiveLoadout.insula_mode,
    )
    const filteredBlocks = this.insula.filterContextBlocks(prompt.context_blocks, permissions)
    const cleanedPrompt  = { ...prompt, context_blocks: filteredBlocks }

    addStage('insula', {
      can_write_semantic: permissions.can_write_semantic,
      can_write_episodic: permissions.can_write_episodic,
      sentiment:          permissions.sentiment,
      sentiment_score:    permissions.sentiment_score.toFixed(2),
      redacted:           permissions.redacted_patterns,
      has_forget_directive: !!permissions.retention_override,
    }, Date.now() - t4)

    // ── STAGE 6: ASSEMBLE ─────────────────────────────────────
    const t5 = Date.now()

    // Build citation annotations for context blocks
    const allCitations: Citation[] = [
      ...ragCitations,
      ...thalCitations.filter((c) =>
        !ragCitations.some((r) => r.memory_id === c.memory_id)
      ),
    ]

    // Add current user message to messages array
    const finalMessages = [
      ...cleanedPrompt.messages,
      { role: 'user' as const, content: req.message },
    ]

    // Build context block header with citation references
    const citationPrefix = allCitations.length > 0
      ? `\n\n[Retrieved Context — ${allCitations.length} sources]\n` +
        allCitations.slice(0, 5)
          .map((c, i) => `[${i + 1}] ${c.source} (relevance: ${c.relevance.toFixed(2)})`)
          .join('\n')
      : ''

    const systemWithCitations = cleanedPrompt.system + citationPrefix
    const finalPrompt = {
      ...cleanedPrompt,
      system:   systemWithCitations,
      messages: finalMessages,
    }

    addStage('assemble', {
      system_length:  finalPrompt.system.length,
      context_blocks: finalPrompt.context_blocks.length,
      messages:       finalPrompt.messages.length,
      citations:      allCitations.length,
      token_breakdown: finalPrompt.token_breakdown,
    }, Date.now() - t5)

    // ── STAGE 7: GENERATE ─────────────────────────────────────
    const t6 = Date.now()
    let generateResult
    try {
      generateResult = await this.model.generate({
        prompt:        finalPrompt,
        model_profile: decision.model_profile,
        api_key:       apiKey,
        base_url:      baseUrl,
        max_tokens:    effectiveLoadout.budgets.response_reserve,
      })
    } catch (err: any) {
      await this.saveTrace({
        traceId,
        session,
        userId: req.user_id,
        requestAt,
        stages,
        candidates: memoryCandidates,
        packed,
        dropped,
        prompt: finalPrompt,
        citations: allCitations,
        memoryDiff: null,
        consolidationQueued: false,
        consolidationType:   undefined,
        error: err.message,
      })
      throw err
    }
    addStage('generate', {
      model:           generateResult.model,
      usage:           generateResult.usage,
      stop_reason:     generateResult.stop_reason,
      response_length: generateResult.response.length,
    }, Date.now() - t6)

    // ── STAGE 8: SESSION UPDATE + L1 COMPACTION ───────────────
    const now = new Date().toISOString()
    const userMsgId  = crypto.randomUUID()
    const assistantMsgId = crypto.randomUUID()

    const userEntry: SlidingWindowEntry = {
      role:        'user',
      content:     req.message,
      token_count: estimateTokens(req.message),
      timestamp:   requestAt,
      trace_id:    traceId,
      message_id:  userMsgId,
    }
    const taggedResponse = agentName
      ? `[${agentName}] ${generateResult.response}`
      : generateResult.response

    const assistantEntry: SlidingWindowEntry = {
      role:        'assistant',
      content:     taggedResponse,
      token_count: generateResult.usage.output_tokens || estimateTokens(taggedResponse),
      timestamp:   now,
      trace_id:    traceId,
      message_id:  assistantMsgId,
    }

    let updatedWindow = [...session.sliding_window, userEntry, assistantEntry]

    // ── L1 Compaction: evict oldest entries if over budget ────
    let compactionPass = session.running_state.compaction_pass ?? 0
    if (pressure >= effectiveLoadout.thresholds.consolidation_trigger) {
      const targetTokens = Math.floor(effectiveLoadout.budgets.l1_window_tokens * 0.6)
      const { compacted, evicted } = this.thalamus.compactL1(updatedWindow, targetTokens)
      if (evicted.length > 0) {
        updatedWindow = compacted
        compactionPass++
        addStage('compact', {
          evicted_count: evicted.length,
          compaction_pass: compactionPass,
          target_tokens: targetTokens,
        }, 0)
      }
    } else {
      // Cap at 50 turns regardless
      updatedWindow = updatedWindow.slice(-50)
    }

    const totalTokensUsed = session.tokens_used + (generateResult.usage.total_tokens ?? 0)
    const updatedSession: SessionState = {
      ...session,
      sliding_window: updatedWindow,
      tokens_used:    totalTokensUsed,
      running_state: {
        ...session.running_state,
        active_skills:         decision.activated_skills.map((s) => s.id),
        pending_consolidation: pressure >= effectiveLoadout.thresholds.consolidation_trigger,
        compaction_pass:       compactionPass,
      },
      updated_at: now,
    }
    await this.storage.upsertSession(updatedSession)

    // ── STAGE 8: CONSOLIDATION SCHEDULING ────────────────────
    let consolidationQueued = false
    let consolidationType: string | undefined

    const shouldConsolidate =
      permissions.can_write_summary &&
      (pressure >= effectiveLoadout.thresholds.consolidation_trigger ||
       req.metadata?.force_consolidate === true ||
       req.metadata?.session_end === true)

    if (shouldConsolidate) {
      consolidationType = req.metadata?.session_end === true
        ? 'session_end'
        : pressure >= effectiveLoadout.thresholds.consolidation_trigger
        ? 'token_pressure'
        : 'manual'

      await this.storage.insertConsolidationJob({
        job_id:            crypto.randomUUID(),
        session_id:        session.session_id,
        trace_id:          traceId,
        consolidation_type: consolidationType,
        transcript:        updatedWindow,
        context_used:      finalPrompt,
        insula_permissions: permissions,
      })
      consolidationQueued = true
    }

    addStage('consolidate', {
      queued:              consolidationQueued,
      consolidation_type:  consolidationType,
      pressure:            pressure.toFixed(2),
      trigger_threshold:   effectiveLoadout.thresholds.consolidation_trigger,
    }, 0)

    // ── SAVE TRACE ────────────────────────────────────────────
    await this.saveTrace({
      traceId,
      session,
      userId: req.user_id,
      requestAt,
      stages,
      candidates: memoryCandidates,
      packed,
      dropped,
      prompt: finalPrompt,
      citations: allCitations,
      memoryDiff: null,  // will be updated after consolidation
      consolidationQueued,
      consolidationType,
      error: null,
    })

    return {
      trace_id:               traceId,
      session_id:             session.session_id,
      response:               generateResult.response,
      model:                  generateResult.model,
      token_breakdown:        finalPrompt.token_breakdown,
      skills_activated:       decision.activated_skills.map((s) => s.name),
      memory_items_retrieved: memoryCandidates.length + ragCandidates.length,
      citations:              allCitations,
      memory_diff:            null,  // populated after async consolidation
      consolidation_queued:   consolidationQueued,
      consolidation_type:     consolidationType,
    }
  }

  // ── Helper: Ingest + session bootstrap ─────────────────────

  private async ingestMessage(req: ChatRequest): Promise<SessionState> {
    const now       = new Date().toISOString()
    const sessionId = req.session_id ?? crypto.randomUUID()

    let session = await this.storage.getSession(sessionId)

    if (!session) {
      session = {
        session_id:  sessionId,
        user_id:     req.user_id,
        project_id:  req.project_id ?? null,
        token_budget: 16000,
        tokens_used:  0,
        sliding_window: [],
        running_state: {
          goals:                 [],
          active_skills:         [],
          last_tool_results:     {},
          pending_consolidation: false,
          compaction_pass:       0,
        },
        metadata:   req.metadata ?? {},
        created_at: now,
        updated_at: now,
      }
    }

    return session
  }

  // ── Helper: Persist trace ──────────────────────────────────

  private async saveTrace(params: {
    traceId:             string
    session:             SessionState
    userId:              string
    requestAt:           string
    stages:              TraceEvent[]
    candidates:          any[]
    packed:              any[]
    dropped:             any[]
    prompt:              any
    citations:           Citation[]
    memoryDiff:          MemoryDiff | null
    consolidationQueued: boolean
    consolidationType:   string | undefined
    error:               string | null
  }): Promise<void> {
    await this.storage.insertTrace({
      trace_id:             params.traceId,
      session_id:           params.session.session_id,
      user_id:              params.userId,
      request_at:           params.requestAt,
      completed_at:         new Date().toISOString(),
      stages:               params.stages,
      retrieval_candidates: params.candidates,
      thalamus_scores:      params.packed,
      dropped_context:      params.dropped.map((d) => ({
        label:  d.label,
        reason: d.drop_reason,
        score:  d.scores?.final,
      })),
      citations:            params.citations,
      memory_diff:          params.memoryDiff,
      token_breakdown:      params.prompt.token_breakdown,
      consolidation_queued: params.consolidationQueued,
      consolidation_type:   params.consolidationType,
      error:                params.error,
    })
  }
}
