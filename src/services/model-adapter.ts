// ============================================================
// MODEL ADAPTER — Dual-backend: OpenAI-compatible + Anthropic
// ============================================================

import type { AssembledPrompt, ModelProfile } from '../types'
import { MODEL_MAP, OPENAI_MODEL_MAP } from '../config'

export interface GenerateParams {
  prompt: AssembledPrompt
  model_profile: ModelProfile
  stream?: boolean
  api_key: string
  base_url?: string          // if set → use OpenAI-compatible endpoint
  max_tokens?: number
}

export interface GenerateResult {
  response: string
  model: string
  usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    reasoning_tokens?: number
  }
  stop_reason: string
}

// ── Context block builder ─────────────────────────────────────
function buildContextBlock(prompt: AssembledPrompt): string {
  if (prompt.context_blocks.length === 0) return ''
  const lines: string[] = ['<retrieved_context>']
  for (const block of prompt.context_blocks) {
    lines.push(`\n${block.label}`)
    lines.push(block.content)
  }
  lines.push('</retrieved_context>')
  return lines.join('\n')
// ── OpenAI-compatible path (MindBridge unified API) ────────────────────────────────────────────
async function generateOpenAI(params: GenerateParams): Promise<GenerateResult> {
  const { prompt, model_profile, max_tokens = 2048 } = params
  const model = OPENAI_MODEL_MAP[model_profile] ?? OPENAI_MODEL_MAP.default
  
  // MindBridge API at api.soul-os.cc (no API key required at Worker level)
  const base_url = 'https://api.soul-os.cc/v1'
  const api_key = 'not-needed'  // MindBridge handles auth internally
  
  const contextBlock = buildContextBlock(prompt)
  const systemContent = contextBlock
    ? `${prompt.system}\n\n${contextBlock}`
    : prompt.system

  // OpenAI format: system as first message with role "system"
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemContent },
    ...prompt.messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  const endpoint = `${base_url}/chat/completions`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens,
      messages,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`OpenAI API error ${response.status}: ${errText}`)
  }

  const data = await response.json() as any
  const choice = data.choices?.[0]
  const usage = data.usage ?? {}
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0

  return {
    response: choice?.message?.content ?? '',
    model: data.model ?? model,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
      reasoning_tokens: reasoningTokens,
    },
    stop_reason: choice?.finish_reason ?? 'unknown',
  }
}

// ── Anthropic path (MindBridge unified API) ────────────────────────────────────────────
async function generateAnthropic(params: GenerateParams): Promise<GenerateResult> {
  const { prompt, model_profile, max_tokens = 2048 } = params
  const model = MODEL_MAP[model_profile] ?? MODEL_MAP.default

  // MindBridge API uses OpenAI-compatible format for all providers
  const base_url = 'https://api.soul-os.cc/v1'
  
  const contextBlock = buildContextBlock(prompt)
  const systemContent = contextBlock
    ? `${prompt.system}\n\n${contextBlock}`
    : prompt.system

  // Use OpenAI message format (MindBridge handles provider conversion)
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemContent },
    ...prompt.messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  const response = await fetch(`${base_url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens,
      messages,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`MindBridge API error ${response.status}: ${errText}`)
  }

  const data = await response.json() as any
  const choice = data.choices?.[0]
  const usage = data.usage ?? {}

  return {
    response: choice?.message?.content ?? '',
    model: data.model ?? model,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    },
    stop_reason: choice?.finish_reason ?? 'unknown',
  }
}

// ── Public adapter ────────────────────────────────────────────
export class ModelAdapter {
  async generate(params: GenerateParams): Promise<GenerateResult> {
    // All models now go through MindBridge unified API
    // Check if model starts with 'mindbridge:anthropic' to route correctly
    const model = params.model_profile
    if (model && (MODEL_MAP[model]?.includes('anthropic') || model.includes('anthropic'))) {
      return generateAnthropic(params)
    }
    return generateOpenAI(params)
  }

  async generateStream(params: GenerateParams): Promise<ReadableStream<Uint8Array>> {
    const { prompt, model_profile, max_tokens = 2048 } = params
    const base_url = 'https://api.soul-os.cc/v1'

    // Determine model based on profile
    const model = MODEL_MAP[model_profile]?.includes('anthropic') 
      ? MODEL_MAP[model_profile] ?? MODEL_MAP.default
      : OPENAI_MODEL_MAP[model_profile] ?? OPENAI_MODEL_MAP.default

    const contextBlock = buildContextBlock(prompt)
    const systemContent = contextBlock ? `${prompt.system}\n\n${contextBlock}` : prompt.system
    const messages = [
      { role: 'system', content: systemContent },
      ...prompt.messages.map((m) => ({ role: m.role, content: m.content })),
    ]

    const response = await fetch(`${base_url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens, messages, stream: true }),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`MindBridge stream error ${response.status}: ${errText}`)
    }
    return response.body!
  }
}
