import { callAi, hasAiKey } from '../_shared/ai-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const {
      customerName, balance, dpd, agentType, tone,
      ptpStatus, followUpCount, callerName,
      systemPrompt, temperature, maxTokens, maxPtpDays,
    } = await req.json()

    if (!customerName || !agentType || !tone) {
      return new Response(
        JSON.stringify({ error: 'customerName, agentType, and tone are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!hasAiKey()) {
      return new Response(
        JSON.stringify({ error: 'No AI key configured. Set GEMINI_API_KEY or LOVABLE_API_KEY in env.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const toneInstructions: Record<string, string> = {
      polite: 'Bohat izzat aur adab se baat karo, customer ko aaram se samjhao. Professional lekin dosti wala andaz.',
      assertive: 'SAKHT, BOLD, aur POWERFUL andaz mein baat karo. Tum friendly reminder NAHI — tum SERIOUS recovery agent ho. CIBIL reporting, account freeze, legal recovery ka WAZEH mention karo. Consequences sunao: court notice, credit score damage, account freeze. Mazeed delay BILKUL bardasht nahi. Extension KHATAM. Short punchy sentences. Direct aur commanding.',
      empathetic: 'Customer ki mushkil samjho, unki situation ka ehsaas dikhao, lekin payment ki taraf guide karo.',
    }

    const agentInstructions: Record<string, string> = {
      fresh_call: 'Yeh pehli baar call hai. Customer ko introduce karo aur balance ke baare mein batao. PTP lo.',
      broken_promise: 'Customer ne pehle promise kiya tha lekin payment nahi ki. Reminder do aur nayi date lo. Serious tone.',
      ptp_reminder: 'Kal PTP date hai. Customer ko yaad dilao aur confirm karo ke payment hogi.',
      ptp_followup: 'Aaj PTP date hai. Check karo ke payment hui ya nahi. Agar nahi hui to nayi date lo.',
      non_customer: 'Kisi aur ne phone uthaya. Politely message choro aur customer ke liye callback schedule karo.',
      no_answer: 'Phone nahi uthaya ya band hai. Voicemail ya SMS choro. 2 ghante baad retry karo.',
      after_hours: 'Office hours ke baad hai. Kal subah 9 baje retry schedule karo.',
      negotiation: 'Customer extension maang raha hai. Original date pe insist karo lekin flexibility dikhao.',
      escalation: 'High priority account. Supervisor attention zaroori hai. Serious tone rakho.',
      general_inquiry: 'Customer ke general sawaal ka jawab do. Account details share karo.',
    }

    const ptpLimit = maxPtpDays || 5
    const basePrompt = systemPrompt
      ? systemPrompt.replace(/{maxPtpDays}/g, String(ptpLimit))
      : `Tum ek AI debt collection voice agent ho Pakistani bank ke liye. 
SIRF Roman Urdu mein script generate karo (Urdu words English letters mein). Hindi mat use karo.

Script mein yeh sections include karo:
1. **Opening** - Salam aur introduction
2. **Main Body** - Balance discuss karo, agent type ke mutabiq
3. **PTP Negotiation** - Payment date lo (maximum ${ptpLimit} din)
4. **Objection Handling** - Agar customer refuse kare
5. **Closing** - Summary aur next steps

IMPORTANT: Poori script Roman Urdu mein ho. Natural conversational andaz mein likho.`

    const prompt = `${basePrompt}

---

Customer Details:
- Naam: ${customerName}
- Outstanding Balance: PKR ${Number(balance).toLocaleString()}
- Days Past Due (DPD): ${dpd}
- PTP Status: ${ptpStatus || 'None'}
- Follow-up Count: ${followUpCount || 0}
- Caller Name: ${callerName || 'Iqra'}

Agent Type: ${agentType}
Instructions: ${agentInstructions[agentType] || 'General call karo.'}

Tone: ${tone}
Tone Instructions: ${toneInstructions[tone] || 'Professional baat karo.'}

Caller ${callerName || 'Iqra'} ki taraf se call hai — script mein caller apna naam ${callerName || 'Iqra'} bataye.`

    const aiResult = await callAi({
      prompt,
      temperature: temperature ?? 0.7,
      maxTokens: maxTokens ?? 2048,
    })

    if (!aiResult.ok) {
      console.error('AI error:', aiResult.error)
      return new Response(
        JSON.stringify({ error: 'AI API failed', details: aiResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, script: aiResult.text, callerName: callerName || 'Iqra' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('generate-script error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})