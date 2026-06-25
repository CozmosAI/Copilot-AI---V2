import { apiFetch, safeJsonResponse } from './apiClient';

type MetaAdsSafeStatus = {
  ok: boolean;
  connected: boolean;
  status: string;
  error?: string;
  [key: string]: any;
};

function getErrorMessage(data: any, fallback: string): string {
  if (data?.error && typeof data.error === 'string') {
    if (data.error.trim().startsWith('<!DOCTYPE') || data.error.trim().startsWith('<html')) {
      return fallback;
    }
    return data.error;
  }

  if (data?.message && typeof data.message === 'string') {
    return data.message;
  }

  return fallback;
}

/**
 * Passo 1: Obter URL de autorização e redirecionar para o Facebook Login.
 */
export const initiateMetaAdsAuth = async (userId: string) => {
  const redirectUri = window.location.origin;

  const response = await apiFetch(
    `/api/auth/meta-ads/url?user_id=${encodeURIComponent(userId)}&redirect_uri=${encodeURIComponent(redirectUri)}`
  );

  const data = await safeJsonResponse(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, 'Não foi possível gerar URL de login do Meta Ads.'));
  }

  if (!data?.url || typeof data.url !== 'string') {
    throw new Error('A URL de login do Meta Ads não foi retornada pelo servidor.');
  }

  window.location.href = data.url;
};

/**
 * Passo 2: Trocar o code do Facebook por token no backend.
 */
export const exchangeMetaCode = async (code: string, userId: string) => {
  const redirectUri = window.location.origin;

  const response = await apiFetch('/api/auth/meta-ads/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      redirect_uri: redirectUri,
      user_id: userId,
    }),
  });

  const data = await safeJsonResponse(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, 'Erro na troca de código Meta Ads.'));
  }

  return data;
};

/**
 * Passo 3: Selecionar a conta de anúncios Meta.
 */
export const selectMetaAccount = async (userId: string, adAccountId: string) => {
  const response = await apiFetch('/api/auth/meta-ads/select-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      ad_account_id: adAccountId,
    }),
  });

  const data = await safeJsonResponse(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, 'Erro ao selecionar conta Meta Ads.'));
  }

  return data;
};

/**
 * Obter status da conexão Meta Ads.
 * Esta função nunca deve quebrar a tela caso o backend retorne HTML, vazio ou erro.
 */
export const getMetaAdsStatus = async (userId: string): Promise<MetaAdsSafeStatus> => {
  try {
    const response = await apiFetch(`/api/meta-ads/status/${encodeURIComponent(userId)}`);
    const data = await safeJsonResponse(response);

    if (!response.ok) {
      console.error('[Meta Ads] Status retornou erro:', getErrorMessage(data, 'Erro ao verificar status.'));
      return {
        ok: false,
        connected: false,
        status: 'error',
        error: 'Não foi possível verificar status do Meta Ads.',
      };
    }

    if (data?.error && typeof data.error === 'string') {
      const trimmed = data.error.trim();

      if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
        console.error('[Meta Ads] Backend retornou HTML em vez de JSON para status.');
        return {
          ok: false,
          connected: false,
          status: 'error',
          error: 'Não foi possível verificar status do Meta Ads.',
        };
      }
    }

    return {
      ok: Boolean(data?.ok),
      connected: Boolean(data?.connected),
      status: data?.status || (data?.connected ? 'active' : 'disconnected'),
      ...data,
    };
  } catch (err) {
    console.error('[Meta Ads] Erro ao verificar status:', err);
    return {
      ok: false,
      connected: false,
      status: 'error',
      error: 'Não foi possível verificar status do Meta Ads.',
    };
  }
};

/**
 * Desconectar Meta Ads.
 */
export const disconnectMetaAds = async (userId: string) => {
  const response = await apiFetch('/api/meta-ads/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });

  const data = await safeJsonResponse(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, 'Erro ao desconectar Meta Ads.'));
  }

  return data;
};
