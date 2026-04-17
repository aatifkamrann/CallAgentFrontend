# Call Flow Logic And Timing Guide

## Purpose
This document explains how calling logic works end-to-end:
- UI to server to Twilio to AI and back
- Which method calls which method
- How status transitions happen
- Scenario-by-scenario behavior (completed, no-answer, busy, failed, canceled)
- Timing windows and why each timeout exists
- How scheduler moves due customers into calling queue

---

## High-Level Architecture

- Frontend page: src/pages/CallCenter.tsx
- Frontend settings page: src/pages/AgentSettings.tsx
- Frontend schedule page: src/pages/Schedule.tsx
- Frontend API layer: src/services/db.ts
- Backend call orchestration: server/routes/calls.js
- Backend scheduler: server/scheduler.js
- Backend scheduler routes: server/index.js

Core channels:
- REST API for call start/end and status fetch
- WebSocket dashboard channel for real-time STATUS_UPDATE events
- Twilio status callbacks for telephony state
- Twilio recording callback for post-call recording availability

---

## End-To-End Method Flow (UI To Server)

## 1. Call Start
1. User presses Start Call in CallCenter UI.
2. CallCenter method startCall() runs.
3. startCall() calls invokeFunction("make-call", payload).
4. API layer maps to POST /api/make-call.
5. Backend server/routes/calls.js make-call handler:
   - prepares conversation row
   - prewarms greeting + Gemini WS
   - sends Twilio call request with StatusCallback and RecordingStatusCallback
6. Backend returns callSid and conversationId.
7. UI stores active call state and starts local call timer.

## 2. During Call (Live Status)
1. Twilio sends status callback events to POST /api/call-status.
2. Backend updates call_conversations.status (ringing, in-progress, ending, terminal states).
3. Backend emits STATUS_UPDATE via emitStatusUpdate().
4. CallCenter receives STATUS_UPDATE on WebSocket and updates UI quickly.
5. CallCenter also runs pollConversationStatus() every 1 second as reliability fallback.

## 3. Call End And Finalization
Two end paths exist:
- A. Real completed answered call:
  - callback status completed with duration > 0 is mapped to ending first
  - analysis/finalization completes afterward
  - UI shows ending/analyzing then completed result
- B. Not answered terminal calls (no-answer/busy/failed/canceled):
  - callback maps directly to terminal response
  - customer retry is scheduled
  - STATUS_UPDATE emitted to UI

## 4. Recording And Reanalysis
1. Twilio posts recording completion to POST /api/recording-status.
2. Backend stores recording URL and tries transcript extraction from recording.
3. If recording-based prediction is available, it can become primary final outcome.
4. If recording processing is delayed/unavailable, provisional result is kept with pending marker.
5. When recording completes, final rows are reconciled and pending marker removed.

---

## Scenario Logic (What Happens In Each Case)

## Scenario A: Customer picks up, talks, then hangs up
- Twilio: in-progress -> completed
- Backend: completed (duration > 0) is first marked ending
- Reason: allow transcript/AI finalization before hard completed state
- UI: shows Ending/Analyzing state, then final outcome

## Scenario B: No pickup
- Twilio callback may come as no-answer
- If callback delayed/missed, backend watchdog polls Twilio and can finalize no-answer
- Final response: no_answer
- Retry schedule: default 2 hours (or configured rule)

## Scenario C: Busy line
- Twilio status busy
- Final response: busy
- Retry schedule: default 2 hours (or configured rule)

## Scenario D: Failed/unreachable
- Twilio status failed with SIP codes such as 480/408/404/410/503
- Final response usually mapped to switched_off
- Retry schedule: default 2 hours

## Scenario E: Canceled/declined before answer
- Twilio canceled/cancelled, or completed with zero duration + decline-like SIP
- Mapped to no_answer
- Terminal reason: declined_before_answer

## Scenario F: Machine detected
- Async AMD indicates machine_start
- Server requests Twilio hangup
- Final mapped toward no_answer path

---

## Timing Windows And Why They Exist

Values are currently defined in server/routes/calls.js RESOURCE_LIMITS and UI polling hooks.

