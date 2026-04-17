import { useState, useEffect, useCallback } from 'react';
import { Clock, CalendarDays, RefreshCw, Phone, Power, PowerOff, PlayCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useCustomers } from '@/hooks/useCustomers';
import { useCallLogs } from '@/hooks/useCallLogs';
import { AgentBadge, ToneBadge } from '@/components/dashboard/StatusBadge';
import { AgentType, ToneMode } from '@/types/voice-agent';
import { PriorityBadge } from '@/components/dashboard/PriorityBadge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { withAuthHeaders } from '@/lib/auth';
import { isRecordingPredictionPending, sanitizeDisplayText } from '@/lib/utils';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');

export default function Schedule() {
  const navigate = useNavigate();
  const { customers, loading } = useCustomers();
  const { callLogs } = useCallLogs();
  const [schedulerEnabled, setSchedulerEnabled] = useState(false);
  const [schedulerLoading, setSchedulerLoading] = useState(false);
  const [schedulerPollMinutes, setSchedulerPollMinutes] = useState(1);

  const now = new Date();

  // Check scheduler status on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/scheduler/status`, withAuthHeaders())
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setSchedulerEnabled(data.enabled);
        const minutes = Number(data?.config?.schedulerPollMinutes || data?.config?.schedulerPollSec / 60 || 1);
        setSchedulerPollMinutes(Number.isFinite(minutes) ? Math.max(1, Math.round(minutes)) : 1);
      })
      .catch(() => {});
  }, []);

  const latestCallLogByCustomer = callLogs.reduce<Record<string, any>>((acc, row) => {
    if (!row?.customer_id) return acc;
    const prev = acc[row.customer_id];
    const prevTs = prev?.call_date_time ? new Date(prev.call_date_time).getTime() : 0;
    const rowTs = row?.call_date_time ? new Date(row.call_date_time).getTime() : 0;
    if (!prev || rowTs >= prevTs) acc[row.customer_id] = row;
    return acc;
  }, {});

  const getDisplayRetryReason = (customer: any) => {
    const rawReason = String(customer?.retry_reason || '');
    const cleanReason = sanitizeDisplayText(rawReason);
    const latestLog = latestCallLogByCustomer[customer?.id || ''];
    const hasCustomerPendingMarker = isRecordingPredictionPending(rawReason);
    const callLogHasRecording = Boolean(String(latestLog?.recording_url || '').trim());
    const callLogStillPending = isRecordingPredictionPending(latestLog?.notes || '');

    if (hasCustomerPendingMarker && callLogHasRecording && !callLogStillPending) {
      return cleanReason || 'Retry scheduled';
    }

    return cleanReason || 'Retry scheduled';
  };

  const toggleScheduler = useCallback(async () => {
    setSchedulerLoading(true);
    try {
      const endpoint = schedulerEnabled ? 'stop' : 'start';
      const res = await fetch(`${API_BASE}/api/scheduler/${endpoint}`, withAuthHeaders({ method: 'POST' }));
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();
      setSchedulerEnabled(data.enabled);
      toast.success(data.enabled ? 'Auto-redial scheduler STARTED' : 'Auto-redial scheduler STOPPED');
    } catch {
      toast.error('Failed to toggle scheduler');
    }
    setSchedulerLoading(false);
  }, [schedulerEnabled]);

  const triggerAll = useCallback(async () => {
    setSchedulerLoading(true);
    try {
      await fetch(`${API_BASE}/api/scheduler/trigger`, withAuthHeaders({ method: 'POST' }));
      toast.success('Triggered redial for all overdue retries');
    } catch {
      toast.error('Failed to trigger redials');
    }
    setSchedulerLoading(false);
  }, []);

  // Real scheduled retries from DB
  const scheduledRetries = customers
    .filter(c => c.scheduled_retry_at)
    .sort((a, b) => new Date(a.scheduled_retry_at!).getTime() - new Date(b.scheduled_retry_at!).getTime());

  const upcomingRetries = scheduledRetries.filter(c => new Date(c.scheduled_retry_at!).getTime() > now.getTime());
  const overdueRetries = scheduledRetries.filter(c => new Date(c.scheduled_retry_at!).getTime() <= now.getTime());

  // PTP reminders
  const ptpReminders = customers.filter(c => c.ptp_date && c.ptp_status === 'pending');

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Schedule</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Auto-scheduled retries & PTP reminders — {scheduledRetries.length} retries, {ptpReminders.length} PTP pending
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={schedulerEnabled ? 'destructive' : 'default'}
              size="sm"
              className="gap-1.5"
              onClick={toggleScheduler}
              disabled={schedulerLoading}
            >
              {schedulerEnabled ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
              {schedulerEnabled ? 'Stop Auto-Redial' : 'Start Auto-Redial'}
            </Button>
            {overdueRetries.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={triggerAll}
                disabled={schedulerLoading}
              >
                <PlayCircle className="w-4 h-4" />
                Redial All Overdue ({overdueRetries.length})
              </Button>
            )}
          </div>
        </div>

        {/* Scheduler Status */}
        <div className={`px-4 py-2 rounded-md text-sm flex items-center gap-2 ${schedulerEnabled ? 'bg-green-500/10 text-green-600 border border-green-500/30' : 'bg-muted text-muted-foreground border border-border'}`}>
          <div className={`w-2 h-2 rounded-full ${schedulerEnabled ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`} />
          {schedulerEnabled
            ? `Auto-redial is ACTIVE — checking every ${schedulerPollMinutes} minute(s) for overdue retries`
            : 'Auto-redial is OFF — overdue retries will not be called automatically'}
        </div>

        {/* Overdue Retries */}
        {overdueRetries.length > 0 && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg">
            <div className="px-5 py-4 border-b border-destructive/20">
              <h2 className="font-semibold text-destructive flex items-center gap-2">
                <Phone className="w-4 h-4" /> Overdue Retries ({overdueRetries.length})
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">These customers should have been called already</p>
            </div>
            <div className="divide-y divide-destructive/10">
              {overdueRetries.map(c => (
                <div key={c.id} className="px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm text-card-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.phone}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <PriorityBadge score={Number(c.priority_score)} />
                      <AgentBadge agent={c.assigned_agent as AgentType} />
                    </div>
                  </div>
                   <p className="text-xs text-muted-foreground mt-1">{getDisplayRetryReason(c)}</p>
                   {c.final_response && (
                     <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground mt-1 inline-block">
                       Last outcome: {c.final_response.replace(/_/g, ' ')}
                     </span>
                   )}
                   <div className="flex items-center justify-between mt-2">
                     <div className="flex items-center gap-1.5 text-xs text-destructive">
                       <Clock className="w-3 h-3" />
                       Was due: {new Date(c.scheduled_retry_at!).toLocaleString()}
                     </div>
                     <Button size="sm" className="h-7 gap-1" onClick={() => navigate('/call-center', { state: { selectedCustomerId: c.id, triggerCall: true } })}>
                       <Phone className="w-3 h-3" /> Call Now
                     </Button>
                   </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upcoming Retries */}
          <div className="bg-card rounded-lg border border-border">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold text-card-foreground flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-primary" /> Upcoming Retries ({upcomingRetries.length})
              </h2>
            </div>
            <div className="divide-y divide-border">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
              ) : upcomingRetries.length === 0 ? (
                <div className="px-5 py-8 text-center text-muted-foreground text-sm">No scheduled retries</div>
              ) : (
                upcomingRetries.map(c => {
                  const retryTime = new Date(c.scheduled_retry_at!);
                  const hoursLeft = Math.max(0, Math.round((retryTime.getTime() - now.getTime()) / 3600000 * 10) / 10);
                  return (
                    <div key={c.id} className="px-5 py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm text-card-foreground">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.phone}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <AgentBadge agent={c.assigned_agent as AgentType} />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{getDisplayRetryReason(c)}</p>
                      {c.final_response && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground mt-1 inline-block">
                          Last: {c.final_response.replace(/_/g, ' ')}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-primary">
                        <Clock className="w-3 h-3" />
                        {retryTime.toLocaleString()} ({hoursLeft}h remaining)
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* PTP Reminders */}
          <div className="bg-card rounded-lg border border-border">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold text-card-foreground flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" /> PTP Reminders ({ptpReminders.length})
              </h2>
            </div>
            <div className="divide-y divide-border">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
              ) : ptpReminders.length === 0 ? (
                <div className="px-5 py-8 text-center text-muted-foreground text-sm">No pending PTP reminders</div>
              ) : (
                ptpReminders.map(c => {
                  const ptpDate = new Date(c.ptp_date!);
                  const daysUntil = Math.ceil((ptpDate.getTime() - now.getTime()) / 86400000);
                  const isToday = daysUntil === 0;
                  const isTomorrow = daysUntil === 1;
                  return (
                    <div key={c.id} className="px-5 py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm text-card-foreground">{c.name}</p>
                          {isToday && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive font-medium">TODAY — Follow-up needed</span>}
                          {isTomorrow && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 font-medium">TOMORROW — Reminder call</span>}
                        </div>
                        <ToneBadge tone={c.assigned_tone as ToneMode} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        PTP Date: {ptpDate.toLocaleDateString()} ({daysUntil > 0 ? `${daysUntil} days left` : daysUntil === 0 ? 'Today' : 'Overdue'})
                      </p>
                      <p className="text-xs text-muted-foreground">Balance: PKR {Number(c.balance).toLocaleString()}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Rules Reference */}
        <div className="bg-card rounded-lg border border-border p-5">
          <h3 className="font-semibold text-card-foreground mb-3">Auto-Scheduling Rules</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { rule: '📵 No Answer / Switch Off', action: '2 hours baad auto-retry' },
              { rule: '👤 Non-Customer Pickup', action: 'Bhai/behan/maa/baap ne uthaya → 5 hours baad retry' },
              { rule: '❌ "Main [naam] nahi hoon"', action: 'Wrong person — no retry, flag for review' },
              { rule: '📞 Callback Requested', action: '2 hours baad retry' },
              { rule: '🚫 Refused to Pay', action: '24 hours baad retry with escalation' },
              { rule: '🔄 Negotiation Barrier', action: '24 hours baad escalation retry' },
              { rule: '💰 Partial Payment', action: '48 hours baad baqi ke liye retry' },
              { rule: '✅ PTP Secured', action: 'PTP date se 1 din pehle reminder, PTP date pe follow-up' },
              { rule: '🕕 After Hours (6PM+)', action: 'Kal 9 AM pe shift' },
            ].map((item, i) => (
              <div key={i} className="bg-muted rounded-md p-3">
                <p className="text-sm font-medium text-foreground">{item.rule}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.action}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
