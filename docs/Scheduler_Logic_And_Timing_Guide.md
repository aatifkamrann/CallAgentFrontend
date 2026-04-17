# Scheduler Logic And Timing Guide

## Purpose
This guide explains the scheduler end-to-end:
- How settings are applied
- How retries are computed and shifted
- How due customers are selected and dialed
- How sequential post-call chaining works
- Timing values and why each exists

---

## Scope And Key Files

- Backend engine: server/scheduler.js
- Backend API routes: server/index.js
- Settings UI and config sync: src/pages/AgentSettings.tsx
- Schedule UI visibility layer: src/pages/Schedule.tsx
- Customer and call-log refresh cadence: src/hooks/useCustomers.ts, src/hooks/useCallLogs.ts, src/services/db.ts

---

## End-To-End Flow (Settings To Dialing)

## 1. Configure from UI
1. User changes scheduler fields in Agent Settings.
2. Save triggers POST /api/scheduler/config.
3. Payload includes:
   - maxConcurrentCalls
   - interCallDelaySec
   - schedulerPollMinutes
   - autoDialBatchSize
   - retryNoAnswerHours
   - retryNonCustomerHours
   - retryCallbackHours
   - retryRefusedHours

## 2. Backend config apply
1. server/index.js forwards config to updateSchedulerConfig().
2. scheduler.js updates in-memory schedulerConfig.
3. If scheduler is running, interval is restarted safely with new poll interval.
4. If retry-hour settings changed, queued customers are re-scheduled using new rules.

## 3. Scheduler cycle
Each cycle runs two stages:
1. checkPtpReminders()
2. checkAndRedial()

Order is intentional:
- PTP reminders are generated first
- then overdue queue is processed

---

## Scheduler APIs

- GET /api/scheduler/status
  - returns enabled flag, counts, and config snapshot
- POST /api/scheduler/start
  - starts periodic cycle timer
- POST /api/scheduler/stop
  - stops timer
- POST /api/scheduler/trigger
  - immediate manual run of one cycle
- POST /api/scheduler/config
  - updates runtime scheduler configuration

---

## Config Model

Current schedulerConfig fields:
- maxConcurrentCalls: max active calls allowed
- interCallDelaySec: gap between dialing consecutive customers
- schedulerPollSec: internal cycle frequency in seconds
- autoDialBatchSize: cap per cycle selection
- retryNoAnswerHours
- retryNonCustomerHours
- retryCallbackHours
- retryRefusedHours

UI-facing mapping:
- schedulerPollMinutes in UI is converted to schedulerPollSec on server
- minimum enforced schedulerPollSec is 30 seconds

---

## Retry Outcome Mapping

Outcome to retry group:
- no_answer -> retryNoAnswerHours
- switched_off -> retryNoAnswerHours
- callback_requested -> retryCallbackHours
- busy -> retryCallbackHours
- partial_payment -> retryCallbackHours
- non_customer_pickup -> retryNonCustomerHours
- refused -> retryRefusedHours
- abuse_detected -> retryRefusedHours

When retry config changes:
- rescheduleQueuedCustomers() recalculates scheduled_retry_at for future queued rows
- base is last_call_date (or now fallback)
- business-hour constraints are re-applied

---

## PTP Reminder Scheduling Logic

Method: checkPtpReminders()

Candidates:
- ptp_status = pending
- ptp_date exists
- scheduled_retry_at is null
- ptp_date is tomorrow, today, or yesterday

Actions:
- Tomorrow: day-before reminder
- Today: day-of follow-up
- Yesterday: broken promise escalation

Broken promise escalation does:
- assigned_agent -> broken_promise
- assigned_tone -> assertive
- ptp_status -> broken

Default reminder time behavior:
- target around 10:00 AM
- if already past target time, schedule now + 30 minutes
- always clamp into business hours and weekdays

---

## Overdue Retry Dialing Logic

Method: checkAndRedial()

## 1. Business-day guards
- Weekend: overdue retries shifted to next business day 9 AM
- After-hours (>=18 or <9): overdue retries shifted to next valid 9 AM

