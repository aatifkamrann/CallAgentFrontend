/**
 * Media Stream — WebSocket relay between Twilio Media Streams and Gemini Live API
 * 
 * Architecture:
 * 1. Twilio opens WebSocket → sends µ-law 8kHz audio chunks
 * 2. This function transcodes µ-law → PCM 16kHz Linear16
 * 3. Sends PCM to Gemini Live API via WebSocket
 * 4. Receives Gemini audio response (PCM 24kHz)
 * 5. Transcodes PCM 24kHz → µ-law 8kHz
 * 6. Streams back to Twilio
 * 7. Records both sides and saves on call end
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ─── µ-law codec tables ─────────────────────────────────────────
const MULAW_BIAS = 0x84
const MULAW_MAX = 32635

function linearToMulaw(sample: number): number {
  let sign = 0
  if (sample < 0) { sign = 0x80; sample = -sample }
  if (sample > MULAW_MAX) sample = MULAW_MAX
  sample += MULAW_BIAS
  let exponent = 7
  let mask = 0x4000
  while ((sample & mask) === 0 && exponent > 0) { exponent--; mask >>= 1 }
  const mantissa = (sample >> (exponent + 3)) & 0x0F
  return ~(sign | (exponent << 4) | mantissa) & 0xFF
}

// Pre-compute µ-law to linear table
const MULAW_TO_LINEAR = new Int16Array(256)
;(() => {
  for (let i = 0; i < 256; i++) {
    let val = ~i & 0xFF
    const sign = val & 0x80
    const exponent = (val >> 4) & 0x07
    const mantissa = val & 0x0F
    let magnitude = ((mantissa << 3) + MULAW_BIAS) << exponent
    magnitude -= MULAW_BIAS
    MULAW_TO_LINEAR[i] = sign ? -magnitude : magnitude
  }
})()

function mulawToLinear(mulawByte: number): number {
  return MULAW_TO_LINEAR[mulawByte]
}

// ─── Resample PCM (simple linear interpolation) ─────────────────
function resamplePcm(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outputLen = Math.floor(input.length / ratio)
  const output = new Int16Array(outputLen)
  for (let i = 0; i < outputLen; i++) {
    const srcIdx = i * ratio
    const idx = Math.floor(srcIdx)
    const frac = srcIdx - idx
    const s0 = input[idx] || 0
    const s1 = input[Math.min(idx + 1, input.length - 1)] || 0
    output[i] = Math.round(s0 + frac * (s1 - s0))
  }
  return output
}

// ─── Convert µ-law buffer to PCM 16kHz ──────────────────────────
function mulawToPcm16k(mulawData: Uint8Array): Int16Array {
  // µ-law 8kHz → PCM 8kHz
  const pcm8k = new Int16Array(mulawData.length)
  for (let i = 0; i < mulawData.length; i++) {
    pcm8k[i] = mulawToLinear(mulawData[i])
  }
  // Resample 8kHz → 16kHz
  return resamplePcm(pcm8k, 8000, 16000)
}

// ─── Convert PCM 24kHz to µ-law 8kHz ───────────────────────────
function pcm24kToMulaw(pcmData: Int16Array): Uint8Array {
  // Resample 24kHz → 8kHz
  const pcm8k = resamplePcm(pcmData, 24000, 8000)
  const mulaw = new Uint8Array(pcm8k.length)
  for (let i = 0; i < pcm8k.length; i++) {
    mulaw[i] = linearToMulaw(pcm8k[i])
  }
  return mulaw
}

// ─── Int16Array ↔ base64 helpers ────────────────────────────────
function int16ToBase64(data: Int16Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64ToInt16(b64: string): Int16Array {
  const bytes = base64ToUint8(b64)
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
}

function uint8ToBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i])
  return btoa(binary)
}

// ─── Build system prompt ────────────────────────────────────────
function buildSystemInstruction(conv: any): string {
  const toneMap: Record<string, string> = {
    polite: 'Bohat izzat aur pyaar se baat karo. Customer ki izzat karo.',
    assertive: 'Firm aur serious baat karo. Payment ki urgency batao.',
    empathetic: 'Customer ki mushkil samjho lekin payment ki taraf guide karo.',
  }
  const agentMap: Record<string, string> = {
    fresh_call: 'Pehli baar call. Introduce karo aur balance batao.',
    broken_promise: 'Customer ne pehle promise toda. Serious reminder do.',
    ptp_reminder: 'PTP date aa rahi hai. Yaad dilao.',
    ptp_followup: 'PTP date hai aaj. Payment check karo.',
    non_customer: 'Kisi aur ne phone uthaya. Politely message choro.',
    negotiation: 'Customer extension maang raha hai. Flexibility dikhao.',
    escalation: 'High priority. Serious tone.',
  }
  const maxPtpDate = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0]

  return `Tum ${conv.caller_name} ho — ek AI debt collection voice agent Pakistani bank ke liye.
Tum REAL TIME mein phone pe customer se baat kar rahe ho. Audio streaming hai.

CRITICAL:
- SIRF Roman Urdu mein bolo (Urdu words English letters mein likhte hain)
- Chhota aur natural jawab — 1-3 sentences MAX per turn
- Real Pakistani call center agent ki tarah bolo, robotic nahi
- Jab baat khatam ho, apne response ke end mein [END_CALL] bolo
- Customer ka naam ${conv.customer_name}, balance PKR ${Number(conv.balance).toLocaleString()}, ${conv.dpd} din overdue
- PTP Status: ${conv.ptp_status || 'None'}, Follow-ups: ${conv.follow_up_count}
- Max PTP Date: ${maxPtpDate}
- Agent Type: ${conv.agent_type} — ${agentMap[conv.agent_type] || 'General call'}
- Tone: ${conv.tone} — ${toneMap[conv.tone] || 'Professional'}

Agar customer "main ${conv.customer_name} nahi hoon" kahe → end karo.
Agar koi aur phone uthaye → message choro aur end karo.
Agar PTP date mil jaye → confirm karo aur end karo.
Agar refuse kare → ek baar try karo phir end.`
}

// ─── Main Handler ───────────────────────────────────────────────
Deno.serve(async (req) => {
  const url = new URL(req.url)
  const conversationId = url.searchParams.get('conversationId') || ''

  const upgrade = req.headers.get('upgrade') || ''
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response('WebSocket upgrade required', { status: 426 })
  }

  const { socket: twilioWs, response } = Deno.upgradeWebSocket(req)

  const supabase = createClient(supabaseUrl, supabaseKey)
  let geminiWs: WebSocket | null = null
  let streamSid: string | null = null
  let callSid: string | null = null
  
  // Recording buffers
  const inboundChunks: Uint8Array[] = []  // customer audio (µ-law)
  const outboundChunks: Uint8Array[] = [] // agent audio (µ-law)
  
  // Conversation tracking
  const messages: Array<{ role: string; text: string; timestamp: string }> = []
  let conv: any = null
  let callStartTime = Date.now()

  // ── Load conversation data ──────────────────────────────────
  async function loadConversation() {
    if (!conversationId) return
    const { data } = await supabase
      .from('call_conversations')
      .select('*')
      .eq('id', conversationId)
      .single()
    conv = data
  }

  // ── Connect to Gemini Live API ──────────────────────────────
  function connectToGemini() {
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiKey) {
      console.error('[MediaStream] GEMINI_API_KEY not set')
      return
    }

    const model = 'gemini-2.0-flash-live-001'
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiKey}`

    console.log('[MediaStream] Connecting to Gemini Live API...')
    geminiWs = new WebSocket(wsUrl)

    geminiWs.onopen = () => {
      console.log('[MediaStream] ✅ Gemini Live API connected')

      // Send setup message
      const systemInstruction = conv ? buildSystemInstruction(conv) : 'You are a helpful voice assistant speaking in Roman Urdu.'
      
      const setup = {
        setup: {
          model: `models/${model}`,
          generation_config: {
            response_modalities: ['AUDIO'],
            speech_config: {
              voice_config: {
                prebuilt_voice_config: {
                  voice_name: 'Aoede' // Natural female voice
                }
              }
            }
          },
          system_instruction: {
            parts: [{ text: systemInstruction }]
          }
        }
      }

      geminiWs!.send(JSON.stringify(setup))
      console.log('[MediaStream] Sent setup to Gemini')
    }

    geminiWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data))

        // Handle setup complete
        if (msg.setupComplete) {
          console.log('[MediaStream] Gemini setup complete, sending initial greeting prompt')
          // Send text prompt to trigger greeting
          if (conv) {
            const greetingPrompt = {
              client_content: {
                turns: [{
                  role: 'user',
                  parts: [{ text: `Call abhi connect hui hai. Customer ne phone uthaya. Apna opening greeting do — salam karo, apna naam batao (${conv.caller_name}), aur balance ke baare mein baat shuru karo. 2-3 sentences max.` }]
                }],
                turn_complete: true
              }
            }
            geminiWs!.send(JSON.stringify(greetingPrompt))
          }
          return
        }

        // Handle audio response from Gemini
        if (msg.serverContent?.modelTurn?.parts) {
          for (const part of msg.serverContent.modelTurn.parts) {
            if (part.inlineData?.data) {
              // Gemini sends PCM 24kHz audio as base64
              const pcm24k = base64ToInt16(part.inlineData.data)
              
              // Transcode to µ-law 8kHz for Twilio
              const mulawData = pcm24kToMulaw(pcm24k)
              
              // Store for recording
              outboundChunks.push(new Uint8Array(mulawData))

              // Send to Twilio as media message
              if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                const mediaMsg = {
                  event: 'media',
                  streamSid,
                  media: {
                    payload: uint8ToBase64(mulawData)
                  }
                }
                twilioWs.send(JSON.stringify(mediaMsg))
              }
            }

            // Handle text parts (for transcript)
            if (part.text) {
              const text = part.text.trim()
              if (text) {
                messages.push({ role: 'agent', text, timestamp: new Date().toISOString() })
                console.log(`[MediaStream] Agent: ${text.substring(0, 80)}...`)
              }
            }
          }
        }

        // Handle turn complete — Gemini finished speaking
        if (msg.serverContent?.turnComplete) {
          console.log('[MediaStream] Gemini turn complete')
          
          // Check if last message has [END_CALL]
          const lastMsg = messages[messages.length - 1]
          if (lastMsg?.text?.includes('[END_CALL]')) {
            console.log('[MediaStream] AI indicated call end')
            // Send mark to know when audio finishes playing
            if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
              twilioWs.send(JSON.stringify({
                event: 'mark',
                streamSid,
                mark: { name: 'end_call' }
              }))
            }
          }
        }

        // Handle interruption from Gemini side
        if (msg.serverContent?.interrupted) {
          console.log('[MediaStream] Gemini detected interruption')
          // Clear any pending audio on Twilio side
          if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify({ event: 'clear', streamSid }))
          }
        }

      } catch (err) {
        console.error('[MediaStream] Gemini message error:', err)
      }
    }

    geminiWs.onerror = (e) => {
      console.error('[MediaStream] Gemini WebSocket error:', e)
    }

    geminiWs.onclose = (e) => {
      console.log('[MediaStream] Gemini WebSocket closed:', e.code, e.reason)
    }
  }

  // ── Twilio WebSocket handlers ─────────────────────────────────
  twilioWs.onopen = async () => {
    console.log('[MediaStream] Twilio WebSocket connected')
    callStartTime = Date.now()
    await loadConversation()
    connectToGemini()
  }

  twilioWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data))

      switch (msg.event) {
        case 'connected':
          console.log('[MediaStream] Twilio media connected')
          break

        case 'start':
          streamSid = msg.start.streamSid
          callSid = msg.start.callSid
          console.log(`[MediaStream] Stream started: ${streamSid}, Call: ${callSid}`)
          
          // Update conversation with real call SID
          if (conversationId && callSid) {
            supabase
              .from('call_conversations')
              .update({ call_sid: callSid })
              .eq('id', conversationId)
              .then(() => console.log('[MediaStream] Updated call SID'))
          }
          break

        case 'media':
          // Incoming audio from customer (µ-law 8kHz base64)
          const audioData = base64ToUint8(msg.media.payload)
          
          // Store for recording
          inboundChunks.push(new Uint8Array(audioData))

          // Transcode µ-law 8kHz → PCM 16kHz for Gemini
          const pcm16k = mulawToPcm16k(audioData)
          const pcmBase64 = int16ToBase64(pcm16k)

          // Forward to Gemini
          if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            const realtimeInput = {
              realtime_input: {
                media_chunks: [{
                  data: pcmBase64,
                  mime_type: 'audio/pcm;rate=16000'
                }]
              }
            }
            geminiWs.send(JSON.stringify(realtimeInput))
          }
          break

        case 'mark':
          console.log('[MediaStream] Mark received:', msg.mark?.name)
          if (msg.mark?.name === 'end_call') {
            // Audio finished playing, now hang up
            console.log('[MediaStream] End call mark — closing')
            // Twilio will get the hangup from the status callback
          }
          break

        case 'stop':
          console.log('[MediaStream] Stream stopped')
          handleCallEnd()
          break

        default:
          break
      }
    } catch (err) {
      console.error('[MediaStream] Twilio message error:', err)
    }
  }

  twilioWs.onclose = () => {
    console.log('[MediaStream] Twilio WebSocket closed')
    handleCallEnd()
  }

  twilioWs.onerror = (e) => {
    console.error('[MediaStream] Twilio WebSocket error:', e)
  }

  // ── Handle call end — save recording & analyze ────────────────
  let endHandled = false
  async function handleCallEnd() {
    if (endHandled) return
    endHandled = true

    console.log('[MediaStream] Handling call end...')

    // Close Gemini connection
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close()
    }

    const duration = Math.floor((Date.now() - callStartTime) / 1000)

    // ── Build and save recording ──────────────────────────────
    try {
      if (inboundChunks.length > 0 || outboundChunks.length > 0) {
        // Mix both channels into a single µ-law stream, then convert to WAV
        const maxLen = Math.max(
          inboundChunks.reduce((s, c) => s + c.length, 0),
          outboundChunks.reduce((s, c) => s + c.length, 0)
        )

        // Flatten chunks
        const flatInbound = new Uint8Array(inboundChunks.reduce((s, c) => s + c.length, 0))
        let offset = 0
        for (const chunk of inboundChunks) { flatInbound.set(chunk, offset); offset += chunk.length }

        const flatOutbound = new Uint8Array(outboundChunks.reduce((s, c) => s + c.length, 0))
        offset = 0
        for (const chunk of outboundChunks) { flatOutbound.set(chunk, offset); offset += chunk.length }

        // Convert both to PCM and mix
        const inPcm = new Int16Array(flatInbound.length)
        for (let i = 0; i < flatInbound.length; i++) inPcm[i] = mulawToLinear(flatInbound[i])

        const outPcm = new Int16Array(flatOutbound.length)
        for (let i = 0; i < flatOutbound.length; i++) outPcm[i] = mulawToLinear(flatOutbound[i])

        const mixLen = Math.max(inPcm.length, outPcm.length)
        const mixed = new Int16Array(mixLen)
        for (let i = 0; i < mixLen; i++) {
          const a = i < inPcm.length ? inPcm[i] : 0
          const b = i < outPcm.length ? outPcm[i] : 0
          mixed[i] = Math.max(-32768, Math.min(32767, a + b))
        }

        // Create WAV file
        const wavBuffer = createWav(mixed, 8000)
        const fileName = `call-${conversationId || 'unknown'}-${Date.now()}.wav`

        const supabase = createClient(supabaseUrl, supabaseKey)
        const { error: uploadErr } = await supabase.storage
          .from('call_recordings')
          .upload(fileName, wavBuffer, { contentType: 'audio/wav', upsert: true })

        if (uploadErr) {
          console.error('[MediaStream] Recording upload error:', uploadErr)
        } else {
          const { data: urlData } = supabase.storage.from('call_recordings').getPublicUrl(fileName)
          console.log('[MediaStream] Recording saved:', urlData?.publicUrl)

          // Save recording URL to call log (will be created below)
          if (conversationId) {
            await supabase
              .from('call_conversations')
              .update({ 
                status: 'completed',
                messages,
                updated_at: new Date().toISOString()
              })
              .eq('id', conversationId)
          }

          // Create call log with recording
          if (conv) {
            const transcript = messages
              .map(m => `${m.role === 'agent' ? conv.caller_name : 'Customer'}: ${m.text}`)
              .join('\n')

            // Analyze conversation
            const analysis = await analyzeConversation(conv, messages, transcript)

            await supabase.from('call_logs').insert({
              customer_id: conv.customer_id,
              customer_name: conv.customer_name,
              agent_type: conv.agent_type,
              tone: conv.tone,
              status: 'completed',
              duration,
              outcome: analysis.final_response,
              ptp_date: analysis.ptp_date,
              notes: analysis.notes,
              transcript,
              recording_url: urlData?.publicUrl || null,
            })

            // Update customer
            const updateData: any = {
              final_response: analysis.final_response,
              last_call_date: new Date().toISOString(),
              follow_up_count: (conv.follow_up_count || 0) + 1,
              updated_at: new Date().toISOString(),
            }
            if (analysis.ptp_date) {
              updateData.ptp_date = analysis.ptp_date
              updateData.ptp_status = 'pending'
            }
            if (analysis.schedule_retry_hours > 0) {
              updateData.scheduled_retry_at = new Date(Date.now() + analysis.schedule_retry_hours * 3600000).toISOString()
              updateData.retry_reason = analysis.final_response
            }
            await supabase.from('customers').update(updateData).eq('id', conv.customer_id)

            // Update conversation final status
            await supabase
              .from('call_conversations')
              .update({
                status: 'completed',
                final_response: analysis.final_response,
                ptp_date: analysis.ptp_date,
                notes: analysis.notes,
                schedule_retry_hours: analysis.schedule_retry_hours,
                messages,
                updated_at: new Date().toISOString(),
              })
              .eq('id', conversationId)

            console.log('[MediaStream] Call analysis saved:', analysis.final_response)
          }
        }
      }
    } catch (err) {
      console.error('[MediaStream] End processing error:', err)
    }
  }

  return response
})

// ─── Analyze conversation using AI ──────────────────────────────
async function analyzeConversation(conv: any, messages: any[], transcript: string): Promise<any> {
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const lovableKey = Deno.env.get('LOVABLE_API_KEY')
  
  const maxPtpDate = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  const prompt = `Yeh ek real phone call ki transcript hai debt collection ke liye.
Transcript:
${transcript}

Analyze karo aur SIRF JSON return karo:
{
  "final_response": "ptp_secured" | "no_answer" | "non_customer_pickup" | "switched_off" | "callback_requested" | "refused" | "negotiation_barrier" | "partial_payment",
  "ptp_date": "YYYY-MM-DD" ya null,
  "ptp_status": "pending" ya null,
  "notes": "Roman Urdu mein 1 line summary",
  "schedule_retry_hours": number (0 = no retry, 2 = 2hr, 5 = 5hr, 24 = next day)
}
ONLY valid JSON.`

  try {
    let text = ''
    if (geminiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 512, responseMimeType: 'application/json' }
        })
      })
      const data = await res.json()
      text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    } else if (lovableKey) {
      const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lovableKey}` },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2, max_tokens: 512,
          response_format: { type: 'json_object' }
        })
      })
      const data = await res.json()
      text = data.choices?.[0]?.message?.content || ''
    }

    const parsed = JSON.parse(text)
    return parsed
  } catch {
    return { final_response: 'callback_requested', notes: 'Analysis failed', schedule_retry_hours: 2 }
  }
}

// ─── Create WAV file from PCM data ──────────────────────────────
function createWav(pcmData: Int16Array, sampleRate: number): Uint8Array {
  const dataSize = pcmData.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  
  const pcmBytes = new Int16Array(buffer, 44)
  pcmBytes.set(pcmData)
  
  return new Uint8Array(buffer)
}
