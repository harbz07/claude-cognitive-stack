// ============================================================
// MODEL ADAPTER — Claude API abstraction
// ============================================================

import type { AssembledPrompt, ModelProfile } from '../types'
import { MODEL_MAP } from '../config'

export interface GenerateParams {
  prompt: AssembledPrompt
  model_profile: ModelProfile
  stream?: boolean
  api_key: string
  max_tokens?: number
}

export interface GenerateResult {
  response: string
  model: string
  usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  stop_reason: string
}

// Build the context injection block from assembled prompt
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

export class ModelAdapter {
  async generate(params: GenerateParams): Promise<GenerateResult> {
    const { prompt, model_profile, api_key, max_tokens = 2048 } = params
    const model = MODEL_MAP[model_profile] ?? MODEL_MAP.default

    // Build system with context injection
    const contextBlock = buildContextBlock(prompt)
    const fullSystem = contextBlock
      ? `${prompt.system}\n\n${contextBlock}`
      : prompt.system

    // Build messages array
    const messages: Array<{ role: string; content: string }> = [...prompt.messages]

    // Append user message (last in context_blocks or from messages)
    // Note: The last message in the array should be the current user message
    // This is handled by the orchestrator which passes messages with the current turn included

    const body = {
      model,
      max_tokens,
      system: fullSystem,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
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

  async generateStream(params: GenerateParams): Promise<ReadableStream<Uint8Array>> {
    const { prompt, model_profile, api_key, max_tokens = 2048 } = params
    const model = MODEL_MAP[model_profile] ?? MODEL_MAP.default

    const contextBlock = buildContextBlock(prompt)
    const fullSystem = contextBlock ? `${prompt.system}\n\n${contextBlock}` : prompt.system

    const body = {
      model,
      max_tokens,
      system: fullSystem,
      messages: prompt.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
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

    return response.body!
  }
}
