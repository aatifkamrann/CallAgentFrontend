const LOCAL_AUTH_TOKEN_KEY = 'app_auth_token';

export function getStoredAuthToken() {
  try {
    return localStorage.getItem(LOCAL_AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string) {
  try {
    localStorage.setItem(LOCAL_AUTH_TOKEN_KEY, token);
  } catch {}
}

export function clearStoredAuthToken() {
  try {
    localStorage.removeItem(LOCAL_AUTH_TOKEN_KEY);
  } catch {}
}

export function withAuthHeaders(init: RequestInit = {}): RequestInit {
  const token = getStoredAuthToken();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return { ...init, headers };
}