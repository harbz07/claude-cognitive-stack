// ============================================================
// COGNITIVE RUNTIME SERVICE — Core Type Definitions
// ============================================================

export type MemoryType = 'episodic' | 'semantic' | 'summary'
export type MemoryScope = 'session' | 'project' | 'global'
export type ModelProfile = 'default' | 'fast' | 'deep' | 'code'

// ─── L2/L3 Memory Item ───────────────────────────────────────
export interface MemoryItem {
  id: string
  type: MemoryType
  scope: MemoryScope
  content: string
  embedding: number[] | null
  tags: string[]
  confidence: number          // 0..1
  decay_score: number         // 0..1 (higher = more decayed)
  created_at: string
  last_accessed: string
  provenance: {
    session_id: string
    source: 'user' | 'assistant' | 'system' | 'consolidation'
  }
  token_count: number
}

// ─── L1 Session State ────────────────────────────────────────
export interface SlidingWindowEntry {
  role: 'user' | 'assistant' | 'system'
  content: string
  token_count: number
  timestamp: string
  trace_id?: string
}

export interface RunningState {
  goals: string[]
  active_skills: string[]
  last_tool_results: Record<string, unknown>
  pending_consolidation: boolean
}

export interface SessionState {
  session_id: string
  user_id: string
  project_id: string | null
  token_budget: number
  tokens_used: number
  sliding_window: SlidingWindowEntry[]
  running_state: RunningState
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
}

// ─── Skill Package ───────────────────────────────────────────
export interface SkillTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface SkillPackage {
  id: string
  name: string
  trigger: string | RegExp
  system_fragment: string
  tools: SkillTool[]
  priority: number            // higher = loads first
  token_budget: number
  enabled: boolean
  metadata: Record<string, unknown>
}

// ─── Loadout ─────────────────────────────────────────────────
export interface BudgetConfig {
  l1: number                  // tokens for sliding window
  l2: number                  // tokens for retrieved memory
  skills: number              // tokens for skill fragments
  response_reserve: number    // reserved for Claude's response
}

export interface ThresholdConfig {
  consolidation_trigger: number    // token pressure ratio 0..1
  memory_relevance_min: number     // minimum score to include
  decay_write_threshold: number    // minimum confidence to persist
}

export interface Loadout {
  id: string
  name: string
  model_profile: ModelProfile
  budgets: BudgetConfig
  thresholds: ThresholdConfig
  active_skill_ids: string[]
  created_at: string
}

// ─── Thalamus Context Scoring ────────────────────────────────
export interface ContextCandidate {
  id: string
  source: 'l1_window' | 'l2_memory' | 'skill' | 'system'
  content: string
  label: string
  token_count: number
  scores: {
    relevance: number
    recency: number
    scope_match: number
    type_priority: number
    decay_penalty: number
    skill_weight: number
    final: number
  }
  metadata: Record<string, unknown>
  dropped: boolean
  drop_reason?: string
}

// ─── Assembled Prompt ────────────────────────────────────────
export interface AssembledPrompt {
  system: string
  context_blocks: Array<{
    label: string
    content: string
    token_count: number
    source: string
  }>
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
  token_breakdown: {
    system: number
    context: number
    history: number
    user_message: number
    total: number
    budget_remaining: number
  }
}

// ─── Observability / Trace ───────────────────────────────────
export interface TraceEvent {
  trace_id: string
  session_id: string
  stage:
    | 'ingest'
    | 'router'
    | 'retrieve'
    | 'thalamus'
    | 'insula'
    | 'assemble'
    | 'generate'
    | 'consolidate'
  timestamp: string
  duration_ms: number
  data: Record<string, unknown>
}

export interface RequestTrace {
  trace_id: string
  session_id: string
  user_id: string
  request_at: string
  completed_at: string | null
  stages: TraceEvent[]
  retrieval_candidates: ContextCandidate[]
  thalamus_scores: ContextCandidate[]
  dropped_context: Array<{ label: string; reason: string; score: number }>
  token_breakdown: AssembledPrompt['token_breakdown'] | null
  consolidation_queued: boolean
  error: string | null
}

// ─── API Contracts ───────────────────────────────────────────
export interface ChatRequest {
  session_id?: string
  user_id: string
  project_id?: string
  message: string
  skill_hints?: string[]
  loadout_id?: string
  stream?: boolean
  metadata?: Record<string, unknown>
}

export interface ChatResponse {
  trace_id: string
  session_id: string
  response: string
  model: string
  token_breakdown: AssembledPrompt['token_breakdown']
  skills_activated: string[]
  memory_items_retrieved: number
  consolidation_queued: boolean
}

export interface MemoryQueryRequest {
  session_id?: string
  project_id?: string
  query: string
  scope?: MemoryScope
  type?: MemoryType
  limit?: number
  min_score?: number
}

export interface ConsolidationJob {
  job_id: string
  session_id: string
  trace_id: string
  transcript: SlidingWindowEntry[]
  context_used: AssembledPrompt
  insula_permissions: InsularPermissions
  created_at: string
  status: 'pending' | 'processing' | 'done' | 'failed'
}

// ─── Insula ──────────────────────────────────────────────────
export interface InsularPermissions {
  can_write_semantic: boolean
  can_write_episodic: boolean
  can_write_summary: boolean
  redacted_patterns: string[]
  retention_override?: {
    forget_after_session: boolean
    forget_after_project: boolean
  }
}

// ─── Router Decision ─────────────────────────────────────────
export interface RouterDecision {
  activated_skills: SkillPackage[]
  memory_scopes: MemoryScope[]
  model_profile: ModelProfile
  requires_deep_retrieval: boolean
  query_embedding_needed: boolean
  reasoning: string
}
