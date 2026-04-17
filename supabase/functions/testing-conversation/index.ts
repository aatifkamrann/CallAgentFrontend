/**
 * Testing Conversation — Real-time AI response for browser-based testing mode.
 * 
 * Receives the full conversation history + latest customer speech,
 * returns the agent's next response in Roman Urdu.
 * Mirrors the exact same conversational AI logic as call-webhook but for browser testing.
 */

import { callAi, hasAiKey } from '../_shared/ai-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function buildSystemPrompt(ctx: any): string {
  const toneInstructions: Record<string, string> = {
    polite: 'Bohat izzat aur adab se baat karo. Dosti wala andaz.',
    assertive: 'Firm aur urgent andaz. Payment ki seriousness batao. Clear deadline do.',
    empathetic: 'Customer ki mushkil samjho, lekin payment ki taraf guide karo.',
  }

  const agentInstructions: Record<string, string> = {
    fresh_call: 'Pehli baar call. Customer ko introduce karo aur balance ke baare mein batao. PTP lo.',
    broken_promise: 'Customer ne pehle promise toda. Serious reminder do aur nayi date lo.',
    ptp_reminder: 'Kal PTP date hai. Yaad dilao aur confirm karo.',
    ptp_followup: 'Aaj PTP date hai. Check karo payment hui ya nahi.',
    non_customer: 'Kisi aur ne phone uthaya. Politely message choro.',
    no_answer: 'Voicemail ya retry.',
    after_hours: 'Office hours ke baad. Kal retry.',
    negotiation: 'Customer extension maang raha hai. Flexibility dikhao lekin insist karo.',
    escalation: 'High priority. Serious tone.',
    general_inquiry: 'General sawaal ka jawab do.',
  }

  const isFemale = ctx.callerGender === 'female' || 
    ['iqra','amna','sana','nadia','ayesha','zara','mehwish'].includes((ctx.callerName || '').toLowerCase())
  const bolRahi = isFemale ? 'bol rahi' : 'bol raha'
  const samjhi = isFemale ? 'samajh gayi' : 'samajh gaya'
  const karungi = isFemale ? 'karungi' : 'karunga'
  const rahi = isFemale ? 'rahi' : 'raha'

  const maxPtpDate = new Date(Date.now() + (ctx.maxPtpDays || 5) * 86400000).toISOString().split('T')[0]

  return `Tum ${ctx.callerName} ho — ek ${isFemale ? 'female' : 'male'} AI debt collection voice agent Pakistani bank ke liye.
Tum REAL TIME mein customer se phone pe baat kar ${rahi} ho.

GENDER RULES (VERY IMPORTANT):
- Tum ${isFemale ? 'FEMALE (aurat)' : 'MALE (mard)'} ho — ${isFemale ? 'feminine' : 'masculine'} Roman Urdu grammar ZAROOR use karo
- "Main ${ctx.callerName} ${bolRahi} hoon", "Main ${samjhi}", "Main ${karungi}"
- ${isFemale ? 'KABHI "bol raha/samajh gaya/karunga" mat use karo' : 'KABHI "bol rahi/samajh gayi/karungi" mat use karo'}

CRITICAL RULES:
- SIRF Roman Urdu mein jawab do (Urdu words English letters mein)
- Chhota aur natural jawab do — 1-3 sentences MAX per turn
- Natural fillers use karo: "Ji", "Dekhiye", "Bilkul", "Acha"
- Pakistani call center ${isFemale ? 'lady' : 'gentleman'} ki tarah baat karo — robotic NAHI
- Apna naam ${ctx.callerName} batao agar poochein
- Jab baat khatam ho → "[END_CALL]" lagao

Customer Details:
- Naam: ${ctx.customerName}
- Outstanding Balance: PKR ${Number(ctx.balance).toLocaleString()}
- Days Past Due: ${ctx.dpd}
- Previous PTP Status: ${ctx.ptpStatus || 'None'}
- Follow-up Count: ${ctx.followUpCount || 0}
- Max PTP Date: ${maxPtpDate}

Agent Type: ${ctx.agentType}
Instructions: ${agentInstructions[ctx.agentType] || 'General call karo.'}

Tone: ${ctx.tone}  
${toneInstructions[ctx.tone] || 'Professional baat karo.'}

SCENARIOS:
- Customer "main ${ctx.customerName} nahi" kahe → politely end "[END_CALL]"
- Family member → message choro "[END_CALL]"
- Callback maange → "Theek hai" "[END_CALL]"
- Refuse → ek baar try, phir "[END_CALL]"
- PTP de de → confirm aur "[END_CALL]"
- Aggressive → "Main ${samjhi}, lekin..." handle karo

Remember: Phone pe ho, chhota natural jawab. 1-3 sentences MAX.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
  const body = await req.json()
    const {
      customerName, balance, dpd, agentType, tone,
      ptpStatus, followUpCount, callerName, maxPtpDays,
      callerGender,
      conversationHistory,
      customerSpeech,
      action,
    } = body

    // Determine gender pronoun style
    const isFemale = (callerGender === 'female') || 
      ['iqra','amna','sana','nadia','ayesha','zara','mehwish'].includes((callerName || '').toLowerCase())
    const bolRaha = isFemale ? 'bol rahi' : 'bol raha'
    const samjhGayi = isFemale ? 'samajh gayi' : 'samajh gaya'
    const karungi = isFemale ? 'karungi' : 'karunga'

    if (!hasAiKey()) {
      return new Response(
        JSON.stringify({ error: 'No AI key configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const ctx = { customerName, balance, dpd, agentType, tone, ptpStatus, followUpCount, callerName, maxPtpDays, callerGender: isFemale ? 'female' : 'male' }
    const systemPrompt = buildSystemPrompt(ctx)

    // ── GREETING: Generate opening line ──
    if (action === 'greeting') {
      const result = await callAi({
        systemPrompt,
        prompt: `Yeh call abhi connect hui hai. Customer ne phone uthaya hai. Apna opening greeting do — salam karo, apna naam batao, aur baat shuru karo. Chhota rakho — 2-3 sentences max. SIRF Roman Urdu. ${isFemale ? 'Feminine grammar use karo.' : 'Masculine grammar use karo.'}`,
        temperature: 0.8,
        maxTokens: 200,
      })

      const text = result.ok
        ? result.text.replace(/\[END_CALL\]/g, '').trim()
        : `Assalam o Alaikum, main ${callerName} ${bolRaha} hoon bank ki taraf se. Kya main ${customerName} se baat kar ${isFemale ? 'rahi' : 'raha'} hoon?`

      return new Response(
        JSON.stringify({ text, endCall: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── RESPOND: Process customer speech and generate agent response ──
    if (action === 'respond') {
      const history = (conversationHistory || [])
        .map((m: any) => `${m.role === 'agent' ? callerName : 'Customer'}: ${m.text}`)
        .join('\n')

      const result = await callAi({
        systemPrompt,
        prompt: `Yeh ab tak ki conversation hai:\n\n${history}\n\nCustomer ne abhi "${customerSpeech}" kaha. Apna next response do. Chhota rakho — 1-3 sentences. Agar baat khatam ho gayi to "[END_CALL]" lagao. SIRF Roman Urdu.`,
        temperature: 0.7,
        maxTokens: 200,
      })

      let text = result.ok
        ? result.text.trim()
        : `Ji, main ${samjhGayi}. Kya aap payment ke baare mein baat kar sakte hain?`

      const endCall = text.includes('[END_CALL]')
      text = text.replace(/\[END_CALL\]/g, '').trim()

      return new Response(
        JSON.stringify({ text, endCall }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── INTERRUPTED: Customer interrupted while agent was speaking ──
    if (action === 'interrupted') {
      const { agentWasSaying } = body
      const history = (conversationHistory || [])
        .map((m: any) => `${m.role === 'agent' ? callerName : 'Customer'}: ${m.text}`)
        .join('\n')

      const result = await callAi({
        systemPrompt,
        prompt: `CONTEXT: Tum bol ${isFemale ? 'rahi thi' : 'raha tha'}: "${agentWasSaying || '...'}"
