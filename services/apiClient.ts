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
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${session.access_token}`
      };
    }
  } catch (e) {
    console.warn('apiFetch: não foi possível obter session:', e);
  }
  return fetch(apiUrl(path), options);
}

