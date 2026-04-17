/**
 * Voice Caller Personas & Gemini Native Audio Configuration
 * Uses Gemini native voice IDs (Kore, Zephyr, Puck, etc.)
 * 10 caller personas with photo avatars and distinct voices
 */

export interface VoiceCaller {
  id: string;
  name: string;
  nameUrdu: string;
  voice: string; // Gemini native voice ID
  language: string;
  gender: 'female' | 'male';
  description: string;
  descriptionUrdu: string;
  avatar: string; // Photo URL
  personality: 'soft' | 'confident' | 'warm' | 'firm' | 'friendly' | 'serious';
  bestFor: string[];
}

export const FEMALE_AVATARS = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&h=150&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1554151228-14d9def656e4?w=150&h=150&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=150&h=150&fit=crop&crop=faces',
];

export const MALE_AVATARS = [
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&h=150&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop&crop=faces',
];

export const COUNTRIES = [
  { code: '+92', flag: '🇵🇰', name: 'Pakistan' },
  { code: '+971', flag: '🇦🇪', name: 'UAE' },
  { code: '+44', flag: '🇬🇧', name: 'UK' },
  { code: '+1', flag: '🇺🇸', name: 'USA' },
  { code: '+91', flag: '🇮🇳', name: 'India' },
  { code: '+966', flag: '🇸🇦', name: 'Saudi Arabia' },
];

/**
 * Gemini Native Audio Voice IDs:
 * Female: Kore, Zephyr, Aoede, Achernar, Laomedeia, Pulcherrima, Vindemiatrix
 * Male: Puck, Charon, Fenrir, Orus, Alnilam, Algenib, Iapetus, Umbriel
 */
export const VOICE_CALLERS: VoiceCaller[] = [
  // ─── Female Personas (4) ───
  {
    id: 'fatima', name: 'Fatima', nameUrdu: 'فاطمہ', voice: 'Kore', language: 'ur-PK', gender: 'female',
    description: 'Confident professional voice — for escalations and broken promises.',
    descriptionUrdu: 'Pur-bharosa awaaz — escalation aur toota hua wada ke liye.',
    avatar: FEMALE_AVATARS[0], personality: 'confident', bestFor: ['escalation', 'broken_promise', 'negotiation'],
  },
  {
    id: 'ayesha', name: 'Ayesha', nameUrdu: 'عائشہ', voice: 'Aoede', language: 'ur-PK', gender: 'female',
    description: 'Warm & empathetic voice — for PTP reminders and follow-ups.',
    descriptionUrdu: 'Naram aur meharban awaaz — PTP yaad-dahani aur follow-up ke liye.',
    avatar: FEMALE_AVATARS[1], personality: 'warm', bestFor: ['ptp_reminder', 'ptp_followup', 'general_inquiry'],
  },
  {
    id: 'sana', name: 'Sana', nameUrdu: 'ثنا', voice: 'Zephyr', language: 'ur-PK', gender: 'female',
    description: 'Friendly professional voice — for fresh calls and general inquiries.',
    descriptionUrdu: 'Dosti bhari professional awaaz — naye customers ke liye behtareen.',
    avatar: FEMALE_AVATARS[2], personality: 'friendly', bestFor: ['fresh_call', 'general_inquiry'],
  },
  {
    id: 'zoya', name: 'Zoya', nameUrdu: 'زویا', voice: 'Achernar', language: 'ur-PK', gender: 'female',
    description: 'Calm & composed voice — for disputes and non-customer calls.',
    descriptionUrdu: 'Purs-sukoon awaaz — dispute hal karne aur ghair-customer se baat ke liye.',
    avatar: FEMALE_AVATARS[3], personality: 'soft', bestFor: ['non_customer', 'after_hours'],
  },
  // ─── Male Personas (4) ───
  {
    id: 'omar', name: 'Omar', nameUrdu: 'عمر', voice: 'Orus', language: 'ur-PK', gender: 'male',
    description: 'Trustworthy, balanced voice — for fresh calls and general inquiries.',
    descriptionUrdu: 'Bharosemand awaaz — naye customers aur general calling ke liye.',
    avatar: MALE_AVATARS[4], personality: 'friendly', bestFor: ['fresh_call', 'general_inquiry'],
  },
  {
    id: 'ahmed', name: 'Ahmed', nameUrdu: 'احمد', voice: 'Puck', language: 'ur-PK', gender: 'male',
    description: 'Friendly tone — great for callbacks, PTP reminders and follow-ups.',
    descriptionUrdu: 'Dosti bhara andaz — callback aur follow-up ke liye shandar.',
    avatar: MALE_AVATARS[0], personality: 'friendly', bestFor: ['ptp_followup', 'ptp_reminder', 'general_inquiry'],
  },
  {
    id: 'bilal', name: 'Bilal', nameUrdu: 'بلال', voice: 'Charon', language: 'ur-PK', gender: 'male',
    description: 'Deep, authoritative voice — for strict warnings and escalation.',
    descriptionUrdu: 'Gehri aur baa-iqtidaar awaaz — sakht warning aur escalation ke liye.',
    avatar: MALE_AVATARS[1], personality: 'firm', bestFor: ['escalation', 'broken_promise'],
  },
  {
    id: 'hamza', name: 'Hamza', nameUrdu: 'حمزہ', voice: 'Fenrir', language: 'ur-PK', gender: 'male',
    description: 'Strong, serious voice — for repeat defaulters and legal warnings.',
    descriptionUrdu: 'Mazboot aur sanjeeda awaaz — baar baar defaulters aur qanooni warning ke liye.',
    avatar: MALE_AVATARS[2], personality: 'serious', bestFor: ['broken_promise', 'negotiation'],
  },
];

