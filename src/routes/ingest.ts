// ============================================================
// INGEST ROUTE — POST /api/ingest
// Embeds arbitrary content and stores it in:
//   1. D1 memory_items (L2 storage, keyword fallback)
//   2. Supabase pgvector documents table (semantic search)
//
// Body:
//   { content, metadata?, type?, scope?, project_id?, tags? }
// ============================================================

import { Hono } from 'hono'
import type { Env } from '../index'
import { StorageService }      from '../services/storage'
import { EmbeddingService }    from '../services/embeddings'
import { SupabaseVectorStore } from '../services/vector-store'
import { estimateTokens }      from '../config'

type Variables = { user_id: string }

export const ingest = new Hono<{ Bindings: Env; Variables: Variables }>()

ingest.post('/', async (c) => {
  const user_id = c.get('user_id')

  const body = await c.req.json().catch(() => null)
  if (!body?.content) {
    return c.json({ error: 'Missing required field: content' }, 400)
  }

  const {
    content,
    metadata   = {},
    type       = 'semantic',
    scope      = 'project',
    project_id = null,
    tags       = [],
  } = body as {
    content:     string
    metadata?:   Record<string, any>
    type?:       'episodic' | 'semantic' | 'summary'
    scope?:      'session' | 'project' | 'global'
    project_id?: string | null
    tags?:       string[]
  }

  if (!['episodic', 'semantic', 'summary'].includes(type)) {
    return c.json({ error: 'Invalid type. Must be episodic | semantic | summary' }, 400)
  }
  if (!['session', 'project', 'global'].includes(scope)) {
    return c.json({ error: 'Invalid scope. Must be session | project | global' }, 400)
  }

  const db          = c.env.DB
  const storage     = new StorageService(db)
  const embedService = new EmbeddingService(
    c.env.AI ?? null,
    c.env.OPENAI_API_KEY,
    c.env.OPENAI_EMBED_BASE_URL ?? c.env.OPENAI_BASE_URL,
  )

  // ── 1. Generate embedding ────────────────────────────────────
  const embedding = await embedService.embed(content)

  // ── 2. Store in D1 ──────────────────────────────────────────
  const now = new Date().toISOString()
  const id  = crypto.randomUUID()

  const memoryItem = {
    id,
    type,
    scope,
    project_id:    project_id ?? null,
    content,
    embedding,
    source: {
      type:       'manual' as const,
      session_id: `ingest_${user_id}`,
    },
    tags:          Array.isArray(tags) ? tags : [],
    confidence:    1.0,
    decay_score:   0.0,
    created_at:    now,
    last_accessed: now,
    token_count:   estimateTokens(content),
    user_id,
  }

  await storage.insertMemoryItem(memoryItem)

  // ── 3. Sync to pgvector (Supabase) ───────────────────────────
  let vectorId: string | null = null
  if (embedding && c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
    const vectorStore = new SupabaseVectorStore(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_SERVICE_ROLE_KEY,
    )
    vectorId = await vectorStore.insert({
      content,
      metadata: {
        memory_id:  id,
        type,
        scope,
        user_id,
        project_id: project_id ?? null,
        tags,
        confidence: 1.0,
        ...metadata,
      },
      embedding,
    })
  }

  return c.json({
    ok:               true,
    id,
    vector_id:        vectorId,
    embedding_backend: embedService.activeBackend,
    embedding_dims:   embedding?.length ?? 0,
    token_count:      memoryItem.token_count,
  })
})
