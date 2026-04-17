/**
 * Make Call — Initiates a real-time bidirectional AI call via Twilio Media Streams
 * 
 * 1. Creates a conversation record in DB
 * 2. Calls Twilio with TwiML that opens a WebSocket stream to media-stream function
 * 3. media-stream function relays audio between Twilio and Gemini Live API
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseKey)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const {
      customerId, customerName, customerPhone,
      agentType, tone, balance, dpd,
      ptpStatus, followUpCount,
      callerVoice, callerLanguage, callerName,
    } = await req.json()

    if (!customerPhone || !customerName || !customerId) {
      return new Response(
        JSON.stringify({ error: 'customerId, customerPhone, and customerName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const voice = callerVoice || 'Polly.Aditi'
    const language = callerLanguage || 'ur-PK'
    const name = callerName || 'Iqra'

    // Create conversation record
    const { data: conv, error: convError } = await supabase
      .from('call_conversations')
      .insert({
        call_sid: 'pending',
        customer_id: customerId,
        customer_name: customerName,
        agent_type: agentType || 'fresh_call',
        tone: tone || 'polite',
        caller_name: name,
        voice,
        language,
        balance: balance || 0,
        dpd: dpd || 0,
        ptp_status: ptpStatus,
        follow_up_count: followUpCount || 0,
        messages: [],
        status: 'active',
      })
      .select()
      .single()

    if (convError || !conv) {
      console.error('Failed to create conversation:', convError)
      return new Response(
        JSON.stringify({ error: 'Failed to create conversation record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
    const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER')

    if (!accountSid || !authToken || !twilioPhone) {
      console.log('Twilio credentials not configured — mock mode')
      const mockSid = 'MOCK_' + crypto.randomUUID().slice(0, 8)
      await supabase
        .from('call_conversations')
        .update({ call_sid: mockSid })
        .eq('id', conv.id)

      return new Response(
        JSON.stringify({
          success: true, mock: true, callSid: mockSid,
          conversationId: conv.id, status: 'queued',
          agentType: agentType || 'fresh_call', tone: tone || 'polite',
          callerName: name, voice,
          message: `Mock call to ${customerName} at ${customerPhone}`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Real Twilio Call with Media Streams ───────────────────
    // Build WebSocket URL for media-stream edge function
    const wsUrl = supabaseUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://') + 
      `/functions/v1/media-stream?conversationId=${conv.id}`

    // TwiML with <Connect><Stream> for bidirectional audio streaming
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>`

    // Use TwiML directly via Url parameter pointing to a simple endpoint,
    // or use Twiml parameter for inline TwiML
    const statusCallbackUrl = `${supabaseUrl}/functions/v1/call-webhook?conversationId=${conv.id}`

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`
    const params = new URLSearchParams({
      To: customerPhone,
      From: twilioPhone,
      Twiml: twiml,
      StatusCallback: statusCallbackUrl,
      StatusCallbackMethod: 'POST',
      StatusCallbackEvent: 'initiated ringing answered completed',
    })

    const twilioRes = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const twilioData = await twilioRes.json()

    if (!twilioRes.ok) {
      console.error('Twilio error:', twilioData)
      await supabase.from('call_conversations').delete().eq('id', conv.id)
      return new Response(
        JSON.stringify({ error: 'Twilio call failed', details: twilioData }),
        { status: twilioRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update conversation with real call SID
    await supabase
      .from('call_conversations')
      .update({ call_sid: twilioData.sid })
      .eq('id', conv.id)

    return new Response(
      JSON.stringify({
        success: true,
        callSid: twilioData.sid,
        conversationId: conv.id,
        status: twilioData.status,
        agentType: agentType || 'fresh_call',
        tone: tone || 'polite',
        callerName: name,
        voice,
        mode: 'media-streams-live',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('make-call error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
