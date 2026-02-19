// ============================================================
// EMBEDDING SERVICE — Cloudflare AI bge-small-en-v1.5
// 384-dimensional vectors, free on Cloudflare Workers AI
// Falls back gracefully when AI binding is not available
// ============================================================

// bge-small produces 384-dim vectors
export const EMBEDDING_DIMENSIONS = 384
export const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5'

export class EmbeddingService {
  constructor(private ai: Ai | null) {}

  // Generate a single embedding vector for a text string
  async embed(text: string): Promise<number[] | null> {
    if (!this.ai) return null

    try {
      const result = await this.ai.run(EMBEDDING_MODEL as any, {
        text: [text.slice(0, 2048)], // bge-small max input
      }) as any

      const data = result?.data?.[0]
      if (!Array.isArray(data) || data.length === 0) return null
      return data as number[]
    } catch (err: any) {
      console.error('[EmbeddingService] embed error:', err?.message?.slice(0, 100))
      return null
    }
  }

  // Batch embed multiple texts — returns null entries for failures
  async embedBatch(texts: string[]): Promise<Array<number[] | null>> {
    if (!this.ai || texts.length === 0) return texts.map(() => null)

    try {
      const result = await this.ai.run(EMBEDDING_MODEL as any, {
        text: texts.map((t) => t.slice(0, 2048)),
      }) as any

      const data = result?.data
      if (!Array.isArray(data)) return texts.map(() => null)
      return data as Array<number[] | null>
    } catch (err: any) {
      console.error('[EmbeddingService] embedBatch error:', err?.message?.slice(0, 100))
      return texts.map(() => null)
    }
  }

  // ── Similarity Math ───────────────────────────────────────────

  // Cosine similarity between two vectors → [-1, 1], higher = more similar
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0

    let dot = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dot   += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    if (denom === 0) return 0

    // Clamp to [0, 1] — bge vectors are always positive after normalization
    return Math.max(0, Math.min(1, dot / denom))
  }

  // Rank a list of candidates by semantic similarity to a query embedding
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

  // Check if AI binding is available (used for graceful degradation)
  isAvailable(): boolean {
    return this.ai !== null
  }
}
