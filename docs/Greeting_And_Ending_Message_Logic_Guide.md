# Greeting And Ending Message Logic Guide

## Purpose
This document explains how greeting and ending messages are generated, played, detected, and finalized in both:
- Live Twilio media-stream calls
- Browser testing conversation mode

---

## Key Files

- Live call runtime: server/routes/calls.js
- Testing-mode conversation: server/routes/ai.js
- Testing-mode UI behavior: src/pages/CallCenter.tsx

---

## Part A: Greeting Message Logic (Live Calls)

## 1. Greeting text source hierarchy
Live greeting text is built in this order:
1. Generated script opening section (if available)
2. Extracted opening line from script
3. Exact deterministic fallback greeting

Core methods:
- buildExactGreeting(...)
- extractOpeningGreetingFromScript(...)
- ensureLowLatencyOpeningGreeting(...)
- createCallAssets(...)

Key behavior:
- Greeting is identity-first and short
- Caller/customer gender verb forms are enforced
- If interactive greeting text is detected, system prefers exact deterministic greeting to keep pickup flow clean

## 2. Greeting audio warmup and playback
Before dialing, backend prewarms greeting audio:
- generatePreparedGreetingAudio(...)
- warmPreparedGreetingAudio(...)
- startCallAssetWarmup(...)

Playback path when customer answers:
- playPreparedGreeting(...)
- resolveGreetingPayloads(...)

Fallback order:
1. Prepared personalized greeting payloads
2. Gender-matched static voice cache
3. Any-gender static cache fallback
4. Silent connection tone fallback

Why this exists:
- Customer should hear something immediately on pickup
- Avoid dead air while model setup completes
- Keep caller identity consistent

## 3. Greeting lock and suppression
During greeting playback, customer transcript input can be suppressed briefly:
- greetingPlaybackLock and suppression guards

Purpose:
- Prevent overlap and race at first seconds
- Avoid immediate false turn-taking while opening line is still being delivered

## 4. Greeting retries for no-response
Runtime tracks greeting retry counters and no-customer-response pathways.
If no customer speech is captured, outcome path can become no_answer based on guard logic.

---

## Part B: Ending Message Logic (Live Calls)

## 1. End-call trigger detection
Ending can be triggered by:
- Explicit [END_CALL] directive in model text
- Goodbye phrase detection (Allah Hafiz, Khuda Hafiz, goodbye, bye)
- Deterministic closure states (non-customer lock, off-topic limit, hard terminal statuses)

Core detectors:
- hasEndCallDirective(...)
- hasGoodbyeClosingPhrase(...)

## 2. Fast close pipeline
When closing is detected:
1. finalClosingPlaybackLock is enabled
2. customer input is suppressed for closure window
3. graceful hangup timer is scheduled
4. Gemini socket may be closed quickly to prevent duplicate goodbye lines

Core methods/flags around closure:
- scheduleGracefulHangup(...)
- closingRequested
- finalClosingPlaybackLock
- suppressCustomerInputDuringEnding

Why this exists:
- Prevent repeated Allah Hafiz lines
- Ensure a single clean ending phrase
- Avoid post-goodbye extra responses from model

## 3. Non-customer closure behavior
If non-customer intent is locked/confirmed:
- Closure delay uses non-customer path
- Final outcome tends toward non_customer_pickup with retry scheduling rules

## 4. Completed-call ending state
For answered calls:
- Twilio completed leads to ending first
- Analysis runs
- Then final completed result is written

This keeps ending message and final outcome consistent.

---

## Part C: Greeting And Ending In Testing Mode

Testing routes live in server/routes/ai.js with action-based API:
- action = greeting
- action = respond
- action = interrupted
- action = analyze

## 1. Greeting in testing mode
- Prompt-generated greeting from testing-conversation endpoint
- Fallback deterministic greeting if AI unavailable

## 2. End signal in testing mode
- AI may return [END_CALL]
- Server strips token and returns endCall boolean
- Unsafe early ends are blocked (short pickup reply guard)

Safety logic:
- endCall only allowed when safe conditions are met
- prevents greeting-time accidental disconnect

## 3. UI testing-mode silence ending
In CallCenter testing mode:
- After repeated silence prompts, UI speaks a deterministic bye line:
  - "Koi jawab nahi aa raha... Allah Hafiz"
- Then exits call loop and moves to analysis

---

## Part D: Message Rules (Content Intent)

## Greeting intent rules
- Introduce caller identity clearly
- Ask for target customer politely
- Keep first turn short and conversational

## Ending intent rules
- Close with gratitude and goodbye phrase
- In strict negotiation branches, do not end early until allowed by policy
- For callback/busy and non-customer flows, ending line should still remain polite and clear

---

## Timing And Reasoning

| Stage | Typical Behavior | Reason |
|---|---|---|
| Pickup greeting | Immediate via prewarmed/fallback audio | Reduce first-response latency |
| Gemini setup + greeting handoff | Setup completes around early call phase | Smooth transition from greeting to conversation |
| Closing trigger | On explicit directive/goodbye phrase/state rule | Deterministic ending control |
| Graceful hangup delay | Short controlled delay | Let final line finish cleanly |

---

## Troubleshooting Checklist

If greeting sounds wrong or delayed:
1. Verify callAssets.openingGreeting content.
2. Check prepared greeting warmup success logs.
3. Check fallback source selected by resolveGreetingPayloads.
4. Confirm caller gender/voice normalization.

If agent says goodbye twice:
1. Check hasGoodbyeClosingPhrase detection path.
2. Confirm finalClosingPlaybackLock and suppression are set.
3. Confirm Gemini socket is closed on fast close path.

If call ends too early:
1. Check [END_CALL] detection context.
2. Verify early-end guards (especially in testing mode).
3. Check non-customer/off-topic forced-close conditions.

---

## References

- server/routes/calls.js
- server/routes/ai.js
- src/pages/CallCenter.tsx
