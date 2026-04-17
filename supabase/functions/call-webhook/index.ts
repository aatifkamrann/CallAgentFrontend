/**
 * Call Webhook — Status callbacks only (conversation logic moved to media-stream)
 * 
 * Handles Twilio status callbacks: initiated, ringing, answered, completed, failed
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseKey)

Deno.serve(async (req) => {
  try {
    const contentType = req.headers.get('content-type') || ''
    let params: Record<string, string> = {}

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData()
      formData.forEach((value, key) => { params[key] = String(value) })
    } else if (contentType.includes('application/json')) {
      params = await req.json()
    }

    const url = new URL(req.url)
    const conversationId = url.searchParams.get('conversationId') || params.conversationId || ''
    const callSid = params.CallSid || ''
    const callStatus = params.CallStatus || ''
    const callDuration = params.CallDuration || '0'

    console.log(`[CallWebhook] Status: ${callStatus}, SID: ${callSid}, ConvID: ${conversationId}`)

    if (!conversationId) {
      return new Response('OK', { status: 200 })
    }

    // Update conversation status based on Twilio callback
    switch (callStatus) {
      case 'initiated':
      case 'ringing':
        await supabase
          .from('call_conversations')
          .update({ status: callStatus, updated_at: new Date().toISOString() })
          .eq('id', conversationId)
        break

      case 'answered':
        // Media stream WebSocket handles the actual conversation
        await supabase
          .from('call_conversations')
          .update({ status: 'active', call_sid: callSid, updated_at: new Date().toISOString() })
          .eq('id', conversationId)
        break

      case 'completed':
      case 'failed':
      case 'busy':
      case 'no-answer':
      case 'canceled':
        // media-stream handles the full end-of-call processing
        // This is a fallback in case media-stream didn't process it
        const { data: conv } = await supabase
          .from('call_conversations')
          .select('status')
          .eq('id', conversationId)
          .single()

        if (conv && conv.status !== 'completed') {
          const finalStatus = callStatus === 'completed' ? 'completed' : callStatus
          const finalResponse = callStatus === 'no-answer' ? 'no_answer' : 
                               callStatus === 'busy' ? 'switched_off' :
                               callStatus === 'failed' ? 'no_answer' : null

          await supabase
            .from('call_conversations')
            .update({ 
              status: finalStatus,
              final_response: finalResponse,
              updated_at: new Date().toISOString()
            })
            .eq('id', conversationId)

          console.log(`[CallWebhook] Fallback status update: ${finalStatus}`)
        }
        break
    }

    // Twilio expects a 200 response
    return new Response('OK', { status: 200 })

  } catch (err) {
    console.error('call-webhook error:', err)
    return new Response('OK', { status: 200 }) // Always return 200 to Twilio
  }
})
