import { callAi, hasAiKey } from '../_shared/ai-client.ts'

function detectPaymentDoneSemantic(...chunks: Array<string | null | undefined>) {
  const text = chunks
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return false

  const normalizedText = text
    .replace(/\bpe\s*ment\b/g, 'payment')
    .replace(/\bpay\s*ment\b/g, 'payment')
    .replace(/\bpe\s*kr\b/g, 'pay kar')
    .replace(/\bpay\s*kr\b/g, 'pay kar')
    .replace(/\bkar\s*chu\s*ka\b/g, 'kar chuka')
    .replace(/\bkr\s*chu\s*ka\b/g, 'kar chuka')
    .replace(/\bde\s*chu\s*ka\b/g, 'de chuka')

  const futureIntentPatterns = [
    /kal\s+pay/, /pay\s+kar(na|unga|ungi|dunga|dungi)/, /payment\s+kar(na|unga|ungi|dunga|dungi)/,
    /installment/, /qist/, /settlement/, /arrange\s+kar/, /baad\s+mein\s+pay/
  ]
  if (futureIntentPatterns.some((p) => p.test(normalizedText))) return false

  const paidSignals = [
    /already\s+paid/, /i\s+have\s+paid/, /i\s+already\s+paid/, /payment\s+done/,
    /paid\s+it/, /bill\s+paid/, /dues\s+clear/, /clear\s+kar\s+di/, /clear\s+kr\s+di/,
    /jama\s+kar\s+di/, /payment\s+kar\s+di/, /payment\s+kr\s+di/, /pay\s+kar\s+di/,
    /payment\s+ho\s+chuk[ai]/, /payment\s+already\s+ho\s+gayi/,
    /pay\s+kar\s+chuk[ai]/, /payment\s+kar\s+chuk[ai]/, /de\s+chuk[ai]/,
    /transaction\s+(ho\s+gayi|done)/, /amount\s+deduct\s+ho\s+gaya/, /reference\s+number/
  ]

  const proofSignals = [
    /trx/, /transaction\s*id/, /reference\s*(id|number)?/, /receipt/, /screenshot/, /sms\s+aya/
  ]

  const strongPaidClaimSignals = [
    /\b(main|mai|mein|mn|i)\b.*\b(pay|payment|de)\b.*\bkar\b.*\bchuk[ai]\b/,
    /\b(main|mai|mein|mn|i)\b.*\b(pay|payment)\b.*\bkar\b.*\bdi(y|)a\b/,
    /\b(main|mai|mein|mn|i)\b.*\bde\s+chuk[ai]\b/,
    /\balready\b.*\b(pay|payment|paid)\b/,
  ]

  const paidMatchCount = paidSignals.reduce((count, pattern) => count + (pattern.test(normalizedText) ? 1 : 0), 0)
  const hasProofSignal = proofSignals.some((p) => p.test(normalizedText))
  const hasStrongPaidClaim = strongPaidClaimSignals.some((p) => p.test(normalizedText))

  return hasStrongPaidClaim || (paidMatchCount >= 1 && (paidMatchCount >= 2 || hasProofSignal || normalizedText.includes('already')))
}

function detectCallbackRequestedSemantic(...chunks: Array<string | null | undefined>) {
  const text = chunks
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return false

  const callbackSignals = [
    /\bcall\s+later\b/, /\bbaad\s+mein\b/, /\bdobara\s+call\b/, /\bphir\s+call\b/,
    /\babhi\s+busy\b/, /\bbusy\s+hoon\b/, /\babhi\s+free\s+nahi\b/, /\bthori\s+der\s+baad\b/,
    /\b(10|15|20|30|\d+)\s*(min|minute|minut|mint)\b/, /\b(1|2|3|\d+)\s*(ghanta|ghante|hour|hours)\b/
  ]

  return callbackSignals.some((p) => p.test(text))
}

