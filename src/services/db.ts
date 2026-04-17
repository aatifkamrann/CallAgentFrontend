/**
 * Database Service Layer
 * =====================
 * All database operations go through the local Express server (localhost:3001).
 * The server uses SQLite for portable, single-machine deployment.
 */

import { FinalResponse } from '@/hooks/useCustomers';
import { AgentType, ToneMode, calculatePriority, autoAssignAgent, autoAssignTone } from '@/types/voice-agent';
import { withAuthHeaders } from '@/lib/auth';

// PRODUCTION: Same-origin (server serves frontend), so empty string = relative URLs
// DEV: Falls back to localhost:3001
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');

// Safe fetch wrapper: catches network errors AND non-JSON responses
async function safeFetch(url: string, options?: RequestInit): Promise<{ res: Response; json: any; error?: undefined } | { res: null; json: null; error: string }> {
  try {
    const res = await fetch(url, withAuthHeaders(options));
    try {
      const json = await res.json();
      return { res, json };
    } catch {
      // Server returned non-JSON (e.g. HTML error page, empty body)
      const text = 'Server returned invalid response';
      return { res: null, json: null, error: `${text} (HTTP ${res.status})` };
    }
  } catch (err: any) {
    // Network error — server unreachable
    return { res: null, json: null, error: err.message === 'Failed to fetch' ? 'Server is not running. Start the backend server first.' : err.message };
  }
}

// ─── Types ───────────────────────────────────────────────────────

export interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  balance: number;
  dpd: number;
  follow_up_count: number;
  priority_score: number;
  last_call_date: string | null;
  ptp_date: string | null;
  ptp_status: 'pending' | 'kept' | 'broken' | null;
  assigned_agent: string;
  assigned_tone: string;
  final_response: FinalResponse;
  scheduled_retry_at: string | null;
  retry_reason: string | null;
  gender: string;
  created_at: string;
  updated_at: string;
}

export interface CallLogRecord {
  id: string;
  customer_id: string;
  customer_name: string;
  call_date_time: string;
  duration: number;
  status: string;
  agent_type: string;
  tone: string;
  outcome: string | null;
  ptp_date: string | null;
  notes: string | null;
  recording_url: string | null;
  transcript: string | null;
  created_at: string;
}

export interface PostCallData {
  final_response: FinalResponse;
  ptp_date: string | null;
  ptp_status: 'pending' | 'kept' | 'broken' | null;
  notes: string;
  duration: number;
  script_used: boolean;
  transcript?: string;
  schedule_retry_hours?: number;
  non_customer_relation?: string;
}

// ─── Customer Operations ─────────────────────────────────────────

export async function fetchAllCustomers(): Promise<{ data: CustomerRecord[] | null; error: any }> {
  const result = await safeFetch(`${API_BASE}/api/customers`, { cache: 'no-store' });
  if (!result.res) return { data: null, error: { message: result.error } };
  if (!result.res.ok) return { data: null, error: { message: result.json?.error?.message || `HTTP ${result.res.status}` } };
  return { data: result.json.data as CustomerRecord[] | null, error: null };
}

