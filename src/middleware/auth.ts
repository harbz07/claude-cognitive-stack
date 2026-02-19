// ============================================================
// AUTH MIDDLEWARE — API key validation + rate limiting
// ============================================================

import type { Context, Next } from 'hono'
import type { Env } from '../index'

// Simple hash function for API key comparison (Web Crypto)
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// In-memory rate limit store (resets per worker instance)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(userId: string, limitRpm: number): boolean {
  const now = Date.now()
  const windowMs = 60_000
  const entry = rateLimitStore.get(userId)

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(userId, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= limitRpm) return false
  entry.count++
  return true
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization')
  const apiKeyHeader = c.req.header('X-API-Key')

  // Extract key from Bearer token or X-API-Key header
  let rawKey: string | null = null
  if (authHeader?.startsWith('Bearer ')) {
    rawKey = authHeader.slice(7)
  } else if (apiKeyHeader) {
    rawKey = apiKeyHeader
  }

  // Dev mode: allow bypass with a master key from env
  if (rawKey === c.env.MASTER_KEY && c.env.MASTER_KEY) {
    c.set('user_id', 'dev-user')
    c.set('rate_limit_rpm', 1000)
    return next()
  }

  if (!rawKey) {
    return c.json({ error: 'Missing API key. Use Authorization: Bearer <key> or X-API-Key header.' }, 401)
  }

  // In demo mode: allow any key prefixed with "crs_"
  if (rawKey.startsWith('crs_')) {
    c.set('user_id', `user_${rawKey.slice(4, 12)}`)
    c.set('rate_limit_rpm', 60)
    return next()
  }

  try {
    const keyHash = await hashKey(rawKey)
    const { StorageService } = await import('../services/storage')
    const storage = new StorageService(c.env.DB)
    const keyData = await storage.validateApiKey(keyHash)

    if (!keyData) {
      return c.json({ error: 'Invalid API key.' }, 401)
    }

    // Rate limit check
    if (!checkRateLimit(keyData.user_id, keyData.rate_limit_rpm)) {
      return c.json({ error: 'Rate limit exceeded. Try again in a minute.' }, 429)
    }

    c.set('user_id', keyData.user_id)
    c.set('rate_limit_rpm', keyData.rate_limit_rpm)
    return next()
  } catch {
    return c.json({ error: 'Auth service error.' }, 500)
  }
}

export async function optionalAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization')
  const rawKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : c.req.header('X-API-Key')

  if (rawKey === c.env.MASTER_KEY && c.env.MASTER_KEY) {
    c.set('user_id', 'dev-user')
    return next()
  }

  if (rawKey?.startsWith('crs_')) {
    c.set('user_id', `user_${rawKey.slice(4, 12)}`)
    return next()
  }

  c.set('user_id', 'anonymous')
  return next()
}
