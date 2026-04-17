import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Zap, Mic2, Brain, Timer, Save, RotateCcw, CheckCircle2, PhoneCall, FlaskConical, Laptop, RefreshCw, Phone, Loader2, Wifi, WifiOff, Activity, Server, AlertTriangle, Shield, Play, Square as StopIcon, Volume2, FileText, MessageSquare } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { AGENT_LABELS, AGENT_DESCRIPTIONS, TONE_LABELS, AgentType, ToneMode } from '@/types/voice-agent';
import {
  VOICE_CALLERS, VoiceCaller, AgentSettings as SettingsType, AutoDialMode,
  DEFAULT_SETTINGS, DEFAULT_GEMINI_PROMPT, COUNTRIES,
  loadSettings, saveSettings,
} from '@/config/agent-settings';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { withAuthHeaders } from '@/lib/auth';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');

type HealthState = {
  status: string;
  liveModeReady: boolean;
  gemini: { configured: boolean; ready: boolean; mode: string; message: string; model?: string };
  twilio: { configured: boolean; ready: boolean; mode: string; message: string; phoneConfigured: boolean; serverUrlConfigured: boolean };
  scheduler: { enabled: boolean; overdueRetries: number; upcomingRetries: number; ptpReminders: number };
  logging: { ready: boolean; file: string };
  database: { ready: boolean; path: string; type: string };
  timestamp: string;
};