Lekin customer ne tumhe BEECH MEIN ROK DIYA aur kaha: "${customerSpeech}"

Previous conversation:
${history}

IMPORTANT INSTRUCTIONS:
- Customer ne tumhe interrupt kiya — yeh normal hai phone calls mein
- PEHLE customer ki baat acknowledge karo naturally: "Ji ji", "Haan haan, boliye", "Acha acha"
- Phir unke sawal/point ka jawab do
- Apni adhoori baat DOBARA MAT SHURU KARO — customer ne suni thi, ab unka jawab do
- Short aur natural rakho — 1-3 sentences
- Agar baat khatam → "[END_CALL]"
- SIRF Roman Urdu`,
        temperature: 0.75,
        maxTokens: 200,
      })

      let text = result.ok
        ? result.text.trim()
        : `Ji ji, boliye? Main sun ${isFemale ? 'rahi' : 'raha'} hoon.`

      const endCall = text.includes('[END_CALL]')
      text = text.replace(/\[END_CALL\]/g, '').trim()

      return new Response(
        JSON.stringify({ text, endCall }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── ANALYZE: Analyze completed conversation ──
    if (action === 'analyze') {
      const history = (conversationHistory || [])
        .map((m: any) => `${m.role === 'agent' ? callerName : 'Customer'}: ${m.text}`)
        .join('\n')

      const maxPtpDateStr = new Date(Date.now() + (maxPtpDays || 5) * 86400000).toISOString().split('T')[0]
      const today = new Date().toISOString().split('T')[0]

      const result = await callAi({
        prompt: `Yeh ek phone call ki transcript hai debt collection ke liye.
Transcript:
${history}

Total turns: ${(conversationHistory || []).length}

Analyze karo aur SIRF JSON return karo:
{
  "final_response": "ptp_secured" | "no_answer" | "non_customer_pickup" | "switched_off" | "callback_requested" | "refused" | "negotiation_barrier" | "partial_payment",
  "ptp_date": "YYYY-MM-DD" ya null (date "${today}" se "${maxPtpDateStr}" ke beech honi chahiye),
  "ptp_status": "pending" ya null,
  "notes": "Roman Urdu mein 1 line summary",
  "schedule_retry_hours": number (0 = no retry, 2 = 2hr, 24 = next day),
  "non_customer_relation": "brother|sister|mother|father|wife|husband|friend|wrong_person|other" ya null
}

ONLY valid JSON return karo.`,
        temperature: 0.2,
        maxTokens: 512,
      })

      if (!result.ok) {
        return new Response(
          JSON.stringify({ final_response: 'callback_requested', notes: 'AI analysis failed', schedule_retry_hours: 2 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      try {
        const parsed = JSON.parse(result.text)
        const validResponses = ['ptp_secured', 'no_answer', 'non_customer_pickup', 'switched_off', 'negotiation_barrier', 'refused', 'callback_requested', 'partial_payment']
        if (!validResponses.includes(parsed.final_response)) parsed.final_response = 'callback_requested'
        if (parsed.final_response !== 'ptp_secured') { parsed.ptp_date = null; parsed.ptp_status = null }

        return new Response(
          JSON.stringify(parsed),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch {
        return new Response(
          JSON.stringify({ final_response: 'callback_requested', notes: 'Parse error', schedule_retry_hours: 2 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use greeting, respond, or analyze.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('testing-conversation error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
