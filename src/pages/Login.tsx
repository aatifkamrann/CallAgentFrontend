import { FormEvent, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AlertTriangle, Loader2, LockKeyhole, PhoneCall, ShieldCheck, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/components/auth/AuthProvider';

export default function Login() {
  const { session, signIn, loading, authEnabled } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const redirectTo = useMemo(() => {
    const state = location.state as { from?: { pathname?: string } } | null;
    return state?.from?.pathname || '/';
  }, [location.state]);

  if (!loading && session) {
    return <Navigate to={redirectTo} replace />;
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    const { error } = await signIn(email.trim(), password);
    if (error) setErrorMessage(error);

    setSubmitting(false);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-10 text-slate-50">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.16),_transparent_30%),linear-gradient(135deg,_#020617,_#0f172a_55%,_#111827)]" />
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:32px_32px]" />

      <div className="relative grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden rounded-3xl border border-white/10 bg-white/5 p-10 backdrop-blur md:block">
          <div className="mb-8 flex items-center gap-4 rounded-2xl border border-white/10 bg-slate-900/50 p-4">
            <div className="relative h-14 w-14 overflow-hidden rounded-xl border border-white/20 bg-slate-950/80 shadow-lg shadow-black/30">
              <img src="/favicon.png" alt="Astrik Digital" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-tr from-emerald-400/15 via-transparent to-sky-400/20" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Astrik Digital</p>
              <h2 className="text-lg font-semibold text-white">AI Call Command Center</h2>
            </div>
          </div>

          <div className="mb-10 inline-flex items-center gap-3 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">
            <ShieldCheck className="h-4 w-4" />
            Protected operator access
          </div>

          <h1 className="max-w-lg text-4xl font-semibold leading-tight tracking-tight text-white">
            Welcome to your AI calling command center.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-300">
            Monitor customer activity, manage live calls, review outcomes, and operate your workflow from one unified workspace.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <PhoneCall className="mb-3 h-5 w-5 text-emerald-300" />
              <h2 className="text-sm font-medium text-white">Live call operations</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">Run outbound calls, track timers, and review post-call intelligence in real time.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <LockKeyhole className="mb-3 h-5 w-5 text-sky-300" />
              <h2 className="text-sm font-medium text-white">Unified workspace</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">Customers, call logs, schedules, and settings stay organized in one consistent interface.</p>
            </div>
          </div>
        </section>

        <Card className="rounded-3xl border-white/10 bg-slate-900/85 text-slate-50 shadow-2xl shadow-black/30 backdrop-blur">
          <CardHeader className="space-y-3 pb-6">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs text-sky-100">
              <Sparkles className="h-3.5 w-3.5" />
              Secure Operator Login
            </div>
            <CardTitle className="text-3xl font-semibold tracking-tight">Sign in</CardTitle>
            <CardDescription className="text-slate-400">
              Use your operator account to unlock the dashboard, customers, calls, logs, schedule, and settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!authEnabled && (
              <Alert className="mb-5 border-amber-500/30 bg-amber-500/10 text-amber-50">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Authentication is running in local operator mode for this deployment.
                </AlertDescription>
              </Alert>
            )}

            {errorMessage && (
              <Alert className="mb-5 border-destructive/40 bg-destructive/10 text-destructive-foreground">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            <form className="space-y-5" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="text"
                  autoComplete="username"
                  placeholder={authEnabled ? 'operator@company.com' : 'astrikdigital'}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="border-white/10 bg-slate-950/70"
                  disabled={submitting}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="border-white/10 bg-slate-950/70"
                  disabled={submitting}
                  required
                />
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Continue to app'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}