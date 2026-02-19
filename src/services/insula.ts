// ============================================================
// INSULA — Privacy, redaction, memory write permissions
// ============================================================

import type { InsularPermissions, SlidingWindowEntry } from '../types'

const PII_PATTERNS = [
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
  { name: 'phone', pattern: /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'credit_card', pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  { name: 'api_key', pattern: /\b(sk-|pk-|api_key=|apikey=|Bearer\s+)[A-Za-z0-9_\-]{16,}\b/gi },
  { name: 'password', pattern: /\b(password|passwd|pwd)\s*[:=]\s*\S+/gi },
  { name: 'ip_address', pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g },
]

// Directives that suppress memory writes
const FORGET_DIRECTIVES = [
  /\bdon't (remember|store|save|log) this\b/i,
  /\boff the record\b/i,
  /\bno memory\b/i,
  /\bforget this\b/i,
  /\bprivate( mode)?\b/i,
  /\bthis is confidential\b/i,
]

export class InsulaService {
  analyze(content: string, userMetadata?: Record<string, unknown>): InsularPermissions {
    const hasForgetDirective = FORGET_DIRECTIVES.some((p) => p.test(content))
    const hasPii = PII_PATTERNS.some((p) => p.pattern.test(content))

    // Reset regex lastIndex (stateful patterns)
    PII_PATTERNS.forEach((p) => { p.pattern.lastIndex = 0 })

    return {
      can_write_semantic: !hasForgetDirective,
      can_write_episodic: !hasForgetDirective && !hasPii,
      can_write_summary: !hasForgetDirective,
      redacted_patterns: hasPii ? PII_PATTERNS.filter((p) => {
        const match = p.pattern.test(content)
        p.pattern.lastIndex = 0
        return match
      }).map((p) => p.name) : [],
      retention_override: hasForgetDirective
        ? { forget_after_session: true, forget_after_project: true }
        : undefined,
    }
  }

  redact(text: string): string {
    let result = text
    for (const { name, pattern } of PII_PATTERNS) {
      result = result.replace(pattern, `[REDACTED:${name.toUpperCase()}]`)
      pattern.lastIndex = 0
    }
    return result
  }

  filterContextBlocks(
    blocks: Array<{ label: string; content: string; token_count: number; source: string }>,
    permissions: InsularPermissions,
  ): Array<{ label: string; content: string; token_count: number; source: string }> {
    return blocks.map((block) => ({
      ...block,
      content: this.redact(block.content),
    }))
  }

  shouldPersistToMemory(
    content: string,
    permissions: InsularPermissions,
    type: 'episodic' | 'semantic' | 'summary',
  ): boolean {
    if (type === 'episodic' && !permissions.can_write_episodic) return false
    if (type === 'semantic' && !permissions.can_write_semantic) return false
    if (type === 'summary' && !permissions.can_write_summary) return false
    return true
  }
}
