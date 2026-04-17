# AI Voice Agent — Debt Collection System

> Pakistani bank debt collection voice agent with **real-time bidirectional AI conversation** using **Gemini Native Audio API** (`gemini-2.5-flash-native-audio-preview`) and **Twilio Media Streams** for enterprise-grade telephony. Roman Urdu native voice with 8 Gemini voice personas. SQLite for portable deployment.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite + Tailwind)                             │
│  http://localhost:5173                                          │
│  ├── Dashboard       — Stats, priority queue                    │
│  ├── Customers       — CRUD, CSV import, outcome & PTP display  │
│  ├── Call Center     — Manual + Auto-Dial + How It Works Guide  │
│  ├── Call Logs       — History, transcript, recording, filters  │
│  ├── Schedule        — Retries, PTP reminders, Auto-Redial     │
│  └── Settings        — Voice personas, AI config, auto-dialer   │
├─────────────────────────────────────────────────────────────────┤
│  Backend (Express.js + WebSocket)                               │
│  http://localhost:3001                                          │
│  ├── /api/customers          (CRUD + CSV bulk import)           │
│  ├── /api/call-logs          (CRUD)                             │
│  ├── /api/ai/generate-script (Gemini REST API)                  │
│  ├── /api/ai/analyze-call    (Gemini REST API)                  │
│  ├── /api/make-call          (Twilio + Media Streams)           │
│  ├── /api/twiml              (Dynamic TwiML with <Parameter>)   │
│  ├── /api/call-status        (Twilio status callbacks)          │
│  ├── /api/recording-status   (Twilio recording callbacks)       │
│  ├── /api/fetch-recording    (Twilio / local WAV download)      │
│  ├── /api/recordings/:file   (serve audio files)                │
│  ├── /api/scheduler/*        (status, start, stop, trigger)     │
│  ├── /api/stream-status      (active stream monitoring)         │
│  ├── /api/health             (status check)                     │
│  ├── ws://…/media-stream     (Twilio ↔ Gemini audio relay)      │
│  └── ws://…/dashboard        (real-time telemetry to frontend)  │
├─────────────────────────────────────────────────────────────────┤
│  Database: SQLite  → server/data/voice_agent.db                 │
│  Recordings:       → server/data/recordings/                    │
└─────────────────────────────────────────────────────────────────┘
```

## Real-Time Call Flow

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Frontend │───▶│ make-call│───▶│  Twilio  │───▶│ Customer │
│ (React)  │    │  (REST)  │    │  (dial)  │    │ (phone)  │
└─────────┘    └──────────┘    └────┬─────┘    └──────────┘
                                    │ <Connect><Stream>
                               ┌────▼──────────────────┐
                               │  WebSocket /media-stream│
                               │  (Express Server)       │
                               └────┬──────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼                               ▼
        ┌───────────────┐               ┌───────────────┐
        │ Twilio Stream │◄──── µ-law ──▶│ Gemini Native │
        │ (8kHz µ-law)  │               │ Audio (24kHz) │
        │               │◄── transcode ─│ (v1alpha WS)  │
        └───────────────┘               └───────────────┘
```

### Prewarmed Greeting System (Zero Pickup Latency)

Before a call is dialed, the server:
1. **Pre-generates** the personalized greeting audio via Gemini TTS
2. **Transcodes** to µ-law and caches in `CALL_PREPARATION_CACHE`
3. **On pickup**: Streams cached audio **instantly** — no AI processing delay
4. AI session initializes in background; system prompt skips live greeting if prewarmed audio delivered
5. **Fallback chain**: Prewarmed → Static voice cache → Connection tone (440Hz)

Result: Customer hears greeting **within 200ms** of picking up.

---

## Quick Start

### Prerequisites
- **Node.js 18+**
- **Google Gemini API Key** — free at https://aistudio.google.com/apikey
- **Twilio Account** (optional) — works in **mock mode** without it
- **ngrok** (for Twilio webhooks) — `ngrok http 3001`

### Step 1: Install

```bash
npm install           # Frontend
cd server && npm install && cd ..  # Backend
```

### Step 2: Configure Environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```env
# REQUIRED — Gemini Native Audio + REST API
GEMINI_API_KEY="your-gemini-key"

# REQUIRED for real calls — ngrok URL
SERVER_URL="https://your-id.ngrok-free.dev"

# OPTIONAL — Real Twilio calls (leave empty for mock mode)
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TWILIO_AUTH_TOKEN="your-auth-token"
TWILIO_PHONE_NUMBER="+1234567890"
```

### Step 3: Start

**Option A — Using start.bat (Windows):**
```bash
start.bat
```

**Option B — Manual:**

Terminal 1 — Backend:
```bash
cd server && npm run dev
```

Terminal 2 — Frontend:
```bash
npm run dev
```

**Option C — With ngrok (for real Twilio calls):**
```bash
ngrok http 3001
```
Copy the ngrok URL to `SERVER_URL` in `.env`. Open **http://localhost:5173**

---

## Voice Personas — Gemini Native Audio Voices

| Persona | Voice ID | Gender | Personality | Best For |
|---------|----------|--------|-------------|----------|
| Fatima | `Kore` | Female | Confident | Escalation, broken promises |
| Ayesha | `Aoede` | Female | Warm | PTP reminders, follow-ups |
| Sana | `Zephyr` | Female | Friendly | Fresh calls, general inquiry |
| Zoya | `Lyra` | Female | Soft | Non-customer, after hours |
| Omar | `Gacrux` | Male | Friendly | Fresh calls, general inquiry |
| Ahmed | `Puck` | Male | Friendly | PTP follow-up, reminders |
| Bilal | `Charon` | Male | Firm | Escalation, broken promises |
| Hamza | `Fenrir` | Male | Serious | Broken promise, negotiation |

**Auto-Selection Logic**: Female agents are preferred by default. Male firm/serious voices used only for male customers with assertive tone or escalation scenarios.

---

## AI System Prompt & Conversation Rules

### Strict Linguistic Rules (10 Rules)
1. **Dates**: Full month names in Urdu ("Pandra January", "Bees February")
2. **Numbers**: "teen percent" for 3%, round amounts ("Atharah hazaar")
3. **Keywords**: Naturally inject English words: point, sir, interest, payment, credit card
4. **Repetition**: Repeat full sentence if customer says "kia kaha?"
5. **Scope**: Only discuss pending dues — redirect other queries to JS Bank helpline
6. **Accent**: Pakistani Karachi-style, soft, conversational
7. **Flow**: Natural fillers ("acha", "theek hai", "bas")
8. **Avoid**: Don't overuse "Jee" — use "Ji haan" sparingly
9. **Gender**: Correct verb forms based on agent/customer gender
10. **Roman Urdu ONLY**: No Hindi, no full English sentences

### Strict 3-Turn Conversation Flow
- **Turn 1**: Greeting + "Kaise hain aap?" → STOP AND WAIT
- **Turn 2**: Acknowledge, ask for consent to discuss → STOP AND WAIT
- **Turn 3+**: Discuss dues, deadline, PTP collection

### 9 Scenario Responses
1. **Cooperative** — Share dues, due date, payment options
2. **How to Pay** — JS Bank app/online banking steps
3. **Installments** — Redirect to helpline for eligibility
4. **Busy** — Ask for callback time first, then try for PTP date
5. **Refuses** — Remind due date, warn charges, polite goodbye
6. **Loops** — Summarize, close if continues
7. **Payment Done** — Acknowledge, explain system update delay
8. **Non-Customer Pickup** — NEVER share financials, leave callback message
9. **Callback Request** — Confirm callback time, still try for PTP date

---

## Mandatory PTP Date Collection

The AI agent **MUST** collect a Promise to Pay date before ending any call:

- **3 escalating attempts** if customer is vague ("jaldi", "kuch din")
- Maximum PTP window: **5 days**
- Agent confirms date verbally: "Main note kar rahi hoon ke aap [date] tak payment karenge"
- Even **busy customers** get one quick PTP ask before hanging up
- **Exceptions**: Payment Done, Non-Customer — no date required
- If customer refuses all 3 attempts → marked as `negotiation_barrier`

### PTP Follow-Up Schedule (Auto-Scheduled)

| Trigger | Agent Type | Tone | Action |
|---------|-----------|------|--------|
| PTP Day −1 | `ptp_reminder` | Current | "Kal payment due hai" reminder |
| PTP Day | `ptp_followup` | Current | "Aaj payment date hai" follow-up |
| PTP Day +1 (missed) | `broken_promise` | `assertive` | Auto-escalation, consequences mentioned |

---

## Call Outcomes & Auto-Retry Logic

| Outcome | Description | Auto-Retry | Business Hours |
|---------|-------------|------------|----------------|
| `ptp_secured` ✅ | Customer agreed to pay by date | No retry — PTP reminders auto-scheduled | — |
| `callback_requested` 📞 | Customer busy / call back later | **2 hours** | 9AM–6PM Mon–Fri |
| `no_answer` 📵 | Phone rang, no pickup | **2 hours** | 9AM–6PM Mon–Fri |
| `switched_off` 📴 | Phone unreachable | **2 hours** | 9AM–6PM Mon–Fri |
| `busy` ⏳ | Picked up, immediately busy | **2 hours** | 9AM–6PM Mon–Fri |
| `non_customer_pickup` 👤 | Family/wrong person answered | **5 hours** | 9AM–6PM Mon–Fri |
| `negotiation_barrier` ⚠️ | Wants extension/installments | **5 hours** | 9AM–6PM Mon–Fri |
| `refused` ❌ | Explicitly refused to pay | **24 hours** | 9AM–6PM Mon–Fri |
| `partial_payment` 💰 | Partial amount only | **2 hours** | 9AM–6PM Mon–Fri |
| `payment_done` 💳 | Already paid | **No retry** | — |

### Business Hours & Cooldowns
- All retries clamped to **9:00 AM – 6:00 PM**, **Mon–Fri**
- Weekend retries auto-shift to **Monday 9 AM**
- **5-minute cooldown** between calls to same customer
- Scheduler polls every **60 seconds**

---

## Post-Call AI Analysis

After every call, Gemini REST API analyzes the transcript and:

1. **Extracts outcome** — maps to one of 10 standardized labels
2. **Extracts PTP date** — parses "kal", "parson", "Monday ko", "agle hafte" to actual dates
3. **Validates PTP date** — caps at 5-day maximum
4. **Generates notes** — 1-line summary in Roman Urdu
5. **Updates customer record**:
   - `final_response`, `ptp_date`, `ptp_status`
   - `follow_up_count` incremented
   - `priority_score` recalculated: `(follow_up × 10) + (balance/1000 × 5) + (DPD × 3)`
   - `assigned_agent` and `assigned_tone` auto-reassigned based on new profile
   - `scheduled_retry_at` set based on outcome
6. **Creates call log** — with outcome, PTP date, notes, transcript, recording URL

### Fallback Analysis
If AI analysis fails, regex-based extraction handles:
- Non-customer patterns (30+ Urdu phrases)
- Payment commitment keywords
- Day-name to date conversion (Urdu + English)
- Message-count heuristics for short/empty calls

---

## Recording Architecture

### Two Recording Modes (configurable in Settings)

**Mode 1 — Local Stream Recording** (default):
1. Inbound (customer) + Outbound (agent) µ-law chunks captured
2. On call end: decoded to PCM, volume-normalized, mixed to mono WAV
3. Saved to `server/data/recordings/{conversationId}.wav`

**Mode 2 — Twilio Recording** (Settings → "Fetch Twilio Recording"):
1. Twilio records natively (`Record: true` on call)
2. `/api/recording-status` callback triggered when ready
3. Server downloads from Twilio, stores locally
4. Updates call_logs with local recording URL

---

## Customer Management

- **Add**: Single customer with all fields
- **Edit**: Inline edit — balance, DPD, PTP, agent, tone, gender
- **Delete**: With confirmation dialog
- **Import CSV**: Bulk import with columns: name, phone, balance, dpd, follow_up_count, ptp_status, ptp_date, final_response, gender
- **Template**: Download blank CSV template

### Customer Table Columns
| Column | Description |
|--------|-------------|
| Customer | Name, phone, gender |
| Balance | Outstanding PKR amount |
| DPD | Days Past Due (color-coded: 🟢 <30, 🟡 30–59, 🔴 60+) |
| Follow-ups | Number of calls made |
| Priority | Auto-calculated score |
| Agent / Tone | Current assignment (auto-updates post-call) |
| Last Outcome | Latest call result with icon |
| PTP | Status (Pending/Kept/Broken) + date |
| Last Call | Date/time of last call |
| Next Retry | Scheduled retry time + reason (🔴 Overdue / 🔵 Scheduled) |

---

## Call Logs

- **Table & Card** view modes
- **Filters**: Status, Tone, **Outcome** (PTP Secured, Callback, No Answer, Refused, etc.)
- **Search**: By customer name, outcome, notes, agent type
- **Sort**: By date, duration, name
- **Export CSV**: All filtered logs with Call ID, timestamp, duration, outcome, recording URL
- **Detail Dialog**: Full info — date, duration, agent, tone, outcome, PTP date, notes, recording (play/download), transcript

---

## Auto-Dialer System

### Modes
| Mode | Behavior |
|------|----------|
| `off` | Manual calls only |
| `auto` | Process entire queue top→bottom by priority |
| `batch` | Process N customers (configurable batch size) |

### Features
- **Configurable**: Batch size, max concurrent calls, inter-call delay
- **Smart Assignment**: Auto-selects caller persona based on customer profile + gender
- **5-second countdown** before starting (safety net)
- **Progress dashboard**: Live active/completed/failed counts with progress bar
- **Abort**: Stop all at any time

---

## 10 Agent Types (Auto-Assigned)

| Type | When Assigned | Behavior |
|------|--------------|----------|
| `fresh_call` | First call, no history | Polite intro, explain balance |
| `broken_promise` | PTP status = broken | Serious tone, reference broken promise |
| `ptp_reminder` | PTP date is tomorrow | Friendly reminder |
| `ptp_followup` | PTP date is today | Check if payment was made |
| `non_customer` | Last call was non-customer | Ask for customer specifically |
| `no_answer` | Last call had no answer | Try again, mention previous attempt |
| `after_hours` | Past 6 PM | Schedule for next day 9 AM |
| `negotiation` | Customer wants extension | Show flexibility, discuss options |
| `escalation` | High DPD + multiple failures | Supervisor-level urgency |
| `general_inquiry` | Customer has questions | Answer questions, guide to payment |

## 3 Tone Modes (Auto-Assigned)

| Tone | Trigger | Style |
|------|---------|-------|
| `polite` | Default / first call | Warm, respectful, professional |
| `assertive` | Broken promise / DPD ≥ 60 / 5+ follow-ups | Firm, urgent, consequences mentioned |
| `empathetic` | 2+ follow-ups / DPD ≥ 30 | Understanding, patient but goal-oriented |

---

## Environment Variables

All in `server/.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | ✅ Yes | Google Gemini API key (native audio + REST) |
| `SERVER_URL` | ⚠️ For Twilio | Public URL for webhooks (ngrok for local dev) |
| `TWILIO_ACCOUNT_SID` | ❌ No | Twilio Account SID (mock mode if absent) |
| `TWILIO_AUTH_TOKEN` | ❌ No | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | ❌ No | Your Twilio phone number (E.164) |
| `PORT` | ❌ No | Server port (default: 3001) |

---

## Project Structure

```
├── src/                          # Frontend (React)
│   ├── pages/                    # Dashboard, Customers, CallCenter, CallLogs, Schedule, Settings
│   ├── services/db.ts            # API client (local server)
│   ├── hooks/                    # useCustomers, useCallLogs
│   ├── config/agent-settings.ts  # Voice personas, AI prompt, settings
│   └── types/voice-agent.ts      # Agent/tone/priority types + outcome display
│
├── server/                       # Backend (Express + WebSocket + SQLite)
│   ├── index.js                  # Server + WS upgrade handler
│   ├── db.js                     # SQLite setup & schema
│   ├── scheduler.js              # Auto-redial + PTP reminder scheduler
│   ├── routes/
│   │   ├── customers.js          # Customer CRUD + CSV bulk import
│   │   ├── call-logs.js          # Call log CRUD
│   │   ├── ai.js                 # Gemini REST (script + analyze)
│   │   └── calls.js              # Media Streams + Native Audio + Recording
│   ├── data/
│   │   ├── voice_agent.db        # SQLite database (auto-created)
│   │   └── recordings/           # WAV audio files
│   └── .env                      # API keys (not in git)
│
├── start.bat                     # Windows one-click launcher
└── README.md
```

---

## Mock Mode

Without real Twilio credentials, everything works:
- Calls return simulated SIDs (`MOCK_xxxx`)
- AI analyzer uses duration-based heuristics
- Silent WAV recordings generated locally
- Full pipeline runs end-to-end

---

## Production Build

```bash
npm run build
cd server && NODE_ENV=production npm start
```

Single process at `http://localhost:3001` — serves API + built frontend.

---

## License

MIT
