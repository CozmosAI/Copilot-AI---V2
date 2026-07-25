import { supabase } from '../lib/supabase';

export const API_BASE_URL = (((import.meta as any).env?.VITE_BACKEND_URL) || '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

export async function safeJsonResponse(response: Response): Promise<any> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return {
      error: text || 'Resposta inválida do servidor'
    };
  }
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});

  try {
    let { data: { session } } = await supabase.auth.getSession();

    // Se session expirou ou vai expirar em < 60s, tentar refresh
    if (session?.expires_at) {
      const now = Math.floor(Date.now() / 1000);
      if (session.expires_at - now < 60) {
        const { data: { session: newSession } } = await supabase.auth.refreshSession();
        if (newSession) session = newSession;
      }
    }

    // Se ainda não tem session, tentar refresh uma vez
    if (!session?.access_token) {
      const { data: { session: refreshed } } = await supabase.auth.refreshSession();
      if (refreshed) session = refreshed;
    }

    if (session?.access_token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${session.access_token}`);
    }
  } catch (e) {
    console.warn('apiFetch: session error:', e);
  }

  const fetchOptions = { ...options, headers };
  const response = await fetch(apiUrl(path), fetchOptions);

  // Se 401, tentar refresh e refazer UMA vez
  if (response.status === 401 && !headers.has('X-Retry')) {
    try {
      const { data: { session: newSession } } = await supabase.auth.refreshSession();
      if (newSession?.access_token) {
        const retryHeaders = new Headers(headers);
        retryHeaders.set('Authorization', `Bearer ${newSession.access_token}`);
        retryHeaders.set('X-Retry', '1');
        return fetch(apiUrl(path), { ...options, headers: retryHeaders });
      }
    } catch (e) {
      /* refresh failed */
    }
  }

  return response;
}

