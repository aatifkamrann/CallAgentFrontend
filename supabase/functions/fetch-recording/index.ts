import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { callSid, callLogId } = await req.json()

    if (!callSid || !callLogId) {
      return new Response(
        JSON.stringify({ error: 'callSid and callLogId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')

    if (!accountSid || !authToken) {
      // Mock mode — create a small silent WAV, upload to storage
      const mockWav = createSilentWav(2)
      const fileName = `mock-${callLogId}-${Date.now()}.wav`

      const { error: uploadErr } = await supabase.storage
        .from('call_recordings')
        .upload(fileName, mockWav, { contentType: 'audio/wav', upsert: true })

      if (uploadErr) {
        console.error('Storage upload error:', uploadErr)
        return new Response(
          JSON.stringify({ error: 'Failed to upload mock recording', details: uploadErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { data: urlData } = supabase.storage.from('call_recordings').getPublicUrl(fileName)
      const publicUrl = urlData?.publicUrl || ''

      await supabase.from('call_logs').update({
        recording_url: publicUrl,
      }).eq('id', callLogId)

      return new Response(
        JSON.stringify({ success: true, mock: true, message: 'Mock recording saved to storage', url: publicUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch recordings from Twilio
    const recUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}/Recordings.json`
    const recRes = await fetch(recUrl, {
      headers: { 'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`) },
    })

    const recData = await recRes.json()

    if (!recRes.ok || !recData.recordings || recData.recordings.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No recordings found yet. Try again in a few seconds.', retryable: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const recording = recData.recordings[0]
    const recordingSid = recording.sid

    // Download MP3 from Twilio
    const audioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`
    const audioRes = await fetch(audioUrl, {
      headers: { 'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`) },
    })

    if (!audioRes.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to download recording from Twilio' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const audioBuffer = await audioRes.arrayBuffer()
    const audioBytes = new Uint8Array(audioBuffer)
    const fileName = `twilio-${callLogId}-${recordingSid}.mp3`

    // Upload to Cloud Storage
    const { error: uploadErr } = await supabase.storage
      .from('call_recordings')
      .upload(fileName, audioBytes, { contentType: 'audio/mpeg', upsert: true })

    if (uploadErr) {
      console.error('Storage upload error:', uploadErr)
      return new Response(
        JSON.stringify({ error: 'Failed to upload recording to storage', details: uploadErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: urlData } = supabase.storage.from('call_recordings').getPublicUrl(fileName)
    const publicUrl = urlData?.publicUrl || ''

    // Update call log with storage URL
    const { error: updateError } = await supabase.from('call_logs').update({
      recording_url: publicUrl,
    }).eq('id', callLogId)

    if (updateError) {
      console.error('DB update error:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to save recording URL to DB', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true, recordingSid,
        duration: recording.duration,
        url: publicUrl,
        message: 'Recording saved to Cloud Storage',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('fetch-recording error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function createSilentWav(durationSecs: number): Uint8Array {
  const sampleRate = 8000
  const numSamples = sampleRate * durationSecs
  const dataSize = numSamples * 2
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
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  return new Uint8Array(buffer)
}
