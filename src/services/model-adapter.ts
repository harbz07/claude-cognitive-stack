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
}

// ── OpenAI-compatible path ────────────────────────────────────
async function generateOpenAI(params: GenerateParams): Promise<GenerateResult> {
  const { prompt, model_profile, api_key, base_url, max_tokens = 2048 } = params
  const model = OPENAI_MODEL_MAP[model_profile] ?? OPENAI_MODEL_MAP.default

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
      'Authorization': `Bearer ${api_key}`,
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

// ── Anthropic path ────────────────────────────────────────────
async function generateAnthropic(params: GenerateParams): Promise<GenerateResult> {
  const { prompt, model_profile, api_key, max_tokens = 2048 } = params
  const model = MODEL_MAP[model_profile] ?? MODEL_MAP.default

  const contextBlock = buildContextBlock(prompt)
  const fullSystem = contextBlock
    ? `${prompt.system}\n\n${contextBlock}`
    : prompt.system

  const body = {
    model,
    max_tokens,
    system: fullSystem,
    messages: prompt.messages.map((m) => ({ role: m.role, content: m.content })),
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': api_key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${errText}`)
  }

  const data = await response.json() as any

  return {
    response: data.content?.[0]?.text ?? '',
    model: data.model ?? model,
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    },
    stop_reason: data.stop_reason ?? 'unknown',
  }
}

// ── Public adapter ────────────────────────────────────────────
export class ModelAdapter {
  async generate(params: GenerateParams): Promise<GenerateResult> {
    if (params.base_url) {
      return generateOpenAI(params)
    }
    return generateAnthropic(params)
  }

  async generateStream(params: GenerateParams): Promise<ReadableStream<Uint8Array>> {
    const { prompt, model_profile, api_key, base_url, max_tokens = 2048 } = params

    if (base_url) {
      // OpenAI-compatible streaming
      const model = OPENAI_MODEL_MAP[model_profile] ?? OPENAI_MODEL_MAP.default
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
          'Authorization': `Bearer ${api_key}`,
        },
        body: JSON.stringify({ model, max_tokens, messages, stream: true }),
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`OpenAI stream error ${response.status}: ${errText}`)
      }
      return response.body!
    }

    // Anthropic streaming
    const model = MODEL_MAP[model_profile] ?? MODEL_MAP.default
    const contextBlock = buildContextBlock(prompt)
    const fullSystem = contextBlock ? `${prompt.system}\n\n${contextBlock}` : prompt.system

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens,
        system: fullSystem,
        messages: prompt.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Anthropic stream error ${response.status}: ${errText}`)
    }
    return response.body!
  }
}
