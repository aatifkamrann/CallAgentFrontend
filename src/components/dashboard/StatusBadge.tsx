import { cn, humanizeCode } from '@/lib/utils';
import { CallStatus, ToneMode, AgentType, AGENT_LABELS, TONE_LABELS } from '@/types/voice-agent';

const statusColors: Record<CallStatus, string> = {
  queued: 'bg-muted text-muted-foreground',
  ringing: 'bg-primary/15 text-primary',
  in_progress: 'bg-primary/20 text-primary',
  completed: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  no_answer: 'bg-warning/15 text-warning',
  voicemail: 'bg-muted text-muted-foreground',
};

export function CallStatusBadge({ status }: { status: CallStatus }) {
  return (
    <span className={cn("status-badge", statusColors[status])}>
      {humanizeCode(status)}
    </span>
  );
}

const toneColors: Record<ToneMode, string> = {
  polite: 'bg-success/15 text-success',
  assertive: 'bg-destructive/15 text-destructive',
  empathetic: 'bg-primary/15 text-primary',
};

export function ToneBadge({ tone }: { tone: ToneMode }) {
  return <span className={cn("status-badge", toneColors[tone])}>{TONE_LABELS[tone]}</span>;
}

export function AgentBadge({ agent }: { agent: AgentType }) {
  return <span className="status-badge bg-secondary text-secondary-foreground">{AGENT_LABELS[agent]}</span>;
}
