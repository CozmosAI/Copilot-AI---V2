
import { supabase } from '../lib/supabase';

/**
 * Inicia o fluxo de OAuth para o Google Calendar.
 * Configurações CRÍTICAS:
 * - access_type: 'offline' -> Garante que o Google envie um Refresh Token.
 * - prompt: 'consent' -> Força a tela de consentimento para garantir o envio do Refresh Token (ele só envia na primeira vez sem isso).
 */
export const signInWithGoogleCalendar = async () => {
  if (!supabase) return;

  const returnUrl = window.location.origin + window.location.pathname;

  localStorage.setItem('auth_intent', 'google_calendar');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: 'https://www.googleapis.com/auth/calendar.events.readonly',
      redirectTo: returnUrl, 
      queryParams: {
        access_type: 'offline', 
        prompt: 'consent',     
      },
    },
  });

  if (error) throw error;
  return data;
};

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  status: string;
  htmlLink: string;
}

/**
 * Tenta renovar o token chamando o backend.
 * O backend possui o CLIENT_ID e SECRET seguros.
 */
export const refreshGoogleToken = async (userId: string) => {
    try {
        // 1. Busca o refresh token no banco
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('google_calendar_refresh_token')
            .eq('id', userId)
            .single();

        if (error || !profile?.google_calendar_refresh_token) {
            console.warn("Sem refresh token no banco. O usuário precisa reconectar o calendário.");
            throw new Error('REFRESH_TOKEN_MISSING');
        }

        // 2. Chama o backend para trocar refresh token por access token
        const response = await fetch('/api/google/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: profile.google_calendar_refresh_token })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.error("Erro no backend de refresh:", errData);
            throw new Error(errData.error || 'Falha ao renovar token no servidor.');
        }

        const data = await response.json();
        const newAccessToken = data.access_token;

        // 3. Salva o novo token no banco e retorna
        if (newAccessToken) {
            await supabase.from('profiles').update({
                google_calendar_token: newAccessToken
            }).eq('id', userId);
            
            return newAccessToken;
        }
        return null;

    } catch (err) {
        console.error("Erro fatal ao renovar token:", err);
        return null;
    }
}

/**
 * Busca os próximos 20 eventos do calendário.
 * Se der erro 401 (Não autorizado), tenta renovar o token automaticamente.
 */
export const getUpcomingEvents = async (accessToken: string, userId?: string): Promise<GoogleCalendarEvent[]> => {
  // Função interna para fazer a chamada
  const fetchEvents = async (token: string) => {
      const timeMin = new Date().toISOString();
      return fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&maxResults=20&singleEvents=true&orderBy=startTime`,
          {
              headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
              }
          }
      );
  };

  try {
    let response = await fetchEvents(accessToken);

    // LÓGICA DE RENOVAÇÃO AUTOMÁTICA
    if ((response.status === 401 || response.status === 403) && userId) {
        console.log("Token expirado (401). Tentando refresh automático...");
        
        const newToken = await refreshGoogleToken(userId);
        
        if (newToken) {
            console.log("Token renovado com sucesso! Tentando buscar eventos novamente...");
            response = await fetchEvents(newToken);
        } else {
            console.error("Falha ao renovar token. Usuário precisará logar novamente.");
            throw new Error('AUTH_EXPIRED');
        }
    } else if (response.status === 401 || response.status === 403) {
        throw new Error('AUTH_EXPIRED');
    }

    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        if (!response.ok) throw new Error('Resposta inválida do Google Calendar');
    }

    if (!response.ok) {
      const msg = (data.error?.message || '').toLowerCase();
      if (msg.includes('invalid authentication') || msg.includes('unauthorized') || msg.includes('credentials') || msg.includes('token')) {
         throw new Error('AUTH_EXPIRED');
      }
      throw new Error(data.error?.message || 'Falha ao buscar eventos do Google Calendar');
    }

    return data.items || [];
  } catch (error: any) {
    if (error.message === 'AUTH_EXPIRED') throw error;
    if (error.message === 'REFRESH_TOKEN_MISSING') throw new Error('AUTH_EXPIRED');
    
    if (error.message && (
        error.message.toLowerCase().includes('invalid authentication') || 
        error.message.toLowerCase().includes('credentials')
    )) {
        throw new Error('AUTH_EXPIRED');
    }

    console.error("Erro Google Calendar:", error);
    return []; 
  }
};
