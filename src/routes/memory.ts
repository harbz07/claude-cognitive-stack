// ============================================================
// MEMORY ROUTES — /api/memory/*
// ============================================================

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Env } from '../index'
import { StorageService } from '../services/storage'
import { estimateTokens } from '../config'

const memory = new Hono<{ Bindings: Env; Variables: { user_id: string } }>()

const createMemorySchema = z.object({
  content: z.string().min(1).max(5000),
  type: z.enum(['episodic', 'semantic', 'summary']).default('semantic'),
  scope: z.enum(['session', 'project', 'global']).default('project'),
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.8),
  session_id: z.string().optional(),
  project_id: z.string().optional(),
})

// ── POST /api/memory — Store a memory item ──────────────────
memory.post('/', zValidator('json', createMemorySchema), async (c) => {
  const body = c.req.valid('json')
  const userId = c.get('user_id')
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  const storage = new StorageService(c.env.DB)
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  const item = {
    id,
    type: body.type,
    scope: body.scope,
    content: body.content,
    embedding: null,
    tags: body.tags,
    confidence: body.confidence,
    decay_score: 0,
    token_count: estimateTokens(body.content),
    provenance: {
      session_id: body.session_id ?? 'manual',
      source: 'user' as const,
    },
    project_id: body.project_id,
    user_id: userId,
    created_at: now,
    last_accessed: now,
  }

  await storage.insertMemoryItem(item)
  return c.json({ id, created: true }, 201)
})

// ── GET /api/memory — Query memories ────────────────────────
memory.get('/', async (c) => {
  const userId = c.get('user_id')
  if (!c.env.DB) return c.json([])

  const storage = new StorageService(c.env.DB)
  const scope = c.req.query('scope') as any
  const type = c.req.query('type') as any
  const session_id = c.req.query('session_id')
  const limit = parseInt(c.req.query('limit') ?? '20', 10)

  const items = await storage.queryMemory({
    user_id: userId,
    session_id,
    scope,
    type,
    limit,
    exclude_high_decay: true,
  })

  return c.json({ items, count: items.length })
})

// ── DELETE /api/memory/:id — Delete a memory item ───────────
memory.delete('/:id', async (c) => {
  const userId = c.get('user_id')
  const id = c.req.param('id')
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  await c.env.DB
    .prepare('DELETE FROM memory_items WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run()

  return c.json({ deleted: true })
})

// ── GET /api/memory/stats — Memory stats ────────────────────
memory.get('/stats', async (c) => {
  const userId = c.get('user_id')
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  const stats = await c.env.DB
    .prepare(`
      SELECT 
        COUNT(*) as total,
        type,
        scope,
        AVG(confidence) as avg_confidence,
        AVG(decay_score) as avg_decay,
        SUM(token_count) as total_tokens
      FROM memory_items 
      WHERE user_id = ?
      GROUP BY type, scope
    `)
    .bind(userId)
    .all()

  return c.json({ stats: stats.results })
})

export { memory }
