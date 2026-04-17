import { useState } from 'react';
import { Phone, Users, TrendingUp, AlertTriangle, CheckCircle, Clock, Play, Pause } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { PriorityBadge } from '@/components/dashboard/PriorityBadge';
import { CallStatusBadge, ToneBadge, AgentBadge } from '@/components/dashboard/StatusBadge';
import { useCustomers } from '@/hooks/useCustomers';
import { useCallLogs } from '@/hooks/useCallLogs';
import { AGENT_LABELS, AgentType, ToneMode, CallStatus, getOutcomeDisplay } from '@/types/voice-agent';

export default function Dashboard() {
  const { customers, loading: custLoading } = useCustomers();
  const { callLogs, loading: logsLoading } = useCallLogs();
  const [playingId, setPlayingId] = useState<string | null>(null);

  const togglePlay = (id: string, url: string) => {
    const existing = document.getElementById(`audio-${id}`) as HTMLAudioElement | null;
    if (existing) {
      if (playingId === id) { existing.pause(); setPlayingId(null); }
      else { existing.play(); setPlayingId(id); }
      return;
    }
    const audio = new Audio(url);
    audio.id = `audio-${id}`;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    audio.play();
    setPlayingId(id);
    audio.onended = () => { setPlayingId(null); audio.remove(); };
  };

  const topCustomers = [...customers].sort((a, b) => Number(b.priority_score) - Number(a.priority_score)).slice(0, 5);
  const recentCalls = callLogs.slice(0, 5);
  const completedCalls = callLogs.filter(c => c.status === 'completed').length;
  const ptpSecured = callLogs.filter(c => c.ptp_date).length;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Voice Agent Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Collection calls automation — 1-30 DPD accounts</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="Total Accounts" value={customers.length} subtitle="Active in queue" icon={<Users className="w-5 h-5" />} variant="primary" />
          <StatsCard title="Calls Today" value={callLogs.length} subtitle={`${completedCalls} completed`} icon={<Phone className="w-5 h-5" />} trend={{ value: 12, positive: true }} variant="success" />
          <StatsCard title="PTP Secured" value={ptpSecured} subtitle="Promise to Pay" icon={<CheckCircle className="w-5 h-5" />} variant="success" />
          <StatsCard title="Broken Promises" value={customers.filter(c => c.ptp_status === 'broken').length} subtitle="Require follow-up" icon={<AlertTriangle className="w-5 h-5" />} variant="destructive" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card rounded-lg border border-border">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-card-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" /> Priority Queue
              </h2>
              <span className="text-xs text-muted-foreground">Score = (Follow-up×10) + (Balance×5) + (DPD×3)</span>
            </div>
            <div className="divide-y divide-border">
              {custLoading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
              ) : topCustomers.map(customer => (
                <div key={customer.id} className="px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-card-foreground">{customer.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">PKR {Number(customer.balance).toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">{customer.dpd} DPD</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ToneBadge tone={customer.assigned_tone as ToneMode} />
                    <PriorityBadge score={Number(customer.priority_score)} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card rounded-lg border border-border">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold text-card-foreground flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" /> Recent Calls
              </h2>
            </div>
            <div className="divide-y divide-border">
              {logsLoading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
              ) : recentCalls.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No calls yet</div>
              ) : recentCalls.map(call => (
                <div key={call.id} className="px-5 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm text-card-foreground">{call.customer_name}</p>
                      <p className={`text-xs mt-0.5 ${getOutcomeDisplay(call.outcome).color}`}>{getOutcomeDisplay(call.outcome).icon} {getOutcomeDisplay(call.outcome).label}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {call.recording_url && (
                        <button
                          onClick={() => togglePlay(call.id, call.recording_url!)}
                          className="p-1 rounded hover:bg-muted transition-colors"
                          title="Play recording"
                        >
                          {playingId === call.id
                            ? <Pause className="w-3.5 h-3.5 text-primary" />
                            : <Play className="w-3.5 h-3.5 text-primary" />
                          }
                        </button>
                      )}
                      <CallStatusBadge status={call.status as CallStatus} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <AgentBadge agent={call.agent_type as AgentType} />
                    <ToneBadge tone={call.tone as ToneMode} />
                    {call.duration > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {Math.floor(call.duration / 60)}:{(call.duration % 60).toString().padStart(2, '0')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold text-card-foreground">Agent Types Overview</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-5">
            {(Object.entries(AGENT_LABELS) as [string, string][]).map(([key, label]) => {
              const count = customers.filter(c => c.assigned_agent === key).length;
              return (
                <div key={key} className="bg-muted rounded-md p-3 text-center">
                  <p className="text-lg font-bold text-foreground">{count}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
