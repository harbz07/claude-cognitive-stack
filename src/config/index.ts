// ============================================================
// CONFIG — Defaults, environment bindings, loadout presets
// ============================================================

import type { Loadout, SkillPackage } from '../types'

export const DEFAULT_LOADOUT: Loadout = {
  id: 'default',
  name: 'Default Loadout',
  model_profile: 'default',
  budgets: {
    l1: 2000,          // sliding window tokens
    l2: 3000,          // retrieved memory tokens
    skills: 1500,      // skill fragments
    response_reserve: 2048,
  },
  thresholds: {
    consolidation_trigger: 0.75,   // consolidate when 75% budget used
    memory_relevance_min: 0.35,    // drop memory below this score
    decay_write_threshold: 0.4,    // min confidence to persist
  },
  active_skill_ids: ['general'],
  created_at: new Date().toISOString(),
}

export const FAST_LOADOUT: Loadout = {
  id: 'fast',
  name: 'Fast/Cheap Loadout',
  model_profile: 'fast',
  budgets: {
    l1: 1000,
    l2: 1000,
    skills: 500,
    response_reserve: 1024,
  },
  thresholds: {
    consolidation_trigger: 0.80,
    memory_relevance_min: 0.50,
    decay_write_threshold: 0.6,
  },
  active_skill_ids: ['general'],
  created_at: new Date().toISOString(),
}

export const DEEP_LOADOUT: Loadout = {
  id: 'deep',
  name: 'Deep Research Loadout',
  model_profile: 'deep',
  budgets: {
    l1: 4000,
    l2: 8000,
    skills: 3000,
    response_reserve: 4096,
  },
  thresholds: {
    consolidation_trigger: 0.70,
    memory_relevance_min: 0.20,
    decay_write_threshold: 0.3,
  },
  active_skill_ids: ['general', 'research', 'code'],
  created_at: new Date().toISOString(),
}

// Built-in skill packages
export const BUILTIN_SKILLS: SkillPackage[] = [
  {
    id: 'general',
    name: 'General Assistant',
    trigger: /./,  // always activates
    system_fragment: `You are a helpful, precise, and memory-aware assistant. 
You have access to conversation history and retrieved memories. 
Use context efficiently. Be concise unless depth is requested.`,
    tools: [],
    priority: 0,
    token_budget: 200,
    enabled: true,
    metadata: { builtin: true },
  },
  {
    id: 'code',
    name: 'Code Assistant',
    trigger: /\b(code|function|debug|implement|refactor|typescript|javascript|python|sql|api|bug|error|class|type)\b/i,
    system_fragment: `You are also an expert software engineer. 
When writing code: use TypeScript unless specified, add inline comments, consider edge cases.
Format code in proper markdown blocks with language tags.`,
    tools: [],
    priority: 10,
    token_budget: 300,
    enabled: true,
    metadata: { builtin: true },
  },
  {
    id: 'research',
    name: 'Research Mode',
    trigger: /\b(research|analyze|compare|explain|why|how does|what is|deep dive|summarize)\b/i,
    system_fragment: `You are also a thorough researcher. 
Structure complex answers with clear sections. Cite reasoning. 
When uncertain, state your confidence level explicitly.`,
    tools: [],
    priority: 5,
    token_budget: 250,
    enabled: true,
    metadata: { builtin: true },
  },
  {
    id: 'memory_aware',
    name: 'Memory-Aware Mode',
    trigger: /\b(remember|recall|earlier|before|last time|we discussed|you said|previously)\b/i,
    system_fragment: `The user is referencing prior context. 
Check retrieved memories carefully. If you find relevant prior context, 
reference it explicitly with "Based on our earlier discussion...".`,
    tools: [],
    priority: 15,
    token_budget: 150,
    enabled: true,
    metadata: { builtin: true },
  },
]

// Anthropic model map
export const MODEL_MAP: Record<string, string> = {
  default: 'claude-opus-4-5',
  fast: 'claude-haiku-4-5',
  deep: 'claude-opus-4-5',
  code: 'claude-sonnet-4-5',
}

// OpenAI-compatible model map (Genspark proxy)
// Note: these are reasoning models — always use 1500+ max_tokens
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

// Token estimation (rough: 1 token ≈ 4 chars)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Decay schedule: items not accessed decay over time
export function computeDecay(lastAccessedAt: string, createdAt: string): number {
  const now = Date.now()
  const lastAccess = new Date(lastAccessedAt).getTime()
  const ageHours = (now - lastAccess) / (1000 * 60 * 60)
  // Sigmoid decay: after 168h (1 week) → ~0.8 decay
  return Math.min(0.95, 1 / (1 + Math.exp(-0.03 * (ageHours - 48))))
}
