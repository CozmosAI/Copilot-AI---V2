
import { supabase } from '../lib/supabase';

// Helper para chamadas ao backend
const apiCall = async (endpoint: string, body: any) => {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erro na API');
    return data;
};

/**
 * Passo 1: Obter URL de Autorização
 */
export const initiateGoogleAdsAuth = async () => {
    const redirectUri = window.location.origin;
    const response = await fetch(`/api/auth/google-ads/url?redirect_uri=${encodeURIComponent(redirectUri)}`);
    const data = await response.json();
    
    if (data.url) {
        window.location.href = data.url;
    } else {
        throw new Error("Não foi possível gerar URL de login.");
    }
};

/**
 * Passo 2: Trocar o 'code' por tokens
 */
export const exchangeCodeForToken = async (code: string, userId: string) => {
    const redirectUri = window.location.origin;
    return apiCall('/api/auth/google-ads/exchange', {
        code,
        redirect_uri: redirectUri,
        user_id: userId
    });
};

/**
 * Passo 2.5: Confirmar conta selecionada
 */
export const selectGoogleAdsAccount = async (userId: string, accountId: string, accountName: string, managerId?: string) => {
    return apiCall('/api/auth/google-ads/select-account', {
        user_id: userId,
        customer_id: accountId,
        customer_name: accountName,
        manager_id: managerId
    });
};

/**
 * Passo 2.6: Listar filhos de MCC
 */
export const listMccChildren = async (userId: string, managerId: string) => {
    return apiCall('/api/google-ads/mcc-children', {
        user_id: userId,
        manager_id: managerId
    });
};

/**
 * Passo 3: Buscar Campanhas
 */
export const getGoogleCampaigns = async (userId: string, dateRange?: { start: string, end: string }) => {
    try {
        const data = await apiCall('/api/google-ads/campaigns', {
            user_id: userId,
            date_range: dateRange
        });
        
        return (data.results || []).map((row: any) => ({
            id: row.campaign.id,
            name: row.campaign.name,
            platform: 'google',
            spend: (parseInt(row.metrics.costMicros) || 0) / 1000000,
            clicks: parseInt(row.metrics.clicks) || 0,
            impressions: parseInt(row.metrics.impressions) || 0,
            conversions: parseFloat(row.metrics.conversions) || 0,
            status: row.campaign.status
        }));
    } catch (error) {
        console.error("Erro ao buscar campanhas:", error);
        return [];
    }
};

export const getGoogleOverview = async (userId: string, dateRange?: { start: string, end: string }) => {
    try {
        const data = await apiCall('/api/google-ads/overview', { user_id: userId, date_range: dateRange });
        return (data.results || []).map((row: any) => ({
            date: row.segments.date,
            clicks: parseInt(row.metrics.clicks) || 0,
            impressions: parseInt(row.metrics.impressions) || 0,
            spend: (parseInt(row.metrics.costMicros) || 0) / 1000000,
            conversions: parseFloat(row.metrics.conversions) || 0
        }));
    } catch (error) {
        console.error("Erro ao buscar overview:", error);
        return [];
    }
};

export const getGoogleAdGroups = async (userId: string, dateRange?: { start: string, end: string }) => {
    try {
        const data = await apiCall('/api/google-ads/ad-groups', { user_id: userId, date_range: dateRange });
        return (data.results || []).map((row: any) => ({
            id: row.adGroup.id,
            name: row.adGroup.name,
            campaignName: row.campaign.name,
            status: row.adGroup.status,
            clicks: parseInt(row.metrics.clicks) || 0,
            impressions: parseInt(row.metrics.impressions) || 0,
            spend: (parseInt(row.metrics.costMicros) || 0) / 1000000,
            conversions: parseFloat(row.metrics.conversions) || 0
        }));
    } catch (error) {
        console.error("Erro ao buscar ad groups:", error);
        return [];
    }
};

export const getGoogleKeywords = async (userId: string, dateRange?: { start: string, end: string }) => {
    try {
        const data = await apiCall('/api/google-ads/keywords', { user_id: userId, date_range: dateRange });
        return (data.results || []).map((row: any) => ({
            text: row.adGroupCriterion.keyword.text,
            matchType: row.adGroupCriterion.keyword.matchType,
            status: row.adGroupCriterion.status,
            qualityScore: row.adGroupCriterion.qualityInfo?.qualityScore || '-',
            campaignName: row.campaign.name,
            adGroupName: row.adGroup.name,
            clicks: parseInt(row.metrics.clicks) || 0,
            impressions: parseInt(row.metrics.impressions) || 0,
            spend: (parseInt(row.metrics.costMicros) || 0) / 1000000,
            conversions: parseFloat(row.metrics.conversions) || 0
        }));
    } catch (error) {
        console.error("Erro ao buscar keywords:", error);
        return [];
    }
};

export const getGoogleAds = async (userId: string, dateRange?: { start: string, end: string }) => {
    try {
        const data = await apiCall('/api/google-ads/ads', { user_id: userId, date_range: dateRange });
        return (data.results || []).map((row: any) => ({
            id: row.adGroupAd.ad.id,
            headlines: row.adGroupAd.ad.responsiveSearchAd?.headlines?.map((h: any) => h.text).join(' | ') || 'Anúncio Gráfico/Outro',
            status: row.adGroupAd.status,
            campaignName: row.campaign.name,
            adGroupName: row.adGroup.name,
            clicks: parseInt(row.metrics.clicks) || 0,
            impressions: parseInt(row.metrics.impressions) || 0,
            spend: (parseInt(row.metrics.costMicros) || 0) / 1000000
        }));
    } catch (error) {
        console.error("Erro ao buscar ads:", error);
        return [];
    }
};

/**
 * Check Status: Verifica se está conectado no backend
 */
export const checkGoogleAdsStatus = async (userId: string) => {
    try {
        const response = await fetch(`/api/google-ads/status/${userId}`);
        return await response.json();
    } catch (e) {
        return { connected: false };
    }
};

// Deprecated
export const signInWithGoogleAds = async () => {
    console.warn("Use initiateGoogleAdsAuth() agora.");
    return initiateGoogleAdsAuth();
};
export const getAccessibleCustomers = async () => { return []; }
