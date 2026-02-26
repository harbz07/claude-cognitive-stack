// ============================================================
// EMBEDDING SERVICE
// Primary:  OpenAI text-embedding-3-small  (1536-dim)
// Fallback: Cloudflare AI bge-small-en-v1.5 (384-dim)
//
// Priority:
//   1. If OPENAI_API_KEY + OPENAI_EMBED_BASE_URL are present → OpenAI
//   2. Else if Cloudflare AI binding present → bge-small
//   3. Else → null (keyword-only RAG degrades gracefully)
// ============================================================

// OpenAI text-embedding-3-small
export const OPENAI_EMBEDDING_MODEL      = 'text-embedding-3-small'
export const OPENAI_EMBEDDING_DIMENSIONS = 1536

// Cloudflare AI bge-small fallback
export const CF_EMBEDDING_MODEL      = '@cf/baai/bge-small-en-v1.5'
export const CF_EMBEDDING_DIMENSIONS = 384

export type EmbeddingBackend = 'openai' | 'cloudflare' | 'none'

export class EmbeddingService {
  private backend: EmbeddingBackend

  constructor(
    private ai: Ai | null,
    private openaiApiKey?: string | null,
    private openaiBaseUrl?: string | null,   // defaults to https://api.openai.com/v1
  ) {
    if (openaiApiKey) {
      this.backend = 'openai'
    } else if (ai) {
      this.backend = 'cloudflare'
    } else {
      this.backend = 'none'
    }
  }

  get dimensions(): number {
    return this.backend === 'openai'
      ? OPENAI_EMBEDDING_DIMENSIONS
      : CF_EMBEDDING_DIMENSIONS
  }

  get activeBackend(): EmbeddingBackend {
    return this.backend
  }

  // ── Single embed ───────────────────────────────────────────────
  async embed(text: string): Promise<number[] | null> {
    if (this.backend === 'openai') return this.embedOpenAI([text]).then((r) => r[0])
    if (this.backend === 'cloudflare') return this.embedCF(text)
    return null
  }

  // ── Batch embed ────────────────────────────────────────────────
  async embedBatch(texts: string[]): Promise<Array<number[] | null>> {
    if (texts.length === 0) return []
    if (this.backend === 'openai') return this.embedOpenAI(texts)
    if (this.backend === 'cloudflare') {
      return Promise.all(texts.map((t) => this.embedCF(t)))
    }
    return texts.map(() => null)
  }

  // ── OpenAI backend ─────────────────────────────────────────────
  private async embedOpenAI(texts: string[]): Promise<Array<number[] | null>> {
    const baseUrl = this.openaiBaseUrl?.replace(/\/$/, '') ?? 'https://api.openai.com/v1'
    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_EMBEDDING_MODEL,
          input: texts.map((t) => t.slice(0, 8192)),  // model max input
        }),
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        console.error(`[EmbeddingService] OpenAI error ${response.status}:`, errText.slice(0, 200))
        return texts.map(() => null)
      }

      const data = await response.json() as {
        data: Array<{ index: number; embedding: number[] }>
      }

      // API returns items possibly out of order — sort by index
      const sorted = [...data.data].sort((a, b) => a.index - b.index)
      return sorted.map((d) => d.embedding ?? null)
    } catch (err: any) {
      console.error('[EmbeddingService] embedOpenAI error:', err?.message?.slice(0, 120))
      return texts.map(() => null)
    }
  }

  // ── Cloudflare AI fallback ─────────────────────────────────────
  private async embedCF(text: string): Promise<number[] | null> {
    if (!this.ai) return null
    try {
      const result = await this.ai.run(CF_EMBEDDING_MODEL as any, {
        text: [text.slice(0, 2048)],
      }) as any

      const data = result?.data?.[0]
      if (!Array.isArray(data) || data.length === 0) return null
      return data as number[]
    } catch (err: any) {
      console.error('[EmbeddingService] CF embed error:', err?.message?.slice(0, 100))
      return null
    }
  }

  // ── Similarity Math ────────────────────────────────────────────

  // Cosine similarity → [0, 1]  (higher = more similar)
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0

    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
      dot   += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    if (denom === 0) return 0
    return Math.max(0, Math.min(1, dot / denom))
  }

  // Rank candidates by cosine similarity to query embedding
  static rankBySimilarity(
    queryEmbedding: number[],
    candidates: Array<{ id: string; embedding: number[] | null; [key: string]: any }>,
  ): Array<{ id: string; similarity: number }> {
    return candidates
      .map((c) => ({
        id: c.id,
        similarity: c.embedding
          ? EmbeddingService.cosineSimilarity(queryEmbedding, c.embedding)
          : 0,
      }))
      .sort((a, b) => b.similarity - a.similarity)
  }

  // Check availability
  isAvailable(): boolean {
    return this.backend !== 'none'
  }
}