| Timing Window | Value | Location | Why |
|---|---:|---|---|
| Twilio API request timeout | 10s | make-call backend | Prevent call-start hangs on network issues |
| Gemini prewarm max wait | 3s | make-call backend | Reduce pickup latency without blocking dial too long |
| Early Twilio status poll | 30s | make-call backend watchdog | Catch missing callback for no-pickup window |
| No-pickup fallback finalize | 70s | make-call backend watchdog | Hard safety so calls do not remain stuck forever |
| Ending safety finalize | 12s | call-status completed path | Prevent endless ending state if stream finalizer fails |
| UI conversation polling interval | 1s | CallCenter pollConversationStatus usage | Keep UI state accurate if websocket misses event |
| UI poll max wait | 5 minutes | pollConversationStatus default | Stop infinite polling loops |
| UI analyze safety timeout | 90s | CallCenter safety net | Reset UI if backend finalization is delayed |

Expected practical behavior:
- Callback and websocket healthy: UI usually updates in under 1 second.
- Callback delayed: UI may update at 30 second early poll fallback.
- Worst no-pickup fallback: around 70 seconds.

---

## UI Update Flow And Sources

UI status can change from two sources in parallel:

1. WebSocket fast-path:
- STATUS_UPDATE messages from backend dashboard socket
- Near-immediate updates for ringing, in-progress, ending, terminal

2. Polling reliability-path:
- pollConversationStatus() every 1 second
- Covers dropped websocket or callback delays

Conflict handling approach:
- Terminal statuses are guarded to avoid duplicate apply
- Ending state is shown before final completed for answered calls
- Additional safety timers prevent stuck in calling or analyzing state

---

## Scheduler Flow (Schedule Page To Calling Queue)

## Config Inputs
- schedulerPollMinutes: how often scheduler checks due retries
- retryNoAnswerHours: retry delay for no-answer/busy/callback family
- retryNonCustomerHours: retry delay for non-customer family

## Processing
1. Agent Settings saves scheduler config to POST /api/scheduler/config.
2. Backend scheduler updates in-memory config and restarts interval safely.
3. Scheduler cycle checks overdue scheduled_retry_at rows.
4. Eligible rows are dialed using makeCallFn.
5. On call completion, sequential post-call trigger checks next due customer.

## Important distinction
- schedulerPollMinutes controls scan frequency.
- retryNoAnswerHours and retryNonCustomerHours control when next retry becomes due.

Example:
- To retry after 10 minutes, set retryNoAnswerHours = 0.17.
- To check queue every 10 minutes, set schedulerPollMinutes = 10.

---

## Data Updates Per Stage

## On terminal no-answer/busy/failed/canceled
- call_conversations: status + final_response + notes
- customers: final_response, follow_up_count++, scheduled_retry_at, retry_reason
- call_logs: terminal entry inserted

## On answered completed calls
- call_conversations: ending then completed after analysis
- customers: outcome + ptp fields + retry fields based on final analysis
- call_logs: transcript, notes, outcome, recording_url (when available)

## On recording callback
- call_logs.recording_url updated
- transcript and prediction can be re-evaluated from recording
- pending recording marker can be cleared when finalized

---

## Why The System Uses Multiple Guards

- Twilio callbacks are near real-time but not guaranteed deterministic latency.
- WebSocket can be interrupted on page/network transitions.
- AI finalization can be delayed by recording/transcription windows.

So the design intentionally uses:
- callback events (primary truth)
- websocket push (fast UI)
- polling fallback (reliability)
- hard safety timers (stuck-state prevention)

This combination avoids false stuck Calling/Analyzing states and improves correctness of final outcomes.

---

## Quick Operational Checklist

- If UI stuck in Calling:
  - check /api/call-status callbacks in server logs
  - check watchdog fallback at 30s and 70s
  - check websocket dashboard connectivity

- If Schedule shows stale pending recording:
  - verify latest call_log has recording_url and pending marker removed in notes
  - ensure Schedule page reconciles from latest call logs

- If due customers are not auto-called:
  - confirm scheduler enabled
  - confirm schedulerPollMinutes interval
  - confirm scheduled_retry_at is in the past and business-hours rules allow dialing

---

## Reference Files

- src/pages/CallCenter.tsx
- src/pages/Schedule.tsx
- src/pages/AgentSettings.tsx
- src/services/db.ts
- server/routes/calls.js
- server/scheduler.js
- server/index.js
- docs/Greeting_And_Ending_Message_Logic_Guide.md
