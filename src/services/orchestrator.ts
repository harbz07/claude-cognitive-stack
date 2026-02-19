// ============================================================
// COGNITIVE ORCHESTRATOR — The nervous system
// Coordinates the full request lifecycle
// ============================================================

import type {
  ChatRequest,
  ChatResponse,
  SessionState,
  RequestTrace,
  TraceEvent,
  SlidingWindowEntry,
  InsularPermissions,
} from '../types'
import { StorageService } from './storage'
import { RouterService } from './router'
import { RetrievalService } from './retrieval'
import { ThalamusService } from './thalamus'
import { InsulaService } from './insula'
import { ModelAdapter } from './model-adapter'
import { ConsolidationWorker } from '../workers/consolidation'
import {
  DEFAULT_LOADOUT,
  LOADOUT_MAP,
  estimateTokens,
} from '../config'

export class CognitiveOrchestrator {
  private router: RouterService
  private retrieval: RetrievalService
  private thalamus: ThalamusService
  private insula: InsulaService
  private model: ModelAdapter
  private storage: StorageService

  constructor(storage: StorageService) {
    this.storage = storage
    this.router = new RouterService()
    this.retrieval = new RetrievalService(storage)
    this.thalamus = new ThalamusService()
    this.insula = new InsulaService()
    this.model = new ModelAdapter()
  }

  async process(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const traceId = crypto.randomUUID()
    const requestAt = new Date().toISOString()
    const stages: TraceEvent[] = []

    const addStage = (stage: TraceEvent['stage'], data: Record<string, unknown>, durationMs = 0) => {
      stages.push({
        trace_id: traceId,
        session_id: req.session_id ?? '',
        stage,
        timestamp: new Date().toISOString(),
        duration_ms: durationMs,
        data,
      })
    }

    // ── STAGE 1: INGEST ───────────────────────────────────────
    const t0 = Date.now()
    const session = await this.ingestMessage(req)
    addStage('ingest', {
      session_id: session.session_id,
      message_length: req.message.length,
      window_size: session.sliding_window.length,
    }, Date.now() - t0)

    // ── STAGE 2: ROUTER ───────────────────────────────────────
    const t1 = Date.now()
    const loadout = LOADOUT_MAP[req.loadout_id ?? 'default'] ?? DEFAULT_LOADOUT
    const decision = this.router.decide(req.message, session, req.skill_hints)
    addStage('router', {
      reasoning: decision.reasoning,
      skills: decision.activated_skills.map((s) => s.id),
      scopes: decision.memory_scopes,
      model_profile: decision.model_profile,
    }, Date.now() - t1)

    // ── STAGE 3: RETRIEVE ─────────────────────────────────────
    const t2 = Date.now()
    const candidates = await this.retrieval.retrieve({
      user_id: req.user_id,
      session_id: session.session_id,
      project_id: req.project_id,
      query: req.message,
      decision,
      limit: 25,
    })
    addStage('retrieve', {
      candidates_found: candidates.length,
      top_scores: candidates.slice(0, 5).map((c) => ({
        label: c.label,
        score: c.scores.final.toFixed(3),
      })),
    }, Date.now() - t2)

    // ── STAGE 4: THALAMUS ─────────────────────────────────────
    const t3 = Date.now()
    const { packed, dropped, windowEntries, prompt } = this.thalamus.pack({
      session,
      loadout,
      retrievedCandidates: candidates,
      activatedSkills: decision.activated_skills,
      userMessage: req.message,
      baseSystem: 'You are a helpful assistant with persistent memory across conversations.',
    })

    const pressure = this.thalamus.computePressure(
      prompt.token_breakdown,
      loadout.budgets.l1 + loadout.budgets.l2 + loadout.budgets.skills,
    )

    addStage('thalamus', {
      packed_count: packed.length,
      dropped_count: dropped.length,
      token_pressure: pressure.toFixed(2),
      token_breakdown: prompt.token_breakdown,
      dropped_items: dropped.slice(0, 5).map((d) => ({
        label: d.label,
        reason: d.drop_reason,
        score: d.scores.final.toFixed(3),
      })),
    }, Date.now() - t3)

    // ── STAGE 5: INSULA ───────────────────────────────────────
    const t4 = Date.now()
    const permissions = this.insula.analyze(req.message, req.metadata)
    const filteredBlocks = this.insula.filterContextBlocks(prompt.context_blocks, permissions)
    const cleanedPrompt = { ...prompt, context_blocks: filteredBlocks }
    addStage('insula', {
      can_write_semantic: permissions.can_write_semantic,
      can_write_episodic: permissions.can_write_episodic,
      redacted: permissions.redacted_patterns,
      has_forget_directive: !!permissions.retention_override,
    }, Date.now() - t4)

    // ── STAGE 6: ASSEMBLE ────────────────────────────────────
    const t5 = Date.now()
    // Add current user message to messages
    const finalMessages = [
      ...cleanedPrompt.messages,
      { role: 'user' as const, content: req.message },
    ]
    const finalPrompt = { ...cleanedPrompt, messages: finalMessages }
    addStage('assemble', {
      system_length: finalPrompt.system.length,
      context_blocks: finalPrompt.context_blocks.length,
      messages: finalPrompt.messages.length,
      token_breakdown: finalPrompt.token_breakdown,
    }, Date.now() - t5)

    // ── STAGE 7: GENERATE ─────────────────────────────────────
    const t6 = Date.now()
    let generateResult
    try {
      generateResult = await this.model.generate({
        prompt: finalPrompt,
        model_profile: decision.model_profile,
        api_key: apiKey,
        max_tokens: loadout.budgets.response_reserve,
      })
    } catch (err: any) {
      // Save trace on error
      await this.saveTrace({
        trace_id: traceId,
        session_id: session.session_id,
        user_id: req.user_id,
        request_at: requestAt,
        stages,
        candidates,
        packed,
        dropped,
        prompt: finalPrompt,
        consolidation_queued: false,
        error: err.message,
      })
      throw err
    }
    addStage('generate', {
      model: generateResult.model,
      usage: generateResult.usage,
      stop_reason: generateResult.stop_reason,
      response_length: generateResult.response.length,
    }, Date.now() - t6)

    // ── STAGE 8: UPDATE SESSION ───────────────────────────────
    const now = new Date().toISOString()
    const assistantEntry: SlidingWindowEntry = {
      role: 'assistant',
      content: generateResult.response,
      token_count: generateResult.usage.output_tokens || estimateTokens(generateResult.response),
      timestamp: now,
      trace_id: traceId,
    }

    // Add current user message to window too
    const userEntry: SlidingWindowEntry = {
      role: 'user',
      content: req.message,
      token_count: estimateTokens(req.message),
      timestamp: requestAt,
      trace_id: traceId,
    }

    const updatedWindow = [...session.sliding_window, userEntry, assistantEntry].slice(-50) // cap at 50 turns
    const totalTokensUsed = session.tokens_used + generateResult.usage.total_tokens

    const updatedSession: SessionState = {
      ...session,
      sliding_window: updatedWindow,
      tokens_used: totalTokensUsed,
      running_state: {
        ...session.running_state,
        active_skills: decision.activated_skills.map((s) => s.id),
        pending_consolidation: pressure > loadout.thresholds.consolidation_trigger,
      },
      updated_at: now,
    }
    await this.storage.upsertSession(updatedSession)

    // ── STAGE 8: CONSOLIDATION SCHEDULING ────────────────────
    let consolidationQueued = false
    if (
      permissions.can_write_summary &&
      (pressure > loadout.thresholds.consolidation_trigger || req.metadata?.force_consolidate)
    ) {
      await this.storage.insertConsolidationJob({
        job_id: crypto.randomUUID(),
        session_id: session.session_id,
        trace_id: traceId,
        transcript: updatedWindow,
        context_used: finalPrompt,
        insula_permissions: permissions,
      })
      consolidationQueued = true
    }

    addStage('consolidate', {
      queued: consolidationQueued,
      pressure: pressure.toFixed(2),
      trigger_threshold: loadout.thresholds.consolidation_trigger,
    }, 0)

    // ── SAVE TRACE ────────────────────────────────────────────
    await this.saveTrace({
      trace_id: traceId,
      session_id: session.session_id,
      user_id: req.user_id,
      request_at: requestAt,
      stages,
      candidates,
      packed,
      dropped,
      prompt: finalPrompt,
      consolidation_queued: consolidationQueued,
      error: null,
    })

    return {
      trace_id: traceId,
      session_id: session.session_id,
      response: generateResult.response,
      model: generateResult.model,
      token_breakdown: finalPrompt.token_breakdown,
      skills_activated: decision.activated_skills.map((s) => s.name),
      memory_items_retrieved: candidates.length,
      consolidation_queued: consolidationQueued,
    }
  }

