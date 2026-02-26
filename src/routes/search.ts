// ============================================================
// SEARCH ROUTE — POST /api/search
// Semantic search over pgvector (Supabase) with D1 keyword fallback.
//
// Body:
//   { query, matchThreshold?, matchCount?, project_id? }
//
// Response:
//   { matches: [{ id, content, metadata, similarity }], backend }
// ============================================================

import { Hono } from 'hono'
import type { Env } from '../index'
import { StorageService }      from '../services/storage'
import { EmbeddingService }    from '../services/embeddings'
import { SupabaseVectorStore } from '../services/vector-store'

type Variables = { user_id: string }

export const search = new Hono<{ Bindings: Env; Variables: Variables }>()

search.post('/', async (c) => {
  const user_id = c.get('user_id')

  const body = await c.req.json().catch(() => null)
  if (!body?.query) {
    return c.json({ error: 'Missing required field: query' }, 400)
  }

  const {
    query,
    matchThreshold = 0.72,
    matchCount     = 10,
    project_id,
  } = body as {
    query:           string
    matchThreshold?: number
    matchCount?:     number
    project_id?:     string
  }

  const embedService = new EmbeddingService(
    c.env.AI ?? null,
    c.env.OPENAI_API_KEY,
    c.env.OPENAI_EMBED_BASE_URL ?? c.env.OPENAI_BASE_URL,
  )

  // ── 1. Embed query ───────────────────────────────────────────
  const queryEmbedding = await embedService.embed(query)

  // ── 2a. pgvector path (Supabase) ────────────────────────────
  if (queryEmbedding && c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
    const vectorStore = new SupabaseVectorStore(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    const rawMatches = await vectorStore.search({
      queryEmbedding,
      matchThreshold,
      matchCount,
    })

    // Filter to this user (and optionally this project)
    const matches = rawMatches.filter((m) => {
      const meta = m.metadata as Record<string, any>
      if (meta?.user_id && meta.user_id !== user_id) return false
      if (project_id && meta?.project_id && meta.project_id !== project_id) return false
      return true
    })

    return c.json({
      matches,
      backend:        embedService.activeBackend,
      embedding_dims: queryEmbedding.length,
      query_used:     query,
    })
  }

  // ── 2b. D1 keyword fallback ──────────────────────────────────
  const storage = new StorageService(c.env.DB)
  const items   = await storage.queryMemory({
    user_id,
    project_id,
    exclude_high_decay: true,
    limit: matchCount * 3,
  })

  const qTokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)

  const scored = items
    .map((item) => {
      const cTokens = new Set(
        item.content.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      )
      const hits = qTokens.filter((t) => cTokens.has(t)).length
      const similarity = Math.min(1, hits / Math.max(1, qTokens.length))
      return { ...item, similarity }
    })
    .filter((m) => m.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, matchCount)

  const matches = scored.map((m) => ({
    id:         m.id,
    content:    m.content,
    metadata:   { type: m.type, scope: m.scope, tags: m.tags, decay_score: m.decay_score },
    similarity: m.similarity,
  }))

  return c.json({
    matches,
    backend:        embedService.activeBackend,
    embedding_dims: 0,
    query_used:     query,
  })
})
