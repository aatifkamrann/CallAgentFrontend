# Customer Ended Call But UI Shows no_answer After 5 Minutes

## Purpose
Explain why UI can show no_answer after about 5 minutes when customer ends the call, and list all runtime steps currently active in code.

---

## Short Answer
This happens when frontend does not receive a terminal status in time (websocket event missed or status callback/finalization delayed), so frontend polling hits its max wait (300000 ms = 5 minutes) and applies a fallback status:
- status: no_answer
- final_response: no_answer

This fallback is currently intentional to prevent stuck call UI.

---

## Current Runtime Steps In Use

## 1. Call starts
- Frontend starts call using invokeFunction('make-call').
- Backend creates call_conversations row and places Twilio call.
- Backend also arms no-pickup safety timers:
  - 30s early Twilio status poll
  - 70s watchdog no-pickup finalize

## 2. Live status updates
Two channels run in parallel:
1. Twilio callback -> POST /api/call-status (primary source of truth)
2. WebSocket STATUS_UPDATE to frontend (fast UI path)

Frontend also runs polling fallback:
- pollConversationStatus(conversationId, ..., 300000, 1000, false)

That means:
- poll every 1 second
- stop after 5 minutes
- ending is not terminal in this poll call (includeEndingAsTerminal=false)

## 3. If customer ends the call
There are multiple backend branches:

### A. Customer ended before real pickup
Mapped to no_answer branch:
- canceled/cancelled -> no-answer -> final_response no_answer
- completed with duration 0 and decline-like SIP can be treated as declined_before_answer -> no-answer -> final_response no_answer

### B. Customer picked up and then ended normally
- call-status completed with duration > 0 is first set to ending
- media-stream analysis should finalize to completed with analyzed outcome
- if ending gets stuck, backend ending safety finalizer runs after 12s

### C. Callback/finalization misses
If terminal status is never observed by frontend trackers, frontend 5-minute poll timeout triggers local fallback to no_answer.

---

## Why You See Exactly Around 5 Minutes

The exact 5-minute value comes from frontend poll max wait:
- maxWaitMs = 300000 in pollConversationStatus calls used by live call tracking.

When this expires with no terminal payload, frontend executes this protective UI reset path:
- syncEndedCallUi({ status: 'no_answer', final_response: 'no_answer', notes: 'Call status not received — auto reset' })

So even if backend was delayed or callback was missed, UI exits safely instead of staying in active/analyzing forever.

---

## Manual End Button Path (Agent clicks End Call)

When agent clicks End Call:
1. Frontend calls invokeFunction('end-call', { callSid, conversationId }).
2. Backend /api/end-call sets conversation status to ending.
3. Backend force-closes active Twilio media websocket (manual_end_requested) so handleCallEnd runs.
4. Backend also calls Twilio REST Status=completed when callSid is real.
5. Frontend then polls conversation for up to 120000 ms (2 minutes) in this endCall flow.

Important:
- The 5-minute fallback is from the separate live tracker poll loop, not the 2-minute poll inside endCall().
- If state sync races happen and terminal status is still not observed by the live tracker, 5-minute fallback can still appear as no_answer.

---

## Active Timing Guards Right Now

- 30s: TWILIO_STATUS_POLL_MS (early no-pickup reconciliation)
- 70s: NO_PICKUP_FALLBACK_MS (watchdog finalize)
- 12s: ending safety finalizer after completed->ending path
- 90s: frontend analyzing safety reset
- 120s: endCall() follow-up poll after manual end request
- 300s (5 min): frontend live poll max wait fallback to no_answer

---

## Data Writes For no_answer Path

When no-answer style terminal mapping is applied, backend updates:
- call_conversations.status (no-answer or equivalent)
- call_conversations.final_response = no_answer
- customers.final_response = no_answer
- customers.follow_up_count increment
- customers.scheduled_retry_at and retry_reason
- call_logs terminal row

---

## How To Verify This Case Quickly

1. Check server applogs around call-status and NO-PICKUP-FINALIZE entries.
2. Check if conversation hit ending and then completed, or directly no-answer.
3. Check whether STATUS_UPDATE terminal event reached frontend websocket.
4. Check /api/conversation/:id response during the 5-minute window.
5. If frontend notes contain "Call status not received — auto reset", it is the 5-minute UI fallback path.

---

## File References

- src/pages/CallCenter.tsx
- src/services/db.ts
- server/routes/calls.js