export async function insertCustomer(cust: {
  name: string; phone: string; balance: number; dpd: number;
  follow_up_count: number; ptp_status?: string | null; ptp_date?: string | null;
  final_response?: FinalResponse; gender?: string;
}): Promise<{ data?: { id: string }; error: any }> {
  const priority = calculatePriority(cust.follow_up_count, cust.balance / 1000, cust.dpd);
  const agent = autoAssignAgent({
    ptpStatus: cust.ptp_status as any,
    dpd: cust.dpd,
    followUpCount: cust.follow_up_count,
    ptpDate: cust.ptp_date || undefined,
  });
  const tone = autoAssignTone({
    ptpStatus: cust.ptp_status as any,
    dpd: cust.dpd,
    followUpCount: cust.follow_up_count,
  });

  const result = await safeFetch(`${API_BASE}/api/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: cust.name, phone: cust.phone, balance: cust.balance, dpd: cust.dpd,
      follow_up_count: cust.follow_up_count, priority_score: priority,
      ptp_status: cust.ptp_status || null, ptp_date: cust.ptp_date || null,
      assigned_agent: agent, assigned_tone: tone,
      final_response: cust.final_response || null, gender: cust.gender || 'unknown',
    }),
  });
  if (!result.res) return { data: undefined, error: { message: result.error } };
  return {
    data: result.json?.data?.id ? { id: result.json.data.id } : undefined,
    error: result.json?.error || null,
  };
}

export async function bulkImportCustomers(customers: Array<{
  name: string; phone: string; balance: number; dpd: number;
  follow_up_count: number; ptp_status?: string | null; ptp_date?: string | null;
  final_response?: FinalResponse; gender?: string;
}>): Promise<{ data: { imported: number; skipped: number } | null; error: any }> {
  const prepared = customers.map((cust) => {
    const priority = calculatePriority(cust.follow_up_count, cust.balance / 1000, cust.dpd);
    const agent = autoAssignAgent({
      ptpStatus: cust.ptp_status as any,
      dpd: cust.dpd,
      followUpCount: cust.follow_up_count,
      ptpDate: cust.ptp_date || undefined,
    });
    const tone = autoAssignTone({
      ptpStatus: cust.ptp_status as any,
      dpd: cust.dpd,
      followUpCount: cust.follow_up_count,
    });

    return {
      name: cust.name,
      phone: cust.phone,
      balance: cust.balance,
      dpd: cust.dpd,
      follow_up_count: cust.follow_up_count,
      priority_score: priority,
      ptp_status: cust.ptp_status || null,
      ptp_date: cust.ptp_date || null,
      assigned_agent: agent,
      assigned_tone: tone,
      final_response: cust.final_response || null,
      gender: cust.gender || 'unknown',
    };
  });

  const result = await safeFetch(`${API_BASE}/api/customers/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customers: prepared }),
  });
  if (!result.res) return { data: null, error: { message: result.error } };
  if (!result.res.ok) return { data: null, error: result.json?.error || { message: `HTTP ${result.res.status}` } };
  return { data: result.json.data || null, error: result.json.error || null };
}

export async function updateCustomerRecord(id: string, cust: {
  name?: string; phone?: string; balance?: number; dpd?: number;
  follow_up_count?: number; ptp_status?: string | null; ptp_date?: string | null;
  final_response?: FinalResponse;
  priority_score?: number; assigned_agent?: string; assigned_tone?: string;
  last_call_date?: string | null; scheduled_retry_at?: string | null; retry_reason?: string | null;
}): Promise<{ error: any }> {
  // If we have the fields to compute, compute them; otherwise pass through
  let updateData: any = { ...cust, updated_at: new Date().toISOString() };

  if (cust.follow_up_count !== undefined && cust.balance !== undefined && cust.dpd !== undefined) {
    updateData.priority_score = cust.priority_score ?? calculatePriority(cust.follow_up_count, cust.balance / 1000, cust.dpd);
    updateData.assigned_agent = cust.assigned_agent ?? autoAssignAgent({
      ptpStatus: cust.ptp_status as any,
      dpd: cust.dpd,
      followUpCount: cust.follow_up_count,
      ptpDate: cust.ptp_date || undefined,
    });
    updateData.assigned_tone = cust.assigned_tone ?? autoAssignTone({
      ptpStatus: cust.ptp_status as any,
      dpd: cust.dpd,
      followUpCount: cust.follow_up_count,
    });
  }

  const result = await safeFetch(`${API_BASE}/api/customers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updateData),
  });
  if (!result.res) return { error: { message: result.error } };
  return { error: result.json?.error || null };
}

export async function deleteCustomerRecord(id: string): Promise<{ error: any }> {
  const result = await safeFetch(`${API_BASE}/api/customers/${id}`, { method: 'DELETE' });
  if (!result.res) return { error: { message: result.error } };
  return { error: result.json?.error || null };
}

// ─── Call Log Operations ─────────────────────────────────────────

export async function fetchAllCallLogs(): Promise<{ data: CallLogRecord[] | null; error: any }> {
  const result = await safeFetch(`${API_BASE}/api/call-logs`, { cache: 'no-store' });
  if (!result.res) return { data: null, error: { message: result.error } };
  if (!result.res.ok) return { data: null, error: { message: result.json?.error?.message || `HTTP ${result.res.status}` } };
  return { data: result.json.data as CallLogRecord[] | null, error: null };
}

export async function insertCallLog(log: Omit<CallLogRecord, 'id' | 'created_at'>): Promise<{ data?: { id: string }; error: any }> {
  const result = await safeFetch(`${API_BASE}/api/call-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(log),
  });
  if (!result.res) return { data: undefined, error: { message: result.error } };
  return { data: result.json?.data ? { id: result.json.data.id } : undefined, error: result.json?.error || null };
}

