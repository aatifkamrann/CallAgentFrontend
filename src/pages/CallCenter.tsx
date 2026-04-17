import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Phone, PhoneOff, Mic, MicOff, Volume2, Loader2, RefreshCw, Brain, Zap, Square, Activity, FlaskConical, MessageSquare, Info, Clock, CalendarCheck, AlertTriangle, CheckCircle2, XCircle, UserX, PhoneForwarded, Ban } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { useCustomers, FinalResponse } from '@/hooks/useCustomers';
import { PriorityBadge } from '@/components/dashboard/PriorityBadge';
import { ToneBadge, AgentBadge } from '@/components/dashboard/StatusBadge';
import { AGENT_DESCRIPTIONS, AgentType, ToneMode, getOutcomeDisplay } from '@/types/voice-agent';
import { useToast } from '@/hooks/use-toast';
import { DbCustomer } from '@/hooks/useCustomers';
import { processCallOutcome, PostCallData, invokeFunction, pollConversationStatus, fetchConversationStatus, fetchCallLogById } from '@/services/db';
import { loadSettings, getSelectedCaller, autoSelectCaller, AutoDialMode } from '@/config/agent-settings';
import { sanitizeDisplayText, normalizeOutcomeKey, isRecordingPredictionPending } from '@/lib/utils';

// ─── Helper Functions ──────────────────────────────────────
function formatDuration(seconds: number) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface CallHistoryItem {
  customer: DbCustomer;
  outcome: string;
  duration: number;
  timestamp: number;
  callLogId?: string;
  recordingUrl?: string | null;
  source: 'live' | 'db';
}
interface LastOutcomeState {
  customerId: string;
  final_response: string;
  notes: string;
}

type FinalEvalStep =
  | 'ending_call'
  | 'waiting_backend'
  | 'running_ai'
  | 'saving_outcome'
  | 'uploading_recording'
  | 'finalizing_ui'
  | 'complete'
  | 'failed';

// ─── Auto-Dial Job Status ────────────────────────────────────────
interface AutoDialJob {
  customerId: string;
  customerName: string;
  status: 'queued' | 'scripting' | 'calling' | 'analyzing' | 'done' | 'failed';
  outcome?: string;
  error?: string;
  startedAt?: number;
  duration?: number;
}

// ─── Single Call Pipeline (async, self-contained) ────────────────
async function runCallPipeline(
  customer: DbCustomer,
  onUpdate: (update: Partial<AutoDialJob>) => void,
): Promise<void> {
  const settings = loadSettings();
  const caller = autoSelectCaller(customer);

  onUpdate({ status: 'scripting' });
  let script: string | null = null;
  try {
    const { data, error } = await invokeFunction('generate-script', {
        customerName: customer.name, balance: customer.balance, dpd: customer.dpd,
        agentType: customer.assigned_agent, tone: customer.assigned_tone,
        ptpStatus: customer.ptp_status, followUpCount: customer.follow_up_count,
        callerName: caller.name,
        systemPrompt: settings.geminiSystemPrompt,
        temperature: settings.geminiTemperature,
        maxTokens: settings.geminiMaxTokens,
        maxPtpDays: settings.maxPtpDays,
    });
    if (error) throw error;
    script = data?.script || null;
  } catch (err: any) {
    onUpdate({ status: 'failed', error: `Script: ${err.message}` });
    return;
  }

  onUpdate({ status: 'calling', startedAt: Date.now() });
  let callSid: string | null = null;
  try {
    const { data, error } = await invokeFunction('make-call', {
        customerId: customer.id,
        customerName: customer.name, customerPhone: customer.phone,
        agentType: customer.assigned_agent, tone: customer.assigned_tone,
        balance: customer.balance, dpd: customer.dpd,
        ptpStatus: customer.ptp_status, followUpCount: customer.follow_up_count,
        callerVoice: caller.voice, callerLanguage: caller.language, callerName: caller.name,
        preparedScript: script,
        customerGender: customer.gender || 'male',
        callerGender: caller.gender || 'female',
        fetchTwilioRecording: settings.fetchTwilioRecording,
        maxPtpDays: settings.maxPtpDays,
    });
    if (error) throw error;
    callSid = data?.callSid || null;
    if (!callSid) throw new Error('No callSid returned');
    const conversationId = data?.conversationId || callSid;

    // Poll conversation until completed — the server handles analysis + DB updates automatically
    onUpdate({ status: 'calling' });
    const pollResult = await pollConversationStatus(
      conversationId || '',
      (conv) => {
        if (conv.status === 'active') onUpdate({ status: 'calling' });
        if (conv.status === 'completed' || conv.status === 'ending') {
          onUpdate({ status: 'analyzing' });
        }
      },
      300000,
      5000,
      false,
    );

    if (pollResult.error) {
      throw pollResult.error;
    }

    const conv = pollResult.data;
    const duration = conv?.duration || Math.floor((Date.now() - (conv?.created_at ? new Date(conv.created_at).getTime() : Date.now())) / 1000);
    onUpdate({
      status: 'done',
      outcome: (conv?.final_response || 'unknown').replace(/_/g, ' '),
      duration,
    });
    return;
  } catch (err: any) {
    onUpdate({ status: 'failed', error: `Call: ${err.message}` });
    return;
  }
}

// ─── Concurrent Queue Runner ─────────────────────────────────────
async function runConcurrentQueue(
  customers: DbCustomer[],
  maxConcurrent: number,
  onJobUpdate: (id: string, update: Partial<AutoDialJob>) => void,
  abortSignal: AbortSignal,
) {
  const safeConcurrent = Math.max(1, Number(maxConcurrent) || 1);
  let index = 0;
  const running: Promise<void>[] = [];

  const startNext = (): Promise<void> | null => {
    if (abortSignal.aborted || index >= customers.length) return null;
    const customer = customers[index++];
    const id = customer.id;
    onJobUpdate(id, { status: 'queued' });

    const promise = runCallPipeline(customer, (update) => onJobUpdate(id, update))
      .then(() => {
        const idx = running.indexOf(promise);
        if (idx !== -1) running.splice(idx, 1);
        const next = startNext();
        if (next) running.push(next);
      });
    return promise;
  };

  for (let i = 0; i < Math.min(safeConcurrent, customers.length); i++) {
    const p = startNext();
    if (p) running.push(p);
  }

  while (running.length > 0) {
    await Promise.race(running);
  }
}

// ─── Conversation Turn Type ──────────────────────────────────────
interface ConversationTurn {
  role: 'agent' | 'customer' | 'system';
  text: string;
}

// ─── Persistent Call State (survives page navigation) ────────────
const ACTIVE_CALL_KEY = 'lovable_active_call';

interface PersistedCallState {
  conversationId: string;
  callSid: string;
  customerId: string;
  customerName: string;
  startedAt: number;
  testingMode: boolean;
}