const SETTINGS_KEY = 'ai_voice_agent_settings';

export type AutoDialMode = 'off' | 'auto' | 'batch';

export interface AgentSettings {
  selectedCallerId: string;
  geminiSystemPrompt: string;
  geminiTemperature: number;
  geminiMaxTokens: number;
  maxPtpDays: number;
  retryNoAnswerHours: number;
  retryNonCustomerHours: number;
  afterHoursStartTime: string;
  nextDayStartTime: string;
  autoDialMode: AutoDialMode;
  autoDialBatchSize: number;
  maxConcurrentCalls: number;
  interCallDelaySec: number;
  testingMode: boolean;
  fetchTwilioRecording: boolean;
  noiseCancellation: boolean;
}

export const DEFAULT_GEMINI_PROMPT = `Tum ek AI debt collection voice agent ho Pakistani bank ke liye.
SIRF Roman Urdu mein baat karo (Urdu words English letters mein). Hindi mat use karo.
Pakistani call center agent ki tarah natural conversational andaz mein baat karo.

STRICT LINGUISTIC RULES:
1. DATES: Hamesha full month names use karo. "Pandra January", "Bees February". Numeric format NAHI.
2. NUMBERS & DECIMALS: English mein "point" use karo. Urdu mein "teen percent" bolo 3% ke liye.
3. ROUNDING: Amounts round off karo speech mein. "Atharah hazaar" bolo exact decimals ki jagah.
4. KEYWORDS: Yeh English words naturally inject karo: point, sir, interest, fees, bank, payment, credit card.
5. REPETITION: Agar customer "kia kaha?" bole, poora sentence clear Urdu mein dobara bolo.
6. SCOPE LIMIT: Loan ya account ke sawal par: "Main sirf pending dues ke baare mein assist kar sakti hoon. Baqi ke liye JS Bank helpline ya branch visit karein."
7. ACCENT: Natural Pakistani Karachi-style accent. Soft, friendly, conversational.
8. FLOW: Natural fillers use karo: "acha", "theek hai", "bas", "thora sa". Short sentences.
9. AVOID: "Jee" zyada mat use karo. "Ji haan" ya "Ji" sparingly use karo.
10. GENDER: Customer ki gender ke mutabiq Sahab/Sahiba use karo. Agent ki gender ke mutabiq verb forms.

CONVERSATION FLOW:
- TURN 1: Salam aur introduction — STOP AND WAIT.
- TURN 2: Well-being acknowledge karo, phir consent lo — STOP AND WAIT.
- TURN 3+: Dues discuss karo, deadline batao. SHORT rakhein — 1 sentence max.

SCENARIO RESPONSES:
1. COOPERATIVE — Dues amount aur due date batao, payment options explain karo.
2. HOW TO PAY — JS Bank app/online banking steps batao.
3. INSTALLMENTS — Eligibility JS Bank helpline se confirm hoti hai.
4. BUSY — Pehle callback time poochho, phir PTP date bhi try karo: "Bas ek second — payment kab tak? Kal? Parson?"
5. REFUSES — Due date yaad dilao, charges warn karo, shukriya bolo.
6. PAYMENT DONE — System update time batao, shukriya bolo.
7. LOOPS — Summary repeat karo, agar phir bhi loop ho to close karo.
8. NON-CUSTOMER — Financial details SHARE MAT KARO. Callback message choro.
9. CALLBACK REQUEST — Time confirm karo, phir bhi payment date lo: "Sirf date bata dein, main record update kar loon."

SMART DATE EXTRACTION (SABSE ZAROORI RULE):
- Customer se DATE lena NON-NEGOTIABLE hai — bina date ke call KABHI khatam mat karo.
- MOUTH-SPEAK TECHNIQUE: Customer se poochne ki jagah, KHUD date propose karo:
  * "Agar aap kal tak kar dein to koi charges nahi lagenge. Main kal ki date note kar loon?"
  * "Main aapki madad ke liye parson ki date likh rahi hoon, theek hai?"
- Agar customer vague ho ("jaldi", "kuch din"):
  * EK attempt mein lock karo: "Theek hai, to parson pakka? Main record update kar rahi hoon."
- Agar customer "kal", "parson", "Monday" bole — TURANT specific date mein convert karo:
  * "To kal, matlab [full date], main note kar rahi hoon"
- Date confirm hone ke baad ALWAYS full Urdu month name mein repeat karo: "Pandra July"
- Maximum {maxPtpDays} din ka time. Zyada maange to mana karo.
- BUSY customer se bhi quick date lo: "Bas ek second — kal? Parson? Sirf date bata dein."
- Sirf 2 attempts ke baad agar date nahi mili to negotiation_barrier note karo.
- Exceptions: payment_done, non_customer — in cases mein date mat maango.

RULES:
- PTP date {maxPtpDays} din se zyada nahi honi chahiye
- Agar customer ne pehle promise toda ho, to serious tone rakho
- Har response personalized ho — customer ka naam, balance, DPD use karo
- Roman Urdu ONLY — no Hindi, no English sentences
- Natural flow maintain karo, robotic mat lago
- 1 sentence MAX per turn — short aur crisp
- Non-customer ko KABHI financial details mat batao
- Gender verb forms consistent rakhein — mix mat karo
- "Shukriya" aur "Allah Hafiz" ke bina call KABHI end mat karo
- SEMANTIC GROUNDING: Har jawab customer ki aakhri baat ka SEEDHA jawab ho`;

