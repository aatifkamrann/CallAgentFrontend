# AI Voice Agent — POC Testing Checklist

## Pre-requisites
- [ ] Server running on `localhost:3001`
- [ ] Ngrok tunnel active (`SERVER_URL` set in `.env`)
- [ ] Twilio credentials configured
- [ ] Gemini API key configured
- [ ] Frontend running on `localhost:8080`

---

## PHASE 1: Customer Data Setup

### Step 1.1 — Import Customers CSV
- [ ] Go to **Customers** page
- [ ] Click **"Template"** → download CSV template → verify `gender` column present
- [ ] Open `customers_import.csv` — verify 10 rows with gender values (male/female)
- [ ] Click **"Import CSV"** → upload `customers_import.csv`
- [ ] ✅ Success toast: "Imported 10"
- [ ] ✅ All 10 customers appear in table with correct Gender icons (👨/👩)

### Step 1.2 — Verify Auto-Assignment
- [ ] **Priority Score** calculated: `(follow_up × 10) + (balance_in_thousands × 5) + (DPD × 3)`
- [ ] Ayesha Siddiqui (balance=200k, DPD=60, follow_up=3) → highest priority
- [ ] **Agent Type** auto-assigned based on PTP status & DPD:
  - Fatima (PTP pending) → `ptp_reminder`
  - Ayesha (PTP broken) → `broken_promise`
  - Fresh customers (no PTP) → `fresh_call`
- [ ] **Tone** auto-assigned:
  - Broken promise / high DPD → `assertive`
  - Fresh / low DPD → `polite`

### Step 1.3 — Add Customer Manually
- [ ] Click **"Add Customer"** → fill form with gender selection
- [ ] ✅ Customer appears with correct priority, agent, tone auto-calculated

### Step 1.4 — Edit Customer
- [ ] Click pencil icon → change balance, DPD, gender
- [ ] ✅ Priority recalculated, agent/tone reassigned

### Step 1.5 — Delete Customer
- [ ] Click trash icon → confirm delete
- [ ] ✅ Customer removed from list

---

## PHASE 2: Agent Settings & Auto-Dialer

### Step 2.1 — Configure Settings
- [ ] Go to **Agent Settings** page
- [ ] Set **Max Concurrent Calls**: 2
- [ ] Set **Inter-Call Delay**: 5 seconds
- [ ] Set **Auto-Dial**: ON
- [ ] Set **Business Hours**: 9AM - 6PM
- [ ] Click **Save** → ✅ "Settings saved" toast

### Step 2.2 — Verify Scheduler Sync
- [ ] Check server logs: `[SCHEDULER] Config updated` message appears
- [ ] Scheduler respects new concurrent call limit

---

## PHASE 3: Call Execution & Voice Quality

### Step 3.1 — Manual Single Call
- [ ] Go to **Call Centre** page
- [ ] Select a customer → Click **"Call"**
- [ ] ✅ Call initiates, timer starts
- [ ] ✅ Gemini WebSocket connects (server log: `GEMINI: Connected`)
- [ ] ✅ Twilio stream starts (server log: `Stream started`)
- [ ] ✅ AI speaks in Roman Urdu with proper greeting
- [ ] ✅ Customer audio is heard by AI (bidirectional audio working)
- [ ] ✅ Call ends cleanly — timer stops, no re-dial loop

### Step 3.2 — Gender-Aware Voice Selection
- [ ] Call a **female** customer → AI uses appropriate female-friendly voice/persona
- [ ] Call a **male** customer → AI uses appropriate male-friendly voice/persona
- [ ] ✅ Caller agent name matches gender expectation

### Step 3.3 — Recording Quality
- [ ] After call ends, check **Call Logs** page
- [ ] Click play on recording
- [ ] ✅ **Both** customer AND agent voices are audible
- [ ] ✅ Audio is balanced (customer not drowned out by agent)

---

## PHASE 4: POC Scenario Testing (10 Required Scenarios)

### Scenario 1: Priority Calculation ✅
- [ ] Import CSV with varied balances, DPD, follow-ups
- [ ] ✅ Customers sorted by priority score
- [ ] ✅ Formula verified: `(follow_up × 10) + (balance/1000 × 5) + (DPD × 3)`

### Scenario 2: PTP Conversation
- [ ] Call customer with outstanding balance
- [ ] AI asks for promise-to-pay date
- [ ] Customer gives date within 5 days → ✅ AI accepts
- [ ] Customer suggests 10 days → ✅ AI redirects to shorter timeline
- [ ] ✅ PTP date saved in customer record

### Scenario 3: Tonal Modulation
- [ ] Call **fresh customer** (DPD < 15, no broken PTP) → ✅ Polite tone
- [ ] Call **broken promise** customer (PTP broken) → ✅ Assertive tone
- [ ] ✅ Script language matches assigned tone

### Scenario 4: Follow-up Logic
- [ ] Set customer PTP date to tomorrow
- [ ] ✅ Scheduler triggers day-before PTP reminder call
- [ ] Set customer PTP date to today
- [ ] ✅ Scheduler triggers day-of PTP follow-up call
- [ ] ✅ Agent type auto-set to `ptp_reminder`

