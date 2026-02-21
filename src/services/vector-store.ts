// ============================================================
// SUPABASE VECTOR STORE
// pgvector backend for semantic search via match_documents RPC
//
// Table schema (run once in Supabase SQL editor):
// ─────────────────────────────────────────────────────────────
//   create extension if not exists vector;
//
//   create table if not exists documents (
//     id       uuid primary key default gen_random_uuid(),
//     content  text not null,
//     metadata jsonb,
//     embedding vector(1536)
//   );
//
//   create or replace function match_documents(
//     query_embedding vector(1536),
//     match_threshold float,
//     match_count     int
//   )
//   returns table (id uuid, content text, metadata jsonb, similarity float)
//   language plpgsql
//   as $$
//   begin
//     return query
//     select d.id, d.content, d.metadata,
//            1 - (d.embedding <=> query_embedding) as similarity
//     from documents d
//     where 1 - (d.embedding <=> query_embedding) > match_threshold
//     order by d.embedding <=> query_embedding
//     limit match_count;
//   end;
//   $$;
// ─────────────────────────────────────────────────────────────
// ============================================================

export interface VectorDocument {
  id?: string           // uuid, assigned by Supabase on insert
  content: string
  metadata: Record<string, any>
  embedding: number[]
}

export interface VectorMatch {
  id: string
  content: string
  metadata: Record<string, any>
  similarity: number
}

export class SupabaseVectorStore {
  private headers: Record<string, string>

  constructor(
    private supabaseUrl: string,         // e.g. https://xxxx.supabase.co
    private serviceRoleKey: string,      // service_role key (server-only)
  ) {
    this.headers = {
      'Content-Type':  'application/json',
      'apikey':        serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
    }
  }

  // ── Insert a document with its embedding ──────────────────────
  async insert(doc: VectorDocument): Promise<string | null> {
    const url = `${this.supabaseUrl}/rest/v1/documents`

    const body = {
      content:   doc.content,
      metadata:  doc.metadata,
      embedding: `[${doc.embedding.join(',')}]`,  // pgvector literal format
    }

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { ...this.headers, 'Prefer': 'return=representation' },
        body:    JSON.stringify(body),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.error('[SupabaseVectorStore] insert error:', res.status, errText.slice(0, 200))
        return null
      }

      const rows = await res.json() as Array<{ id: string }>
      return rows?.[0]?.id ?? null
    } catch (err: any) {
      console.error('[SupabaseVectorStore] insert exception:', err?.message?.slice(0, 120))
      return null
    }
  }

  // ── Batch insert documents ─────────────────────────────────────
  async insertBatch(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return

    const url = `${this.supabaseUrl}/rest/v1/documents`
    const body = docs.map((doc) => ({
      content:   doc.content,
      metadata:  doc.metadata,
      embedding: `[${doc.embedding.join(',')}]`,
    }))

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { ...this.headers, 'Prefer': 'return=minimal' },
        body:    JSON.stringify(body),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.error('[SupabaseVectorStore] insertBatch error:', res.status, errText.slice(0, 200))
      }
    } catch (err: any) {
      console.error('[SupabaseVectorStore] insertBatch exception:', err?.message?.slice(0, 120))
    }
  }

  // ── Semantic search via match_documents RPC ────────────────────
  async search(params: {
    queryEmbedding: number[]
    matchThreshold?: number   // default 0.72
    matchCount?: number       // default 10
  }): Promise<VectorMatch[]> {
    const {
      queryEmbedding,
      matchThreshold = 0.72,
      matchCount     = 10,
    } = params

    const url = `${this.supabaseUrl}/rest/v1/rpc/match_documents`

    const body = {
      query_embedding: `[${queryEmbedding.join(',')}]`,
      match_threshold: matchThreshold,
      match_count:     matchCount,
    }

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: this.headers,
        body:    JSON.stringify(body),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.error('[SupabaseVectorStore] search error:', res.status, errText.slice(0, 200))
        return []
      }

      const rows = await res.json() as VectorMatch[]
      return Array.isArray(rows) ? rows : []
    } catch (err: any) {
      console.error('[SupabaseVectorStore] search exception:', err?.message?.slice(0, 120))
      return []
    }
  }

  // ── Delete a document by id ────────────────────────────────────
  async delete(id: string): Promise<void> {
    const url = `${this.supabaseUrl}/rest/v1/documents?id=eq.${id}`
    try {
      await fetch(url, { method: 'DELETE', headers: this.headers })
    } catch (err: any) {
      console.error('[SupabaseVectorStore] delete exception:', err?.message?.slice(0, 120))
    }
  }

  // ── Health check ───────────────────────────────────────────────
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.supabaseUrl}/rest/v1/documents?limit=1`, {
        headers: this.headers,
      })
      return res.ok
    } catch {
      return false
    }
  }

  isConfigured(): boolean {
    return !!(this.supabaseUrl && this.serviceRoleKey)
  }
}