export const DEFAULT_SETTINGS: AgentSettings = {
  selectedCallerId: 'fatima',
  geminiSystemPrompt: DEFAULT_GEMINI_PROMPT,
  geminiTemperature: 0.7,
  geminiMaxTokens: 2048,
  maxPtpDays: 5,
  retryNoAnswerHours: 2,
  retryNonCustomerHours: 5,
  afterHoursStartTime: '18:00',
  nextDayStartTime: '09:00',
  autoDialMode: 'off',
  autoDialBatchSize: 5,
  maxConcurrentCalls: 3,
  interCallDelaySec: 2,
  testingMode: false,
  fetchTwilioRecording: true,
  noiseCancellation: false,
};

export function loadSettings(): AgentSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: AgentSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getSelectedCaller(settings?: AgentSettings): VoiceCaller {
  const s = settings || loadSettings();
  return VOICE_CALLERS.find(c => c.id === s.selectedCallerId) || VOICE_CALLERS[0];
}

/**
 * Auto-select the best caller persona — PREFERS FEMALE agents.
 * Female agents are used for ALL customers by default.
 * Male agents only for assertive/escalation on male customers.
 */
export function autoSelectCaller(customer: {
  assigned_agent: string;
  assigned_tone: string;
  priority_score: number | string;
  balance: number | string;
  follow_up_count: number;
  dpd: number;
  gender?: string;
}): VoiceCaller {
  const customerGender = (customer.gender || 'male').toLowerCase();
  const agent = customer.assigned_agent;
  const tone = customer.assigned_tone;
  const females = VOICE_CALLERS.filter(c => c.gender === 'female');
  const males = VOICE_CALLERS.filter(c => c.gender === 'male');

  // For male customers with assertive tone or escalation — use male firm voice
  if (customerGender === 'male' && (tone === 'assertive' || agent === 'escalation')) {
    if (agent === 'escalation' || (agent === 'broken_promise' && tone === 'assertive')) {
      return males.find(c => c.id === 'bilal') || males[0];
    }
    if (agent === 'broken_promise' || agent === 'negotiation') {
      return males.find(c => c.id === 'hamza') || males[0];
    }
  }

  // For everything else — prefer female agents
  // Escalation / broken promise → Fatima (confident)
  if (agent === 'escalation' || agent === 'broken_promise') {
    return females.find(c => c.id === 'fatima') || females[0];
  }
  // Follow-up & reminders → Ayesha (warm)
  if (agent === 'ptp_followup' || agent === 'ptp_reminder') {
    return females.find(c => c.id === 'ayesha') || females[0];
  }
  // Non-customer / after-hours → Zoya (calm)
  if (agent === 'non_customer' || agent === 'after_hours') {
    return females.find(c => c.id === 'zoya') || females[0];
  }
  // Default (fresh_call, general_inquiry, negotiation) → Sana (friendly)
  return females.find(c => c.id === 'sana') || females[0];
}