### Scenario 5: Non-Customer Pickup
- [ ] During call, non-customer answers (e.g., family member)
- [ ] ✅ AI leaves polite message
- [ ] ✅ Customer auto-rescheduled within **5 hours**
- [ ] ✅ `final_response = 'non_customer_pickup'` saved

### Scenario 6: No Answer / Switch Off
- [ ] Call customer who doesn't answer
- [ ] ✅ Auto-reschedule for **2-hour** retry
- [ ] ✅ `final_response = 'no_answer'` or `'switched_off'` saved
- [ ] ✅ `scheduled_retry_at` set correctly

### Scenario 7: After-Hours Trigger
- [ ] Trigger a retry that would fall after 6 PM
- [ ] ✅ System shifts retry to **9 AM next business day**
- [ ] Trigger a retry on Saturday
- [ ] ✅ System shifts to **9 AM Monday**

### Scenario 8: Negotiation Barrier
- [ ] During PTP reminder call, customer asks for extension
- [ ] ✅ AI insists on original PTP date
- [ ] ✅ Does NOT agree to new extended date
- [ ] ✅ `final_response = 'negotiation_barrier'` if customer refuses

### Scenario 9: Call Log Export
- [ ] Make 3+ calls with different outcomes
- [ ] Go to **Call Logs** page
- [ ] Click **Export CSV**
- [ ] ✅ CSV contains: Call_ID, DateTime, Duration, Outcome, Recording URL
- [ ] ✅ All calls present in export

### Scenario 10: Recorded Audio Variety
- [ ] Record at least **5 different interaction types**:
  1. PTP secured (customer agrees to date)
  2. No answer
  3. Non-customer pickup
  4. Negotiation barrier (customer refuses)
  5. Callback requested
- [ ] ✅ All 5 recordings accessible in Call Logs

---

## PHASE 5: Stress Testing

### Step 5.1 — Concurrent Calls
- [ ] Set `maxConcurrentCalls = 3` in settings
- [ ] Add 10+ customers, trigger auto-dial
- [ ] ✅ Only 3 calls active simultaneously
- [ ] ✅ Queue processes remaining customers after calls complete
- [ ] ✅ Inter-call delay respected between batches

### Step 5.2 — Call End → No Re-dial Loop
- [ ] Make a call, let it complete naturally
- [ ] ✅ Timer stops after call ends
- [ ] ✅ System does NOT auto-redial same customer immediately
- [ ] ✅ Customer status updated correctly

### Step 5.3 — Gemini WebSocket Stability
- [ ] During active call, verify Gemini socket stays open
- [ ] ✅ No premature disconnection during conversation
- [ ] ✅ Socket closes only when Twilio session ends (hangup/timeout)
- [ ] ✅ Server logs show clean close: `GEMINI: Session closed`

### Step 5.4 — Twilio μ-law ↔ Gemini PCM Audio
- [ ] ✅ Inbound: Twilio 8kHz μ-law decoded → Gemini 24kHz PCM (upsampled 3x)
- [ ] ✅ Outbound: Gemini 24kHz PCM → Twilio 8kHz μ-law (downsampled 3x)
- [ ] ✅ No audio distortion or clipping in recordings

---

## PHASE 6: Data Integrity

### Step 6.1 — Call Logs Complete
- [ ] After each call: ✅ Call log inserted with all fields
- [ ] Fields verified: customer_id, customer_name, duration, status, agent_type, tone, outcome, transcript, recording_url

### Step 6.2 — Customer Record Updates
- [ ] After call: ✅ `follow_up_count` incremented
- [ ] After call: ✅ `last_call_date` updated
- [ ] After call: ✅ `final_response` set
- [ ] After PTP: ✅ `ptp_status` = 'pending', `ptp_date` set
- [ ] After broken PTP: ✅ `ptp_status` = 'broken'

### Step 6.3 — Retry Scheduling
- [ ] No answer → ✅ `scheduled_retry_at` = now + 2 hours
- [ ] Non-customer → ✅ `scheduled_retry_at` = now + 5 hours
- [ ] After 6 PM → ✅ `scheduled_retry_at` = 9 AM next business day

---

## Summary Scorecard

| # | Scenario | Status |
|---|----------|--------|
| 1 | Priority Calculation | ⬜ |
| 2 | PTP Conversation | ⬜ |
| 3 | Tonal Modulation | ⬜ |
| 4 | Follow-up Logic | ⬜ |
| 5 | Non-Customer Pickup | ⬜ |
| 6 | No Answer / Switch Off | ⬜ |
| 7 | After-Hours Trigger | ⬜ |
| 8 | Negotiation Barrier | ⬜ |
| 9 | Call Log Export | ⬜ |
| 10 | Recorded Audio (5 types) | ⬜ |
| 11 | Concurrent Calls Stress | ⬜ |
| 12 | Gender-Aware Voice | ⬜ |
