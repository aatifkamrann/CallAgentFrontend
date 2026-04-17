import { createContext, useContext, useEffect, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { supabase, isSupabaseConfigured } from '@/integrations/supabase/client';
import { clearStoredAuthToken, getStoredAuthToken, setStoredAuthToken, withAuthHeaders } from '@/lib/auth';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');

type AuthSession = {
  user: {
    email: string;
  };
};

type AuthContextValue = {
  session: AuthSession | null;
  loading: boolean;
  authEnabled: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const init = async () => {
      const token = getStoredAuthToken();
      if (token) {
        try {
          const response = await fetch(`${API_BASE}/api/auth/session`, withAuthHeaders());
          if (response.ok) {
            const data = await response.json();
            if (active) {
              setSession({ user: { email: data.user.email } });
              setLoading(false);
            }
            return;
          }
        } catch {
        }

        clearStoredAuthToken();
      }

      if (!isSupabaseConfigured || !supabase) {
        if (active) {
          setSession(null);
          setLoading(false);
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session?.user?.email ? { user: { email: data.session.user.email } } : null);
      setLoading(false);

      const sub = supabase.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession?.user?.email ? { user: { email: nextSession.user.email } } : null);
      });
      subscription = sub.data.subscription;
    };

    void init();

    return () => {
      active = false;
      if (subscription) subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email, password }),
      });
      const data = await response.json().catch(() => ({ error: 'Server returned invalid response' }));
      if (response.ok) {
        if (data?.token) setStoredAuthToken(data.token);
        setSession({ user: { email: data?.user?.email || email } });
        return { error: null };
      }

      // If local auth fails and Supabase is configured, allow Supabase fallback.
      if (!isSupabaseConfigured || !supabase) {
        return { error: data?.error || 'Login failed' };
      }
    } catch (error: any) {
      if (!isSupabaseConfigured || !supabase) {
        return { error: error.message || 'Login failed' };
      }
    }

    if (!isSupabaseConfigured || !supabase) {
      return { error: 'Login failed' };
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) {
      clearStoredAuthToken();
    }
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    clearStoredAuthToken();
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
      }
    }
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        authEnabled: isSupabaseConfigured,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}