## 2. Capacity controls
- active calls counted from call_conversations status in (active, ending)
- available slots = maxConcurrentCalls - activeCount
- batchLimit = min(availableSlots, autoDialBatchSize)

## 3. Customer selection
- customers where scheduled_retry_at <= now
- sorted by priority_score descending
- limited by batchLimit

## 4. Per-customer guards
- skip if customer already has active call
- skip if last conversation updated less than 5 minutes ago (cooldown)

## 5. Dial attempt
- auto-select caller persona (server-side mirror logic)
- optional fetch of last 3 call logs for context
- call makeCallFn with 30-second safety timeout

On success:
- clear scheduled_retry_at and retry_reason

On failure:
- if resource limit type error: halt current batch
- otherwise reschedule that customer +5 minutes with failure reason

## 6. Inter-call pacing
- waits interCallDelaySec between attempts

---

## Sequential Chaining After Call Completion

Method: onCallCompleted()

Purpose:
- after one call fully completes, check next due customer automatically
- supports one-by-one operational style

Behavior:
- debounced by nextCallTimer to avoid duplicate triggers
- waits max(2 seconds, interCallDelaySec)
- then runs checkAndRedial()

---

## Schedule Page Behavior

Schedule page reads:
- scheduler enabled state and poll interval from /api/scheduler/status
- customers list for scheduled_retry_at
- call logs to reconcile stale pending-recording markers

Panels:
- Overdue retries
- Upcoming retries
- PTP reminders

Actions:
- Start/Stop scheduler
- Trigger all overdue now
- Navigate to Call Center for immediate manual call

---

## Timing And Reason Table

| Item | Value | Why |
|---|---:|---|
| Scheduler minimum poll interval | 30s | Prevent too-frequent heavy DB/dial cycles |
| Scheduler poll interval | configurable (minutes in UI) | Operational control of scan frequency |
| Start warm-up first run | 5s after start | Quick first cycle without waiting full interval |
| Call setup timeout in scheduler dial | 30s | Prevent one stuck dial blocking cycle |
| Customer cooldown before re-dial | 5 min | Avoid rapid repeated calls to same customer |
| Inter-call delay | configurable seconds | Protect provider limits and smooth queue |
| Post-call sequential check delay | max(2s, interCallDelaySec) | Stable one-by-one chaining |
| Failure requeue delay | 5 min | Preserve failed jobs without immediate thrash |

---

## Distinction: Scan Frequency vs Retry Delay

These are different controls:

1. schedulerPollMinutes
- how often scheduler checks for due customers

2. retryNoAnswerHours and others
- how far in future each retry is scheduled

Example:
- If retryNoAnswerHours = 0.17 (10 min), customer becomes due around 10 minutes later.
- If schedulerPollMinutes = 10, scheduler scans every 10 minutes.
- If schedulerPollMinutes = 1, scheduler scans every minute and picks customer as soon as due.

---

## Data Mutation Summary

During scheduler operations, writes mainly occur in customers table:
- scheduled_retry_at
- retry_reason
- assigned_agent
- assigned_tone
- ptp_status (for broken promise escalation)
- updated_at

Call creation itself is delegated to makeCallFn (call route), which then updates conversations/logs.

---

## Operational Debug Checklist

If scheduler seems not dialing:
1. Check scheduler enabled from /api/scheduler/status.
2. Verify scheduled_retry_at <= now for target customers.
3. Confirm business-day and time window are valid.
4. Check active call slots (may be full).
5. Confirm cooldown not blocking recent-customer retries.
6. Inspect logs for call setup timeout or makeCallFn missing.

If timing seems off:
1. Verify schedulerPollMinutes in settings and server status config.
2. Verify retry hour fields (no_answer/non_customer/etc.).
3. Confirm re-scheduling behavior after config change.

If Schedule page text seems stale:
1. Verify latest call_log recording and notes markers.
2. Ensure customer and call-log polling are running with configured cadence.

---

## References

- server/scheduler.js
- server/index.js
- src/pages/AgentSettings.tsx
- src/pages/Schedule.tsx
- src/hooks/useCustomers.ts
- src/hooks/useCallLogs.ts
- src/services/db.ts