function saveActiveCall(state: PersistedCallState) {
  try { localStorage.setItem(ACTIVE_CALL_KEY, JSON.stringify(state)); } catch {}
}
function clearActiveCall() {
  try { localStorage.removeItem(ACTIVE_CALL_KEY); } catch {}
}
function loadActiveCall(): PersistedCallState | null {
  try {
    const raw = localStorage.getItem(ACTIVE_CALL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedCallState;
    // Expire after 10 minutes (call can't run that long realistically)
    if (Date.now() - parsed.startedAt > 600000) { clearActiveCall(); return null; }
    return parsed;
  } catch { return null; }
}

// ─── Component ───────────────────────────────────────────────────
export default function CallCenter() {
  const location = useLocation();
  const navigate = useNavigate();
  const { customers, loading } = useCustomers();
  const [selectedCustomer, setSelectedCustomer] = useState<DbCustomer | null>(null);
  const [callActive, setCallActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [aiScript, setAiScript] = useState<string | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const scriptCacheRef = useRef<Record<string, string>>({}); // Cache scripts per customer ID
  const [callSid, setCallSid] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [finalEvalStep, setFinalEvalStep] = useState<FinalEvalStep | null>(null);
  const [lastOutcome, setLastOutcome] = useState<LastOutcomeState | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedDurationRef = useRef(0);
  const callEndedAtRef = useRef<number>(0); // Cooldown: prevent immediate re-call
  const { toast } = useToast();

  // Auto-dial state
  const [autoDialRunning, setAutoDialRunning] = useState(false);
  const [autoDialJobs, setAutoDialJobs] = useState<Record<string, AutoDialJob>>({});
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ─── Real-time conversation state ──────────────────────────────
  const [testingConversation, setTestingConversation] = useState<ConversationTurn[]>([]);
  const [conversationPhase, setConversationPhase] = useState<'idle' | 'agent_speaking' | 'listening' | 'processing' | 'ending'>('idle');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechSynthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const recognitionRef = useRef<any>(null);
  const conversationHistoryRef = useRef<Array<{ role: 'agent' | 'customer'; text: string }>>([]);
  const callActiveRef = useRef(false);
  const recordingPollTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const voiceCacheRef = useRef<SpeechSynthesisVoice | null>(null);
  const latestScriptRequestRef = useRef<string | null>(null);
  const activeCallCustomerRef = useRef<DbCustomer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ttsDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const callStartTimeRef = useRef<number>(0);
  const [scriptReadyCustomerId, setScriptReadyCustomerId] = useState<string | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);

  const getScheduledRetryMs = useCallback((customer: DbCustomer) => {
    if (!customer.scheduled_retry_at) return null;
    const retryAt = new Date(customer.scheduled_retry_at).getTime();
    return Number.isFinite(retryAt) ? retryAt : null;
  }, []);

  const isQueueEligible = useCallback((customer: DbCustomer) => {
    // Always keep the currently selected customer visible in queue during/after dial trigger.
    if (selectedCustomer?.id === customer.id) return true;

    const retryAtMs = getScheduledRetryMs(customer);
    if (retryAtMs !== null) return retryAtMs <= Date.now();

    const hasBeenCalled = !!customer.final_response || !!customer.last_call_date;
    if (!hasBeenCalled) return true;

    return false;
  }, [getScheduledRetryMs, selectedCustomer?.id]);

  const isDialReady = useCallback((customer: DbCustomer) => {
    const retryAtMs = getScheduledRetryMs(customer);
    if (retryAtMs === null) return true;
    return retryAtMs <= Date.now();
  }, [getScheduledRetryMs]);

  const queue = [...customers]
    .filter(isQueueEligible)
    .sort((a, b) => {
      const aRetryMs = getScheduledRetryMs(a);
      const bRetryMs = getScheduledRetryMs(b);
      const now = Date.now();

      const aDueNow = aRetryMs !== null && aRetryMs <= now;
      const bDueNow = bRetryMs !== null && bRetryMs <= now;
      if (aDueNow !== bDueNow) return aDueNow ? -1 : 1;

      if (aRetryMs !== null && bRetryMs !== null) return aRetryMs - bRetryMs;
      if (aRetryMs !== null) return -1;
      if (bRetryMs !== null) return 1;

      return Number(b.priority_score) - Number(a.priority_score);
    });

  const dbHistory = [...customers]
    .filter((customer) => !!customer.final_response || !!customer.last_call_date)
    .sort((a, b) => {
      const aTime = a.last_call_date ? new Date(a.last_call_date).getTime() : 0;
      const bTime = b.last_call_date ? new Date(b.last_call_date).getTime() : 0;
      return bTime - aTime;
    })
    .map((customer) => ({
      customer,
      outcome: customer.final_response || 'completed',
      duration: 0,
      timestamp: customer.last_call_date ? new Date(customer.last_call_date).getTime() : 0,
      source: 'db' as const,
    }));

  const historyItems: CallHistoryItem[] = (() => {
    const seen = new Set<string>();
    const merged = [...callHistory, ...dbHistory].filter((item) => {
      const minuteBucket = Math.floor((item.timestamp || 0) / 60000);
      const key = `${item.customer.id}|${item.outcome}|${minuteBucket}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return merged.sort((a, b) => b.timestamp - a.timestamp);
  })();

  // Auto-select customer from navigation state
  const triggerCallRef = useRef(false);
  const pendingAutoCallCustomerIdRef = useRef<string | null>(null);
  useEffect(() => {
    const navState = location.state as { selectedCustomerId?: string; triggerCall?: boolean } | null;
    if (navState?.selectedCustomerId && customers.length > 0) {
      const found = customers.find(c => c.id === navState.selectedCustomerId);
      if (found) {
        setSelectedCustomer(found);
        triggerCallRef.current = !!navState.triggerCall;
        pendingAutoCallCustomerIdRef.current = navState.triggerCall ? found.id : null;
      }
      window.history.replaceState({}, '');
    }
  }, [location.state, customers]);

  // ── Restore active call state after page navigation ──
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || customers.length === 0) return;
    const persisted = loadActiveCall();
    if (!persisted || persisted.testingMode) return;
    restoredRef.current = true;
    let cancelled = false;

    const restorePersistedCall = (status: string | null) => {
      const cust = customers.find(c => c.id === persisted.customerId);
      if (cust) {
        setSelectedCustomer(cust);
        activeCallCustomerRef.current = cust;
      }

      setCallSid(persisted.callSid);
      setConversationId(persisted.conversationId);
      callStartTimeRef.current = persisted.startedAt;
      setCallDuration(Math.max(0, Math.floor((Date.now() - persisted.startedAt) / 1000)));

      if (status === 'ending') {
        callActiveRef.current = false;
        setCallActive(false);
        setAnalyzing(true);
        setConversationPhase('ending');
        toast({ title: 'Call status restored', description: `Call with ${persisted.customerName} is being finalized` });
        return;
      }

      setAnalyzing(false);
      setConversationPhase('idle');
      setCallActive(true);
      callActiveRef.current = true;

      intervalRef.current = setInterval(() => {
        if (!callActiveRef.current) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          return;
        }
        setCallDuration(Math.floor((Date.now() - persisted.startedAt) / 1000));
      }, 1000);

      toast({ title: '📞 Active call restored', description: `Call with ${persisted.customerName} is still in progress` });
    };

    void (async () => {
      const { data } = await fetchConversationStatus(persisted.conversationId);
      if (cancelled) return;

      const normalizedStatus = String(data?.status || '').toLowerCase();
      const terminalStatuses = new Set([
        'completed',
        'ended',
        'no-answer',
        'no_answer',
        'busy',
        'failed',
        'canceled',
        'cancelled',
      ]);

      if (terminalStatuses.has(normalizedStatus)) {
        clearActiveCall();
        return;
      }

      restorePersistedCall(normalizedStatus || null);
    })();

    return () => {
      cancelled = true;
    };
  }, [customers, toast]);

  const current = selectedCustomer || queue[0];

  const stopCallTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stopRecordingPoll = useCallback((callLogId: string) => {
    const timer = recordingPollTimersRef.current[callLogId];
    if (timer) {
      clearInterval(timer);
      delete recordingPollTimersRef.current[callLogId];
    }
  }, []);

  const startRecordingPoll = useCallback((callLogId: string, customerName: string) => {
    if (!callLogId || recordingPollTimersRef.current[callLogId]) return;

    const startedAt = Date.now();
    const maxWaitMs = 8 * 60 * 1000;
    const tick = async () => {
      const { data, error } = await fetchCallLogById(callLogId);
      if (error || !data) {
        if (Date.now() - startedAt > maxWaitMs) stopRecordingPoll(callLogId);
        return;
      }

      const url = String(data.recording_url || '').trim();
      const recordingPredictionPending = isRecordingPredictionPending(data.notes || '');

      if (data.outcome) {
        setLastOutcome((prev) => {
          const customerId = data.customer_id || prev?.customerId || current?.id || '';
          if (!customerId) return prev;
          return {
            customerId,
            final_response: data.outcome,
            notes: data.notes || '',
          };
        });
      }

      if (url) {
        setCallHistory(prev => prev.map(item => item.callLogId === callLogId ? { ...item, recordingUrl: url } : item));
        if (!recordingPredictionPending) {
          stopRecordingPoll(callLogId);
          toast({ title: 'Recording ready', description: `${customerName} recording downloaded.` });
          return;
        }
      }

      if (Date.now() - startedAt > maxWaitMs) {
        stopRecordingPoll(callLogId);
      }
    };

    void tick();
    recordingPollTimersRef.current[callLogId] = setInterval(() => { void tick(); }, 3000);
  }, [current?.id, stopRecordingPoll, toast]);

  const syncEndedCallUi = useCallback((conv: any, customerName: string) => {
    if (!callActiveRef.current && !conversationId && !analyzing && conversationPhase === 'idle') return;
    setFinalEvalStep('finalizing_ui');
    callActiveRef.current = false;
    callEndedAtRef.current = Date.now();
    setCallActive(false);
    stopCallTimer();
    endedDurationRef.current = Math.max(1, Math.floor((Date.now() - callStartTimeRef.current) / 1000));
    setAnalyzing(false);
    setConversationPhase('idle');
    setCallSid(null);
    setConversationId(null);
    clearActiveCall(); // Clear persisted state

    const normalizedStatus = String(conv?.status || '').toLowerCase();
    const normalizedFinalResponse = normalizeOutcomeKey(String(conv?.final_response || ''));
    const previousFinal = normalizeOutcomeKey(lastOutcome?.final_response || '');

    let finalResponse = normalizedFinalResponse;
    if (!finalResponse) {
      if (['no_answer', 'no-answer', 'busy', 'failed', 'canceled', 'cancelled'].includes(normalizedStatus)) {
        finalResponse = 'no_answer';
      } else if (normalizedStatus === 'ending') {
        // Backend still finalizing: keep previous known outcome, otherwise use no_answer fallback.
        finalResponse = previousFinal || 'no_answer';
      } else if (['completed', 'ended'].includes(normalizedStatus)) {
        finalResponse = previousFinal || 'callback_requested';
      } else {
        finalResponse = 'no_answer';
      }
    }
    setLastOutcome({ final_response: finalResponse, notes: conv?.notes || '' });
    const endedCustomer = activeCallCustomerRef.current || current;
    if (endedCustomer?.id) {
      setLastOutcome({ customerId: endedCustomer.id, final_response: finalResponse, notes: conv?.notes || '' });
    }

    // Add to local call history panel
    if (endedCustomer) {
      const liveCallLogId = conv?.call_log_id;
      const liveRecordingUrl = conv?.recording_url || null;
      setCallHistory(prev => [{
        customer: endedCustomer,
        outcome: finalResponse,
        duration: endedDurationRef.current,
        timestamp: Date.now(),
        callLogId: liveCallLogId,
        recordingUrl: liveRecordingUrl,
      }, ...prev]);

      if (liveCallLogId && !liveRecordingUrl) {
        startRecordingPoll(liveCallLogId, endedCustomer.name);
      }
    }

    activeCallCustomerRef.current = null;

    const finalDisplay = getOutcomeDisplay(finalResponse);
    toast({
      title: normalizedStatus === 'completed' ? '✅ Call concluded' : 'Call finished',
      description: `${customerName} → ${finalDisplay.icon} ${finalDisplay.label}`,
    });
    setFinalEvalStep('complete');
  }, [analyzing, conversationId, conversationPhase, current, lastOutcome?.final_response, startRecordingPoll, stopCallTimer, toast]);

  const syncEndingCallUi = useCallback(() => {
    if (!callActiveRef.current && !callActive) return;
    setFinalEvalStep('waiting_backend');
    callActiveRef.current = false;
    setCallActive(false);
    stopCallTimer();
    endedDurationRef.current = Math.max(1, Math.floor((Date.now() - callStartTimeRef.current) / 1000));
    setAnalyzing(true);
    setConversationPhase('ending');
  }, [callActive, stopCallTimer]);

  // Auto-scroll conversation
  useEffect(() => {
    if (conversationScrollRef.current) {
      conversationScrollRef.current.scrollTop = conversationScrollRef.current.scrollHeight;
    }
  }, [testingConversation]);

  // ─── TTS Helpers ───────────────────────────────────────────────

  const sanitizeSpeechText = useCallback((value: string) => {
    return value
      .replace(/\*\*/g, '').replace(/[`#>*_]/g, ' ')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/\[END_CALL\]/g, '')
      .replace(/\s+/g, ' ').trim();
  }, []);

  const waitForSpeechVoices = useCallback(async () => {
    if (!('speechSynthesis' in window)) return [];
    const synth = window.speechSynthesis;
    const existing = synth.getVoices();
    if (existing.length > 0) return existing;
    return new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const handler = () => {
        const v = synth.getVoices();
        if (v.length > 0) { synth.removeEventListener('voiceschanged', handler); resolve(v); }
      };
      synth.addEventListener('voiceschanged', handler);
      setTimeout(() => { synth.removeEventListener('voiceschanged', handler); resolve(synth.getVoices()); }, 1500);
    });
  }, []);

  const pickBrowserVoice = useCallback((voices: SpeechSynthesisVoice[], preferredLang: string, gender: 'female' | 'male') => {
    // Score each voice for quality + gender + language match
    const scored = voices.map(v => {
      let score = 0;
      const name = v.name.toLowerCase();
      const lang = v.lang.toLowerCase();
      const prefLang = preferredLang.toLowerCase();
      const family = prefLang.split('-')[0];

      // Language match
      if (lang === prefLang) score += 100;
      else if (lang.startsWith(prefLang)) score += 80;
      else if (lang.startsWith(family)) score += 60;
      else if (lang.startsWith('ur')) score += 50;
      else if (lang.startsWith('hi')) score += 40;
      else if (lang.startsWith('en')) score += 10;

      // Gender match — check voice name for gender hints
      const femaleHints = ['female', 'woman', 'zira', 'hazel', 'samantha', 'karen', 'moira', 'fiona', 'veena', 'lekha', 'priya', 'aditi', 'raveena', 'kajal', 'neerja', 'google.*female', 'google.*hindi.*female'];
      const maleHints = ['male', 'man', 'david', 'daniel', 'james', 'mark', 'rishi', 'hemant', 'google.*male', 'google.*hindi.*male'];

      const isFemaleVoice = femaleHints.some(h => new RegExp(h, 'i').test(name));
      const isMaleVoice = maleHints.some(h => new RegExp(h, 'i').test(name));

      if (gender === 'female' && isFemaleVoice) score += 50;
      else if (gender === 'male' && isMaleVoice) score += 50;
      else if (gender === 'female' && isMaleVoice) score -= 30;
      else if (gender === 'male' && isFemaleVoice) score -= 30;

      // Prefer Google voices (much more natural sounding)
      if (name.includes('google')) score += 25;

      // Prefer non-default system voices (they tend to be better)
      if (!v.localService) score += 5;

      return { voice: v, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.voice ?? null;
  }, []);

  // ─── Interruptible TTS — speaks while listening for customer voice ───

  const speakWithInterruptionDetection = useCallback((text: string): Promise<{ interrupted: boolean; interruptionText: string; spokenPortion: string }> => {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !text.trim()) {
        resolve({ interrupted: false, interruptionText: '', spokenPortion: '' });
        return;
      }

      const synth = window.speechSynthesis;
      synth.cancel();
      const cleaned = sanitizeSpeechText(text);
      if (!cleaned) { resolve({ interrupted: false, interruptionText: '', spokenPortion: '' }); return; }

      let interrupted = false;
      let interruptionText = '';
      let speakStartTime = Date.now();
      let recognition: any = null;

      const utterance = new SpeechSynthesisUtterance(cleaned);
      if (voiceCacheRef.current) utterance.voice = voiceCacheRef.current;
      utterance.lang = voiceCacheRef.current?.lang || 'ur-PK';
      utterance.rate = 0.88;
      utterance.pitch = voiceCacheRef.current?.name?.toLowerCase().includes('male') ? 0.9 : 1.05;
      utterance.volume = 1;

      // Estimate how much was spoken based on time elapsed
      const estimateSpokenPortion = () => {
        const elapsed = (Date.now() - speakStartTime) / 1000;
        const totalEstimatedDuration = cleaned.length / 12; // ~12 chars/sec at 0.88 rate
        const fraction = Math.min(1, elapsed / totalEstimatedDuration);
        const charsSaid = Math.floor(fraction * cleaned.length);
        return cleaned.substring(0, charsSaid);
      };

      // Start listening WHILE agent is speaking — detect customer interruptions
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'ur-PK';
        recognition.interimResults = true; // KEY: detect voice early via interim results
        recognition.continuous = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event: any) => {
          // Check if any result has meaningful speech (not just noise)
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0]?.transcript?.trim() || '';
            const confidence = event.results[i][0]?.confidence || 0;

            // Only trigger interruption for meaningful speech (not background noise)
            if (transcript.length > 2 && (confidence > 0.4 || event.results[i].isFinal)) {
              if (!interrupted) {
                interrupted = true;
                interruptionText = transcript;
                const spokenPortion = estimateSpokenPortion();
                console.log('[Voice Agent] ⚡ INTERRUPTED! Customer said:', transcript, '| Agent had said:', spokenPortion);

                // Immediately stop agent speaking
                synth.cancel();
                try { recognition.stop(); } catch {}

                resolve({ interrupted: true, interruptionText: transcript, spokenPortion });
              } else if (event.results[i].isFinal) {
                // Update with final transcript if we already interrupted
                interruptionText = transcript;
              }
              return;
            }
          }
        };

        recognition.onerror = () => {}; // Ignore errors during interruption detection
        recognition.onend = () => {
          // If recognition ended naturally (no interruption), restart if still speaking
          if (!interrupted && synth.speaking) {
            try { recognition.start(); } catch {}
          }
        };

        // Small delay before starting recognition to avoid echo detection
        setTimeout(() => {
          if (!interrupted) {
            try { recognition.start(); } catch {}
          }
        }, 400);
      }

      utterance.onend = () => {
        if (!interrupted) {
          // Agent finished speaking naturally — stop recognition
          try { recognition?.stop(); } catch {}
          resolve({ interrupted: false, interruptionText: '', spokenPortion: cleaned });
        }
      };
      utterance.onerror = () => {
        if (!interrupted) {
          try { recognition?.stop(); } catch {}
          resolve({ interrupted: false, interruptionText: '', spokenPortion: '' });
        }
      };

      speechSynthRef.current = utterance;
      speakStartTime = Date.now();
      synth.speak(utterance);
    });
  }, [sanitizeSpeechText]);

  // Simple speak (no interruption detection — for short prompts)
  const speakText = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !text.trim()) { resolve(); return; }
      const synth = window.speechSynthesis;
      synth.cancel();
      const cleaned = sanitizeSpeechText(text);
      if (!cleaned) { resolve(); return; }

      const utterance = new SpeechSynthesisUtterance(cleaned);
      if (voiceCacheRef.current) utterance.voice = voiceCacheRef.current;
      utterance.lang = voiceCacheRef.current?.lang || 'ur-PK';
      utterance.rate = 0.88;
      utterance.pitch = voiceCacheRef.current?.name?.toLowerCase().includes('male') ? 0.9 : 1.05;
      utterance.volume = 1;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthRef.current = utterance;
      synth.speak(utterance);
    });
  }, [sanitizeSpeechText]);

  // ─── Speech Recognition (standalone — for listening phase) ─────

  const listenForSpeech = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        toast({ title: 'Speech Recognition Unavailable', description: 'Chrome ya Edge use karein.', variant: 'destructive' });
        resolve('');
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.lang = 'ur-PK';
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.maxAlternatives = 3;

      let resolved = false;
      const safeResolve = (val: string) => { if (!resolved) { resolved = true; resolve(val); } };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        console.log('[Voice Agent] Customer said:', transcript);
        safeResolve(transcript);
      };
      recognition.onerror = (e: any) => {
        console.warn('[Voice Agent] Recognition error:', e.error);
        safeResolve('');
      };
      recognition.onend = () => safeResolve('');

      recognitionRef.current = recognition;
      setTimeout(() => { try { recognition.stop(); } catch {} safeResolve(''); }, 15000);
      recognition.start();
    });
  }, [toast]);

  // ─── Real-Time Conversation Loop (Testing Mode) ────────────────

  const runConversationLoop = useCallback(async (customer: DbCustomer) => {
    const settings = loadSettings();
    const caller = autoSelectCaller(customer);
    let customerTurnCount = 0;

    const normalizeDemoSpeech = (value: string) =>
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s?]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const isShortPickupReply = (value: string) => {
      const normalized = normalizeDemoSpeech(value);
      return [
        'hello', 'helo', 'hello ji', 'assalam o alaikum', 'assalamualaikum', 'assalam',
        'ji', 'jee', 'ji ji', 'haan', 'han', 'hmm', 'kon', 'kaun', 'kon hai', 'kaun hai', 'boliye'
      ].includes(normalized);
    };

    const hasClosingTone = (value: string) => /allah hafiz|khuda hafiz|dobara call|baad mein call|wrong number|ghalat number/i.test(value || '');

    const buildReengagementReply = () =>
      `Ji, assalam o alaikum. Main ${caller.name} ${caller.gender === 'female' ? 'bol rahi' : 'bol raha'} hoon bank ki taraf se. Kya main ${customer.name} se baat kar ${caller.gender === 'female' ? 'rahi' : 'raha'} hoon?`;

    const guardEarlyDemoEnd = (customerText: string, agentText: string, requestedEnd: boolean) => {
      if ((requestedEnd || hasClosingTone(agentText)) && customerTurnCount < 2 && isShortPickupReply(customerText)) {
        return { agentText: buildReengagementReply(), shouldEnd: false };
      }
      return { agentText, shouldEnd: requestedEnd };
    };

    // Prepare browser voice — match gender
    const voices = await waitForSpeechVoices();
    voiceCacheRef.current = pickBrowserVoice(voices, caller.language, caller.gender);

    console.log('[Voice Agent] Selected browser voice:', voiceCacheRef.current?.name, voiceCacheRef.current?.lang, 'for', caller.name, `(${caller.gender})`);

    const ctx = {
      customerName: customer.name, balance: customer.balance, dpd: customer.dpd,
      agentType: customer.assigned_agent, tone: customer.assigned_tone,
      ptpStatus: customer.ptp_status, followUpCount: customer.follow_up_count,
      callerName: caller.name, maxPtpDays: settings.maxPtpDays,
      customerGender: customer.gender || 'male',
      callerGender: caller.gender || 'female',
    };

    // ── 1. AI Greeting (with interruption detection!) ──
    setConversationPhase('agent_speaking');
    setTestingConversation([{ role: 'system', text: '📞 Call connected... Agent preparing greeting...' }]);

    let greetingText: string;
    try {
      const { data, error } = await invokeFunction('testing-conversation', { ...ctx, action: 'greeting' });
      if (error) throw error;
      greetingText = data?.text || `Assalam o Alaikum, main ${caller.name} ${caller.gender === 'female' ? 'bol rahi' : 'bol raha'} hoon. Kya main ${customer.name} se baat kar ${caller.gender === 'female' ? 'rahi' : 'raha'} hoon?`;
    } catch {
      greetingText = `Assalam o Alaikum, main ${caller.name} ${caller.gender === 'female' ? 'bol rahi' : 'bol raha'} hoon bank ki taraf se. Kya main ${customer.name} se baat kar ${caller.gender === 'female' ? 'rahi' : 'raha'} hoon?`;
    }

    conversationHistoryRef.current = [{ role: 'agent', text: greetingText }];
    setTestingConversation([{ role: 'agent', text: greetingText }]);

    // Speak greeting WITH interruption detection — customer might say "haan ji" while agent is still greeting
    let greetingResult = await speakWithInterruptionDetection(greetingText);

    // ── 2. Conversation Turns (with real-time interruption handling) ──
    let turnCount = 0;
    const MAX_TURNS = 20;
    const MAX_SILENCE = 2;

    // If customer interrupted the greeting, jump straight to handling that
    let pendingInterruption: { text: string; agentWasSaying: string } | null = null;
    if (greetingResult.interrupted && greetingResult.interruptionText) {
      pendingInterruption = { text: greetingResult.interruptionText, agentWasSaying: greetingResult.spokenPortion };
      setTestingConversation(prev => [...prev, 
        { role: 'system', text: '⚡ Customer interrupted' },
        { role: 'customer', text: greetingResult.interruptionText }
      ]);
    }

    while (callActiveRef.current && turnCount < MAX_TURNS) {
      turnCount++;

      let customerSpeech = '';

      // ── Handle pending interruption OR listen for new speech ──
      if (pendingInterruption) {
        customerSpeech = pendingInterruption.text;
        // Add to history with context about what agent was saying
        conversationHistoryRef.current.push({ role: 'customer', text: customerSpeech });
        customerTurnCount += 1;

        // Get AI response that acknowledges the interruption
        setConversationPhase('processing');
        let agentResponse: string;
        let shouldEnd = false;

        try {
          const { data, error } = await invokeFunction('testing-conversation', {
            ...ctx, action: 'interrupted',
            conversationHistory: conversationHistoryRef.current,
            customerSpeech,
            agentWasSaying: pendingInterruption.agentWasSaying,
          });
          if (error) throw error;
          agentResponse = data?.text || 'Ji ji, boliye, main sun rahi hoon.';
          shouldEnd = data?.endCall === true;
        } catch {
          agentResponse = 'Ji, boliye?';
        }

        ({ agentText: agentResponse, shouldEnd } = guardEarlyDemoEnd(customerSpeech, agentResponse, shouldEnd));

        pendingInterruption = null;

        conversationHistoryRef.current.push({ role: 'agent', text: agentResponse });
        setTestingConversation(prev => [...prev, { role: 'agent', text: agentResponse }]);
        setConversationPhase('agent_speaking');

        // Speak response WITH interruption detection
        const result = await speakWithInterruptionDetection(agentResponse);
        if (result.interrupted && result.interruptionText) {
          pendingInterruption = { text: result.interruptionText, agentWasSaying: result.spokenPortion };
          setTestingConversation(prev => [...prev,
            { role: 'system', text: '⚡ Customer interrupted' },
            { role: 'customer', text: result.interruptionText }
          ]);
        }

        if (shouldEnd || !callActiveRef.current) break;
        continue; // Loop back — either handle next interruption or listen normally
      }

      // ── Normal flow: pause, then listen ──
      await new Promise(r => setTimeout(r, 800));
      if (!callActiveRef.current) break;

      setConversationPhase('listening');

      let silenceCount = 0;
      while (!customerSpeech && silenceCount < MAX_SILENCE && callActiveRef.current) {
        customerSpeech = await listenForSpeech();
        if (!customerSpeech && callActiveRef.current) {
          silenceCount++;
          if (silenceCount < MAX_SILENCE) {
            await new Promise(r => setTimeout(r, 600));
            const prompt = silenceCount === 1 ? 'Hello? Kya aap sun rahe hain?' : 'Kya aap abhi baat kar sakte hain?';
            conversationHistoryRef.current.push({ role: 'agent', text: prompt });
            setTestingConversation(prev => [...prev, { role: 'agent', text: prompt }]);
            setConversationPhase('agent_speaking');
            await speakText(prompt);
            await new Promise(r => setTimeout(r, 600));
            setConversationPhase('listening');
          }
        }
      }

      if (!callActiveRef.current) break;

      if (!customerSpeech) {
        const bye = `Koi jawab nahi aa raha. Main baad mein dobara call ${caller.gender === 'female' ? 'karungi' : 'karunga'}. Allah Hafiz.`;
        conversationHistoryRef.current.push({ role: 'agent', text: bye });
        setTestingConversation(prev => [...prev, { role: 'agent', text: bye }]);
        setConversationPhase('agent_speaking');
        await speakText(bye);
        break;
      }

      // Add customer speech
      conversationHistoryRef.current.push({ role: 'customer', text: customerSpeech });
      customerTurnCount += 1;
      setTestingConversation(prev => [...prev, { role: 'customer', text: customerSpeech }]);

      // ── AI Response ──
      setConversationPhase('processing');
      let agentResponse: string;
      let shouldEnd = false;

      try {
        const { data, error } = await invokeFunction('testing-conversation', {
          ...ctx, action: 'respond',
          conversationHistory: conversationHistoryRef.current,
          customerSpeech,
        });
        if (error) throw error;
        agentResponse = data?.text || 'Ji, main samajh gayi.';
        shouldEnd = data?.endCall === true;
      } catch {
        agentResponse = 'Ji, main samajh gayi. Kya aap payment ke baare mein baat kar sakte hain?';
      }

      ({ agentText: agentResponse, shouldEnd } = guardEarlyDemoEnd(customerSpeech, agentResponse, shouldEnd));

      conversationHistoryRef.current.push({ role: 'agent', text: agentResponse });
      setTestingConversation(prev => [...prev, { role: 'agent', text: agentResponse }]);
      setConversationPhase('agent_speaking');

      // Speak WITH interruption detection
      const speakResult = await speakWithInterruptionDetection(agentResponse);
      if (speakResult.interrupted && speakResult.interruptionText) {
        pendingInterruption = { text: speakResult.interruptionText, agentWasSaying: speakResult.spokenPortion };
        setTestingConversation(prev => [...prev,
          { role: 'system', text: '⚡ Customer interrupted' },
          { role: 'customer', text: speakResult.interruptionText }
        ]);
      }

      if (shouldEnd || !callActiveRef.current) break;
    }

    // ── 3. End & Analyze ──
    // Always stop timer and mark call inactive
    callActiveRef.current = false;
    setCallActive(false);
    stopCallTimer();

    setConversationPhase('ending');
    // Calculate actual duration from start time
    const actualDuration = Math.max(1, Math.floor((Date.now() - callStartTimeRef.current) / 1000));
    endedDurationRef.current = actualDuration;

    // Stop mic recording and collect audio blob
    let recordingBlob: Blob | null = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        mediaRecorderRef.current!.onstop = () => {
          if (audioChunksRef.current.length > 0) {
            recordingBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          }
          resolve();
        };
        mediaRecorderRef.current!.stop();
        // Cleanup mic stream
        const micStream = (mediaRecorderRef.current as any)?._micStream;
        if (micStream) micStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        mediaRecorderRef.current!.stream.getTracks().forEach(t => t.stop());
      });
    }
    // Cleanup AudioContext
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }

    if (conversationHistoryRef.current.length > 1) {
      setAnalyzing(true);
      setFinalEvalStep('running_ai');
      try {
        const { data, error } = await invokeFunction('testing-conversation', {
          ...ctx, action: 'analyze',
          conversationHistory: conversationHistoryRef.current,
        });
        if (error) throw error;

        const transcript = conversationHistoryRef.current
          .map(m => `${m.role === 'agent' ? caller.name : 'Customer'}: ${m.text}`)
          .join('\n');

        const callData: PostCallData = {
          final_response: data.final_response as FinalResponse,
          ptp_date: data.ptp_date || null,
          ptp_status: data.ptp_status || null,
          notes: data.notes || '',
          duration: endedDurationRef.current,
          script_used: !!aiScript,
          transcript,
          schedule_retry_hours: data.schedule_retry_hours ?? 0,
          non_customer_relation: data.non_customer_relation || undefined,
        };

        setFinalEvalStep('saving_outcome');
        const result = await processCallOutcome(customer as any, callData);
        if (!result.success) {
          toast({ title: 'Error saving outcome', description: result.error, variant: 'destructive' });
        } else {
          setLastOutcome({ final_response: data.final_response || 'unknown', notes: data.notes || '' });

          // Add to local call history panel
          setCallHistory(prev => [{
            customer,
            outcome: data.final_response || 'unknown',
            duration: endedDurationRef.current,
            timestamp: Date.now(),
            callLogId: result.callLogId
          }, ...prev]);

          toast({
            title: '✅ Call Analyzed & Saved',
            description: `${customer.name} → ${(data.final_response || '').replace(/_/g, ' ')}`,
          });

          // Save recording to Cloud Storage
          if (recordingBlob && result.callLogId) {
            setFinalEvalStep('uploading_recording');
            try {
              const { supabase } = await import('@/integrations/supabase/client');
              const fileName = `test-${result.callLogId}-${Date.now()}.webm`;
              const { error: uploadErr } = await supabase.storage
                .from('call_recordings')
                .upload(fileName, recordingBlob, { contentType: 'audio/webm', upsert: true });

              if (!uploadErr) {
                const { data: urlData } = supabase.storage
                  .from('call_recordings')
                  .getPublicUrl(fileName);

                if (urlData?.publicUrl) {
                  // Update call log with recording URL
                  const { supabase: sb } = await import('@/integrations/supabase/client');
                  await sb.from('call_logs').update({ recording_url: urlData.publicUrl }).eq('id', result.callLogId);
                  toast({ title: '🎙 Recording Saved', description: 'Call recording uploaded successfully.' });
                }
              } else {
                console.error('Recording upload error:', uploadErr);
              }
            } catch (recErr) {
              console.error('Failed to save recording:', recErr);
            }
          }
        }
      } catch (err: any) {
        setFinalEvalStep('failed');
        toast({ title: 'Analysis Failed', description: err.message, variant: 'destructive' });
      } finally {
        setFinalEvalStep(prev => prev === 'failed' ? 'failed' : 'complete');
        setAnalyzing(false);
        setCallSid(null);
        setConversationPhase('idle');
      }
    } else {
      setConversationPhase('idle');
    }
  }, [aiScript, callDuration, listenForSpeech, pickBrowserVoice, speakText, stopCallTimer, toast, waitForSpeechVoices]);

  // ─── Script Generation ─────────────────────────────────────────

  useEffect(() => {
    if (current && scriptCacheRef.current[current.id]) {
      setAiScript(scriptCacheRef.current[current.id]);
      setScriptReadyCustomerId(current.id);
    } else if (current) {
      setAiScript(null);
      setScriptReadyCustomerId(null);
    }
  }, [current?.id]);

  useEffect(() => {
    if (!current?.id || callActive) return;
    if (lastOutcome && lastOutcome.customerId !== current.id) {
      setLastOutcome(null);
    }
  }, [current?.id, callActive, lastOutcome]);

  useEffect(() => {
    const pendingCustomerId = pendingAutoCallCustomerIdRef.current;
    if (!triggerCallRef.current || !current || !pendingCustomerId) return;
    if (current.id !== pendingCustomerId || callActive || scriptLoading || analyzing) return;

    triggerCallRef.current = false;
    pendingAutoCallCustomerIdRef.current = null;
    void startCall(current);
  }, [current?.id, scriptLoading, analyzing, callActive]);

  useEffect(() => {
    return () => { stopCallTimer(); };
  }, [stopCallTimer]);

  useEffect(() => {
    return () => {
      Object.keys(recordingPollTimersRef.current).forEach((callLogId) => {
        const timer = recordingPollTimersRef.current[callLogId];
        if (timer) clearInterval(timer);
      });
      recordingPollTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const settings = loadSettings();
    const shouldTrackLiveCall = !settings.testingMode && !!conversationId && (callActive || analyzing || conversationPhase === 'ending');
    if (!shouldTrackLiveCall) return;

    let cancelled = false;
    let terminalHandled = false;
    const customerName = current?.name || 'Customer';
    const terminalStatuses = new Set([
      'completed',
      'ended',
      'no-answer',
      'no_answer',
      'busy',
      'failed',
      'canceled',
      'cancelled',
    ]);

    const handleTerminal = (conv: any) => {
      const normalizedStatus = String(conv?.status || '').toLowerCase();
      if (cancelled || terminalHandled || !conv || !terminalStatuses.has(normalizedStatus)) return;
      terminalHandled = true;
      syncEndedCallUi(conv, customerName);
    };

    pollConversationStatus(
      conversationId,
      (conv) => {
        if (cancelled || terminalHandled || !conv) return;
        const normalizedStatus = String(conv.status || '').toLowerCase();
        if (normalizedStatus === 'ending') {
          syncEndingCallUi();
          return;
        }
        handleTerminal(conv);
      },
      300000,
      1000,
      false,
    ).then((result) => {
      if (cancelled || terminalHandled) return;
      if (result.data) {
        const normalizedStatus = String(result.data.status || '').toLowerCase();
        if (normalizedStatus === 'ending') {
          syncEndingCallUi();
          return;
        }
        handleTerminal(result.data);
      } else {
        // Polling timed out — no terminal status received (e.g. status callback dropped).
        // Auto-reset the UI so it doesn't stay stuck in call-active state indefinitely.
        syncEndedCallUi(
          { status: 'no_answer', final_response: 'no_answer', notes: 'Call status not received — auto reset' },
          customerName,
        );
      }
    }).catch(() => {
    });

    return () => {
      cancelled = true;
    };
  }, [analyzing, callActive, conversationId, conversationPhase, current?.name, syncEndedCallUi, syncEndingCallUi]);

  // Safety net: never leave UI in analyzing state forever.
  useEffect(() => {
    if (!analyzing || !conversationId) return;

    let cancelled = false;
    const timeout = setTimeout(async () => {
      if (cancelled) return;
      try {
        const latest = await pollConversationStatus(conversationId, undefined, 4000, 1000);
        if (!cancelled && latest?.data) {
          syncEndedCallUi(latest.data, current?.name || 'Customer');
          return;
        }
      } catch {}

      if (!cancelled) {
        syncEndedCallUi({ status: 'failed', final_response: 'failed', notes: 'UI safety timeout reset' }, current?.name || 'Customer');
        toast({ title: 'Call sync timeout', description: 'Call UI was reset after a delayed backend response.', variant: 'destructive' });
      }
    }, 90000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [analyzing, conversationId, current?.name, syncEndedCallUi, toast]);

  const generateScript = async (targetCustomer = current) => {
    if (!targetCustomer) return null;
    const requestCustomerId = targetCustomer.id;
    latestScriptRequestRef.current = requestCustomerId;
    setScriptReadyCustomerId(null);
    setScriptLoading(true);
    setAiScript(null);
    try {
      const settings = loadSettings();
      const caller = autoSelectCaller(targetCustomer);
      const { data, error } = await invokeFunction('generate-script', {
          customerName: targetCustomer.name, balance: targetCustomer.balance, dpd: targetCustomer.dpd,
          agentType: targetCustomer.assigned_agent, tone: targetCustomer.assigned_tone,
          ptpStatus: targetCustomer.ptp_status, followUpCount: targetCustomer.follow_up_count,
          callerName: caller.name,
          customerGender: targetCustomer.gender || 'male',
          callerGender: caller.gender || 'female',
          systemPrompt: settings.geminiSystemPrompt,
          temperature: settings.geminiTemperature,
          maxTokens: settings.geminiMaxTokens,
          maxPtpDays: settings.maxPtpDays,
      });
      if (latestScriptRequestRef.current !== requestCustomerId) return;
      if (error) throw error;
      if (data?.script) {
        if (current?.id === requestCustomerId) {
          setAiScript(data.script);
        }
        scriptCacheRef.current[requestCustomerId] = data.script; // Cache it
        return data.script as string;
      } else if (data?.error) {
        toast({ title: 'Script Error', description: data.error, variant: 'destructive' });
      }
    } catch (err: any) {
      if (latestScriptRequestRef.current === requestCustomerId) {
        toast({ title: 'Script Generation Failed', description: err.message, variant: 'destructive' });
      }
    } finally {
      if (latestScriptRequestRef.current === requestCustomerId) {
        setScriptReadyCustomerId(requestCustomerId);
        setScriptLoading(false);
      }
    }
    return null;
  };

  // ─── Call Control ──────────────────────────────────────────────

  const startCall = async (targetCustomer = current) => {
    if (!targetCustomer) return;

    // Cooldown: prevent re-calling within 5 minutes of last call end
    if (callEndedAtRef.current && Date.now() - callEndedAtRef.current < 300000) {
      toast({ title: 'Cooldown', description: 'Please wait 5 minutes before the next call.', variant: 'destructive' });
      return;
    }
    if (callActiveRef.current) return; // Already in a call

    const settings = loadSettings();
    const caller = autoSelectCaller(targetCustomer);

    const cachedScript = scriptCacheRef.current[targetCustomer.id] || null;
    const currentCustomerScript = scriptReadyCustomerId === targetCustomer.id && current?.id === targetCustomer.id
      ? aiScript
      : null;
    let preparedScript = cachedScript || currentCustomerScript || null;
    if (!preparedScript) {
      preparedScript = await generateScript(targetCustomer);
      if (!preparedScript) {
        toast({ title: 'Call blocked', description: 'Script tayar nahi hua, is liye call start nahi ki.' , variant: 'destructive' });
        return;
      }
    }

    // Clear any leftover timer from previous call
    stopCallTimer();
    setCallActive(true);
    callActiveRef.current = true;
    activeCallCustomerRef.current = targetCustomer;
    setCallDuration(0);
    setLastOutcome(null);
    setConversationId(null);
    setFinalEvalStep(null);
    setTestingConversation([]);
    conversationHistoryRef.current = [];
    setConversationPhase('idle');
    callStartTimeRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      // Guard: only increment if call is still active
      if (!callActiveRef.current) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        return;
      }
      setCallDuration(d => d + 1);
    }, 1000);

    if (settings.testingMode) {
      setCallSid(`test-${Date.now()}`);
      toast({ title: '🧪 Testing Mode Call', description: 'Agent bolega, aap mic se jawab dein — real conversation!' });

      // Set up combined recording: mic (customer) + TTS (agent) via AudioContext
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioCtx = new AudioContext();
        audioContextRef.current = audioCtx;

        // Create a destination that merges all audio sources
        const destination = audioCtx.createMediaStreamDestination();

        // Connect mic input to the mix
        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(destination);

        // Create a TTS capture destination for speechSynthesis audio
        // We also connect it to the default output so user hears it
        ttsDestinationRef.current = destination;

        // Record the merged stream (mic + any audio we route through it)
        const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm' });
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
        recorder.start(1000);
        mediaRecorderRef.current = recorder;

        // Store mic stream tracks for cleanup
        (recorder as any)._micStream = micStream;
      } catch {
        console.warn('Mic access denied for recording — will record TTS only');
      }

      runConversationLoop(current);
      return;
    }

    // ── Production Mode: Twilio ──
    try {
      const { data, error } = await invokeFunction('make-call', {
          customerId: targetCustomer.id,
          customerName: targetCustomer.name, customerPhone: targetCustomer.phone,
          agentType: targetCustomer.assigned_agent, tone: targetCustomer.assigned_tone,
          balance: targetCustomer.balance, dpd: targetCustomer.dpd,
          ptpStatus: targetCustomer.ptp_status, followUpCount: targetCustomer.follow_up_count,
          callerVoice: caller.voice, callerLanguage: caller.language, callerName: caller.name,
          preparedScript,
          customerGender: targetCustomer.gender || 'male',
          callerGender: caller.gender || 'female',
          fetchTwilioRecording: settings.fetchTwilioRecording,
          maxPtpDays: settings.maxPtpDays,
          noiseCancellation: settings.noiseCancellation ?? false,
      });
      if (error) throw error;
      if (data?.callSid) {
        setCallSid(data.callSid);
        setConversationId(data.conversationId || null);
        // Persist call state so it survives page navigation
        saveActiveCall({
          conversationId: data.conversationId || data.callSid,
          callSid: data.callSid,
          customerId: targetCustomer.id,
          customerName: targetCustomer.name,
          startedAt: callStartTimeRef.current,
          testingMode: false,
        });
        toast({ title: data.mock ? 'Mock Call Started' : 'Call Connected', description: 'Call is active' });
      } else if (data?.error) {
        toast({ title: 'Call Failed', description: data.error, variant: 'destructive' });
        callActiveRef.current = false;
        activeCallCustomerRef.current = null;
        setCallActive(false);
        stopCallTimer();
        setConversationPhase('idle');
        setCallSid(null);
        setConversationId(null);
        clearActiveCall();
      }
    } catch (err: any) {
      toast({ title: 'Call Failed', description: err.message, variant: 'destructive' });
      callActiveRef.current = false;
      activeCallCustomerRef.current = null;
      setCallActive(false);
      stopCallTimer();
      setConversationPhase('idle');
                setLastOutcome({ customerId: customer.id, final_response: data.final_response || 'unknown', notes: data.notes || '' });
      setCallSid(null);
      setConversationId(null);
      clearActiveCall();
    }
  };

  const endCall = async () => {
    callActiveRef.current = false;
    setCallActive(false);
    stopCallTimer();
    endedDurationRef.current = callDuration;
    setConversationPhase('ending');
    setFinalEvalStep('ending_call');

    window.speechSynthesis?.cancel();
    try { recognitionRef.current?.stop(); } catch {}
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }

    const settings = loadSettings();
    if (settings.testingMode) return; // Loop handles analysis

    if (!callSid && !conversationId) return; // nothing to end

    setAnalyzing(true);
    try {
      setFinalEvalStep('ending_call');
      const { error } = await invokeFunction('end-call', {
          callSid,
          conversationId,
      });
      if (error) throw error;

      if (conversationId) {
        setFinalEvalStep('waiting_backend');
        const pollResult = await pollConversationStatus(conversationId, undefined, 120000, 1000);
        if (pollResult.data) {
          setFinalEvalStep('finalizing_ui');
          const conv = pollResult.data;
          syncEndedCallUi(conv, current?.name || 'Customer');
        } else {
          toast({ title: 'End requested', description: 'Call is closing in backend. Check applogs.txt if result is delayed.' });
        }
      } else {
        toast({ title: 'End requested', description: 'Call close request sent.' });
      }
    } catch (err: any) {
      setFinalEvalStep('failed');
      toast({ title: 'End Call Failed', description: err.message, variant: 'destructive' });
    } finally {
      setAnalyzing(false);
      setCallSid(null);
      setConversationId(null);
      setConversationPhase('idle');
      clearActiveCall();
    }
  };

  // ─── Auto-Dial Controls ──────────────────────────────────────────
  const startAutoDial = useCallback(() => {
    if (autoDialRunning) {
      toast({ title: 'Auto-dial already running', description: 'Please stop current run before starting again.' });
      return;
    }

    const settings = loadSettings();
    if (settings.autoDialMode === 'off') {
      toast({ title: 'Auto-dial is off', description: 'Enable it in Settings first', variant: 'destructive' });
      return;
    }

    // Auto-dial only customers that are ready now (scheduled retry time reached).
    const dialReadyQueue = queue.filter(isDialReady);
    const safeConcurrent = Math.max(1, Number(settings.maxConcurrentCalls) || 1);
    const targetCount = settings.autoDialMode === 'auto' ? dialReadyQueue.length : settings.autoDialBatchSize;
    const batch = dialReadyQueue.slice(0, targetCount);

    if (batch.length === 0) {
      toast({
        title: 'No due customers right now',
        description: 'Scheduled callbacks are visible in queue and will become callable at their due time.',
      });
      return;
    }

    const initialJobs: Record<string, AutoDialJob> = {};
    batch.forEach((c, i) => { initialJobs[c.id] = { customerId: c.id, customerName: c.name, status: 'queued' }; });

    setAutoDialJobs(initialJobs);
    setAutoDialRunning(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    toast({ title: `⚡ Auto-Dial Starting in 5s...`, description: `${batch.length} customers (priority top→bottom), ${safeConcurrent} concurrent` });

    // 5-second countdown before starting calls
    setTimeout(() => {
      if (controller.signal.aborted) return;
      toast({ title: `📞 Auto-Dial Active`, description: `Dialing ${batch.length} customers now...` });
      runConcurrentQueue(batch, safeConcurrent, (id, update) => {
        setAutoDialJobs(prev => ({ ...prev, [id]: { ...prev[id], ...update } }));
      }, controller.signal).finally(() => {
        setAutoDialRunning(false);
        toast({ title: '✅ Auto-Dial Complete', description: `Processed ${batch.length} customers` });
      });
    }, 5000);
  }, [autoDialRunning, isDialReady, queue, toast]);

  const stopAutoDial = useCallback(() => {
    abortControllerRef.current?.abort();
    setAutoDialRunning(false);
    toast({ title: '⏹ Auto-Dial Stopped' });
  }, [toast]);

  const jobList = Object.values(autoDialJobs);
  const doneCount = jobList.filter(j => j.status === 'done').length;
  const failedCount = jobList.filter(j => j.status === 'failed').length;
  const activeCount = jobList.filter(j => ['scripting', 'calling', 'analyzing'].includes(j.status)).length;

  if (loading) return <DashboardLayout><div className="flex items-center justify-center h-[60vh]"><Loader2 className="w-8 h-8 animate-spin text-primary" /><span className="ml-3 text-muted-foreground">Loading call queue...</span></div></DashboardLayout>;

  const settings = loadSettings();

  // ─── Phase indicator helper ────────────────────────────────────
  const phaseLabel = conversationPhase === 'agent_speaking' ? '🗣️ Agent bol raha hai...'
    : conversationPhase === 'listening' ? '🎤 Aap ki baari — bolein...'
    : conversationPhase === 'processing' ? '🧠 AI soch rahi hai...'
    : conversationPhase === 'ending' ? '📊 Call khatam — analyzing...'
    : null;

  const finalEvalLabel = finalEvalStep === 'ending_call' ? 'Ending active call...'
    : finalEvalStep === 'waiting_backend' ? 'Waiting for backend final evaluation...'
    : finalEvalStep === 'running_ai' ? 'Running AI transcript analysis...'
    : finalEvalStep === 'saving_outcome' ? 'Saving final outcome to customer profile...'
    : finalEvalStep === 'uploading_recording' ? 'Uploading call recording...'
    : finalEvalStep === 'finalizing_ui' ? 'Applying final result to UI...'
    : finalEvalStep === 'complete' ? 'Final evaluation completed.'
    : finalEvalStep === 'failed' ? 'Final evaluation failed.'
    : 'Preparing final evaluation...';

  const finalEvalProgress = finalEvalStep === 'ending_call' ? 15
    : finalEvalStep === 'waiting_backend' ? 35
    : finalEvalStep === 'running_ai' ? 55
    : finalEvalStep === 'saving_outcome' ? 75
    : finalEvalStep === 'uploading_recording' ? 88
    : finalEvalStep === 'finalizing_ui' ? 95
    : finalEvalStep === 'complete' ? 100
    : finalEvalStep === 'failed' ? 100
    : 10;

  return (
    <DashboardLayout>
      <div className="p-6 flex gap-6 h-[calc(100vh-0px)]">
        {/* Queue Panel */}
        <div className="w-80 shrink-0 bg-card rounded-lg border border-border flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-card-foreground text-sm">Call Queue</h2>
                <p className="text-xs text-muted-foreground">
                  {queue.length} accounts • Mode: {settings.autoDialMode.toUpperCase()}
                  {(callActive || activeCount > 0) && (
                    <span className="ml-1 text-primary font-medium">• 📞 {callActive ? 1 + activeCount : activeCount} in call</span>
                  )}
                </p>
              </div>
              {settings.autoDialMode !== 'off' && (
                !autoDialRunning ? (
                  <Button size="sm" onClick={startAutoDial} className="gap-1 text-xs">
                    <Zap className="w-3 h-3" /> Auto-Dial
                    {settings.autoDialMode === 'batch' && ` (${settings.autoDialBatchSize})`}
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={stopAutoDial} className="gap-1 text-xs">
                    <Square className="w-3 h-3" /> Stop
                  </Button>
                )
              )}
            </div>

            {autoDialRunning && jobList.length > 0 && (
              <div className="bg-muted rounded-md p-2 space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="flex items-center gap-1"><Activity className="w-3 h-3 text-primary animate-pulse" /> Active: {activeCount}</span>
                  <span className="text-green-500">✅ {doneCount}</span>
                  {failedCount > 0 && <span className="text-destructive">❌ {failedCount}</span>}
                  <span className="text-muted-foreground">{doneCount + failedCount}/{jobList.length}</span>
                </div>
                <div className="w-full bg-border rounded-full h-1.5">
                  <div className="bg-primary rounded-full h-1.5 transition-all" style={{ width: `${((doneCount + failedCount) / jobList.length) * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto divide-y divide-border">
            {queue.map(c => {
              const job = autoDialJobs[c.id];
              const scheduledRetryMs = getScheduledRetryMs(c);
              const isScheduled = scheduledRetryMs !== null;
              const dueNow = isScheduled ? scheduledRetryMs <= Date.now() : true;
              return (
                <button key={c.id} onClick={() => !autoDialRunning && setSelectedCustomer(c)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    !autoDialRunning && current?.id === c.id ? 'bg-accent/20 border-l-2 border-l-primary' : 'hover:bg-muted/30'
                  } ${job?.status === 'done' ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-card-foreground">{c.name}</p>
                    {job && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        job.status === 'done' ? 'bg-green-500/10 text-green-600' :
                        job.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                        job.status === 'queued' ? 'bg-muted text-muted-foreground' :
                        'bg-primary/10 text-primary'
                      }`}>
                        {job.status === 'scripting' ? '📝 Script' :
                         job.status === 'calling' ? '📞 Calling' :
                         job.status === 'analyzing' ? '🧠 Analyzing' :
                         job.status === 'done' ? `${getOutcomeDisplay(job.outcome).icon} ${getOutcomeDisplay(job.outcome).label}` :
                         job.status === 'failed' ? '❌ Failed' : '⏳ Queued'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <PriorityBadge score={Number(c.priority_score)} />
                    {isScheduled && !job && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${dueNow ? 'bg-amber-500/10 text-amber-600' : 'bg-blue-500/10 text-blue-600'}`}>
                        {dueNow ? '⏰ Due now' : '🗓 Scheduled'}
                      </span>
                    )}
                    {c.final_response && !job && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded bg-muted ${getOutcomeDisplay(c.final_response).color}`}>{getOutcomeDisplay(c.final_response).icon} {getOutcomeDisplay(c.final_response).label}</span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Follow-ups: {c.follow_up_count} | DPD: {c.dpd}
                    {isScheduled && ` | Retry: ${new Date(scheduledRetryMs!).toLocaleString()}`}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Call History Panel */}
        <div className="w-80 shrink-0 bg-card rounded-lg border border-border flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-card-foreground text-sm">Call History</h2>
              <p className="text-xs text-muted-foreground">{historyItems.length} completed calls</p>
            </div>
            <div className="flex-1 overflow-auto divide-y divide-border">
              {historyItems.length === 0 && (
                <div className="px-4 py-6 text-xs text-muted-foreground">
                  No completed calls yet. Finished calls will move here automatically.
                </div>
              )}
              {historyItems.map((item, index) => (
                <div key={index} className="group relative">
                  <button
                    onClick={() => item.callLogId ? navigate(`/call-logs?highlight=${item.callLogId}`) : navigate('/call-logs')}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (item.source !== 'live') return;
                      setCallHistory(prev => prev.filter((entry) => !(entry.source === 'live' && entry.customer.id === item.customer.id && entry.timestamp === item.timestamp)));
                      toast({ title: 'Removed from local history', description: `${item.customer.name} history item was cleared.` });
                    }}
                    className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-card-foreground">{item.customer.name}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getOutcomeDisplay(item.outcome).color}`}>
                        {getOutcomeDisplay(item.outcome).icon} {getOutcomeDisplay(item.outcome).label}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {item.duration > 0 ? `${formatDuration(item.duration)} • ` : ''}{new Date(item.timestamp).toLocaleTimeString()}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Recording: {item.recordingUrl ? 'Ready' : 'Downloading...'}
                    </p>
                    {item.source === 'live' && (
                      <p className="text-[10px] text-muted-foreground">
                        Right-click to remove from this panel
                      </p>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>

        {/* Main Panel */}
        <div className="flex-1 flex flex-col gap-4">
          {/* Auto-Dial Dashboard */}
          {autoDialRunning && (
            <div className="bg-card rounded-lg border border-primary/30 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-card-foreground flex items-center gap-2">
                  <Zap className="w-5 h-5 text-primary" /> Auto-Dialer Running
                </h2>
                <Button variant="destructive" size="sm" onClick={stopAutoDial} className="gap-1">
                  <Square className="w-4 h-4" /> Stop All
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="bg-muted rounded-md p-3 text-center"><p className="text-2xl font-bold text-foreground">{jobList.length}</p><p className="text-[10px] text-muted-foreground">Total</p></div>
                <div className="bg-primary/10 rounded-md p-3 text-center"><p className="text-2xl font-bold text-primary">{activeCount}</p><p className="text-[10px] text-muted-foreground">Active</p></div>
                <div className="bg-green-500/10 rounded-md p-3 text-center"><p className="text-2xl font-bold text-green-600">{doneCount}</p><p className="text-[10px] text-muted-foreground">Completed</p></div>
                <div className="bg-destructive/10 rounded-md p-3 text-center"><p className="text-2xl font-bold text-destructive">{failedCount}</p><p className="text-[10px] text-muted-foreground">Failed</p></div>
              </div>
              <div className="space-y-2 max-h-40 overflow-auto">
                {jobList.filter(j => ['scripting', 'calling', 'analyzing'].includes(j.status)).map(j => (
                  <div key={j.customerId} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                    <span className="text-sm font-medium text-foreground">{j.customerName}</span>
                    <span className="text-xs text-primary flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {j.status === 'scripting' ? 'Generating Script...' : j.status === 'calling' ? 'Calling...' : 'AI Analyzing...'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State — no customer selected or queue empty */}
          {!current && !autoDialRunning && (
            <div className="flex-1 flex flex-col gap-6 overflow-auto py-4">
              {/* Header */}
              <div className="flex flex-col items-center text-center gap-4">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                    <Phone className="w-10 h-10 text-primary/60" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-accent flex items-center justify-center">
                    <Zap className="w-3.5 h-3.5 text-accent-foreground" />
                  </div>
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-foreground tracking-tight">Call Center Ready</h2>
                  <p className="text-muted-foreground text-sm">
                    {queue.length > 0
                      ? `${queue.length} customers in queue — select one to begin or use Auto-Dial.`
                        : historyItems.length > 0
                      ? 'All customers called. Check history below or add more customers.'
                      : 'No customers in queue. Add from Customers page.'}
                  </p>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto w-full">
                <div className="bg-card rounded-xl border border-border p-3 text-center space-y-1">
                  <div className="w-8 h-8 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                    <Phone className="w-4 h-4 text-primary" />
                  </div>
                  <p className="text-xs font-semibold text-foreground">Manual Call</p>
                  <p className="text-[10px] text-muted-foreground">Select & dial one by one</p>
                </div>
                <div className="bg-card rounded-xl border border-border p-3 text-center space-y-1">
                  <div className="w-8 h-8 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-primary" />
                  </div>
                  <p className="text-xs font-semibold text-foreground">Auto-Dial</p>
                  <p className="text-[10px] text-muted-foreground">Priority-based batch calling</p>
                </div>
                <div className="bg-card rounded-xl border border-border p-3 text-center space-y-1">
                  <div className="w-8 h-8 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                    <Brain className="w-4 h-4 text-primary" />
                  </div>
                  <p className="text-xs font-semibold text-foreground">AI Analysis</p>
                  <p className="text-[10px] text-muted-foreground">Auto outcome & scheduling</p>
                </div>
              </div>

              {/* ─── How It Works Guide ─── */}
              <div className="grid grid-cols-2 gap-4 max-w-4xl mx-auto w-full">

                {/* Call Outcomes */}
                <div className="bg-card rounded-xl border border-border p-4">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
                    <Info className="w-4 h-4 text-primary" /> Call Outcomes & Auto-Retry
                  </h3>
                  <div className="space-y-2">
                    {[
                      { icon: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />, label: 'PTP Secured', desc: 'Customer gave payment date', retry: 'Auto PTP reminders' },
                      { icon: <Clock className="w-3.5 h-3.5 text-amber-500" />, label: 'Callback Requested', desc: 'Customer busy / call later', retry: '2 hours' },
                      { icon: <Phone className="w-3.5 h-3.5 text-blue-500" />, label: 'No Answer', desc: 'Phone rang, no pickup / 3x greeting no response', retry: '2 hours' },
                      { icon: <UserX className="w-3.5 h-3.5 text-orange-500" />, label: 'Non-Customer Pickup', desc: 'Family/wrong person answered', retry: '5 hours' },
                      { icon: <XCircle className="w-3.5 h-3.5 text-destructive" />, label: 'Refused', desc: 'Customer refused to pay', retry: '24 hours' },
                      { icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />, label: 'Negotiation Barrier', desc: 'Wants extension/installments', retry: '5 hours' },
                      { icon: <Ban className="w-3.5 h-3.5 text-muted-foreground" />, label: 'Switched Off', desc: 'Phone unreachable', retry: '2 hours' },
                      { icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />, label: 'Payment Done', desc: 'Already paid', retry: 'No retry' },
                      { icon: <XCircle className="w-3.5 h-3.5 text-red-700" />, label: 'Abuse Detected', desc: 'Customer used abusive language', retry: '24 hours' },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
                        {item.icon}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground">{item.label}</p>
                          <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground whitespace-nowrap">
                          ↻ {item.retry}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* PTP & Scheduling Rules */}
                <div className="bg-card rounded-xl border border-border p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
                      <CalendarCheck className="w-4 h-4 text-primary" /> PTP Date Collection Rules
                    </h3>
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <div className="flex items-start gap-2">
                        <span className="text-primary font-bold mt-0.5">①</span>
                        <p>Agent <strong className="text-foreground">MUST</strong> collect a payment date before ending call. Non-negotiable.</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-primary font-bold mt-0.5">②</span>
                        <p>If customer is vague ("jaldi", "kuch din"), agent insists <strong className="text-foreground">3 times</strong> for specific date.</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-primary font-bold mt-0.5">③</span>
                        <p>Max PTP date: <strong className="text-foreground">5 days</strong>. Agent cannot grant longer.</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-primary font-bold mt-0.5">④</span>
                        <p>Even <strong className="text-foreground">busy customers</strong> are asked for a quick PTP date before hanging up.</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-primary font-bold mt-0.5">⑤</span>
                        <p>Exceptions: <strong className="text-foreground">Payment Done</strong> & <strong className="text-foreground">Non-Customer</strong> — no date asked.</p>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border pt-3">
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
                      <PhoneForwarded className="w-4 h-4 text-primary" /> Auto Follow-Up Schedule
                    </h3>
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                        <span className="font-medium text-foreground">📅 PTP Day −1</span>
                        <span>Reminder call: "Kal payment due hai"</span>
                      </div>
                      <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                        <span className="font-medium text-foreground">📅 PTP Day</span>
                        <span>Follow-up: "Aaj payment date hai"</span>
                      </div>
                      <div className="flex items-center justify-between bg-amber-500/5 rounded-md px-3 py-2 border border-amber-500/20">
                        <span className="font-medium text-foreground">⚠️ PTP Day +1</span>
                        <span className="text-amber-600 font-medium">Broken Promise → Assertive tone</span>
                      </div>
                      <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                        <span className="font-medium text-foreground">⏰ Business Hours</span>
                        <span>9 AM – 6 PM, Mon–Fri only</span>
                      </div>
                      <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                        <span className="font-medium text-foreground">🔄 Cooldown</span>
                        <span>5 min gap between same customer calls</span>
                      </div>
                      <div className="flex items-center justify-between bg-primary/5 rounded-md px-3 py-2 border border-primary/20">
                        <span className="font-medium text-foreground">🔊 Greeting Retry</span>
                        <span>3x replay if no response in 5s each</span>
                      </div>
                      <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                        <span className="font-medium text-foreground">📋 History Context</span>
                        <span>Scheduler passes last 3 transcripts to AI</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Queue preview */}
              {queue.length > 0 && (
                <div className="flex items-center justify-center gap-3">
                  <div className="flex -space-x-2">
                    {queue.slice(0, 5).map((c, i) => (
                      <div key={c.id} className="w-8 h-8 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[10px] font-bold text-muted-foreground" style={{ zIndex: 5 - i }}>
                        {c.name.charAt(0)}
                      </div>
                    ))}
                    {queue.length > 5 && (
                      <div className="w-8 h-8 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center text-[10px] font-bold text-primary">
                        +{queue.length - 5}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Top priority: <strong className="text-foreground">{queue[0]?.name}</strong> — PKR {Number(queue[0]?.balance || 0).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Customer Detail */}
          {current && !autoDialRunning && (
            <>
              <div className="bg-card rounded-lg border border-border p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-card-foreground">{current.name}</h2>
                    <p className="text-sm text-muted-foreground font-mono mt-1">{current.phone}</p>
                  </div>
                  <PriorityBadge score={Number(current.priority_score)} />
                </div>
                <div className="grid grid-cols-6 gap-3 mt-5">
                  <div className="bg-muted rounded-md p-3"><p className="text-xs text-muted-foreground">Balance</p><p className="text-base font-bold text-foreground">PKR {Number(current.balance).toLocaleString()}</p></div>
                  <div className="bg-muted rounded-md p-3"><p className="text-xs text-muted-foreground">DPD</p><p className="text-base font-bold text-foreground">{current.dpd}</p></div>
                  <div className="bg-muted rounded-md p-3"><p className="text-xs text-muted-foreground">Follow-ups</p><p className="text-base font-bold text-foreground">{current.follow_up_count}</p></div>
                  <div className="bg-muted rounded-md p-3"><p className="text-xs text-muted-foreground">PTP Status</p><p className="text-base font-bold text-foreground">{current.ptp_status ? (current.ptp_status === 'kept' ? '✅ Kept' : current.ptp_status === 'broken' ? '❌ Broken' : current.ptp_status === 'pending' && current.ptp_date ? '📅 PTP Scheduled' : '⏳ PTP Pending') : '—'}</p></div>
                  <div className="bg-muted rounded-md p-3"><p className="text-xs text-muted-foreground">Last Response</p><p className={`text-sm font-bold ${getOutcomeDisplay(current.final_response).color}`}>{getOutcomeDisplay(current.final_response).icon} {getOutcomeDisplay(current.final_response).label}</p></div>
                  <div className="bg-muted rounded-md p-3"><p className="text-xs text-muted-foreground">Last Call</p><p className="text-sm font-bold text-foreground">{current.last_call_date ? new Date(current.last_call_date).toLocaleDateString() : 'Never'}</p></div>
                </div>
                <div className="flex items-center gap-3 mt-4">
                  <AgentBadge agent={current.assigned_agent as AgentType} />
                  <ToneBadge tone={current.assigned_tone as ToneMode} />
                  {(() => {
                    const autoCaller = autoSelectCaller(current);
                    return (
                      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-semibold">
                        🎙️
                        <img src={autoCaller.avatar} alt={autoCaller.name} className="w-5 h-5 rounded-full object-cover" crossOrigin="anonymous" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        {autoCaller.name} ({autoCaller.voice})
                      </span>
                    );
                  })()}
                </div>
                <p className="text-xs text-muted-foreground mt-2">{AGENT_DESCRIPTIONS[current.assigned_agent as AgentType]}</p>
              </div>

              {/* Call Controls */}
              <div className="bg-card rounded-lg border border-border p-6 flex flex-col items-center gap-4">
                {settings.testingMode && (
                  <div className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-warning/10 border border-warning/30">
                    <FlaskConical className="w-4 h-4 text-warning" />
                    <span className="text-xs font-semibold text-warning">🧪 TESTING MODE — Real-time Two-Way Conversation</span>
                  </div>
                )}

                {(() => {
                  const caller = current ? autoSelectCaller(current) : getSelectedCaller();
                  return (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <img src={caller.avatar} alt={caller.name} className="w-8 h-8 rounded-full object-cover border border-border" crossOrigin="anonymous" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).replaceWith(Object.assign(document.createElement('span'), { className: 'w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary', textContent: caller.name[0] })); }} />
                      <span>Calling as <strong className="text-foreground">{caller.name}</strong></span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted">{caller.voice}</span>
                      {settings.testingMode
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning font-medium">Browser</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">Twilio</span>
                      }
                    </div>
                  );
                })()}

                {/* Real-time Conversation Panel */}
                {settings.testingMode && testingConversation.length > 0 && (callActive || conversationPhase !== 'idle') && (
                  <div className="w-full space-y-2">
                    {/* Phase indicator */}
                    {phaseLabel && (
                      <div className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium ${
                        conversationPhase === 'listening' ? 'bg-green-500/10 text-green-600 border border-green-500/30' :
                        conversationPhase === 'agent_speaking' ? 'bg-primary/10 text-primary border border-primary/30' :
                        conversationPhase === 'processing' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/30' :
                        'bg-muted text-muted-foreground border border-border'
                      }`}>
                        {conversationPhase === 'listening' && <Mic className="w-3.5 h-3.5 animate-pulse" />}
                        {conversationPhase === 'agent_speaking' && <Volume2 className="w-3.5 h-3.5 animate-pulse" />}
                        {conversationPhase === 'processing' && <Brain className="w-3.5 h-3.5 animate-pulse" />}
                        {conversationPhase === 'ending' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {phaseLabel}
                      </div>
                    )}

                    {/* Chat bubbles */}
                    <div ref={conversationScrollRef} className="w-full bg-muted/50 rounded-lg p-3 max-h-48 overflow-auto space-y-2 border border-border">
                      {testingConversation.map((turn, i) => (
                        <div key={i} className={`flex ${turn.role === 'customer' ? 'justify-end' : turn.role === 'system' ? 'justify-center' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                            turn.role === 'agent'
                              ? 'bg-primary/15 text-foreground border border-primary/20'
                              : turn.role === 'customer'
                              ? 'bg-green-500/15 text-foreground border border-green-500/20'
                              : 'bg-muted text-muted-foreground italic'
                          }`}>
                            {turn.role !== 'system' && (
                              <span className={`text-[10px] font-semibold block mb-0.5 ${
                                turn.role === 'agent' ? 'text-primary' : 'text-green-600'
                              }`}>
                                {turn.role === 'agent' ? `🤖 ${current ? autoSelectCaller(current).name : getSelectedCaller().name}` : '🧑 You (Customer)'}
                              </span>
                            )}
                            {turn.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {analyzing && (
                  <div className="w-full max-w-xl bg-muted/40 border border-border rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Loader2 className="w-5 h-5 text-primary animate-spin mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-foreground">Final Evaluation In Progress</p>
                        <p className="text-xs text-muted-foreground mt-1">{finalEvalLabel}</p>
                        <div className="w-full bg-border rounded-full h-1.5 mt-3">
                          <div className={`rounded-full h-1.5 transition-all ${finalEvalStep === 'failed' ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${finalEvalProgress}%` }} />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-2">Steps: End call -&gt; Backend evaluate -&gt; Save outcome -&gt; Finalize UI</p>
                      </div>
                    </div>
                  </div>
                )}

                {lastOutcome && lastOutcome.customerId === current?.id && !callActive && !analyzing && conversationPhase === 'idle' && (
                  isRecordingPredictionPending(lastOutcome.notes) ? (
                    <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-center">
                      <p className="text-sm font-bold text-amber-600 inline-flex items-center gap-2 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> Recording Analysis In Progress
                      </p>
                      <p className={`text-sm mt-1 ${getOutcomeDisplay(lastOutcome.final_response).color}`}>
                        Provisional: <strong>{getOutcomeDisplay(lastOutcome.final_response).icon} {getOutcomeDisplay(lastOutcome.final_response).label}</strong>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Server is finalizing the recording-based result. UI will update automatically.</p>
                    </div>
                  ) : (
                    <div className="w-full bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
                      <p className="text-sm font-bold text-green-600">✅ Last Call Final Outcome</p>
                      <p className={`text-sm mt-1 ${getOutcomeDisplay(lastOutcome.final_response).color}`}>
                        Result: <strong>{getOutcomeDisplay(lastOutcome.final_response).icon} {getOutcomeDisplay(lastOutcome.final_response).label}</strong>
                      </p>
                      {lastOutcome.notes && <p className="text-xs text-muted-foreground mt-1">{sanitizeDisplayText(lastOutcome.notes)}</p>}
                    </div>
                  )
                )}

                {callActive && (
                  <div className="text-center">
                    <div className="w-3 h-3 rounded-full animate-pulse mx-auto bg-green-500" />
                    <p className="text-sm font-medium text-foreground mt-2">Call in Progress</p>
                    <p className="text-2xl font-mono font-bold text-primary mt-1">
                      {Math.floor(callDuration / 60)}:{(callDuration % 60).toString().padStart(2, '0')}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  {!callActive && conversationPhase === 'idle' ? (
                    <Button onClick={() => { void startCall(); }} className="gap-2 px-8" size="lg" disabled={analyzing || scriptLoading}>
                      <Phone className="w-5 h-5" /> Start Call
                    </Button>
                  ) : (
                    <>
                      <Button variant="secondary" size="lg" onClick={() => setMuted(!muted)} className="gap-2">
                        {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />} {muted ? 'Unmute' : 'Mute'}
                      </Button>
                      <Button variant="destructive" size="lg" onClick={endCall} className="gap-2 px-8" disabled={conversationPhase === 'ending'}>
                        <PhoneOff className="w-5 h-5" /> End Call
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Script */}
              <div className="bg-card rounded-lg border border-border p-5 flex-1 overflow-auto">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-card-foreground flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-primary" /> AI Script (Roman Urdu)
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => { void generateScript(); }} disabled={scriptLoading} className="gap-1">
                    {scriptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Regenerate
                  </Button>
                </div>
                <div className="bg-muted rounded-md p-4 font-mono text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {scriptLoading ? (
                    <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Script generate ho rahi hai...</div>
                  ) : aiScript ? aiScript : (
                    <>
                      <p className="text-foreground font-medium mb-2">Opening:</p>
                      <p>"Assalam-o-Alaikum, kya main {current.name} se baat kar raha hoon? Yeh aapke outstanding balance PKR {Number(current.balance).toLocaleString()} ke hawale se call hai."</p>
                      <p className="text-foreground font-medium mt-4 mb-2">PTP Negotiation:</p>
                      <p>"Kya aap agle 5 dinon mein payment ka commitment de sakte hain?"</p>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Auto-Dial Results */}
          {!autoDialRunning && jobList.length > 0 && (
            <div className="bg-card rounded-lg border border-border p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-card-foreground">📊 Last Auto-Dial Results</h3>
                <Button variant="ghost" size="sm" onClick={() => setAutoDialJobs({})}>Clear</Button>
              </div>
              <div className="space-y-1 max-h-60 overflow-auto">
                {jobList.map(j => (
                  <div key={j.customerId} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                    <span className="text-sm text-foreground">{j.customerName}</span>
                    <span className={`text-xs font-medium ${j.status === 'done' ? 'text-green-600' : 'text-destructive'}`}>
                      {j.status === 'done' ? `${getOutcomeDisplay(j.outcome).icon} ${getOutcomeDisplay(j.outcome).label}` : `❌ ${j.error?.slice(0, 40)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
