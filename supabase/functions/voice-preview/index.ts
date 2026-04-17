import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function createWavFromPcm(pcmBase64: string, sampleRate = 24000): Uint8Array {
  const pcmBytes = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0));
  const dataSize = pcmBytes.length;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const encoder = new TextEncoder();

  const writeStr = (offset: number, str: string) => {
    const bytes = encoder.encode(str);
    new Uint8Array(header, offset, bytes.length).set(bytes);
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const result = new Uint8Array(44 + dataSize);
  result.set(new Uint8Array(header), 0);
  result.set(pcmBytes, 44);
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { voice, text } = await req.json();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const sampleText = text || "Assalam o Alaikum. Main bank se bol rahi hoon.";
    const voiceName = voice || "Zephyr";

    const models = [
      "gemini-2.5-flash-preview-tts",
      "gemini-2.5-flash-preview-native-audio",
      "gemini-2.0-flash",
    ];

    let lastError = "";

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1alpha/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: sampleText }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName }
                }
              }
            }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          lastError = errText;
          console.error(`[VOICE-PREVIEW] ${model} failed:`, errText);
          continue;
        }

        const data = await response.json();
        const audioPart = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);

        if (!audioPart?.inlineData?.data) {
          lastError = "No audio data";
          continue;
        }

        const rawMime = audioPart.inlineData.mimeType || "";
        console.log(`[VOICE-PREVIEW] ✅ ${model}, mime: ${rawMime}`);

        // Convert PCM to WAV if needed
        if (rawMime.includes("L16") || rawMime.includes("pcm") || rawMime.includes("raw")) {
          const rateMatch = rawMime.match(/rate=(\d+)/);
          const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;
          const wavBytes = createWavFromPcm(audioPart.inlineData.data, sampleRate);
          
          // Convert back to base64
          let binary = "";
          for (let i = 0; i < wavBytes.length; i++) {
            binary += String.fromCharCode(wavBytes[i]);
          }
          const wavBase64 = btoa(binary);

          return new Response(JSON.stringify({ audio: wavBase64, mimeType: "audio/wav" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ audio: audioPart.inlineData.data, mimeType: rawMime || "audio/mp3" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      } catch (fetchErr) {
        lastError = (fetchErr as Error).message;
        continue;
      }
    }

    return new Response(JSON.stringify({ error: "All TTS models failed", details: lastError }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("voice-preview error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