  // ── Helper: Ingest + session bootstrap ─────────────────────
  private async ingestMessage(req: ChatRequest): Promise<SessionState> {
    const now = new Date().toISOString()
    const sessionId = req.session_id ?? crypto.randomUUID()

    let session = await this.storage.getSession(sessionId)

    if (!session) {
      session = {
        session_id: sessionId,
        user_id: req.user_id,
        project_id: req.project_id ?? null,
        token_budget: 16000,
        tokens_used: 0,
        sliding_window: [],
        running_state: {
          goals: [],
          active_skills: [],
          last_tool_results: {},
          pending_consolidation: false,
        },
        metadata: req.metadata ?? {},
        created_at: now,
        updated_at: now,
      }
    }

    return session
  }

  // ── Helper: Persist trace ──────────────────────────────────
  private async saveTrace(params: {
    trace_id: string
    session_id: string
    user_id: string
    request_at: string
    stages: TraceEvent[]
    candidates: any[]
    packed: any[]
    dropped: any[]
    prompt: any
    consolidation_queued: boolean
    error: string | null
  }): Promise<void> {
    await this.storage.insertTrace({
      trace_id: params.trace_id,
      session_id: params.session_id,
      user_id: params.user_id,
      request_at: params.request_at,
      completed_at: new Date().toISOString(),
      stages: params.stages,
      retrieval_candidates: params.candidates,
      thalamus_scores: params.packed,
      dropped_context: params.dropped.map((d) => ({
        label: d.label,
        reason: d.drop_reason,
        score: d.scores?.final,
      })),
      token_breakdown: params.prompt.token_breakdown,
      consolidation_queued: params.consolidation_queued,
      error: params.error,
    })
  }
}
