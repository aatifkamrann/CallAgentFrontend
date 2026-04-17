import { humanizeCode, normalizeOutcomeKey } from '@/lib/utils';

export type AgentType =
  | 'fresh_call'
  | 'broken_promise'
  | 'ptp_reminder'
  | 'ptp_followup'
  | 'non_customer'
  | 'no_answer'
  | 'after_hours'
  | 'negotiation'
  | 'escalation'
  | 'general_inquiry';

export type ToneMode = 'polite' | 'assertive' | 'empathetic';

export type CallStatus = 'queued' | 'ringing' | 'in_progress' | 'completed' | 'failed' | 'no_answer' | 'voicemail';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  balance: number;
  dpd: number; // days past due
  followUpCount: number;
  priorityScore: number;
  lastCallDate?: string;
  ptpDate?: string;
  ptpStatus?: 'pending' | 'kept' | 'broken';
  assignedAgent: AgentType;
  assignedTone: ToneMode;
}

export interface CallLog {
  id: string;
  customerId: string;
  customerName: string;
  callDateTime: string;
  duration: number; // seconds
  status: CallStatus;
  agentType: AgentType;
  tone: ToneMode;
  outcome?: string;
  ptpDate?: string;
  notes?: string;
}

export const AGENT_LABELS: Record<AgentType, string> = {
  fresh_call: 'Fresh Call',
  broken_promise: 'Broken Promise',
  ptp_reminder: 'PTP Reminder',
  ptp_followup: 'PTP Follow-up',
  non_customer: 'Non-Customer Pickup',
  no_answer: 'No Answer / Switch Off',
  after_hours: 'After-Hours',
  negotiation: 'Negotiation Barrier',
  escalation: 'Escalation',
  general_inquiry: 'General Inquiry',
};

export const TONE_LABELS: Record<ToneMode, string> = {
  polite: 'Polite & Professional',
  assertive: 'Assertive & Urgent',
  empathetic: 'Empathetic & Understanding',
};

export type FinalResponse = 
  | 'ptp_secured'
  | 'no_answer'
  | 'non_customer_pickup'
  | 'switched_off'
  | 'negotiation_barrier'
  | 'refused'
  | 'callback_requested'
  | 'partial_payment'
  | 'payment_done'
  | 'busy'
  | 'abuse_detected';

export const OUTCOME_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  ptp_secured:         { label: 'PTP Secured',           icon: '✅', color: 'text-green-600' },
  no_answer:           { label: 'No Answer',             icon: '📵', color: 'text-yellow-600' },
  non_customer_pickup: { label: 'Non-Customer Pickup',   icon: '👤', color: 'text-orange-500' },
  switched_off:        { label: 'Phone Switched Off',    icon: '📴', color: 'text-red-400' },
  negotiation_barrier: { label: 'Negotiation Barrier',   icon: '🚫', color: 'text-orange-600' },
  refused:             { label: 'Refused to Pay',        icon: '❌', color: 'text-red-600' },
  callback_requested:  { label: 'Callback Requested',    icon: '📞', color: 'text-blue-500' },
  partial_payment:     { label: 'Partial Payment',       icon: '💰', color: 'text-amber-500' },
  payment_done:        { label: 'Payment Done',          icon: '💳', color: 'text-green-500' },
  busy:                { label: 'Customer Busy',         icon: '⏳', color: 'text-yellow-500' },
  abuse_detected:      { label: 'Abuse Detected',        icon: '🤬', color: 'text-red-700' },
};

export function getOutcomeLabel(response: string | null | undefined): string {
  if (!response) return '—';
  const normalized = normalizeOutcomeKey(response);
  return OUTCOME_LABELS[normalized]?.label || humanizeCode(normalized);
}

export function getOutcomeDisplay(response: string | null | undefined): { label: string; icon: string; color: string } {
  if (!response) return { label: '—', icon: '⏳', color: 'text-muted-foreground' };
  const normalized = normalizeOutcomeKey(response);
  return OUTCOME_LABELS[normalized] || { label: humanizeCode(normalized), icon: '❓', color: 'text-muted-foreground' };
}

export const AGENT_DESCRIPTIONS: Record<AgentType, string> = {
  fresh_call: 'First-time outreach to accounts 1-30 DPD',
  broken_promise: 'Follow-up when previous PTP was not honored',
  ptp_reminder: 'Day-before reminder for upcoming PTP date',
  ptp_followup: 'Day-of follow-up to confirm PTP completion',
  non_customer: 'Non-customer picked up — leave message & reschedule',
  no_answer: 'No answer or phone switched off — auto-retry in 2hrs',
  after_hours: 'Retry shifted to next business day at 9 AM',
  negotiation: 'Customer requesting extension — insist on original date',
  escalation: 'High-priority accounts requiring supervisor attention',
  general_inquiry: 'General account inquiries and information',
};

export function calculatePriority(followUpCount: number, balance: number, dpd: number): number {
  return (followUpCount * 10) + (balance * 5) + (dpd * 3);
}

export function autoAssignTone(customer: Pick<Customer, 'ptpStatus' | 'dpd' | 'followUpCount'>): ToneMode {
  // POC: broken promise → assertive (bold/strict)
  if (customer.ptpStatus === 'broken') return 'assertive';
  // POC: high DPD (60+) or many follow-ups → assertive (serious overdue)
  if (customer.dpd >= 60 || customer.followUpCount > 5) return 'assertive';
  // POC: moderate DPD (30-59) or 2-5 follow-ups → empathetic
  if (customer.dpd >= 30 || customer.followUpCount >= 2) return 'empathetic';
  // POC: fresh / low DPD (<30) → polite
  return 'polite';
}

export function autoAssignAgent(customer: Pick<Customer, 'ptpStatus' | 'dpd' | 'followUpCount' | 'ptpDate'>): AgentType {
  if (customer.ptpStatus === 'broken') return 'broken_promise';
  if (customer.ptpDate) {
    const ptpDate = new Date(customer.ptpDate);
    const today = new Date();
    const diffDays = Math.ceil((ptpDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return 'ptp_reminder';
    if (diffDays === 0) return 'ptp_followup';
  }
  if (customer.followUpCount === 0) return 'fresh_call';
  if (customer.dpd > 25) return 'escalation';
  return 'general_inquiry';
}
