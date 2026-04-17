import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const RECORDING_PENDING_MARKER = '[RECORDING_PENDING]';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sanitizeDisplayText(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .replace(/\[RECORDING_PENDING\]\s*/g, '')
    .replace(/(?:Ã.|Â.|â.|€™|€œ|€|€|™|œ|ž|š)+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isRecordingPredictionPending(value: string | null | undefined): boolean {
  return String(value || '').includes(RECORDING_PENDING_MARKER);
}

export function normalizeOutcomeKey(value: string | null | undefined): string {
  const cleaned = sanitizeDisplayText(value).toLowerCase();
  const match = cleaned.match(/\b(ptp_secured|no_answer|non_customer_pickup|switched_off|negotiation_barrier|refused|callback_requested|partial_payment|payment_done|busy|abuse_detected)\b/);
  return match?.[1] || cleaned;
}

export function humanizeCode(value: string | null | undefined): string {
  const normalized = normalizeOutcomeKey(value) || sanitizeDisplayText(value);
  if (!normalized) return '—';
  return normalized
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