export async function invokeFunction(name: string, body: any): Promise<{ data: any; error: any }> {
  const route = FUNCTION_ROUTE_MAP[name] || `/api/${name}`;
  const url = `${API_BASE}${route}`;
  const result = await safeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!result.res) return { data: null, error: { message: result.error } };
  if (!result.res.ok) {
    return { data: null, error: { message: result.json?.error || result.json?.details || `HTTP ${result.res.status}` } };
  }
  if (result.json?.error && typeof result.json.error === 'string') {
    return { data: null, error: { message: result.json.error } };
  }
  return { data: result.json, error: null };
}

// ─── API Functions (routes to local Express server) ─────────────

// Map edge function names to local API endpoints
const FUNCTION_ROUTE_MAP: Record<string, string> = {
  'generate-script': '/api/ai/generate-script',
  'analyze-call': '/api/ai/analyze-call',
  'make-call': '/api/make-call',
  'end-call': '/api/end-call',
  'call-webhook': '/api/call-webhook',
  'fetch-recording': '/api/fetch-recording',
  'testing-conversation': '/api/ai/testing-conversation',
};

// ─── Poll Conversation Status ────────────────────────────────────

export async function pollConversationStatus(
  conversationId: string,
  onUpdate?: (conv: any) => void,
  maxWaitMs = 300000,
  pollIntervalMs = 3000,
  includeEndingAsTerminal = true,
): Promise<{ data: any; error: any }> {
  const start = Date.now();
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
  if (includeEndingAsTerminal) terminalStatuses.add('ending');

  while (Date.now() - start < maxWaitMs) {
    const result = await safeFetch(`${API_BASE}/api/conversation/${conversationId}`);
    if (!result.res) {
      // Server offline during polling — just keep trying silently
      await new Promise(r => setTimeout(r, pollIntervalMs));
      continue;
    }
    if (!result.res.ok) return { data: null, error: { message: `HTTP ${result.res.status}` } };
    if (result.json) {
      onUpdate?.(result.json);
      const normalizedStatus = String(result.json.status || '').toLowerCase();
      if (terminalStatuses.has(normalizedStatus)) {
        return { data: result.json, error: null };
      }
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  return { data: null, error: { message: 'Call timed out after 5 minutes' } };
}

export async function fetchConversationStatus(conversationId: string): Promise<{ data: any; error: any }> {
  const result = await safeFetch(`${API_BASE}/api/conversation/${conversationId}`);
  if (!result.res) return { data: null, error: { message: result.error } };
  if (!result.res.ok) return { data: null, error: { message: `HTTP ${result.res.status}` } };
  return { data: result.json, error: null };
}

export async function fetchCallLogById(callLogId: string): Promise<{ data: any; error: any }> {
  const result = await safeFetch(`${API_BASE}/api/call-logs/${callLogId}`);
  if (!result.res) return { data: null, error: { message: result.error } };
  if (!result.res.ok) return { data: null, error: { message: `HTTP ${result.res.status}` } };
  return { data: result.json?.data || null, error: null };
}

// ─── Post-Call Business Logic ────────────────────────────────────

export async function processCallOutcome(
  customer: CustomerRecord,
  callData: PostCallData
): Promise<{ success: boolean; error?: string; callLogId?: string }> {
  const now = new Date().toISOString();
  const newFollowUp = customer.follow_up_count + 1;

  let newPtpStatus = customer.ptp_status;
  let newPtpDate = customer.ptp_date;

  switch (callData.final_response) {
    case 'ptp_secured':
      newPtpStatus = 'pending';
      newPtpDate = callData.ptp_date || customer.ptp_date;
      break;
    case 'refused':
    case 'negotiation_barrier':
      if (customer.ptp_status === 'pending') newPtpStatus = 'broken';
      break;
  }

  // Determine call status — if conversation happened (has transcript or ptp_secured), it's completed
  const hasConversation = !!callData.transcript || callData.final_response === 'ptp_secured' || callData.final_response === 'callback_requested' || callData.final_response === 'partial_payment' || callData.final_response === 'payment_done' || callData.final_response === 'busy' || callData.final_response === 'abuse_detected' || callData.final_response === 'refused' || callData.final_response === 'negotiation_barrier' || callData.final_response === 'non_customer_pickup';
  const callStatus = (['no_answer', 'switched_off'].includes(callData.final_response || ''))
    ? 'no_answer'
    : (hasConversation || callData.duration > 0) ? 'completed' : 'failed';

  const priority = calculatePriority(newFollowUp, Number(customer.balance) / 1000, customer.dpd);
  const agent = autoAssignAgent({ ptpStatus: newPtpStatus as any, dpd: customer.dpd, followUpCount: newFollowUp, ptpDate: newPtpDate || undefined });
  const tone = autoAssignTone({ ptpStatus: newPtpStatus as any, dpd: customer.dpd, followUpCount: newFollowUp });

  let scheduledRetryAt: string | null = null;
  let retryReason: string | null = null;
  const retryHours = callData.schedule_retry_hours ?? 0;

  if (retryHours > 0) {
    scheduledRetryAt = new Date(Date.now() + retryHours * 3600000).toISOString();
    retryReason = `${retryHours} ghante baad retry`;
  }

  // Update customer
  const { error: custError } = await updateCustomerRecord(customer.id, {
    follow_up_count: newFollowUp,
    last_call_date: now,
    final_response: callData.final_response,
    ptp_status: newPtpStatus,
    ptp_date: newPtpDate,
    priority_score: priority,
    assigned_agent: agent,
    assigned_tone: tone,
    scheduled_retry_at: scheduledRetryAt,
    retry_reason: retryReason,
    balance: customer.balance,
    dpd: customer.dpd,
  });

  if (custError) return { success: false, error: `Customer update failed: ${custError.message}` };

  // Insert call log
  const { data: logData, error: logError } = await insertCallLog({
    customer_id: customer.id,
    customer_name: customer.name,
    call_date_time: now,
    duration: callData.duration,
    status: callStatus,
    agent_type: customer.assigned_agent, // Log the tone/agent USED during the call
    tone: customer.assigned_tone,
    outcome: callData.final_response,
    ptp_date: callData.final_response === 'ptp_secured' ? callData.ptp_date : null,
    notes: callData.notes || (callData.script_used ? 'AI Roman Urdu script used' : null),
    transcript: callData.transcript || null,
    recording_url: null,
  });

  if (logError) return { success: false, error: `Call log failed: ${logError.message}` };
  return { success: true, callLogId: logData?.id };
}

// ─── Realtime Subscriptions ──────────────────────────────────────

export function subscribeToCustomers(callback: () => void) {
  const POLL_MS = 10000;

  const runIfVisible = () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) return;
    callback();
  };

  const interval = setInterval(runIfVisible, POLL_MS);
  const onFocus = () => runIfVisible();
  const onVisibility = () => {
    if (typeof document !== 'undefined' && !document.hidden) runIfVisible();
  };

  if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return () => {
    clearInterval(interval);
    if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}

export function subscribeToCallLogs(callback: () => void) {
  const POLL_MS = 12000;

  const runIfVisible = () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) return;
    callback();
  };

  const interval = setInterval(runIfVisible, POLL_MS);
  const onFocus = () => runIfVisible();
  const onVisibility = () => {
    if (typeof document !== 'undefined' && !document.hidden) runIfVisible();
  };

  if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return () => {
    clearInterval(interval);
    if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}
