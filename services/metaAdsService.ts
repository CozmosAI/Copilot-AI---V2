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
      const errorMsg = getErrorMessage(data, 'Erro HTTP ao verificar status do Meta Ads.');
      console.error('[Meta Ads] Status retornou erro HTTP:', errorMsg, 'Detalhes:', data);
      return {
        ok: false,
        connected: false,
        status: 'error',
        error: errorMsg,
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
          error: 'O servidor retornou uma resposta inválida (HTML). Verifique as configurações de ambiente do servidor.',
        };
      }

      console.warn('[Meta Ads] Resposta de status contém um erro:', data.error);
      return {
        ok: false,
        connected: false,
        status: 'error',
        error: data.error,
        ...data,
      };
    }

    return {
      ok: Boolean(data?.ok),
      connected: Boolean(data?.connected),
      status: data?.status || (data?.connected ? 'active' : 'disconnected'),
      ...data,
    };
  } catch (err: any) {
    console.error('[Meta Ads] Erro ao verificar status:', err);
    return {
      ok: false,
      connected: false,
      status: 'error',
      error: err?.message || 'Não foi possível verificar o status do Meta Ads devido a um erro de conexão.',
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

export const getMetaOverview = async (userId: string, dateRange?: { start: string, end: string }) => {
  try {
    const response = await apiFetch('/api/meta-ads/overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, date_range: dateRange })
    });
    const data = await safeJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao buscar overview Meta Ads');
    return (data.results || []).map((row: any) => ({
      date: row.date,
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      clicks: parseInt(row.clicks) || 0,
      conversions: parseInt(row.conversions) || 0,
      actions: row.actions || []
    }));
  } catch (error) {
    console.error("Erro ao buscar overview Meta:", error);
    return [];
  }
};

export const getMetaCampaigns = async (userId: string, dateRange?: { start: string, end: string }) => {
  try {
    const response = await apiFetch('/api/meta-ads/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, date_range: dateRange })
    });
    const data = await safeJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao buscar campanhas Meta Ads');
    return (data.results || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      platform: 'meta',
      type: row.objective || 'N/A',
      budget: parseFloat(row.budget) || 0,
      spend: parseFloat(row.spend) || 0,
      clicks: parseInt(row.clicks) || 0,
      impressions: parseInt(row.impressions) || 0,
      conversions: parseInt(row.conversions) || 0,
      conversionsValue: 0,
      ctr: row.impressions > 0 ? (row.clicks / row.impressions) : 0,
      averageCpc: row.clicks > 0 ? (row.spend / row.clicks) : 0,
      status: row.status
    }));
  } catch (error) {
    console.error("Erro ao buscar campanhas Meta:", error);
    return [];
  }
};

export const getMetaAdGroups = async (userId: string, dateRange?: { start: string, end: string }, campaignId?: string) => {
  try {
    const response = await apiFetch('/api/meta-ads/ad-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, date_range: dateRange, campaign_id: campaignId })
    });
    const data = await safeJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao buscar ad groups Meta Ads');
    return (data.results || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      campaignName: row.campaignName,
      status: row.status,
      clicks: parseInt(row.clicks) || 0,
      impressions: parseInt(row.impressions) || 0,
      spend: parseFloat(row.spend) || 0,
      conversions: parseInt(row.conversions) || 0,
      conversionsValue: 0
    }));
  } catch (error) {
    console.error("Erro ao buscar conjuntos de anúncios Meta:", error);
    return [];
  }
};

export const getMetaAds = async (userId: string, dateRange?: { start: string, end: string }) => {
  try {
    const response = await apiFetch('/api/meta-ads/ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, date_range: dateRange })
    });
    const data = await safeJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao buscar anúncios Meta Ads');
    return (data.results || []).map((row: any) => ({
      id: row.id,
      headlines: row.name,
      status: row.status,
      campaignName: row.campaignName,
      adGroupName: row.adGroupName,
      clicks: parseInt(row.clicks) || 0,
      impressions: parseInt(row.impressions) || 0,
      spend: parseFloat(row.spend) || 0,
      conversions: parseInt(row.conversions) || 0,
      imageUrl: row.imageUrl,
      videoId: row.videoId,
      body: row.body,
      title: row.title
    }));
  } catch (error) {
    console.error("Erro ao buscar anúncios Meta:", error);
    return [];
  }
};

export const getMetaSearchTerms = async (userId: string, dateRange: { start: string, end: string }) => {
  try {
    const response = await apiFetch('/api/meta-ads/search-terms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, date_range: dateRange })
    });
    const data = await safeJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao buscar search-terms Meta Ads');
    return (data.results || []).map((row: any) => ({
      searchTerm: row.searchTerm || '',
      campaignName: row.campaignName || '',
      adGroupName: row.adGroupName || '',
      clicks: parseInt(row.clicks) || 0,
      impressions: parseInt(row.impressions) || 0,
      spend: parseFloat(row.spend) || 0,
      conversions: parseInt(row.conversions) || 0,
      ctr: row.ctr || 0
    }));
  } catch (error) {
    console.error("Erro ao buscar termos de pesquisa Meta:", error);
    return [];
  }
};


export const toggleMetaCampaignStatus = async (userId: string, campaignId: string, action: 'pause' | 'enable') => {
    const response = await apiFetch('/api/meta-ads/campaigns/toggle-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, campaign_id: campaignId, action })
    });
    const data = await safeJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao alterar status da campanha Meta');
    return data;
};

export const updateMetaCampaignBudget = async (userId: string, adsetId: string, newAmount: number) => {
    const response = await apiFetch('/api/meta-ads/campaigns/update-budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, adset_id: adsetId, new_amount: newAmount })
    });
    const data = await safeJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Erro ao atualizar orçamento Meta');
    return data;
};
