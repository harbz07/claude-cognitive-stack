// ============================================================
// OBSERVABILITY ROUTES — /api/traces/*
// ============================================================

import { Hono } from 'hono'
import type { Env } from '../index'
import { StorageService } from '../services/storage'
import { ConsolidationWorker } from '../workers/consolidation'

const traces = new Hono<{ Bindings: Env; Variables: { user_id: string } }>()

// ── GET /api/traces — List traces ───────────────────────────
traces.get('/', async (c) => {
  const userId = c.get('user_id')
  if (!c.env.DB) return c.json([])

  const storage = new StorageService(c.env.DB)
  const session_id = c.req.query('session_id')
  const limit = parseInt(c.req.query('limit') ?? '20', 10)

  const list = await storage.listTraces({ user_id: userId, session_id, limit })
  return c.json({ traces: list, count: list.length })
})

// ── GET /api/traces/:id — Single trace detail ───────────────
traces.get('/:id', async (c) => {
  const userId = c.get('user_id')
  const traceId = c.req.param('id')
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  const storage = new StorageService(c.env.DB)
  const trace = await storage.getTrace(traceId)

  if (!trace || trace.user_id !== userId) {
    return c.json({ error: 'Trace not found' }, 404)
  }

  return c.json(trace)
})

// ── GET /api/traces/session/:id — All traces for session ────
traces.get('/session/:id', async (c) => {
  const userId = c.get('user_id')
  const sessionId = c.req.param('id')
  if (!c.env.DB) return c.json([])

  const storage = new StorageService(c.env.DB)
  const list = await storage.listTraces({ user_id: userId, session_id: sessionId, limit: 50 })
  return c.json({ traces: list, count: list.length })
})

// ── POST /api/traces/consolidate — Trigger manual consolidation
traces.post('/consolidate', async (c) => {
  const userId = c.get('user_id')
  const apiKey = c.env.OPENAI_API_KEY || c.env.ANTHROPIC_API_KEY
  const baseUrl = c.env.OPENAI_API_KEY ? c.env.OPENAI_BASE_URL : undefined

  if (!c.env.DB || !apiKey) {
    return c.json({ error: 'Service not configured' }, 503)
  }

  const storage = new StorageService(c.env.DB)
  const worker = new ConsolidationWorker(storage, apiKey, baseUrl)
  const result = await worker.processPendingJobs()

  return c.json({ message: 'Consolidation triggered', ...result })
})

// ── GET /api/traces/stats — System stats ────────────────────
traces.get('/system/stats', async (c) => {
  if (!c.env.DB) return c.json({ error: 'DB not configured' }, 503)

  const [traceCount, memCount, sessionCount, jobCount] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM request_traces').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM memory_items').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM sessions').first(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM consolidation_jobs WHERE status = 'pending'").first(),
  ])

  return c.json({
    total_traces: traceCount?.count ?? 0,
    total_memories: memCount?.count ?? 0,
    total_sessions: sessionCount?.count ?? 0,
    pending_consolidation_jobs: jobCount?.count ?? 0,
    timestamp: new Date().toISOString(),
  })
})

export { traces }
