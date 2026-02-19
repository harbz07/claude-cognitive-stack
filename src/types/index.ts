// ============================================================
// COGNITIVE RUNTIME SERVICE — Core Type Definitions
// Aligned to: https://www.basecampgrounds.com canonical spec
// ============================================================

export type MemoryType = 'episodic' | 'semantic' | 'summary'
export type MemoryScope = 'session' | 'project' | 'global'
export type ModelProfile = 'default' | 'fast' | 'deep' | 'code'
export type InsulaMode = 'standard' | 'strict' | 'permissive'

// ─── L2/L3 Memory Item ───────────────────────────────────────
export interface MemorySource {
  type: 'chat' | 'document' | 'consolidation' | 'manual'
  message_id?: string
  document_id?: string
  session_id: string
}

export interface MemoryItem {
  id: string
  type: MemoryType
  scope: MemoryScope
  project_id: string | null
  content: string
  embedding: number[] | null
  source: MemorySource
  tags: string[]
  confidence: number          // 0..1
  decay_score: number         // 0..1 (higher = more decayed)
  created_at: string
  last_accessed: string
  token_count: number
  // Legacy compat — used by storage insert
  provenance?: { session_id: string; source: string }
  user_id?: string
}

// ─── Summary (canonical: key_facts[] + consolidation_pass) ───
export interface MemorySummary {
  id: string
  session_id: string
  scope: MemoryScope
  project_id: string | null
  content: string
  key_facts: string[]           // structured fact array
  token_count: number
  created_at: string
  consolidation_pass: number    // increments each time this summary is consolidated
}

// ─── L1 Session State ─────────────────────────────────────────
export interface SlidingWindowEntry {
  role: 'user' | 'assistant' | 'system'
  content: string
  token_count: number
  timestamp: string
  trace_id?: string
  message_id?: string           // stable ID for provenance / RAG citation
}

export interface RunningState {
  goals: string[]
  active_skills: string[]
  last_tool_results: Record<string, unknown>
  pending_consolidation: boolean
  compaction_pass: number       // how many times L1 has been compacted
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

// ─── Skill Package (canonical spec) ──────────────────────────
export interface SkillTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface SkillPackage {
  id: string
  name: string
  version: string                     // e.g. "1.0.0"
  trigger: string | RegExp
  system_fragment: string
  tools: SkillTool[]
  priority: number
  token_budget: number
  max_context_tokens: number          // spec: max context window for this skill
  compatible_models: string[]         // spec: e.g. ["gpt-5","claude-sonnet-4.5"]
  enabled: boolean
  metadata: Record<string, unknown>
}

// ─── Project (isolated namespace) ────────────────────────────
export interface Project {
  id: string                          // e.g. "proj_abc123"
  user_id: string
  name: string
  description: string
  skill_loadout: string[]             // skill IDs active for this project
  model_override?: ModelProfile
  thalamus_threshold?: number
  insula_mode?: InsulaMode
  rag_top_k?: number
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
}

// ─── Loadout (canonical spec) ────────────────────────────────
export interface BudgetConfig {
  l1_window_tokens: number            // spec: l1_window_tokens
  l2_budget_tokens: number            // spec: l2_budget_tokens
  skills: number
  response_reserve: number
}

export interface ThresholdConfig {
  thalamus_threshold: number          // spec: 0.72 (default), 0.60 (deep)
  consolidation_trigger: number       // spec: 0.80 (80% budget → consolidate)
  decay_write_threshold: number
}

export interface Loadout {
  id: string
  name: string
  session_id?: string
  project_id?: string
  model_profile: ModelProfile
  active_skills: string[]
  rag_top_k: number                   // spec: default 5
  budgets: BudgetConfig
  thresholds: ThresholdConfig
  insula_mode: InsulaMode
  created_at: string
}

// ─── Citations (provenance on every retrieval) ────────────────
export interface Citation {
  source: string                      // e.g. "chat_msg_42", "doc_readme.md"
  source_type: 'chat' | 'document' | 'memory' | 'skill' | 'rag'
  message_id?: string
  memory_id?: string
  relevance: number                   // 0..1
  content_snippet?: string
}

// ─── Thalamus Context Scoring ─────────────────────────────────
export interface ContextCandidate {
  id: string
  source: 'l1_window' | 'l2_memory' | 'skill' | 'system' | 'rag'
  content: string
  label: string
  token_count: number
  citation?: Citation                 // provenance for this candidate
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

// ─── RAG Result (chat + document retrieval) ───────────────────
export interface RagResult {
  id: string
  content: string
  source: string
  source_type: 'chat' | 'document' | 'memory'
  relevance: number
  token_count: number
  message_id?: string
  metadata: Record<string, unknown>
}

// ─── Insula Analysis (sentiment + PII) ───────────────────────
export interface InsularPermissions {
  can_write_semantic: boolean
  can_write_episodic: boolean
  can_write_summary: boolean
  redacted_patterns: string[]
  sentiment: 'positive' | 'negative' | 'neutral' | 'volatile'
  sentiment_score: number             // -1..1
  insula_mode: InsulaMode
  retention_override?: {
    forget_after_session: boolean
    forget_after_project: boolean
  }
}

// ─── Assembled Prompt ─────────────────────────────────────────
export interface AssembledPrompt {
  system: string
  context_blocks: Array<{
    label: string
    content: string
    token_count: number
    source: string
    citation?: Citation
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

// ─── Memory Diff (observability step 7) ──────────────────────
export interface MemoryDiff {
  added: number
  updated: number
  removed: number
  new_items: string[]           // ids
  updated_items: string[]       // ids
  key_facts_extracted: string[] // top key_facts from this consolidation pass
}

// ─── Consolidation Job ────────────────────────────────────────
export interface ConsolidationJob {
  job_id: string
  session_id: string
  trace_id: string
  consolidation_type: 'session_end' | 'token_pressure' | 'manual'
  transcript: SlidingWindowEntry[]
  context_used: AssembledPrompt
  insula_permissions: InsularPermissions
  created_at: string
  status: 'pending' | 'processing' | 'done' | 'failed'
}

// ─── Observability / Trace ────────────────────────────────────
export interface TraceEvent {
  trace_id: string
  session_id: string
  stage:
    | 'ingest'
    | 'wernicke'          // Wernicke Router (renamed from 'router')
    | 'rag'               // RAG Search stage
    | 'thalamus'
    | 'insula'
    | 'assemble'
    | 'generate'
    | 'consolidate'
    | 'compact'           // L1 compaction stage
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
  citations: Citation[]              // all citations in response
  memory_diff: MemoryDiff | null
  token_breakdown: AssembledPrompt['token_breakdown'] | null
  consolidation_queued: boolean
  consolidation_type?: string
  error: string | null
}

// ─── API Contracts ────────────────────────────────────────────
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
  citations: Citation[]              // full provenance on every response
  memory_diff: MemoryDiff | null
  consolidation_queued: boolean
  consolidation_type?: string
}

// ─── Wernicke Router Decision ─────────────────────────────────
export interface WernickeDecision {
  activated_skills: SkillPackage[]
  memory_scopes: MemoryScope[]
  model_profile: ModelProfile
  requires_deep_retrieval: boolean
  rag_sources: Array<'chat_index' | 'project_docs' | 'knowledge_graph'>
  rag_top_k: number
  min_score: number                  // spec: thalamus_threshold (0.72)
  reasoning: string
  project_id?: string                // for namespace isolation
}

// ─── Legacy alias ─────────────────────────────────────────────
export type RouterDecision = WernickeDecision
