import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  FileText, Download, Play, Pause, MessageSquare, Search,
  PhoneCall, PhoneOff, Clock, TrendingUp, Calendar, ChevronDown,
  ChevronUp, ExternalLink, Volume2, Eye, BarChart3, Phone, Timer,
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { CallStatusBadge, ToneBadge, AgentBadge } from '@/components/dashboard/StatusBadge';
import { useCallLogs } from '@/hooks/useCallLogs';
import { invokeFunction } from '@/services/db';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AgentType, ToneMode, CallStatus, AGENT_LABELS, TONE_LABELS, getOutcomeDisplay } from '@/types/voice-agent';
import type { DbCallLog } from '@/hooks/useCallLogs';
import { isRecordingPredictionPending, sanitizeDisplayText } from '@/lib/utils';

function formatDuration(seconds: number) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatAudioTime(seconds: number) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getOutcomeIcon(outcome: string | null) {
  const display = getOutcomeDisplay(outcome);
  if (!outcome) return <Clock className="w-4 h-4 text-muted-foreground" />;
  if (display.color.includes('green')) return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  if (display.color.includes('red')) return <XCircle className="w-4 h-4 text-destructive" />;
  if (display.color.includes('yellow') || display.color.includes('orange')) return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
  return <Phone className="w-4 h-4 text-primary" />;
}

// ═══ Inline Audio Player with Play/Pause, Seekbar, Time ═══
function AudioPlayer({ src, compact = false }: { src: string; compact?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onDur = () => { setDuration(audio.duration); setLoading(false); };
    const onEnd = () => { setPlaying(false); setCurrentTime(0); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWait = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onDur);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWait);
    audio.addEventListener('canplay', onCanPlay);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onDur);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWait);
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause(); else audio.play().catch(() => {});
  }, [playing]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * duration;
  }, [duration]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        <audio ref={audioRef} src={src} preload="metadata" />
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={toggle}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> :
           playing ? <Pause className="w-3.5 h-3.5 text-destructive" /> : <Play className="w-3.5 h-3.5 text-primary" />}
        </Button>
        <div className="w-16 h-1.5 bg-muted rounded-full cursor-pointer overflow-hidden" onClick={seek}>
          <div className="h-full bg-primary rounded-full transition-all duration-150" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-[10px] text-muted-foreground font-mono w-8 shrink-0">{formatAudioTime(currentTime)}</span>
      </div>
    );
  }

  return (
    <div className="w-full space-y-2" onClick={e => e.stopPropagation()}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="flex items-center gap-3">
        <Button size="sm" variant={playing ? 'destructive' : 'default'} className="gap-1.5 shrink-0" onClick={toggle}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> :
           playing ? <><Pause className="w-4 h-4" /> Pause</> : <><Play className="w-4 h-4" /> Play</>}
        </Button>
        <span className="text-xs text-muted-foreground font-mono w-10 text-right shrink-0">{formatAudioTime(currentTime)}</span>
        <div className="flex-1 h-2 bg-muted rounded-full cursor-pointer overflow-hidden group" onClick={seek}>
          <div className="h-full bg-primary rounded-full transition-all duration-150 group-hover:bg-primary/80" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs text-muted-foreground font-mono w-10 shrink-0">{formatAudioTime(duration)}</span>
      </div>
    </div>
  );
}

