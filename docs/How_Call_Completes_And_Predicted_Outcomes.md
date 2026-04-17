# How Call Completes And Predicted Outcomes

## Purpose
This guide focuses on two things only:
1. How a call is completed in runtime.
2. How final predicted outcome is selected and saved.

Use this with the broader architecture document when debugging call end states and prediction conflicts.

---

## Part A: How Call Completes

## 1. Dial starts
Flow:
1. UI starts call from Call Center.
2. Frontend calls invokeFunction("make-call").
3. Backend route POST /api/make-call creates conversation and dials via Twilio.
4. Twilio callback URLs are attached for status and recording.

Key behavior:
- Backend prewarms greeting and Gemini setup before dialing for lower pickup latency.
- Conversation row gets call_sid and live status transitions.

## 2. Live status transitions
Twilio posts status events to POST /api/call-status.

Main transitions:
- ringing: conversation status -> ringing
- in-progress: conversation status -> in-progress
- completed with duration > 0: conversation status -> ending first
- no-answer/busy/failed/canceled/cancelled: mapped directly to terminal path

Why completed goes to ending first:
- Answered calls need transcript finalization and post-call analysis before final completed write.

## 3. Terminal handling for not-answered calls
If call never reaches full answered analysis path, backend finalizes quickly:
- no-answer -> final_response no_answer
- busy -> final_response busy
- failed (+ SIP unreachable set) -> final_response switched_off
- canceled/cancelled/declined-before-answer -> final_response no_answer

Then backend updates:
- call_conversations
- customers (retry schedule + follow_up_count)
- call_logs (terminal log row)

## 4. Safety nets when callbacks/stream are delayed
Backend has guard timers:
- 30s: early Twilio status poll fallback
- 70s: no-pickup hard finalize fallback
- 12s after ending: auto-finalize if stream analysis is stuck

UI has guard timers:
- 1s polling cadence for conversation status
- 90s analyze safety timeout reset

Result:
- UI should not remain stuck forever in Calling or Analyzing.

---

## Part B: How Predicted Outcome Is Chosen

Prediction system uses 3 parallel candidates:
1. semantic_logic: deterministic semantic model on transcript/messages
2. gemini_live: Gemini extraction from live transcript
3. gemini_recording: Gemini extraction from recording transcript

These are compared and logged, then one active final outcome is chosen.

## 1. Base analysis entry
Method: analyzeConversation(messages, conv, options)

Responsibilities:
- Normalize/validate final_response, ptp_date, ptp_status
- Apply semantic evidence overrides (non-customer, callback, refusal, payment-done)
- Apply low-signal customer transcript override using agent-confirmed PTP hints
- Enforce PTP constraints and confidence floor

## 2. Recording-based predictor
Method: predictOutcomeFromRecording({ recordingUrl, callSid, conv })

Flow:
1. Try local recording transcript extraction.
2. If not available, try Twilio recording fetch transcript rescue.
3. Parse transcript to messages.
4. Run analyzeConversation on parsed recording messages.
5. Return normalized prediction snapshot.

If unavailable, returns unavailable snapshot with reason.

## 3. Arbitration logic (which predictor wins)
At call finalization time, backend builds:
- liveGeminiPrediction
- semanticLogicPrediction
- recordingBasedPrediction

Then arbitration:
- If recording prediction is available and has outcome:
  - it becomes active primary final outcome
  - finalization_source = GEMINI-RECORDING-PRIMARY
- Else:
  - live Gemini result remains active
  - finalization_source = GEMINI-LIVE-FINAL

Pending state:
- If recording prediction is not yet usable but expected, backend marks recording_prediction_pending and stores pending marker in notes/retry_reason.

## 4. Final writes after active outcome selected
Once active outcome is set, backend writes to:

1. call_conversations:
- status completed
- final_response
- ptp_date
- notes
- schedule_retry_hours

2. customers:
- final_response
- last_call_date
- follow_up_count increment
- priority_score recompute
- assigned_agent reassignment
- assigned_tone reassignment
- ptp_status and ptp_date update
- scheduled_retry_at and retry_reason

3. call_logs:
- outcome, notes, transcript, duration
- recording_url (when available)
- call summary payload fields

Finally backend broadcasts CALL_RESULT with:
- outcome
- ptp fields
- retry_in_hours
- finalization_source
- prediction comparison snapshots

---

## Outcome Mapping Summary

Common terminal mapping behavior:
- no-answer, canceled, cancelled, declined-before-answer -> no_answer
- busy -> busy
- failed + unreachable SIP evidence -> switched_off
- answered completed call -> analysis-driven outcome (ptp_secured, callback_requested, refused, etc.)

Retry-hour source:
- Derived from outcome via semantic retry map and scheduling helpers.

---

## Timing And Reasoning Table

| Item | Value | Why |
|---|---:|---|
| Twilio callback to /call-status | Near real-time (seconds, network-dependent) | Primary event truth from telephony provider |
| UI websocket update | Near-immediate after backend emit | Fast status reflection without waiting for polling |
| UI polling interval | 1 second | Reliability if websocket misses events |
| Early Twilio status poll fallback | 30 seconds | Recover when callback is delayed/missed |
| No-pickup hard finalize | 70 seconds | Prevent stuck ringing/calling with no media |
| Ending safety auto-finalize | 12 seconds | Prevent endless ending state |
| UI analyze safety reset | 90 seconds | Prevent endless analyzing state |

---

## Debug Checklist (Call End + Prediction)

When outcome looks wrong, verify in order:
1. call-status callback payload (CallStatus, SipResponseCode, CallDuration)
2. call_conversations.status transitions (ringing/in-progress/ending/terminal)
3. prediction comparison logs (semantic/live/recording)
4. finalization_source in CALL_RESULT payload
5. customer and call_log rows after final write
6. recording callback and pending marker cleanup path

---

## Primary Code References

- server/routes/calls.js
- src/pages/CallCenter.tsx
- src/services/db.ts
- docs/Greeting_And_Ending_Message_Logic_Guide.md
