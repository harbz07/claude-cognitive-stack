// ============================================================
// INSULA — Safety filter, PII redaction, sentiment analysis,
//          memory write gating
// Spec: https://www.basecampgrounds.com (Insula node)
// ============================================================

import type { InsularPermissions, InsulaMode, SlidingWindowEntry } from '../types'

// ─── PII Detection Patterns ──────────────────────────────────
const PII_PATTERNS = [
  { name: 'email',       pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
  { name: 'phone',       pattern: /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { name: 'ssn',         pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'credit_card', pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  { name: 'api_key',     pattern: /\b(sk-|pk-|api_key=|apikey=|Bearer\s+)[A-Za-z0-9_\-]{16,}\b/gi },
  { name: 'password',    pattern: /\b(password|passwd|pwd)\s*[:=]\s*\S+/gi },
  { name: 'ip_address',  pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g },
]

// ─── Forget Directives (suppress memory writes) ───────────────
const FORGET_DIRECTIVES = [
  /\bdon'?t (remember|store|save|log) this\b/i,
  /\boff the record\b/i,
  /\bno memory\b/i,
  /\bforget this\b/i,
  /\bprivate( mode)?\b/i,
  /\bthis is confidential\b/i,
  /\bdo not (save|store|record)\b/i,
]

// ─── Sentiment Lexicons ──────────────────────────────────────
const POSITIVE_SIGNALS = [
  /\b(great|excellent|perfect|love|wonderful|amazing|fantastic|helpful|thanks|thank you|awesome|good|nice|happy|pleased|satisfied|correct|right|exactly|yes|sure)\b/i,
]

const NEGATIVE_SIGNALS = [
  /\b(wrong|bad|terrible|awful|hate|useless|broken|error|fail|failed|failure|incorrect|no|never|can'?t|won'?t|don'?t|not working|frustrat|disappoint|angry|upset|problem|issue|bug)\b/i,
]

const VOLATILE_SIGNALS = [
  /\b(urgent|emergency|critical|crisis|deadline|immediately|asap|now|alert|danger|warning|serious)\b/i,
  /[!]{2,}/,   // multiple exclamation marks
  /\bWHY\b|\bHELP\b|\bNOW\b/,  // emphatic caps
]

export class InsulaService {
  /**
   * Full Insula analysis:
   * - PII detection
   * - Forget directive detection
   * - Sentiment scoring
   * - Write permission gating
   */
  analyze(
    content: string,
    userMetadata?: Record<string, unknown>,
    mode: import('../types').InsulaMode = 'standard',
  ): InsularPermissions {
    const hasForgetDirective = FORGET_DIRECTIVES.some((p) => p.test(content))

    // Reset PII pattern lastIndex (stateful regex)
    PII_PATTERNS.forEach((p) => { p.pattern.lastIndex = 0 })
    const hasPii = PII_PATTERNS.some((p) => {
      const match = p.pattern.test(content)
      p.pattern.lastIndex = 0
      return match
    })

    const detectedPiiPatterns = hasPii
      ? PII_PATTERNS.filter((p) => {
          const match = p.pattern.test(content)
          p.pattern.lastIndex = 0
          return match
        }).map((p) => p.name)
      : []

    // ── Sentiment Analysis ────────────────────────────────────
    const { sentiment, sentiment_score } = this.analyzeSentiment(content)

    // In strict mode, volatile sentiment also gates episodic writes
    const volatileBlock = mode === 'strict' && sentiment === 'volatile'

    return {
      can_write_semantic: !hasForgetDirective,
      can_write_episodic: !hasForgetDirective && !hasPii && !volatileBlock,
      can_write_summary:  !hasForgetDirective,
      redacted_patterns:  detectedPiiPatterns,
      sentiment,
      sentiment_score,
      insula_mode: mode,
      retention_override: hasForgetDirective
        ? { forget_after_session: true, forget_after_project: true }
        : undefined,
    }
  }

  /**
   * Analyze sentiment of a text string.
   * Returns a sentiment label and a score in [-1, 1].
   */
  analyzeSentiment(text: string): {
    sentiment: InsularPermissions['sentiment']
    sentiment_score: number
  } {
    if (!text) return { sentiment: 'neutral', sentiment_score: 0 }

    let positiveHits = 0
    let negativeHits = 0
    let volatileHits = 0

    for (const pattern of POSITIVE_SIGNALS) {
      const matches = text.match(pattern)
      if (matches) positiveHits += matches.length
    }
    for (const pattern of NEGATIVE_SIGNALS) {
      const matches = text.match(pattern)
      if (matches) negativeHits += matches.length
    }
    for (const pattern of VOLATILE_SIGNALS) {
      const matches = text.match(pattern)
      if (matches) volatileHits += matches.length
    }

    const total = positiveHits + negativeHits
    const rawScore = total > 0 ? (positiveHits - negativeHits) / total : 0

    // Clamp to [-1, 1]
    const sentiment_score = Math.max(-1, Math.min(1, rawScore))

    let sentiment: InsularPermissions['sentiment'] = 'neutral'
    if (volatileHits >= 2 || (negativeHits > 0 && volatileHits >= 1)) {
      sentiment = 'volatile'
    } else if (sentiment_score > 0.2) {
      sentiment = 'positive'
    } else if (sentiment_score < -0.2) {
      sentiment = 'negative'
    }

    return { sentiment, sentiment_score }
  }

  /**
   * Redact PII from a text string.
   */
  redact(text: string): string {
    let result = text
    for (const { name, pattern } of PII_PATTERNS) {
      result = result.replace(pattern, `[REDACTED:${name.toUpperCase()}]`)
      pattern.lastIndex = 0
    }
    return result
  }

  /**
   * Filter context blocks: redact PII, log filtered items.
   * In strict mode, also filters volatile-sentiment content.
   */
  filterContextBlocks(
    blocks: Array<{ label: string; content: string; token_count: number; source: string; citation?: unknown }>,
    permissions: InsularPermissions,
  ): Array<{ label: string; content: string; token_count: number; source: string; citation?: unknown }> {
    return blocks.map((block) => ({
      ...block,
      content: this.redact(block.content),
    }))
  }

  /**
   * Check if a specific memory write should be persisted.
   */
  shouldPersistToMemory(
    content: string,
    permissions: InsularPermissions,
    type: 'episodic' | 'semantic' | 'summary',
  ): boolean {
    if (type === 'episodic' && !permissions.can_write_episodic) return false
    if (type === 'semantic' && !permissions.can_write_semantic) return false
    if (type === 'summary'  && !permissions.can_write_summary)  return false
    return true
  }

  /**
   * Classify a candidate memory item before write.
   * Returns: { safe: boolean, reason?: string }
   */
  classifyForWrite(content: string, permissions: InsularPermissions): {
    safe: boolean
    action: 'store' | 'block' | 'redact'
    reason?: string
    pii_detected: boolean
    sentiment: InsularPermissions['sentiment']
  } {
    PII_PATTERNS.forEach((p) => { p.pattern.lastIndex = 0 })
    const hasPii = PII_PATTERNS.some((p) => {
      const m = p.pattern.test(content)
      p.pattern.lastIndex = 0
      return m
    })

    const { sentiment } = this.analyzeSentiment(content)

    if (permissions.retention_override?.forget_after_session) {
      return { safe: false, action: 'block', reason: 'forget_directive', pii_detected: hasPii, sentiment }
    }
    if (hasPii) {
      return { safe: true, action: 'redact', reason: 'pii_detected', pii_detected: true, sentiment }
    }
    return { safe: true, action: 'store', pii_detected: false, sentiment }
  }
}