export default function CallLogs() {
  const { callLogs, loading, refetch } = useCallLogs();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [toneFilter, setToneFilter] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<'date' | 'duration' | 'name'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedCall, setSelectedCall] = useState<DbCallLog | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [redownloadBusy, setRedownloadBusy] = useState<Record<string, boolean>>({});
  const [transcriptBusy, setTranscriptBusy] = useState<Record<string, boolean>>({});

  const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');

  const getRecordingUrl = (url: string) => {
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl) return '';
    if (cleanUrl.startsWith('http')) return cleanUrl;
    return `${API_BASE}${cleanUrl}`;
  };

  const normalizeRecordingUrl = useCallback((url?: string | null) => {
    const value = String(url || '').trim();
    if (!value) return '';
    const lower = value.toLowerCase();
    if (['null', 'undefined', 'unavailable', 'n/a', 'na', 'none'].includes(lower)) return '';
    return value;
  }, []);

  const hasPlayableRecording = useCallback((call: DbCallLog) => {
    return !!normalizeRecordingUrl(call.recording_url);
  }, [normalizeRecordingUrl]);

  const getPlayableRecordingUrl = useCallback((call: DbCallLog) => {
    const normalized = normalizeRecordingUrl(call.recording_url);
    if (!normalized) return '';
    return getRecordingUrl(normalized);
  }, [normalizeRecordingUrl]);

  const RECORDING_PENDING_WINDOW_MS = 8 * 60 * 60 * 1000;

  const getCallTimestampMs = useCallback((call: DbCallLog) => {
    const raw = call.call_date_time || call.created_at;
    const rawText = String(raw || '').trim();
    if (!rawText) return null;

    // SQLite datetime('now') returns naive UTC like "YYYY-MM-DD HH:mm:ss".
    // Interpret that shape as UTC so recent calls don't appear several hours old.
    let parsed = Date.parse(rawText);
    if (!Number.isFinite(parsed) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawText)) {
      parsed = Date.parse(rawText.replace(' ', 'T') + 'Z');
    }

    // Some browsers parse the sqlite shape loosely; normalize explicitly when needed.
    if (!Number.isFinite(parsed) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(rawText)) {
      parsed = Date.parse(rawText + 'Z');
    }

    const ts = parsed;
    return Number.isFinite(ts) ? ts : null;
  }, []);

  const isRecordingPending = useCallback((call: DbCallLog) => {
    const status = String(call.status || '').toLowerCase();
    const terminalWithoutRecording = new Set(['no_answer', 'no-answer', 'busy', 'failed', 'canceled', 'cancelled']);
    if (hasPlayableRecording(call) || terminalWithoutRecording.has(status)) return false;

    const callTs = getCallTimestampMs(call);
    if (callTs === null) return true;

    const callAgeMs = Date.now() - callTs;
    return callAgeMs < RECORDING_PENDING_WINDOW_MS;
  }, [getCallTimestampMs, hasPlayableRecording]);

  const isRecordingUnavailable = useCallback((call: DbCallLog) => {
    const status = String(call.status || '').toLowerCase();
    const terminalWithoutRecording = new Set(['no_answer', 'no-answer', 'busy', 'failed', 'canceled', 'cancelled']);
    if (hasPlayableRecording(call) || terminalWithoutRecording.has(status)) return false;

    const callTs = getCallTimestampMs(call);
    if (callTs === null) return false;

    const callAgeMs = Date.now() - callTs;
    return callAgeMs >= RECORDING_PENDING_WINDOW_MS;
  }, [getCallTimestampMs, hasPlayableRecording]);

  // Stats
  const stats = useMemo(() => {
    const total = callLogs.length;
    const completed = callLogs.filter(c => c.status === 'completed').length;
    const avgDuration = total > 0 ? Math.round(callLogs.reduce((s, c) => s + (c.duration || 0), 0) / Math.max(completed, 1)) : 0;
    const today = new Date().toDateString();
    const todayCalls = callLogs.filter(c => new Date(c.call_date_time).toDateString() === today).length;
    const withPtp = callLogs.filter(c => c.ptp_date).length;
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, avgDuration, todayCalls, withPtp, successRate };
  }, [callLogs]);

  // Filter & sort
  const filtered = useMemo(() => {
    let list = [...callLogs];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.customer_name.toLowerCase().includes(q) ||
        c.outcome?.toLowerCase().includes(q) ||
        c.notes?.toLowerCase().includes(q) ||
        c.agent_type.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter);
    if (toneFilter !== 'all') list = list.filter(c => c.tone === toneFilter);
    if (outcomeFilter !== 'all') list = list.filter(c => c.outcome === outcomeFilter);

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = new Date(a.call_date_time).getTime() - new Date(b.call_date_time).getTime();
      else if (sortField === 'duration') cmp = (a.duration || 0) - (b.duration || 0);
      else cmp = a.customer_name.localeCompare(b.customer_name);
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [callLogs, search, statusFilter, toneFilter, outcomeFilter, sortField, sortDir]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const redownloadFromTwilio = useCallback(async (call: DbCallLog) => {
    if (!call?.id || redownloadBusy[call.id]) return;
    setRedownloadBusy(prev => ({ ...prev, [call.id]: true }));
    try {
      const { data, error } = await invokeFunction('fetch-recording', {
        callLogId: call.id,
        customerId: call.customer_id,
        callDateTime: call.call_date_time,
        force: true,
      });

      if (error || !data?.success) {
        const msg = error?.message || data?.error || data?.message || 'Recording not available yet in Twilio logs';
        toast({ title: 'Re-download failed', description: msg, variant: 'destructive' });
        return;
      }

      if (data?.url) {
        setSelectedCall(prev => {
          if (!prev || prev.id !== call.id) return prev;
          return {
            ...prev,
            recording_url: data.url,
            transcript: data.transcript || prev.transcript,
          };
        });
      }

      toast({ title: 'Recording downloaded', description: 'Recording fetched from Twilio logs successfully.' });
      await refetch();
    } finally {
      setRedownloadBusy(prev => ({ ...prev, [call.id]: false }));
    }
  }, [redownloadBusy, refetch, toast]);

  const generateTranscriptFromRecording = useCallback(async (call: DbCallLog) => {
    if (!call?.id || !hasPlayableRecording(call) || transcriptBusy[call.id]) return;
    setTranscriptBusy(prev => ({ ...prev, [call.id]: true }));
    try {
      const { data, error } = await invokeFunction('fetch-recording', {
        callLogId: call.id,
        customerId: call.customer_id,
        callDateTime: call.call_date_time,
        force: true,
      });

      if (error || !data?.success) {
        const msg = error?.message || data?.error || data?.message || 'Transcript generation failed';
        toast({ title: 'Transcript failed', description: msg, variant: 'destructive' });
        return;
      }

      if (data?.transcript) {
        toast({ title: 'Transcript generated', description: 'Transcript was generated from recording audio.' });
      } else {
        toast({ title: 'Transcript pending', description: 'Recording exists but transcript is not ready yet.' });
      }

      await refetch();
    } finally {
      setTranscriptBusy(prev => ({ ...prev, [call.id]: false }));
    }
  }, [hasPlayableRecording, refetch, toast, transcriptBusy]);

  // While recordings are pending, keep refreshing so audio appears automatically when callback lands.
  useEffect(() => {
    if (callLogs.length === 0) return;
    const hasPendingRecordings = callLogs.some(isRecordingPending);
    if (!hasPendingRecordings) return;

    const timer = setInterval(() => {
      void refetch();
    }, 12000);

    return () => clearInterval(timer);
  }, [callLogs, isRecordingPending, refetch]);

  useEffect(() => {
    if (!selectedCall) return;
    const latest = callLogs.find(c => c.id === selectedCall.id);
    if (!latest) return;
    setSelectedCall(prev => {
      if (!prev || prev.id !== latest.id) return prev;
      if (
        prev.recording_url === latest.recording_url &&
        prev.transcript === latest.transcript &&
        prev.status === latest.status &&
        prev.outcome === latest.outcome
      ) {
        return prev;
      }
      return { ...prev, ...latest };
    });
  }, [callLogs, selectedCall]);

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />;
  };

  const exportCSV = () => {
    const headers = ['Call_ID', 'Customer_Name', 'Call_DateTime', 'Call_Duration_Sec', 'Status', 'Agent_Type', 'Tone', 'Outcome', 'PTP_Date', 'PTP_Status', 'Notes', 'Recording_URL', 'Transcript'];
    const rows = filtered.map(c => [
      c.id, c.customer_name, c.call_date_time, c.duration, c.status, c.agent_type, c.tone,
      c.outcome || '', c.ptp_date || '', c.outcome === 'ptp_secured' ? 'pending' : '', 
      c.notes || '', c.recording_url || '', c.transcript ? c.transcript.substring(0, 500) : ''
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `call-logs-export-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportXLSX = () => {
    // Generate a comprehensive POC report as CSV with all required fields
    const headers = ['Call_ID', 'Customer_Name', 'Call_DateTime', 'Call_Duration_Sec', 'Call_Duration_Formatted', 'Status', 'Agent_Type', 'Tone', 'Outcome', 'Interaction_Type', 'PTP_Date', 'Notes', 'Recording_Available', 'Recording_URL'];
    const rows = filtered.map(c => {
      // Map outcome to interaction type for audit
      const interactionType = c.outcome === 'ptp_secured' ? 'PTP Secured' 
        : c.outcome === 'callback_requested' ? 'Callback Requested'
        : c.outcome === 'no_answer' ? 'No Answer'
        : c.outcome === 'non_customer_pickup' ? 'Non-Customer Pickup'
        : c.outcome === 'refused' ? 'Refused'
        : c.outcome === 'negotiation_barrier' ? 'Negotiation Barrier'
        : c.outcome === 'payment_done' ? 'Payment Done'
        : c.outcome === 'busy' ? 'Busy'
        : c.outcome === 'switched_off' ? 'Switched Off'
        : c.outcome === 'abuse_detected' ? 'Abuse Detected'
        : c.outcome || 'Unknown';
      return [
        c.id, c.customer_name, c.call_date_time, c.duration, formatDuration(c.duration),
        c.status, c.agent_type, c.tone, c.outcome || '', interactionType,
        c.ptp_date || '', c.notes || '', c.recording_url ? 'Yes' : 'No', c.recording_url || ''
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `POC-Call-Report-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
                <FileText className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground tracking-tight">Call Logs</h1>
                <p className="text-sm text-muted-foreground">{callLogs.length} total calls · {stats.todayCalls} today</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={refetch} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
              <Button variant="default" size="sm" onClick={exportXLSX} className="gap-1.5">
                <FileText className="w-3.5 h-3.5" /> POC Report
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {/* Stats Cards */}
          <div className="px-6 pt-5 pb-2">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {[
                { label: 'Total Calls', value: stats.total, icon: PhoneCall, color: 'text-primary', bg: 'bg-primary/10' },
                { label: 'Completed', value: stats.completed, icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10' },
                { label: 'Today', value: stats.todayCalls, icon: Calendar, color: 'text-blue-500', bg: 'bg-blue-500/10' },
                { label: 'Avg Duration', value: formatDuration(stats.avgDuration), icon: Timer, color: 'text-amber-500', bg: 'bg-amber-500/10' },
                { label: 'PTP Collected', value: stats.withPtp, icon: TrendingUp, color: 'text-purple-500', bg: 'bg-purple-500/10' },
                { label: 'Success Rate', value: `${stats.successRate}%`, icon: BarChart3, color: 'text-green-500', bg: 'bg-green-500/10' },
              ].map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="rounded-xl border border-border bg-card p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center`}>
                        <Icon className={`w-4 h-4 ${stat.color}`} />
                      </div>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{stat.label}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Search & Filters */}
          <div className="px-6 py-3 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search customer, outcome, notes..."
                value={search} onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:ring-2 focus:ring-primary focus:outline-none">
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="no_answer">No Answer</option>
              <option value="in_progress">In Progress</option>
              <option value="queued">Queued</option>
            </select>
            <select value={toneFilter} onChange={e => setToneFilter(e.target.value)}
              className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:ring-2 focus:ring-primary focus:outline-none">
              <option value="all">All Tones</option>
              <option value="polite">Polite</option>
              <option value="assertive">Assertive</option>
              <option value="empathetic">Empathetic</option>
            </select>
            <select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)}
              className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:ring-2 focus:ring-primary focus:outline-none">
              <option value="all">All Outcomes</option>
              <option value="ptp_secured">✅ PTP Secured</option>
              <option value="callback_requested">📞 Callback</option>
              <option value="no_answer">📵 No Answer</option>
              <option value="non_customer_pickup">👤 Non-Customer</option>
              <option value="refused">❌ Refused</option>
              <option value="negotiation_barrier">⚠️ Negotiation</option>
              <option value="payment_done">💳 Payment Done</option>
              <option value="busy">⏳ Busy</option>
              <option value="switched_off">📴 Switched Off</option>
            </select>
            <div className="flex items-center gap-1 ml-auto">
              <Button variant={viewMode === 'table' ? 'secondary' : 'ghost'} size="sm" className="h-8 w-8 p-0" onClick={() => setViewMode('table')}>
                <BarChart3 className="w-4 h-4" />
              </Button>
              <Button variant={viewMode === 'cards' ? 'secondary' : 'ghost'} size="sm" className="h-8 w-8 p-0" onClick={() => setViewMode('cards')}>
                <FileText className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 pb-6">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-border bg-muted/30 p-16 text-center space-y-3">
                <PhoneOff className="w-16 h-16 text-muted-foreground/30 mx-auto" />
                <h3 className="text-lg font-bold text-muted-foreground">No Call Logs Found</h3>
                <p className="text-sm text-muted-foreground">
                  {callLogs.length === 0 ? 'Start making calls from the Call Center to see logs here.' : 'Try adjusting your filters or search.'}
                </p>
              </div>
            ) : viewMode === 'table' ? (
              /* ═══ TABLE VIEW ═══ */
              <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                          onClick={() => toggleSort('name')}>
                          <span className="flex items-center gap-1">Customer <SortIcon field="name" /></span>
                        </th>
                        <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                          onClick={() => toggleSort('date')}>
                          <span className="flex items-center gap-1">Date/Time <SortIcon field="date" /></span>
                        </th>
                        <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                          onClick={() => toggleSort('duration')}>
                          <span className="flex items-center gap-1">Duration <SortIcon field="duration" /></span>
                        </th>
                        <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                        <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Agent / Tone</th>
                        <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Outcome</th>
                        <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Recording</th>
                        <th className="text-right px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filtered.map(call => (
                        <tr key={call.id} className="hover:bg-muted/20 transition-colors group cursor-pointer" onClick={() => setSelectedCall(call)}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              {getOutcomeIcon(call.outcome)}
                              <div>
                                <p className="text-sm font-semibold text-foreground">{call.customer_name}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">{call.customer_id?.slice(0, 8) || '—'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm text-foreground">{new Date(call.call_date_time).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })}</p>
                            <p className="text-[10px] text-muted-foreground">{new Date(call.call_date_time).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} · {timeAgo(call.call_date_time)}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-mono font-semibold text-foreground">{formatDuration(call.duration)}</span>
                          </td>
                          <td className="px-4 py-3"><CallStatusBadge status={call.status as CallStatus} /></td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <AgentBadge agent={call.agent_type as AgentType} />
                              <ToneBadge tone={call.tone as ToneMode} />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <p className={`text-sm max-w-[200px] truncate ${getOutcomeDisplay(call.outcome).color}`}>{getOutcomeDisplay(call.outcome).icon} {getOutcomeDisplay(call.outcome).label}</p>
                            {isRecordingPredictionPending(call.notes) && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1.5">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Recording analysis pending...
                              </p>
                            )}
                            {call.ptp_date && (
                              <p className="text-[10px] text-primary mt-0.5">PTP: {new Date(call.ptp_date).toLocaleDateString()}</p>
                            )}
                          </td>
                          {/* Recording inline player */}
                          <td className="px-4 py-3">
                            {hasPlayableRecording(call) ? (
                              <AudioPlayer src={getPlayableRecordingUrl(call)} compact />
                            ) : isRecordingPending(call) ? (
                              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1.5">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Processing...
                              </span>
                            ) : isRecordingUnavailable(call) ? (
                              <div className="inline-flex items-center gap-1.5">
                                <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1.5">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Processing...
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[10px]"
                                  onClick={() => redownloadFromTwilio(call)}
                                  disabled={!!redownloadBusy[call.id]}
                                >
                                  {redownloadBusy[call.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                  Re-download
                                </Button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                              {hasPlayableRecording(call) && (
                                <a href={getPlayableRecordingUrl(call)} download
                                  className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition-colors">
                                  <Download className="w-3.5 h-3.5 text-primary" />
                                </a>
                              )}
                              {call.transcript && (
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                                  onClick={() => setSelectedCall(call)}>
                                  <MessageSquare className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {hasPlayableRecording(call) && !call.transcript && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => generateTranscriptFromRecording(call)}
                                  disabled={!!transcriptBusy[call.id]}
                                >
                                  {transcriptBusy[call.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5 text-primary" />}
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                                onClick={() => setSelectedCall(call)}>
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Showing {filtered.length} of {callLogs.length} calls</p>
                  <p className="text-xs text-muted-foreground">Click any row for full details</p>
                </div>
              </div>
            ) : (
              /* ═══ CARD VIEW ═══ */
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map(call => (
                  <div key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className="rounded-xl border border-border bg-card p-5 hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer group">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        {getOutcomeIcon(call.outcome)}
                        <div>
                          <p className="font-bold text-foreground text-sm">{call.customer_name}</p>
                          <p className="text-[10px] text-muted-foreground">{timeAgo(call.call_date_time)}</p>
                        </div>
                      </div>
                      <CallStatusBadge status={call.status as CallStatus} />
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div className="text-center bg-muted/50 rounded-lg py-2">
                        <p className="text-xs font-bold text-foreground font-mono">{formatDuration(call.duration)}</p>
                        <p className="text-[9px] text-muted-foreground">Duration</p>
                      </div>
                      <div className="text-center bg-muted/50 rounded-lg py-2">
                        <AgentBadge agent={call.agent_type as AgentType} />
                      </div>
                      <div className="text-center bg-muted/50 rounded-lg py-2">
                        <ToneBadge tone={call.tone as ToneMode} />
                      </div>
                    </div>

                    {call.outcome && (
                      <p className={`text-xs mb-2 line-clamp-2 ${getOutcomeDisplay(call.outcome).color}`}>{getOutcomeDisplay(call.outcome).icon} {getOutcomeDisplay(call.outcome).label}</p>
                    )}
                    {isRecordingPredictionPending(call.notes) && (
                      <p className="text-[10px] text-muted-foreground mb-2 inline-flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Recording analysis pending...
                      </p>
                    )}
                    {call.notes && (
                      <p className="text-[10px] text-muted-foreground/70 line-clamp-1 italic">📝 {sanitizeDisplayText(call.notes)}</p>
                    )}

                    {/* Recording player in card */}
                    {hasPlayableRecording(call) && (
                      <div className="mt-3 pt-3 border-t border-border" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <Volume2 className="w-3 h-3 text-primary" />
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Recording</span>
                        </div>
                        <AudioPlayer src={getPlayableRecordingUrl(call)} compact />
                      </div>
                    )}

                    {!hasPlayableRecording(call) && isRecordingPending(call) && (
                      <div className="mt-3 pt-3 border-t border-border" onClick={e => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Recording is still processing...
                        </div>
                      </div>
                    )}

                    {!hasPlayableRecording(call) && isRecordingUnavailable(call) && (
                      <div className="mt-3 pt-3 border-t border-border" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Recording is still processing...
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px]"
                            onClick={() => redownloadFromTwilio(call)}
                            disabled={!!redownloadBusy[call.id]}
                          >
                            {redownloadBusy[call.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            Re-download
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(call.call_date_time).toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        {hasPlayableRecording(call) && (
                          <a href={getPlayableRecordingUrl(call)} download
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition-colors">
                            <Download className="w-3.5 h-3.5 text-primary" />
                          </a>
                        )}
                        {call.transcript && <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Call Detail Dialog ═══ */}
      <Dialog open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-auto">
          {selectedCall && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  {getOutcomeIcon(selectedCall.outcome)}
                  <span>{selectedCall.customer_name}</span>
                  <CallStatusBadge status={selectedCall.status as CallStatus} />
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-5 mt-2">
                {/* Quick Info Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Date', value: new Date(selectedCall.call_date_time).toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
                    { label: 'Duration', value: formatDuration(selectedCall.duration) },
                    { label: 'Agent', value: AGENT_LABELS[selectedCall.agent_type as AgentType] || selectedCall.agent_type },
                    { label: 'Tone', value: TONE_LABELS[selectedCall.tone as ToneMode] || selectedCall.tone },
                  ].map(item => (
                    <div key={item.label} className="rounded-lg bg-muted/50 border border-border p-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                      <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
                    </div>
                  ))}
                </div>

                {/* Outcome */}
                {selectedCall.outcome && (
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Outcome / Reason</p>
                    <p className={`text-sm font-semibold ${getOutcomeDisplay(selectedCall.outcome).color}`}>{getOutcomeDisplay(selectedCall.outcome).icon} {getOutcomeDisplay(selectedCall.outcome).label}</p>
                  </div>
                )}

                {/* PTP Date */}
                {selectedCall.ptp_date && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                    <p className="text-[10px] text-primary uppercase tracking-wider mb-1">Promise to Pay</p>
                    <p className="text-sm font-semibold text-foreground">{new Date(selectedCall.ptp_date).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                  </div>
                )}

                {/* Notes */}
                {selectedCall.notes && (
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Agent Notes</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{sanitizeDisplayText(selectedCall.notes)}</p>
                  </div>
                )}

                {/* Recording — Full Player */}
                {hasPlayableRecording(selectedCall) && (
                  <div className="rounded-lg border border-border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-4 h-4 text-primary" />
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Recording</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <a href={getPlayableRecordingUrl(selectedCall)} download
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20">
                          <Download className="w-3.5 h-3.5" /> Download
                        </a>
                        <a href={getPlayableRecordingUrl(selectedCall)} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> Open
                        </a>
                      </div>
                    </div>
                    <AudioPlayer src={getPlayableRecordingUrl(selectedCall)} />
                  </div>
                )}

                {!hasPlayableRecording(selectedCall) && isRecordingPending(selectedCall) && (
                  <div className="rounded-lg border border-border p-4">
                    <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Recording is still processing and will appear soon.
                    </div>
                  </div>
                )}

                {!hasPlayableRecording(selectedCall) && isRecordingUnavailable(selectedCall) && (
                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Recording is still processing and may appear shortly.
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => redownloadFromTwilio(selectedCall)}
                        disabled={!!redownloadBusy[selectedCall.id]}
                      >
                        {redownloadBusy[selectedCall.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        Re-download from Twilio
                      </Button>
                    </div>
                  </div>
                )}

                {hasPlayableRecording(selectedCall) && !selectedCall.transcript && (
                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <MessageSquare className="w-4 h-4 text-primary" />
                        Transcript is not available yet for this recording.
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => generateTranscriptFromRecording(selectedCall)}
                        disabled={!!transcriptBusy[selectedCall.id]}
                      >
                        {transcriptBusy[selectedCall.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                        Generate Transcript
                      </Button>
                    </div>
                  </div>
                )}

                {/* Transcript */}
                {selectedCall.transcript && (
                  <div className="rounded-lg border border-border overflow-hidden">
                    <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Transcript</p>
                    </div>
                    <div className="p-4 max-h-[300px] overflow-auto">
                      <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                        {selectedCall.transcript}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Meta */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-border">
                  <span>ID: {selectedCall.id.slice(0, 12)}...</span>
                  <span>Customer: {selectedCall.customer_id?.slice(0, 12) || '—'}</span>
                  <span>Created: {new Date(selectedCall.created_at).toLocaleString()}</span>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
