/**
 * Shared AI Client — works with BOTH:
 *   1. Lovable AI Gateway (LOVABLE_API_KEY) — used in Lovable Cloud
 *   2. Direct Google Gemini API (GEMINI_API_KEY) — used for local/self-hosted
 *
 * Priority: GEMINI_API_KEY > LOVABLE_API_KEY
 * If neither is set, returns null (caller should handle mock mode).
 */

interface AiCallOptions {
  prompt: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
}

interface AiResponse {
  text: string
  ok: boolean
  error?: string
}

export async function callAi(options: AiCallOptions): Promise<AiResponse> {
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const lovableKey = Deno.env.get('LOVABLE_API_KEY')

  if (geminiKey) {
    return callGeminiDirect(geminiKey, options)
  }

  if (lovableKey) {
    return callLovableGateway(lovableKey, options)
  }

  return { text: '', ok: false, error: 'No AI API key configured. Set GEMINI_API_KEY or LOVABLE_API_KEY.' }
}

export function hasAiKey(): boolean {
  return !!(Deno.env.get('GEMINI_API_KEY') || Deno.env.get('LOVABLE_API_KEY'))
}

// ─── Direct Google Gemini API ────────────────────────────────────
async function callGeminiDirect(apiKey: string, options: AiCallOptions): Promise<AiResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`

  const contents: any[] = []
  if (options.systemPrompt) {
    contents.push({ role: 'user', parts: [{ text: options.systemPrompt }] })
    contents.push({ role: 'model', parts: [{ text: 'Samajh gaya. Main tayar hoon.' }] })
  }
  contents.push({ role: 'user', parts: [{ text: options.prompt }] })

  const body: any = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 2048,
    },
  }

  if (options.jsonMode) {
    body.generationConfig.responseMimeType = 'application/json'
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()

  if (!res.ok) {
    return { text: '', ok: false, error: JSON.stringify(data) }
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return { text, ok: true }
}

// ─── Lovable AI Gateway (OpenAI-compatible) ──────────────────────
async function callLovableGateway(apiKey: string, options: AiCallOptions): Promise<AiResponse> {
  const url = 'https://ai.gateway.lovable.dev/v1/chat/completions'

  const messages: any[] = []
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }
  messages.push({ role: 'user', content: options.prompt })

  const body: any = {
    model: 'google/gemini-2.5-flash',
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
  }

  if (options.jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()

  if (!res.ok) {
    return { text: '', ok: false, error: JSON.stringify(data) }
  }

  const text = data.choices?.[0]?.message?.content || ''
  return { text, ok: true }
}