function detectNegotiationBarrierSemantic(...chunks: Array<string | null | undefined>) {
  const text = chunks
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return false

  const barrierSignals = [
    /\binstallment\b/, /\bqist\b/, /\bextension\b/, /\bwaqt\s+chahiye\b/,
    /\bek\s+mahina\b/, /\bnext\s+month\b/, /\bagle\s+mahine\b/, /\bmonth\s+end\b/,
    /\bsettlement\b/, /\bkam\s+kar\s+do\b/, /\bthora\s+kam\b/, /\brestructure\b/
  ]

  return barrierSignals.some((p) => p.test(text))
}

function detectNonCustomerSemantic(...chunks: Array<string | null | undefined>) {
  const text = chunks
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return false

  const nonCustomerSignals = [
    /\bwrong\s+number\b/, /\bgalat\s+number\b/, /\bghalat\s+number\b/,
    /\b(main|mai|mein|mn)\b.*\b(nahi|nhi)\b.*\b(hun|hoon)\b/,
    /\b(woh|wo)\b.*\b(nahi\s+hain|available\s+nahi)\b/,
    /\b(main|mai|mein)\b.*\b(unka|unki|inka|inki)\b/,
    /\b(mujhe\s+nahi\s+pata|nahi\s+jaanta|nahi\s+jaanti)\b/,
    /\bmessage\s+nahi\s+de\s+sakt/
  ]

  return nonCustomerSignals.some((p) => p.test(text))
}

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
      ptpStatus, followUpCount, duration, script, transcript, notes,
    } = await req.json()

    if (!customerName) {
      return new Response(
        JSON.stringify({ error: 'customerName is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // If no AI key, return smart mock based on duration
    if (!hasAiKey()) {
      let mockOutcome
      const semanticNonCustomer = detectNonCustomerSemantic(transcript, notes, script)
      const semanticPaymentDone = detectPaymentDoneSemantic(transcript, notes, script)
      const semanticCallbackRequested = detectCallbackRequestedSemantic(transcript, notes, script)
      const semanticNegotiationBarrier = detectNegotiationBarrierSemantic(transcript, notes, script)
      if (semanticNonCustomer) {
        mockOutcome = { final_response: 'non_customer_pickup', ptp_date: null, ptp_status: null, notes: 'Mock: Non-customer ne call receive ki', schedule_retry_hours: 5 }
      } else if (semanticPaymentDone) {
        mockOutcome = { final_response: 'payment_done', ptp_date: null, ptp_status: null, notes: 'Mock: Customer ne payment already done confirm ki', schedule_retry_hours: 0 }
      } else if (semanticCallbackRequested) {
        mockOutcome = { final_response: 'callback_requested', ptp_date: null, ptp_status: null, notes: 'Mock: Customer ne baad mein call ka kaha', schedule_retry_hours: 2 }
      } else if (semanticNegotiationBarrier) {
        mockOutcome = { final_response: 'negotiation_barrier', ptp_date: null, ptp_status: null, notes: 'Mock: Customer extension/installment maang raha hai', schedule_retry_hours: 5 }
      } else if (duration === 0) {
        mockOutcome = { final_response: 'no_answer', ptp_date: null, ptp_status: null, notes: 'Mock: Phone nahi uthaya — 2 ghante baad retry hoga', schedule_retry_hours: 2 }
      } else if (duration <= 15) {
        mockOutcome = { final_response: 'non_customer_pickup', ptp_date: null, ptp_status: null, notes: 'Mock: Kisi aur ne uthaya (ghar ka koi) — 5 ghante baad retry', schedule_retry_hours: 5, non_customer_relation: 'family_member' }
      } else if (duration <= 45) {
        mockOutcome = { final_response: 'callback_requested', ptp_date: null, ptp_status: null, notes: 'Mock: Customer ne kaha abhi nahi baat ho sakti — 2 ghante baad retry', schedule_retry_hours: 2 }
      } else {
        mockOutcome = { final_response: 'ptp_secured', ptp_date: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0], ptp_status: 'pending', notes: 'Mock: Customer ne 3 din mein payment ka wada kiya', schedule_retry_hours: 0 }
      }
      return new Response(
        JSON.stringify({ success: true, mock: true, ...mockOutcome }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const maxPtpDate = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0]
    const today = new Date().toISOString().split('T')[0]

    const prompt = `Tum ek AI debt collection call analyzer ho. Call ka data dekh kar SIRF JSON output do.

Customer Details:
- Naam: ${customerName}
- Balance: PKR ${Number(balance).toLocaleString()}
- DPD: ${dpd}
- Previous PTP Status: ${ptpStatus || 'None'}
- Follow-up Count: ${followUpCount || 0}
- Call Duration: ${duration} seconds
- Agent Type: ${agentType}
- Tone Used: ${tone}

Script used during call:
${script || 'No script available'}

Transcript:
${transcript || 'No transcript available'}

---

SCENARIOS aur unke responses:

1. NO ANSWER (duration = 0):
   final_response: "no_answer"
   schedule_retry_hours: 2
   notes: "Phone nahi uthaya — 2 ghante baad retry"

2. SWITCHED OFF (duration = 0):
   final_response: "switched_off"
   schedule_retry_hours: 2
   notes: "Phone band hai — 2 ghante baad retry"

3. NON-CUSTOMER PICKUP (duration 1-20 sec, kisi aur ne uthaya — bhai, behan, maa, baap, biwi, shohar, dost, padosi):
   final_response: "non_customer_pickup"
   non_customer_relation: "brother" | "sister" | "mother" | "father" | "wife" | "husband" | "friend" | "other"
   schedule_retry_hours: 5
   notes: "Customer ke [relation] ne phone uthaya — message diya, 5 ghante baad retry"

4. CUSTOMER SAYS "NO I AM NOT [name]" or "wrong number" (duration 1-20 sec):
   final_response: "non_customer_pickup"
   non_customer_relation: "wrong_person"
   schedule_retry_hours: 0
   notes: "Ghalat number ya customer ne inkaar kiya ke woh [name] hain"

5. CALLBACK REQUESTED (duration 15-45 sec):
   final_response: "callback_requested"
   schedule_retry_hours: 2
   notes: "Customer ne kaha baad mein call karo — 2 ghante baad retry"

6. REFUSED TO PAY (duration 30+ sec):
   final_response: "refused"
   schedule_retry_hours: 24
   notes: "Customer ne payment se inkaar kiya — kal retry"

7. NEGOTIATION BARRIER (duration 30+ sec):
   final_response: "negotiation_barrier"
   schedule_retry_hours: 24
   notes: "Customer extension maang raha hai — kal retry with escalation"

8. PTP SECURED (duration 45+ sec):
   final_response: "ptp_secured"
   ptp_date: koi date "${today}" se "${maxPtpDate}" ke beech
   ptp_status: "pending"
   schedule_retry_hours: 0
   notes: "Customer ne payment ka wada kiya [date] tak"

9. PARTIAL PAYMENT (duration 45+ sec):
   final_response: "partial_payment"
   schedule_retry_hours: 48
   notes: "Customer ne kuch amount diya — baqi ke liye 2 din baad retry"

10. PAYMENT DONE (semantic-first):
  final_response: "payment_done"
  schedule_retry_hours: 0
  notes: "Customer ne confirm kiya ke payment already ho chuki hai"
  Trigger when customer clearly says equivalents of: "already paid", "payment kar di", "amount deduct ho gaya", "trx/reference id", "receipt".

11. BUSY:
  final_response: "busy"
  schedule_retry_hours: 2

12. ABUSE DETECTED:
  final_response: "abuse_detected"
  schedule_retry_hours: 24

Duration-based hints:
- 0 sec = no_answer ya switched_off
- 1-20 sec = non_customer_pickup ya wrong person
- 15-45 sec = callback_requested ya refused
- 46-120 sec = negotiation, ptp_secured ya partial
- 120+ sec = ptp_secured likely

SIRF yeh JSON return karo:
{
  "final_response": "...",
  "ptp_date": "YYYY-MM-DD" ya null,
  "ptp_status": "pending" ya null,
  "notes": "Roman Urdu summary",
  "schedule_retry_hours": number (0 means no retry needed),
  "non_customer_relation": "brother|sister|mother|father|wife|husband|friend|wrong_person|other" ya null
}

Return ONLY valid JSON, no markdown.`

    const aiResult = await callAi({
      prompt,
      temperature: 0.2,
      maxTokens: 512,
    })

    if (!aiResult.ok) {
      console.error('AI analyze error:', aiResult.error)
      return new Response(
        JSON.stringify({ error: 'AI API failed', details: aiResult.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const rawText = aiResult.text || '{}'
    let result: any
    try {
      result = JSON.parse(rawText)
    } catch {
      console.error('JSON parse failed:', rawText)
      result = duration > 45
        ? { final_response: 'ptp_secured', ptp_date: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0], ptp_status: 'pending', notes: 'AI parse error — defaulted to ptp_secured', schedule_retry_hours: 0 }
        : { final_response: 'no_answer', ptp_date: null, ptp_status: null, notes: 'AI parse error — defaulted', schedule_retry_hours: 2 }
    }

    // Validate
    const semanticNonCustomer = detectNonCustomerSemantic(transcript, notes, script, result?.notes)
    const semanticPaymentDone = detectPaymentDoneSemantic(transcript, notes, script, result?.notes)
    const semanticCallbackRequested = detectCallbackRequestedSemantic(transcript, notes, script, result?.notes)
    const semanticNegotiationBarrier = detectNegotiationBarrierSemantic(transcript, notes, script, result?.notes)
    if (semanticNonCustomer) {
      result.final_response = 'non_customer_pickup'
      result.ptp_date = null
      result.ptp_status = null
      result.schedule_retry_hours = 5
      result.notes = result.notes || 'Non-customer ne call receive ki.'
    } else if (semanticPaymentDone) {
      result.final_response = 'payment_done'
      result.ptp_date = null
      result.ptp_status = null
      result.schedule_retry_hours = 0
      result.notes = result.notes || 'Customer ne payment already done confirm ki.'
    } else if (semanticCallbackRequested && result.final_response !== 'ptp_secured') {
      result.final_response = 'callback_requested'
      result.ptp_date = null
      result.ptp_status = null
      result.schedule_retry_hours = 2
      result.notes = result.notes || 'Customer ne callback/later request diya.'
    } else if (semanticNegotiationBarrier && result.final_response !== 'ptp_secured') {
      result.final_response = 'negotiation_barrier'
      result.ptp_date = null
      result.ptp_status = null
      result.schedule_retry_hours = 5
      result.notes = result.notes || 'Customer ne extension/installment maanga, date commit nahi diya.'
    }

    const validResponses = ['ptp_secured', 'no_answer', 'non_customer_pickup', 'switched_off', 'negotiation_barrier', 'refused', 'callback_requested', 'partial_payment', 'payment_done', 'busy', 'abuse_detected']
    if (!validResponses.includes(result.final_response)) {
      result.final_response = duration > 45 ? 'ptp_secured' : 'no_answer'
    }

    // Ensure PTP consistency
    if (result.final_response !== 'ptp_secured') {
      result.ptp_date = null
      result.ptp_status = null
    } else {
      result.ptp_status = result.ptp_status || 'pending'
      if (!result.ptp_date) {
        result.ptp_date = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]
      }
    }

    // Ensure schedule_retry_hours
    if (typeof result.schedule_retry_hours !== 'number') {
      const retryMap: Record<string, number> = {
        no_answer: 2, switched_off: 2, non_customer_pickup: 5,
        callback_requested: 2, busy: 2, refused: 24, negotiation_barrier: 5, abuse_detected: 24,
        partial_payment: 48, ptp_secured: 0, payment_done: 0,
      }
      result.schedule_retry_hours = retryMap[result.final_response] ?? 2
    }

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('analyze-call error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})