export default function AgentSettings() {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<HealthState | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [demoPhone, setDemoPhone] = useState('');
  const [demoCountry, setDemoCountry] = useState(COUNTRIES[0]);
  const [demoCalling, setDemoCalling] = useState(false);
  const [demoResult, setDemoResult] = useState<{ success: boolean; message: string } | null>(null);
  const [demoLiveStatus, setDemoLiveStatus] = useState<string[]>([]);
  const [demoCallActive, setDemoCallActive] = useState(false);
  const demoWsRef = useRef<WebSocket | null>(null);
  const [activeTab, setActiveTab] = useState('health');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voiceLoading, setVoiceLoading] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  // Voice preview — use Gemini TTS via local Express server
  const stopVoicePreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setPlayingVoiceId(null);
    setVoiceLoading(null);
  }, []);

  const playVoicePreview = useCallback(async (callerId: string, callerGender: 'female' | 'male', callerVoice: string) => {
    if (playingVoiceId === callerId) { stopVoicePreview(); return; }
    stopVoicePreview();

    const sampleText = VOICE_SAMPLES[callerId] || 'Assalam o Alaikum. Main bank se bol rahi hoon. Kaise hain aap?';
    setVoiceLoading(callerId);

    try {
      const res = await fetch(`${API_BASE}/api/voice-preview`, withAuthHeaders({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: callerVoice, text: sampleText })
      }));

      let data: any;
      try { data = await res.json(); } catch { throw new Error('Server returned invalid response'); }
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (!data?.audio) throw new Error('No audio returned');

      // Convert base64 to audio blob and play
      const mimeType = data.mimeType || 'audio/mp3';
      const byteChars = atob(data.audio);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArray], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingVoiceId(callerId);
      setVoiceLoading(null);

      audio.onended = () => { stopVoicePreview(); URL.revokeObjectURL(url); };
      audio.onerror = () => { stopVoicePreview(); URL.revokeObjectURL(url); };

      setTimeout(() => {
        if (audioRef.current === audio) stopVoicePreview();
      }, 25000);

      await audio.play();
    } catch (err: any) {
      setVoiceLoading(null);
      setPlayingVoiceId(null);
      console.error('Voice preview error:', err);
      toast({ title: 'Voice preview failed', description: err.message, variant: 'destructive' });
    }
  }, [playingVoiceId, stopVoicePreview, toast]);

  // Stop preview when switching tabs
  useEffect(() => { if (activeTab !== 'voice') stopVoicePreview(); }, [activeTab, stopVoicePreview]);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${API_BASE}/api/health`, withAuthHeaders({ signal: controller.signal }));
      clearTimeout(timeout);
      let data: any;
      try { data = await res.json(); } catch { throw new Error('Server returned invalid response'); }
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setHealth(data);
    } catch (err: any) {
      const msg = err.name === 'AbortError' ? 'Server not reachable (timeout)' : err.message?.includes('Failed to fetch') ? 'Server offline — start your Express server on port 3001' : err.message;
      setHealthError(msg);
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    setSettings(loadSettings());
    void loadHealth();
  }, [loadHealth]);

  const handleSave = async () => {
    saveSettings(settings);
    setSaved(true);
    toast({ title: '✅ Settings saved successfully!' });
    setTimeout(() => setSaved(false), 2000);

    // Sync scheduler config to server
    try {
      await fetch(`${API_BASE}/api/scheduler/config`, withAuthHeaders({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxConcurrentCalls: settings.maxConcurrentCalls,
          interCallDelaySec: settings.interCallDelaySec,
          schedulerPollMinutes: settings.schedulerPollMinutes,
          autoDialBatchSize: settings.autoDialBatchSize,
          retryNoAnswerHours: settings.retryNoAnswerHours,
          retryNonCustomerHours: settings.retryNonCustomerHours,
          retryCallbackHours: settings.retryNoAnswerHours,  // callbacks use same delay as no-answer
          retryRefusedHours: settings.retryNonCustomerHours * 5,  // refused = 5× non-customer delay
        }),
      }));
    } catch {}
  };

  const handleReset = () => {
    setSettings({ ...DEFAULT_SETTINGS });
    saveSettings(DEFAULT_SETTINGS);
    toast({ title: 'Settings reset to defaults' });
  };

  const selectedCaller = VOICE_CALLERS.find(c => c.id === settings.selectedCallerId) || VOICE_CALLERS[0];

  const healthCards = health ? [
    {
      key: 'gemini', title: 'Gemini AI', icon: Brain,
      ready: health.gemini.ready, configured: health.gemini.configured,
      summary: health.gemini.ready ? '✅ Connected & Ready' : health.gemini.configured ? '⚠️ Config found, check failed' : '❌ Not Configured',
      detail: health.gemini.message,
      model: health.gemini.model,
    },
    {
      key: 'twilio', title: 'Telephony', icon: PhoneCall,
      ready: health.twilio.ready, configured: health.twilio.configured,
      summary: health.twilio.ready ? '✅ Connected & Ready' : health.twilio.configured ? '⚠️ Needs attention' : '❌ Not Configured',
      detail: health.twilio.message,
      extra: health.twilio.phoneConfigured ? 'Phone ✅' : 'Phone ❌',
    },
    {
      key: 'scheduler', title: 'Auto-Scheduler', icon: Timer,
      ready: health.scheduler.enabled, configured: true,
      summary: health.scheduler.enabled ? '✅ Running' : '⏸ Stopped',
      detail: `${health.scheduler.overdueRetries} overdue · ${health.scheduler.upcomingRetries} upcoming · ${health.scheduler.ptpReminders} PTP`,
    },
    {
      key: 'logging', title: 'File Logging', icon: Activity,
      ready: health.logging.ready, configured: true,
      summary: health.logging.ready ? '✅ Active' : '❌ Not writing',
      detail: health.logging.file,
    },
  ] : [];

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
                <Settings className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground tracking-tight">Agent Settings</h1>
                <p className="text-sm text-muted-foreground">Configure voice personas, AI behavior, call rules & system health</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Server Status Pill */}
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
                health ? 'border-success/30 bg-success/10 text-success' : healthError ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-border bg-muted text-muted-foreground'
              }`}>
                {health ? <Wifi className="w-3 h-3" /> : healthError ? <WifiOff className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
                {health ? 'Server Online' : healthError ? 'Server Offline' : 'Checking...'}
              </div>
              <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </Button>
              <Button size="sm" onClick={handleSave} className="gap-1.5 shadow-md shadow-primary/20">
                {saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {saved ? 'Saved!' : 'Save'}
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content — Full Width Scrollable */}
        <div className="flex-1 overflow-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="sticky top-0 z-[5] bg-background/95 backdrop-blur-sm border-b border-border px-6">
              <TabsList className="h-12 bg-transparent gap-1">
                <TabsTrigger value="health" className="gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                  <Activity className="w-4 h-4" /> System Health
                </TabsTrigger>
                <TabsTrigger value="voice" className="gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                  <Mic2 className="w-4 h-4" /> Voice Personas
                </TabsTrigger>
                <TabsTrigger value="demo" className="gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                  <Phone className="w-4 h-4" /> Demo Call
                </TabsTrigger>
                <TabsTrigger value="ai" className="gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                  <Brain className="w-4 h-4" /> AI Config
                </TabsTrigger>
                <TabsTrigger value="dialer" className="gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                  <PhoneCall className="w-4 h-4" /> Auto-Dialer
                </TabsTrigger>
                <TabsTrigger value="rules" className="gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                  <Shield className="w-4 h-4" /> Rules & Agents
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ═══ TAB: System Health ═══ */}
            <TabsContent value="health" className="p-6 space-y-6 mt-0">
              {/* Mode Toggle */}
              <div className={`rounded-xl border-2 transition-all ${
                settings.testingMode
                  ? 'border-warning bg-gradient-to-r from-warning/10 to-warning/5 shadow-lg shadow-warning/10'
                  : 'border-success/30 bg-gradient-to-r from-success/10 to-success/5'
              }`}>
                <div className="px-6 py-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      settings.testingMode ? 'bg-warning/20' : 'bg-success/20'
                    }`}>
                      {settings.testingMode ? <Laptop className="w-6 h-6 text-warning" /> : <PhoneCall className="w-6 h-6 text-success" />}
                    </div>
                    <div>
                      <h2 className="font-bold text-lg text-foreground">
                        {settings.testingMode ? '🧪 Testing Mode' : '🚀 Production Mode'}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {settings.testingMode
                          ? 'Browser mic & speaker — no telephony charges'
                          : 'Live calls to real phone numbers'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                      settings.testingMode ? 'bg-warning/20 text-warning' : 'bg-success/20 text-success'
                    }`}>
                      {settings.testingMode ? 'TESTING' : 'LIVE'}
                    </span>
                    <Switch
                      checked={settings.testingMode}
                      onCheckedChange={(checked) => setSettings(s => ({ ...s, testingMode: checked }))}
                    />
                  </div>
                </div>
              </div>

              {/* Recording Fetch Toggle */}
              <div className={`rounded-xl border-2 transition-all ${
                settings.fetchTwilioRecording
                  ? 'border-primary/30 bg-gradient-to-r from-primary/10 to-primary/5'
                  : 'border-border bg-gradient-to-r from-muted/30 to-transparent'
              }`}>
                <div className="px-6 py-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      settings.fetchTwilioRecording ? 'bg-primary/20' : 'bg-muted'
                    }`}>
                      <Mic2 className={`w-6 h-6 ${settings.fetchTwilioRecording ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <h2 className="font-bold text-lg text-foreground">
                        {settings.fetchTwilioRecording ? '🎙️ Call Recording Enabled' : '🔇 Call Recording Disabled'}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {settings.fetchTwilioRecording
                          ? 'Fetch call recordings from cloud API after each call ends'
                          : 'Local recording only — no cloud recording fetch'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                      settings.fetchTwilioRecording ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {settings.fetchTwilioRecording ? 'ON' : 'OFF'}
                    </span>
                    <Switch
                      checked={settings.fetchTwilioRecording}
                      onCheckedChange={(checked) => setSettings(s => ({ ...s, fetchTwilioRecording: checked }))}
                    />
                  </div>
                </div>
              </div>

              {/* Noise Cancellation Toggle */}
              <div className={`rounded-xl border-2 transition-all ${
                settings.noiseCancellation
                  ? 'border-primary/30 bg-gradient-to-r from-primary/10 to-primary/5'
                  : 'border-border bg-gradient-to-r from-muted/30 to-transparent'
              }`}>
                <div className="px-6 py-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      settings.noiseCancellation ? 'bg-primary/20' : 'bg-muted'
                    }`}>
                      <Volume2 className={`w-6 h-6 ${settings.noiseCancellation ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <h2 className="font-bold text-lg text-foreground">
                        {settings.noiseCancellation ? '🔇 Noise Cancellation Enabled' : '🔊 Noise Cancellation Disabled'}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {settings.noiseCancellation
                          ? 'Filters background noise before sending audio to AI — may reduce sensitivity to soft speech'
                          : 'All customer audio passes through to AI directly — best for clear call quality'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                      settings.noiseCancellation ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {settings.noiseCancellation ? 'ON' : 'OFF'}
                    </span>
                    <Switch
                      checked={settings.noiseCancellation}
                      onCheckedChange={(checked) => setSettings(s => ({ ...s, noiseCancellation: checked }))}
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 text-primary" />
                    <div>
                      <h2 className="font-bold text-foreground">Live System Health</h2>
                      <p className="text-xs text-muted-foreground">
                        Express server at {API_BASE}
                        {health?.timestamp ? ` · Last check: ${new Date(health.timestamp).toLocaleTimeString()}` : ''}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={loadHealth} disabled={healthLoading} className="gap-2">
                    <RefreshCw className={`w-4 h-4 ${healthLoading ? 'animate-spin' : ''}`} />
                    {healthLoading ? 'Checking...' : 'Refresh'}
                  </Button>
                </div>

                <div className="p-6">
                  {healthError ? (
                    <div className="rounded-xl border-2 border-dashed border-destructive/30 bg-destructive/5 p-8 text-center space-y-3">
                      <WifiOff className="w-12 h-12 text-destructive/50 mx-auto" />
                      <h3 className="text-lg font-bold text-destructive">Server Not Connected</h3>
                      <p className="text-sm text-muted-foreground max-w-md mx-auto">{healthError}</p>
                      <div className="bg-muted rounded-lg p-4 text-left text-xs text-muted-foreground max-w-md mx-auto space-y-1">
                        <p className="font-semibold text-foreground">To connect your server:</p>
                        <p>1. Open terminal in <code className="text-primary">server/</code> folder</p>
                        <p>2. Run: <code className="text-primary">npm install && npm start</code></p>
                        <p>3. Ensure server environment is configured</p>
                        <p>4. Click <strong>Refresh</strong> above</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={loadHealth} className="gap-2 mt-2">
                        <RefreshCw className="w-4 h-4" /> Try Again
                      </Button>
                    </div>
                  ) : health ? (
                    <div className="space-y-4">
                      {/* Overall status bar */}
                      <div className={`rounded-lg px-5 py-3 flex items-center justify-between ${
                        health.liveModeReady ? 'bg-success/10 border border-success/20' : 'bg-warning/10 border border-warning/20'
                      }`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${health.liveModeReady ? 'bg-success animate-pulse' : 'bg-warning animate-pulse'}`} />
                          <span className={`font-bold text-sm ${health.liveModeReady ? 'text-success' : 'text-warning'}`}>
                            {health.liveModeReady ? 'All Systems Operational' : 'Some Services Need Attention'}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">DB: {health.database?.type || '—'}</span>
                      </div>

                      {/* Service Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                        {healthCards.map((item) => {
                          const Icon = item.icon;
                          return (
                            <div key={item.key} className={`rounded-xl border-2 p-5 transition-all hover:shadow-md ${
                              item.ready ? 'border-success/20 bg-gradient-to-b from-success/5 to-transparent' : item.configured ? 'border-warning/20 bg-gradient-to-b from-warning/5 to-transparent' : 'border-destructive/20 bg-gradient-to-b from-destructive/5 to-transparent'
                            }`}>
                              <div className="flex items-center justify-between mb-3">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                  item.ready ? 'bg-success/15' : item.configured ? 'bg-warning/15' : 'bg-destructive/15'
                                }`}>
                                  <Icon className={`w-5 h-5 ${
                                    item.ready ? 'text-success' : item.configured ? 'text-warning' : 'text-destructive'
                                  }`} />
                                </div>
                                <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold tracking-wide ${
                                  item.ready ? 'bg-success/15 text-success' : item.configured ? 'bg-warning/15 text-warning' : 'bg-destructive/15 text-destructive'
                                }`}>
                                  {item.ready ? 'READY' : item.configured ? 'CHECK' : 'MISSING'}
                                </span>
                              </div>
                              <h3 className="font-bold text-foreground text-sm">{item.title}</h3>
                              <p className="text-xs text-muted-foreground mt-1">{item.summary}</p>
                              <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">{item.detail}</p>
                              {'model' in item && item.model && (
                                <p className="text-[10px] mt-1 font-mono text-primary">{item.model}</p>
                              )}
                              {'extra' in item && item.extra && (
                                <p className="text-[10px] mt-1 text-muted-foreground">{item.extra}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ═══ TAB: Voice Personas ═══ */}
            <TabsContent value="voice" className="p-6 space-y-6 mt-0">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-foreground">Voice Personas</h2>
                  <p className="text-sm text-muted-foreground">Select who makes the calls — 5 female + 5 male agents with unique Gemini voices</p>
                </div>
                <div className="flex items-center gap-3 bg-muted rounded-xl px-4 py-2.5 border border-border">
                  <img
                    src={selectedCaller.avatar}
                    alt={selectedCaller.name}
                    className="h-10 w-10 rounded-full object-cover border-2 border-primary shadow-md"
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  <div>
                    <p className="text-sm font-bold text-foreground">Active: {selectedCaller.name}</p>
                    <p className="text-[10px] text-muted-foreground">Voice: {selectedCaller.voice} · {selectedCaller.gender}</p>
                  </div>
                </div>
              </div>

              {/* Female Agents */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">♀ Female Agents</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                  {VOICE_CALLERS.filter(c => c.gender === 'female').map(caller => (
                    <CallerCard key={caller.id} caller={caller} selected={settings.selectedCallerId === caller.id}
                      onSelect={() => { stopVoicePreview(); setSettings(s => ({ ...s, selectedCallerId: caller.id })); }}
                      isPlaying={playingVoiceId === caller.id}
                      isLoading={voiceLoading === caller.id}
                      onPlayToggle={() => playVoicePreview(caller.id, caller.gender, caller.voice)} />
                  ))}
                </div>
              </div>

              {/* Male Agents */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">♂ Male Agents</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                  {VOICE_CALLERS.filter(c => c.gender === 'male').map(caller => (
                    <CallerCard key={caller.id} caller={caller} selected={settings.selectedCallerId === caller.id}
                      onSelect={() => { stopVoicePreview(); setSettings(s => ({ ...s, selectedCallerId: caller.id })); }}
                      isPlaying={playingVoiceId === caller.id}
                      isLoading={voiceLoading === caller.id}
                      onPlayToggle={() => playVoicePreview(caller.id, caller.gender, caller.voice)} />
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* ═══ TAB: Demo Call ═══ */}
            <TabsContent value="demo" className="p-6 space-y-6 mt-0">
              <div className="max-w-3xl mx-auto">
                <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-b from-primary/5 to-transparent overflow-hidden">
                  <div className="px-6 py-5 border-b border-border bg-primary/5">
                    <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                      <Phone className="w-5 h-5 text-primary" /> 📞 Demo Test Call
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Live test — system dials your phone, AI agent talks, you verify everything works.
                    </p>
                  </div>
                  <div className="p-6 space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">Phone Number</Label>
                        <div className="flex gap-2">
                          <select
                            value={demoCountry.code}
                            onChange={e => setDemoCountry(COUNTRIES.find(c => c.code === e.target.value) || COUNTRIES[0])}
                            disabled={demoCalling || demoCallActive}
                            className="w-28 bg-muted rounded-lg px-2 py-2 border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            {COUNTRIES.map(c => (
                              <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                            ))}
                          </select>
                          <Input placeholder="3001234567" value={demoPhone}
                            onChange={e => setDemoPhone(e.target.value)} disabled={demoCalling || demoCallActive} className="flex-1" />
                        </div>
                        <p className="text-[10px] text-muted-foreground">Enter number without leading 0</p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">Voice Agent</Label>
                        <div className="flex items-center gap-2">
                          <img
                            src={selectedCaller.avatar}
                            alt={selectedCaller.name}
                            className="h-9 w-9 rounded-full object-cover border-2 border-border shrink-0"
                            referrerPolicy="no-referrer" crossOrigin="anonymous"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                          <select
                            value={settings.selectedCallerId}
                            onChange={e => setSettings(s => ({ ...s, selectedCallerId: e.target.value }))}
                            disabled={demoCalling || demoCallActive}
                            className="flex-1 bg-muted rounded-lg px-3 py-2 border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            {VOICE_CALLERS.map(caller => (
                              <option key={caller.id} value={caller.id}>
                                {caller.name} — {caller.voice} ({caller.gender === 'female' ? '♀' : '♂'})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={async () => {
                        const fullPhone = demoCountry.code + demoPhone.replace(/^0+/, '');
                        if (!demoPhone || demoPhone.length < 6) {
                          toast({ title: 'Enter a valid phone number', variant: 'destructive' });
                          return;
                        }
                        setDemoCalling(true);
                        setDemoResult(null);
                        setDemoLiveStatus([]);
                        setDemoCallActive(false);

                        // Connect to dashboard WebSocket for live updates
                        try {
                          const wsBase = API_BASE || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
                          const wsUrl = wsBase.replace(/^http/, 'ws') + '/dashboard';
                          const ws = new WebSocket(wsUrl);
                          demoWsRef.current = ws;

                          ws.onmessage = (event) => {
                            try {
                              const msg = JSON.parse(event.data);
                              if (msg.type === 'LOG' || msg.type === 'STATE' || msg.type === 'TRANSCRIPT') {
                                const timestamp = new Date().toLocaleTimeString();
                                let icon = '📡';
                                if (msg.source === 'twil') icon = '📞';
                                else if (msg.source === 'gemini') icon = '🤖';
                                else if (msg.type === 'TRANSCRIPT') icon = '💬';
                                else if (msg.type === 'STATE') icon = '🔄';

                                const statusMsg = `[${timestamp}] ${icon} ${msg.message || msg.state || msg.text || JSON.stringify(msg)}`;
                                setDemoLiveStatus(prev => [...prev.slice(-30), statusMsg]);

                                // Detect call connection
                                if (msg.message?.includes('Stream connected') || msg.message?.includes('connected')) {
                                  setDemoCallActive(true);
                                }

                                // Detect call end
                                if (msg.message?.includes('Call ended') || msg.message?.includes('hangup') || msg.message?.includes('completed') || msg.message?.includes('disconnected')) {
                                  setDemoCallActive(false);
                                  setDemoLiveStatus(prev => [...prev, `[${timestamp}] ✅ Call completed — check Call Logs for full analysis`]);
                                }
                              }
                            } catch { /* ignore parse errors */ }
                          };

                          ws.onerror = () => {
                            setDemoLiveStatus(prev => [...prev, `⚠️ WebSocket error — live updates unavailable, call still proceeding`]);
                          };

                          ws.onclose = () => {
                            demoWsRef.current = null;
                          };
                        } catch {
                          setDemoLiveStatus(prev => [...prev, '⚠️ Could not connect WebSocket for live updates']);
                        }

                        try {
                          const caller = VOICE_CALLERS.find(c => c.id === settings.selectedCallerId) || VOICE_CALLERS[0];
                          setDemoLiveStatus(prev => [...prev, `📤 Initiating call to ${fullPhone} with agent ${caller.name} (${caller.voice})...`]);

                          const res = await fetch(`${API_BASE}/api/make-call`, withAuthHeaders({
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              customerPhone: fullPhone, customerName: 'Demo Test', customerId: '',
                              agentType: 'fresh_call', tone: 'polite',
                              callerName: caller.name, callerVoice: caller.voice, callerLanguage: caller.language,
                              balance: 25000, dpd: 5,
                              noiseCancellation: settings.noiseCancellation ?? false,
                            }),
                          }));
                          let data: any;
                          try { data = await res.json(); } catch { throw new Error('Server returned invalid response'); }
                          if (!res.ok) throw new Error(data?.error || data?.details?.message || `HTTP ${res.status}`);

                          if (data.mock) {
                            setDemoResult({ success: true, message: `Mock call queued (telephony not configured)` });
                            setDemoLiveStatus(prev => [...prev, '⚠️ Telephony not configured — mock mode.']);
                          } else {
                            setDemoResult({ success: true, message: `📞 Call initiated successfully!` });
                            setDemoLiveStatus(prev => [...prev, `✅ Dialing... phone will ring shortly.`]);
                          }
                          toast({ title: data.mock ? 'Mock call (telephony not configured)' : '✅ Call placed!' });
                        } catch (err: any) {
                          setDemoResult({ success: false, message: err.message });
                          setDemoLiveStatus(prev => [...prev, `❌ Error: ${err.message}`]);
                          toast({ title: 'Demo call failed', description: err.message, variant: 'destructive' });
                          // Cleanup WS
                          if (demoWsRef.current) { demoWsRef.current.close(); demoWsRef.current = null; }
                        } finally {
                          setDemoCalling(false);
                        }
                      }}
                      disabled={demoCalling || !demoPhone || !!healthError || demoCallActive}
                      className="w-full h-12 text-base gap-2 shadow-lg shadow-primary/20"
                      size="lg"
                    >
                      {demoCalling ? <Loader2 className="w-5 h-5 animate-spin" /> : demoCallActive ? <Volume2 className="w-5 h-5 animate-pulse" /> : <Phone className="w-5 h-5" />}
                      {demoCalling ? 'Initiating...' : demoCallActive ? '🔴 Call Active — Listen & Speak' : healthError ? 'Server Offline — Cannot Call' : 'Place Demo Call'}
                    </Button>

                    {demoResult && (
                      <div className={`rounded-xl border px-5 py-4 ${demoResult.success ? 'border-success/30 bg-success/10' : 'border-destructive/30 bg-destructive/10'}`}>
                        <p className={`text-sm font-medium ${demoResult.success ? 'text-success' : 'text-destructive'}`}>
                          {demoResult.message}
                        </p>
                      </div>
                    )}

                    {/* Live Call Status Feed */}
                    {demoLiveStatus.length > 0 && (
                      <div className="rounded-xl border border-border bg-background overflow-hidden">
                        <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Activity className="w-4 h-4 text-primary" />
                            <span className="text-sm font-bold text-foreground">Live Call Status</span>
                            {demoCallActive && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                          </div>
                          <button onClick={() => { setDemoLiveStatus([]); setDemoCallActive(false); if (demoWsRef.current) { demoWsRef.current.close(); demoWsRef.current = null; } }}
                            className="text-[10px] text-muted-foreground hover:text-foreground">Clear</button>
                        </div>
                        <div className="max-h-64 overflow-auto p-3 space-y-1 font-mono text-xs">
                          {demoLiveStatus.map((msg, i) => (
                            <div key={i} className={`py-1 px-2 rounded ${
                              msg.includes('❌') ? 'bg-destructive/10 text-destructive' :
                              msg.includes('✅') ? 'bg-success/10 text-success' :
                              msg.includes('⚠️') ? 'bg-warning/10 text-warning' :
                              msg.includes('💬') ? 'bg-blue-500/10 text-blue-400' :
                              msg.includes('🤖') ? 'bg-purple-500/10 text-purple-400' :
                              'text-muted-foreground'
                            }`}>
                              {msg}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Test Checklist */}
                    <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-3">
                      <p className="font-bold text-foreground text-sm flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-primary" /> System Test Checklist
                      </p>
                      <div className="space-y-2">
                        {[
                          { label: 'Server online & health check passed', check: !!health },
                          { label: 'Gemini AI connected & ready', check: health?.gemini?.ready },
                          { label: 'Telephony configured with phone number', check: health?.twilio?.ready },
                          { label: 'Call initiated successfully', check: demoResult?.success },
                          { label: 'Customer answered & two-way audio working', check: demoCallActive || demoLiveStatus.some(s => s.includes('Stream connected')) },
                          { label: 'Agent spoke greeting in Roman Urdu', check: demoLiveStatus.some(s => s.includes('GREETING') || s.includes('greeting')) },
                          { label: 'Call completed & logged', check: demoLiveStatus.some(s => s.includes('completed') || s.includes('Call ended')) },
                        ].map((item, i) => (
                          <div key={i} className="flex items-center gap-3 py-1.5">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                              item.check ? 'bg-success/20 border-success text-success' : 'bg-muted border-border text-muted-foreground'
                            }`}>
                              {item.check ? '✓' : i + 1}
                            </div>
                            <span className={`text-sm ${item.check ? 'text-foreground' : 'text-muted-foreground'}`}>{item.label}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">
                        When you answer the call, speak to the AI agent — it will respond in Roman Urdu. 
                        Say "Haan bolien" to test cooperative flow, or "Abhi busy hoon" to test busy flow.
                        Watch the live feed above for real-time transcripts and state changes.
                      </p>
                    </div>

                    <div className="bg-muted/50 rounded-xl p-4 text-xs text-muted-foreground space-y-1.5 border border-border">
                      <p className="font-bold text-foreground text-sm">How to test:</p>
                      <p>1. Enter your phone number and click <strong>Place Demo Call</strong></p>
                      <p>2. Your phone will ring — pick up</p>
                      <p>3. Agent "{selectedCaller.name}" will say "Assalam o Alaikum" in Roman Urdu</p>
                      <p>4. <strong>Reply naturally</strong> — say "Haan bolien" or "Theek hai batayein"</p>
                      <p>5. Agent will discuss demo dues (25,000 PKR) and follow the conversation flow</p>
                      <p>6. Watch the <strong>Live Call Status</strong> feed for real-time transcripts</p>
                      <p>7. After hanging up, check the <strong>System Test Checklist</strong> — all items should turn green ✅</p>
                      <p>8. Full call analysis appears in <strong>Call Logs</strong> page</p>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ═══ TAB: AI Config ═══ */}
            <TabsContent value="ai" className="p-6 space-y-6 mt-0">
              {/* Gemini Native Audio Model Config */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/30">
                  <h2 className="font-bold text-foreground flex items-center gap-2">
                    <Brain className="w-5 h-5 text-primary" /> Gemini Native Audio — Model Setup
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    WebSocket setup message sent to Gemini when a call connects. This is the exact config used in <code className="text-primary bg-primary/10 px-1 rounded">calls.js</code>.
                  </p>
                </div>
                <div className="p-6 space-y-5">
                  {/* Model & Modalities */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">Model</Label>
                      <div className="bg-muted rounded-lg px-4 py-3 border border-border font-mono text-sm text-foreground">
                        gemini-2.5-flash-native-audio-preview-12-2025
                      </div>
                      <p className="text-[10px] text-muted-foreground">Native audio-to-audio model — no text round-trips</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">Response Modalities</Label>
                      <div className="flex gap-2">
                        <span className="px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-sm font-semibold text-primary">AUDIO</span>
                        <span className="px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm font-semibold text-blue-400">TEXT</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Both audio and text transcription enabled</p>
                    </div>
                  </div>

                  {/* Speech Config */}
                  <div className="rounded-lg border border-border bg-muted/20 p-5 space-y-4">
                    <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                      <Volume2 className="w-4 h-4 text-primary" /> Speech Configuration
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Voice</p>
                        <p className="text-sm font-semibold text-foreground">{selectedCaller.voice}</p>
                        <p className="text-[10px] text-muted-foreground">Active persona: {selectedCaller.name}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Input Transcription</p>
                        <span className="text-sm font-semibold text-success">✅ Enabled</span>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Output Transcription</p>
                        <span className="text-sm font-semibold text-success">✅ Enabled</span>
                      </div>
                    </div>
                  </div>

                  {/* Generation Config */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold">Temperature: {settings.geminiTemperature}</Label>
                      <Slider value={[settings.geminiTemperature]}
                        onValueChange={v => setSettings(s => ({ ...s, geminiTemperature: v[0] }))}
                        min={0} max={1} step={0.1} />
                      <p className="text-[10px] text-muted-foreground">Lower = consistent responses · Higher = creative</p>
                    </div>
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold">Max Tokens: {settings.geminiMaxTokens}</Label>
                      <Slider value={[settings.geminiMaxTokens]}
                        onValueChange={v => setSettings(s => ({ ...s, geminiMaxTokens: v[0] }))}
                        min={512} max={4096} step={256} />
                      <p className="text-[10px] text-muted-foreground">Maximum response length per turn</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* System Instruction */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/30">
                  <h2 className="font-bold text-foreground flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" /> System Instruction — Roman Urdu Agent Prompt
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Full prompt injected into <code className="text-primary bg-primary/10 px-1 rounded">systemInstruction.parts[0].text</code>. 
                    Dynamic variables: <code className="text-primary bg-primary/10 px-1 rounded">{'${agentName}'}</code>, <code className="text-primary bg-primary/10 px-1 rounded">{'${amount}'}</code>, <code className="text-primary bg-primary/10 px-1 rounded">{'${dueDate}'}</code>, <code className="text-primary bg-primary/10 px-1 rounded">{'${customerName}'}</code>
                  </p>
                </div>
                <div className="p-6 space-y-4">
                  <Textarea
                    value={settings.geminiSystemPrompt}
                    onChange={e => setSettings(s => ({ ...s, geminiSystemPrompt: e.target.value }))}
                    rows={20}
                    className="font-mono text-xs leading-relaxed"
                    placeholder="Enter system instructions..."
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground">{settings.geminiSystemPrompt.length} characters</p>
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                      setSettings(s => ({ ...s, geminiSystemPrompt: DEFAULT_GEMINI_PROMPT }));
                      toast({ title: 'Reset to full template prompt' });
                    }}>
                      Reset to Default Template
                    </Button>
                  </div>
                </div>
              </div>

              {/* Conversation Scenarios */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/30">
                  <h2 className="font-bold text-foreground flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-primary" /> 7 Scenario Responses
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">Built into the system instruction — agent handles these automatically</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-6">
                  {[
                    { scenario: 'Cooperative', trigger: '"Haan bolien"', icon: '✅', color: 'border-success/30 bg-success/5' },
                    { scenario: 'How to Pay', trigger: '"Kaise pay karun?"', icon: '💳', color: 'border-blue-500/30 bg-blue-500/5' },
                    { scenario: 'Installments', trigger: '"Installments ka option?"', icon: '📊', color: 'border-purple-500/30 bg-purple-500/5' },
                    { scenario: 'Customer Busy', trigger: '"Abhi busy hoon"', icon: '⏰', color: 'border-warning/30 bg-warning/5' },
                    { scenario: 'Refuses Help', trigger: '"Mujhe help nahi chahiye"', icon: '❌', color: 'border-destructive/30 bg-destructive/5' },
                    { scenario: 'Customer Loops', trigger: '"Ji bolien" repeats', icon: '🔄', color: 'border-muted-foreground/30 bg-muted/50' },
                    { scenario: 'Payment Done', trigger: '"Payment ho chuki hai"', icon: '✔️', color: 'border-success/30 bg-success/5' },
                  ].map(s => (
                    <div key={s.scenario} className={`rounded-lg border-2 p-4 ${s.color}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{s.icon}</span>
                        <h3 className="font-semibold text-sm text-foreground">{s.scenario}</h3>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Trigger: <span className="font-mono text-foreground">{s.trigger}</span></p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Linguistic Rules */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/30">
                  <h2 className="font-bold text-foreground flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" /> Strict Linguistic Rules
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-6">
                  {[
                    { rule: 'Dates', detail: 'Full month names — "Pandra January"', icon: '📅' },
                    { rule: 'Numbers', detail: 'Use "point" for decimals, round amounts', icon: '🔢' },
                    { rule: 'Keywords', detail: 'Inject: sir, interest, bank, payment, credit card', icon: '🔤' },
                    { rule: 'Accent', detail: 'Karachi-style Pakistani accent', icon: '🎙️' },
                    { rule: 'Fillers', detail: '"acha", "theek hai", "bas" naturally', icon: '💬' },
                    { rule: 'Scope', detail: 'Only credit card dues — nothing else', icon: '🔒' },
                  ].map(r => (
                    <div key={r.rule} className="rounded-lg bg-muted/50 border border-border p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span>{r.icon}</span>
                        <h3 className="font-semibold text-sm text-foreground">{r.rule}</h3>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{r.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* ═══ TAB: Auto-Dialer ═══ */}
            <TabsContent value="dialer" className="p-6 space-y-6 mt-0">
              {/* Concurrent Scheduling System */}
              <div className="rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
                <div className="px-6 py-5 border-b border-border bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                      <Zap className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="font-bold text-lg text-foreground">Concurrent Call Scheduler</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Schedule batch calls — system auto-assigns tone & agent per customer profile
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-6 space-y-6">
                  {/* Mode Selection */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {([
                      { mode: 'off' as AutoDialMode, label: '🔴 Manual', desc: 'One call at a time — full control', color: 'border-muted-foreground/20', icon: '🖱️' },
                      { mode: 'auto' as AutoDialMode, label: '🟢 Auto (All)', desc: 'Process ALL queue by priority', color: 'border-success/30', icon: '⚡' },
                      { mode: 'batch' as AutoDialMode, label: '🟡 Batch (Top N)', desc: 'Process top-N priority accounts', color: 'border-warning/30', icon: '📋' },
                    ]).map(opt => (
                      <button key={opt.mode} onClick={() => setSettings(s => ({ ...s, autoDialMode: opt.mode }))}
                        className={`text-left rounded-xl p-5 border-2 transition-all ${
                          settings.autoDialMode === opt.mode
                            ? `${opt.color} bg-primary/5 shadow-lg ring-2 ring-primary/20`
                            : 'border-border bg-muted/50 hover:border-primary/30'
                        }`}>
                        <h3 className="font-bold text-foreground">{opt.label}</h3>
                        <p className="text-xs text-muted-foreground mt-1">{opt.desc}</p>
                        {settings.autoDialMode === opt.mode && <CheckCircle2 className="w-4 h-4 text-primary mt-2" />}
                      </button>
                    ))}
                  </div>

                  {/* Concurrent Controls */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold">Batch Size</Label>
                      <Input type="number" value={settings.autoDialBatchSize}
                        onChange={e => setSettings(s => ({ ...s, autoDialBatchSize: Math.max(1, Number(e.target.value)) }))}
                        min={1} max={100} disabled={settings.autoDialMode !== 'batch'} />
                      <p className="text-[10px] text-muted-foreground">
                        {settings.autoDialMode === 'batch' ? `Top ${settings.autoDialBatchSize} priority customers` : settings.autoDialMode === 'auto' ? 'All customers' : 'Auto-dial is off'}
                      </p>
                    </div>
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold">Max Concurrent Calls: {settings.maxConcurrentCalls}</Label>
                      <Slider value={[settings.maxConcurrentCalls]}
                        onValueChange={v => setSettings(s => ({ ...s, maxConcurrentCalls: v[0] }))}
                        min={1} max={10} step={1} />
                      <p className="text-[10px] text-muted-foreground">
                        {settings.maxConcurrentCalls} customers called simultaneously
                      </p>
                    </div>
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold">Inter-Call Delay (sec)</Label>
                      <Input type="number" value={settings.interCallDelaySec ?? 0}
                        onChange={e => setSettings(s => ({ ...s, interCallDelaySec: Math.max(0, Number(e.target.value)) }))}
                        min={0} max={60} />
                      <p className="text-[10px] text-muted-foreground">Pause between starting new calls</p>
                    </div>
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold">Scheduler Check Interval (min)</Label>
                      <Input
                        type="number"
                        value={settings.schedulerPollMinutes ?? 1}
                        onChange={e => setSettings(s => ({ ...s, schedulerPollMinutes: Math.max(1, Number(e.target.value) || 1) }))}
                        min={1}
                        max={60}
                      />
                      <p className="text-[10px] text-muted-foreground">Example: set 10 for 10-minute schedule pickup cycle</p>
                    </div>
                  </div>

                  {/* Smart Scheduling Explanation */}
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
                      <Brain className="w-4 h-4 text-primary" />
                      <h3 className="font-bold text-sm text-foreground">Smart Agent & Tone Assignment</h3>
                    </div>
                    <div className="p-5 space-y-4">
                      <p className="text-xs text-muted-foreground">
                        Each customer in the batch is automatically matched with the optimal agent type and tone based on their profile. 
                        The system uses the priority formula and customer history to determine the right approach.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-lg border border-success/20 bg-success/5 p-4">
                          <h4 className="text-xs font-bold text-success mb-2">🤖 Auto Agent Selection</h4>
                          <ul className="text-[10px] text-muted-foreground space-y-1">
                            <li>• Fresh accounts → <span className="text-foreground font-medium">Fresh Call agent</span></li>
                            <li>• Broken PTP → <span className="text-foreground font-medium">Broken Promise agent</span></li>
                            <li>• High DPD/balance → <span className="text-foreground font-medium">Escalation agent</span></li>
                            <li>• Pending PTP → <span className="text-foreground font-medium">PTP Reminder agent</span></li>
                          </ul>
                        </div>
                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                          <h4 className="text-xs font-bold text-blue-400 mb-2">🎙️ Auto Tone & Voice</h4>
                          <ul className="text-[10px] text-muted-foreground space-y-1">
                            <li>• Cooperative history → <span className="text-foreground font-medium">Polite tone, soft voice</span></li>
                            <li>• Repeat defaulter → <span className="text-foreground font-medium">Assertive tone, firm voice</span></li>
                            <li>• Sensitive case → <span className="text-foreground font-medium">Empathetic tone, warm voice</span></li>
                            <li>• High risk → <span className="text-foreground font-medium">Auto-assigns best persona</span></li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Pipeline Architecture */}
                  <div className="bg-muted/50 rounded-xl p-5 text-xs text-muted-foreground space-y-2 border border-border">
                    <p className="font-bold text-foreground text-sm">⚡ Call Pipeline (per customer)</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {['📝 Script Gen', '🤖 Agent Match', '📞 Live Call', '🎙️ AI Audio', '🧠 AI Analysis', '💾 DB Save'].map((step, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <span className="px-2 py-1 rounded-md bg-primary/10 text-primary font-medium">{step}</span>
                          {i < 5 && <span className="text-muted-foreground">→</span>}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2">• Max <strong className="text-foreground">{settings.maxConcurrentCalls}</strong> calls run in parallel</p>
                    <p>• Scheduler checks due retries every <strong className="text-foreground">{settings.schedulerPollMinutes}</strong> minute(s)</p>
                    <p>• Priority order: highest score processed first</p>
                    <p>• Failed/no-answer auto-scheduled for retry per Rules tab</p>
                    <p>• Each call gets its own voice persona based on customer profile</p>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ═══ TAB: Rules & Agents ═══ */}
            <TabsContent value="rules" className="p-6 space-y-6 mt-0">
              {/* Call Rules */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/30">
                  <h2 className="font-bold text-foreground flex items-center gap-2">
                    <Timer className="w-5 h-5 text-primary" /> Call Rules & Retry Logic
                  </h2>
                </div>
                <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-5">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Max PTP Days</Label>
                    <Input type="number" value={settings.maxPtpDays}
                      onChange={e => setSettings(s => ({ ...s, maxPtpDays: Number(e.target.value) }))} min={1} max={30} />
                    <p className="text-[10px] text-muted-foreground">Customer can't commit beyond this</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">No Answer Retry (hrs)</Label>
                    <Input type="number" value={settings.retryNoAnswerHours}
                      onChange={e => setSettings(s => ({ ...s, retryNoAnswerHours: Number(e.target.value) }))} min={0.01} step={0.01} max={72} />
                    <p className="text-[10px] text-muted-foreground">Auto-retry after no answer / busy / callback — {settings.retryNoAnswerHours < 1 ? Math.round(settings.retryNoAnswerHours * 60) + ' min' : settings.retryNoAnswerHours + ' hr'} (10 min = 0.17)</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Non-Customer Retry (hrs)</Label>
                    <Input type="number" value={settings.retryNonCustomerHours}
                      onChange={e => setSettings(s => ({ ...s, retryNonCustomerHours: Number(e.target.value) }))} min={0.01} step={0.01} max={72} />
                    <p className="text-[10px] text-muted-foreground">Retry when someone else picks up — {settings.retryNonCustomerHours < 1 ? Math.round(settings.retryNonCustomerHours * 60) + ' min' : settings.retryNonCustomerHours + ' hr'}</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">After-Hours Cutoff</Label>
                    <Input type="time" value={settings.afterHoursStartTime}
                      onChange={e => setSettings(s => ({ ...s, afterHoursStartTime: e.target.value }))} />
                    <p className="text-[10px] text-muted-foreground">Calls after this → next day {settings.nextDayStartTime}</p>
                  </div>
                </div>
              </div>

              {/* Priority Formula */}
              <div className="rounded-xl border border-border bg-card p-6">
                <h3 className="font-bold text-foreground mb-3">Priority Scoring Formula</h3>
                <div className="bg-muted rounded-xl p-4 font-mono text-sm text-primary border border-border">
                  Score = (Follow-up Count × 10) + (Balance in K × 5) + (DPD × 3)
                </div>
                <p className="text-xs text-muted-foreground mt-2">Higher scores processed first.</p>
              </div>

              {/* 10 Agent Types */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/30">
                  <h2 className="font-bold text-foreground flex items-center gap-2">
                    <Zap className="w-5 h-5 text-primary" /> 10 Agent Types
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-6">
                  {(Object.entries(AGENT_LABELS) as [AgentType, string][]).map(([key, label]) => (
                    <div key={key} className="bg-muted/50 rounded-lg p-4 border border-transparent hover:border-primary/20 transition-colors">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-sm text-foreground">{label}</h3>
                        <span className="text-[10px] font-mono text-muted-foreground bg-background px-2 py-0.5 rounded">{key}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{AGENT_DESCRIPTIONS[key]}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3 Tone Modes */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/30">
                  <h2 className="font-bold text-foreground flex items-center gap-2">
                    <Settings className="w-5 h-5 text-primary" /> 3 Tone Modes
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6">
                  {([
                    { key: 'polite' as ToneMode, gradient: 'from-green-500/10 to-transparent', border: 'border-green-500/30', desc: 'Default for fresh calls. Warm, professional.' },
                    { key: 'assertive' as ToneMode, gradient: 'from-red-500/10 to-transparent', border: 'border-red-500/30', desc: 'Broken promises, high DPD. Firm, urgent.' },
                    { key: 'empathetic' as ToneMode, gradient: 'from-blue-500/10 to-transparent', border: 'border-blue-500/30', desc: '2+ follow-ups. Understanding but goal-oriented.' },
                  ]).map(tone => (
                    <div key={tone.key} className={`rounded-xl p-5 border-2 bg-gradient-to-b ${tone.gradient} ${tone.border}`}>
                      <h3 className="font-bold text-foreground">{TONE_LABELS[tone.key]}</h3>
                      <p className="text-xs text-muted-foreground mt-2">{tone.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}

/* ─── Voice Preview Samples (Roman Urdu) ─── */
const VOICE_SAMPLES: Record<string, string> = {
  fatima: 'Assalam o Alaikum. Main Fatima bol rahi hoon JS Bank se. Kaise hain aap? Main aapse aapke account ke baare mein baat karna chahti hoon. Aapke account par kuch pending amount show ho raha hai. Agar aap time par payment kar dein to koi extra charges nahi lagenge. Kya aap abhi baat kar sakte hain?',
  omar: 'Assalam o Alaikum. Main Omar hoon bank se. Kaise hain aap? Bas ek friendly reminder dena tha ke aapki upcoming payment ki date qareeb hai. Agar aap time par kar dein to sab theek rahega. Koi sawal ho to main hazir hoon.',
};

/* ─── Caller Card Component with Voice Preview ─── */
function CallerCard({ caller, selected, onSelect, isPlaying, isLoading, onPlayToggle }: {
  caller: VoiceCaller; selected: boolean; onSelect: () => void;
  isPlaying: boolean; isLoading?: boolean; onPlayToggle: () => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className={`text-left rounded-xl border-2 transition-all overflow-hidden ${
      selected
        ? 'border-primary bg-primary/10 shadow-lg shadow-primary/10 ring-2 ring-primary/20'
        : 'border-border bg-card hover:border-primary/30 hover:shadow-md'
    }`}>
      <button onClick={onSelect} className="w-full text-left p-4 pb-2">
        <div className="flex items-center gap-3 mb-3">
          {!imgError ? (
            <img src={caller.avatar} alt={caller.name}
              className="h-12 w-12 rounded-full object-cover border-2 border-border shrink-0 shadow-sm"
              referrerPolicy="no-referrer" crossOrigin="anonymous"
              onError={() => setImgError(true)} />
          ) : (
            <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center text-lg font-bold text-primary shrink-0 border-2 border-border">
              {caller.name[0]}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-foreground text-sm truncate">{caller.name}</h3>
            <p className="text-[10px] text-muted-foreground">{caller.nameUrdu}</p>
          </div>
          {selected && <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-2">{caller.descriptionUrdu}</p>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono">{caller.voice}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            caller.personality === 'soft' ? 'bg-green-500/20 text-green-400' :
            caller.personality === 'confident' ? 'bg-blue-500/20 text-blue-400' :
            caller.personality === 'warm' ? 'bg-amber-500/20 text-amber-400' :
            caller.personality === 'firm' ? 'bg-red-500/20 text-red-400' :
            caller.personality === 'friendly' ? 'bg-cyan-500/20 text-cyan-400' :
            'bg-purple-500/20 text-purple-400'
          }`}>{caller.personality}</span>
        </div>
      </button>

      {/* Voice Preview Button — only on selected card */}
      {selected && (
        <div className="px-4 pb-3 pt-2">
          <button
            onClick={(e) => { e.stopPropagation(); onPlayToggle(); }}
            disabled={!!isLoading}
            className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all ${
              isLoading
                ? 'bg-muted text-muted-foreground border border-border cursor-wait'
                : isPlaying
                ? 'bg-destructive/15 text-destructive hover:bg-destructive/25 border border-destructive/30'
                : 'bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30'
            }`}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Generating with Gemini...</span>
              </>
            ) : isPlaying ? (
              <>
                <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                <span>Playing Gemini Voice... Tap to Stop</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>▶ Preview Gemini Voice</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
