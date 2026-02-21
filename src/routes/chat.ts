// ============================================================
// CHAT ROUTES — /api/chat/*
// ============================================================

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../index'
import { StorageService } from '../services/storage'
import { CognitiveOrchestrator } from '../services/orchestrator'
import { ConsolidationWorker } from '../workers/consolidation'

const chatSchema = z.object({
  session_id: z.string().uuid().optional(),
  user_id: z.string().optional(), // overridden by auth middleware
  project_id: z.string().optional(),
  message: z.string().min(1).max(10000),
  skill_hints: z.array(z.string()).optional(),
  loadout_id: z.enum(['default', 'fast', 'deep']).optional(),
  stream: z.boolean().optional().default(false),
  metadata: z.record(z.unknown()).optional(),
})

const chat = new Hono<{ Bindings: Env; Variables: { user_id: string } }>()

// ── POST /api/chat — Main cognitive endpoint ────────────────
chat.post('/', zValidator('json', chatSchema), async (c) => {
  const body = c.req.valid('json')
  const userId = c.get('user_id')

  // Prefer OpenAI-compatible key, fall back to Anthropic
  const apiKey = c.env.OPENAI_API_KEY || c.env.ANTHROPIC_API_KEY
  const baseUrl = c.env.OPENAI_API_KEY ? c.env.OPENAI_BASE_URL : undefined

  if (!apiKey) {
    return c.json({ error: 'No model API key configured (OPENAI_API_KEY or ANTHROPIC_API_KEY).' }, 503)
  }

  if (!c.env.DB) {
    return c.json({ error: 'Database not configured.' }, 503)
  }

  const storage = new StorageService(c.env.DB)
  const orchestrator = new CognitiveOrchestrator(
    storage,
    c.env.AI ?? null,
    c.env.OPENAI_API_KEY,
    c.env.OPENAI_EMBED_BASE_URL ?? c.env.OPENAI_BASE_URL,
    c.env.SUPABASE_URL,
    c.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  try {
    const response = await orchestrator.process(
      {
        ...body,
        user_id: userId,
        metadata: body.metadata ?? {},
      },
      apiKey,
      baseUrl,
    )

    // Fire-and-forget consolidation if queued
    if (response.consolidation_queued) {
      const worker = new ConsolidationWorker(
        storage,
        apiKey,
        baseUrl,
        c.env.AI ?? null,
        c.env.OPENAI_API_KEY,
        c.env.OPENAI_EMBED_BASE_URL ?? c.env.OPENAI_BASE_URL,
        c.env.SUPABASE_URL,
        c.env.SUPABASE_SERVICE_ROLE_KEY,
      )
      worker.processPendingJobs().catch(() => {})
    }

    return c.json(response)
  } catch (err: any) {
    return c.json(
      { error: err.message ?? 'Internal error', trace_id: null },
      err.message?.includes('API key') ? 401 : 500,
    )
  }
})

// ── GET /api/chat/sessions — List user sessions ─────────────
chat.get('/sessions', async (c) => {
  const userId = c.get('user_id')
  if (!c.env.DB) return c.json([])

  const storage = new StorageService(c.env.DB)
  const result = await c.env.DB
    .prepare(`SELECT session_id, project_id, tokens_used, token_budget, created_at, updated_at 
              FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20`)
    .bind(userId)
    .all()

  return c.json(result.results ?? [])
})

// ── GET /api/chat/sessions/:id — Get session details ────────
chat.get('/sessions/:id', async (c) => {
  const userId = c.get('user_id')
  const sessionId = c.req.param('id')
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  const storage = new StorageService(c.env.DB)
  const session = await storage.getSession(sessionId)

  if (!session || session.user_id !== userId) {
    return c.json({ error: 'Session not found' }, 404)
  }

  return c.json(session)
})

// ── DELETE /api/chat/sessions/:id — Clear session ───────────
chat.delete('/sessions/:id', async (c) => {
  const userId = c.get('user_id')
  const sessionId = c.req.param('id')
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  await c.env.DB
    .prepare('DELETE FROM sessions WHERE session_id = ? AND user_id = ?')
    .bind(sessionId, userId)
    .run()

  return c.json({ deleted: true })
})

export { chat }
