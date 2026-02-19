// ============================================================
// CONFIG — Defaults, loadout presets, built-in skills
// Aligned to: https://www.basecampgrounds.com canonical spec
// ============================================================

import type { Loadout, SkillPackage } from '../types'

export const DEFAULT_LOADOUT: Loadout = {
  id: 'default',
  name: 'Default Loadout',
  model_profile: 'default',
  budgets: {
    l1_window_tokens: 2000,
    l2_budget_tokens: 3000,
    skills: 1500,
    response_reserve: 2048,
  },
  thresholds: {
    thalamus_threshold: 0.72,          // spec: 0.72 — gate for Thalamus inclusion
    consolidation_trigger: 0.80,       // spec: 80% budget triggers consolidation
    decay_write_threshold: 0.4,
  },
  active_skills: ['general'],
  rag_top_k: 5,                        // spec: rag_top_k default 5
  insula_mode: 'standard',
  created_at: new Date().toISOString(),
}

export const FAST_LOADOUT: Loadout = {
  id: 'fast',
  name: 'Fast / Cheap (Haiku)',
  model_profile: 'fast',
  budgets: {
    l1_window_tokens: 1000,
    l2_budget_tokens: 1000,
    skills: 500,
    response_reserve: 1024,
  },
  thresholds: {
    thalamus_threshold: 0.72,
    consolidation_trigger: 0.80,
    decay_write_threshold: 0.6,
  },
  active_skills: ['general'],
  rag_top_k: 3,
  insula_mode: 'standard',
  created_at: new Date().toISOString(),
}

export const DEEP_LOADOUT: Loadout = {
  id: 'deep',
  name: 'Deep Research (Opus)',
  model_profile: 'deep',
  budgets: {
    l1_window_tokens: 4000,
    l2_budget_tokens: 8000,
    skills: 3000,
    response_reserve: 4096,
  },
  thresholds: {
    thalamus_threshold: 0.60,          // lower gate for deep research — capture more context
    consolidation_trigger: 0.80,
    decay_write_threshold: 0.3,
  },
  active_skills: ['general', 'research', 'code'],
  rag_top_k: 10,
  insula_mode: 'standard',
  created_at: new Date().toISOString(),
}

// ─── Built-in Skill Packages (canonical spec) ─────────────────
// Fields: id, name, version, trigger, system_fragment, tools,
//         priority, token_budget, max_context_tokens, compatible_models, enabled
export const BUILTIN_SKILLS: SkillPackage[] = [
  {
    id: 'general',
    name: 'General Assistant',
    version: '1.0.0',
    trigger: /./,  // always activates
    system_fragment: `You are a helpful, precise, and memory-aware assistant.
You have access to conversation history and retrieved memories.
Use context efficiently. Be concise unless depth is requested.
When referencing retrieved memories, cite them explicitly.`,
    tools: [],
    priority: 0,
    token_budget: 200,
    max_context_tokens: 8192,
    compatible_models: ['gpt-5', 'gpt-5-mini', 'claude-sonnet-4-5', 'claude-opus-4-5'],
    enabled: true,
    metadata: { builtin: true },
  },
  {
    id: 'code',
    name: 'Code Assistant',
    version: '1.0.0',
    trigger: /\b(code|function|debug|implement|refactor|typescript|javascript|python|sql|api|bug|error|class|type|interface|module)\b/i,
    system_fragment: `You are also an expert software engineer.
When writing code: use TypeScript unless specified, add inline comments, consider edge cases.
Format code in proper markdown blocks with language tags.
For complex functions, describe the approach before the code.`,
    tools: [],
    priority: 10,
    token_budget: 300,
    max_context_tokens: 16384,
    compatible_models: ['gpt-5', 'claude-sonnet-4-5', 'claude-opus-4-5'],
    enabled: true,
    metadata: { builtin: true },
  },
  {
    id: 'research',
    name: 'Research Mode',
    version: '1.0.0',
    trigger: /\b(research|analyze|compare|explain|why|how does|what is|deep dive|summarize|overview)\b/i,
    system_fragment: `You are also a thorough researcher.
Structure complex answers with clear sections. Cite reasoning explicitly.
When uncertain, state your confidence level (e.g. "High confidence:", "Uncertain:").
Provide balanced perspectives for ambiguous questions.`,
    tools: [],
    priority: 5,
    token_budget: 250,
    max_context_tokens: 16384,
    compatible_models: ['gpt-5', 'claude-sonnet-4-5', 'claude-opus-4-5'],
    enabled: true,
    metadata: { builtin: true },
  },
  {
    id: 'memory_aware',
    name: 'Memory-Aware Mode',
    version: '1.0.0',
    trigger: /\b(remember|recall|earlier|before|last time|we discussed|you said|previously|in our|you mentioned)\b/i,
    system_fragment: `The user is referencing prior context.
Check the retrieved memories carefully. If you find relevant prior context,
reference it explicitly: "Based on our earlier discussion about [topic]...".
If you don't find the referenced memory, say so clearly.`,
    tools: [],
    priority: 15,
    token_budget: 150,
    max_context_tokens: 8192,
    compatible_models: ['gpt-5', 'gpt-5-mini', 'claude-haiku-4-5', 'claude-sonnet-4-5'],
    enabled: true,
    metadata: { builtin: true },
  },
  {
    id: 'project_scope',
    name: 'Project Scope',
    version: '1.0.0',
    trigger: /\b(project|workspace|this project|our project|in this context|for this|project memory)\b/i,
    system_fragment: `You are working within a specific project context.
Prioritize project-scoped memories and knowledge.
When answering, consider the project's goals, conventions, and constraints from memory.
Tag new facts with the project context when relevant.`,
    tools: [],
    priority: 8,
    token_budget: 200,
    max_context_tokens: 8192,
    compatible_models: ['gpt-5', 'claude-sonnet-4-5'],
    enabled: true,
    metadata: { builtin: true },
  },
]

// ─── Anthropic model map ─────────────────────────────────────
export const MODEL_MAP: Record<string, string> = {
  default: 'claude-sonnet-4-5',
  fast: 'claude-haiku-4-5',
  deep: 'claude-opus-4-5',
  code: 'claude-sonnet-4-5',
}

// ─── OpenAI-compatible model map (Genspark proxy) ────────────
// Note: These are reasoning models — use 1500+ max_tokens
export const OPENAI_MODEL_MAP: Record<string, string> = {
  default: 'gpt-5',
  fast: 'gpt-5-mini',
  deep: 'gpt-5',
  code: 'gpt-5',
}

export const LOADOUT_MAP: Record<string, Loadout> = {
  default: DEFAULT_LOADOUT,
  fast: FAST_LOADOUT,
  deep: DEEP_LOADOUT,
}

// ─── Token estimation (rough: 1 token ≈ 4 chars) ─────────────
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

// ─── Decay schedule: items not accessed decay over time ───────
// Sigmoid: after 168h (1 week) → ~0.8 decay, after 24h → ~0.3
export function computeDecay(lastAccessedAt: string, _createdAt?: string): number {
  const now = Date.now()
  const lastAccess = new Date(lastAccessedAt).getTime()
  const ageHours = (now - lastAccess) / (1000 * 60 * 60)
  return Math.min(0.95, 1 / (1 + Math.exp(-0.03 * (ageHours - 48))))
}
