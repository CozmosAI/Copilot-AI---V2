
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
export const getGoogleCampaigns = async (userId: string, dateRange?: { start: string, end: string }, compareDateRange?: { start: string, end: string }, customerId?: string) => {
    try {
        const body: any = {
            user_id: userId,
            date_range: dateRange,
            customer_id: customerId
        };

        if (compareDateRange?.start && compareDateRange?.end) {
            body.compare_start = compareDateRange.start;
            body.compare_end = compareDateRange.end;
        }

        const data = await apiCall('/api/google-ads/campaigns', body);
        
        const processRows = (rows: any[]) => (rows || []).map((row: any) => ({
            id: row.campaign.id,
            name: row.campaign.name,
            platform: 'google',
            type: row.campaign.advertisingChannelType,
            budget: (parseInt(row.campaignBudget?.amountMicros) || 0) / 1000000,
            spend: (parseInt(row.metrics.costMicros) || 0) / 1000000,
            clicks: parseInt(row.metrics.clicks) || 0,
            impressions: parseInt(row.metrics.impressions) || 0,
            conversions: parseFloat(row.metrics.conversions) || 0,
            conversionsValue: parseFloat(row.metrics.conversionsValue) || 0,
            ctr: parseFloat(row.metrics.ctr) || 0,
            averageCpc: (parseInt(row.metrics.averageCpc) || 0) / 1000000,
            status: row.campaign.status
        }));

        if (data.comparison) {
            return {
                current: processRows(data.results),
                previous: processRows(data.comparison)
            };
        }

        return processRows(data.results);
    } catch (error) {
        console.error("Erro ao buscar campanhas:", error);
        return [];
    }
};

export const getGoogleOverview = async (userId: string, dateRange?: { start: string, end: string }, campaignId?: string, compareDateRange?: { start: string, end: string }, customerId?: string) => {
    try {
        const body: any = { 
            user_id: userId, 
            date_range: dateRange,
            campaign_id: campaignId,
            customer_id: customerId
        };

        if (compareDateRange?.start && compareDateRange?.end) {
            body.compare_start = compareDateRange.start;
            body.compare_end = compareDateRange.end;
        }

        const data = await apiCall('/api/google-ads/overview', body);

        const processRows = (rows: any[]) => (rows || []).map((row: any) => ({
            date: row.segments.date,
            clicks: parseInt(row.metrics.clicks) || 0,
            impressions: parseInt(row.metrics.impressions) || 0,
            spend: (parseInt(row.metrics.costMicros) || 0) / 1000000,
            conversions: parseFloat(row.metrics.conversions) || 0,
            conversionsValue: parseFloat(row.metrics.conversionsValue) || 0
        }));

        if (data.comparison) {
            return {
                current: processRows(data.results),
                previous: processRows(data.comparison)
            };
        }

        return processRows(data.results);
    } catch (error) {
        console.error("Erro ao buscar overview:", error);
        return [];
    }
};

export const getGoogleAdGroups = async (userId: string, dateRange?: { start: string, end: string }, customerId?: string) => {
    try {
        const data = await apiCall('/api/google-ads/ad-groups', { user_id: userId, date_range: dateRange, customer_id: customerId });
        return (data.results || []).map((row: any) => ({
            id: row.adGroup.id,
            name: row.adGroup.name,
            campaignName: row.campaign.name,
            status: row.adGroup.status,
            clicks: parseInt(row.metrics.clicks) || 0,
            impressions: parseInt(row.metrics.impressions) || 0,
            spend: (parseInt(row.metrics.costMicros) || 0) / 1000000,
            conversions: parseFloat(row.metrics.conversions) || 0,
            conversionsValue: parseFloat(row.metrics.conversionsValue) || 0
        }));
    } catch (error) {
        console.error("Erro ao buscar ad groups:", error);
        return [];
    }
};

export const getGoogleKeywords = async (userId: string, dateRange?: { start: string, end: string }, customerId?: string) => {
    try {
        const data = await apiCall('/api/google-ads/keywords', { user_id: userId, date_range: dateRange, customer_id: customerId });
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
            conversions: parseFloat(row.metrics.conversions) || 0,
            conversionsValue: parseFloat(row.metrics.conversionsValue) || 0
        }));
    } catch (error) {
        console.error("Erro ao buscar keywords:", error);
        return [];
    }
};

export const getGoogleAds = async (userId: string, dateRange?: { start: string, end: string }, customerId?: string) => {
    try {
        const data = await apiCall('/api/google-ads/ads', { user_id: userId, date_range: dateRange, customer_id: customerId });
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

export const getGoogleAssetGroups = async (userId: string, dateRange: { start: string, end: string }, campaignId: string, customerId?: string) => {
    try {
        const data = await apiCall('/api/google-ads/asset-groups', { 
            user_id: userId, 
            date_range: dateRange,
            campaign_id: campaignId,
            customer_id: customerId
        });
        return (data.results || []).map((row: any) => ({
            id: row.assetGroup.id,
            name: row.assetGroup.name,
            status: row.assetGroup.status,
            clicks: parseInt(row.metrics.clicks) || 0,
            impressions: parseInt(row.metrics.impressions) || 0,
            spend: (parseInt(row.metrics.costMicros) || 0) / 1000000,
            conversions: parseFloat(row.metrics.conversions) || 0,
            conversionsValue: parseFloat(row.metrics.conversionsValue) || 0
        }));
    } catch (error) {
        console.error("Erro ao buscar asset groups:", error);
        return [];
    }
};

export const getGooglePmaxAssets = async (userId: string, dateRange: { start: string, end: string }, campaignId: string, customerId?: string) => {
    try {
        const data = await apiCall('/api/google-ads/pmax-assets', { 
            user_id: userId, 
            date_range: dateRange,
            campaign_id: campaignId,
            customer_id: customerId
        });
        return (data.results || []).map((row: any) => ({
            name: row.asset.name || row.asset.textAsset?.text || 'Recurso sem nome',
            type: row.asset.type,
            fieldType: row.assetGroupAsset.fieldType,
            assetGroupName: row.assetGroup.name,
            impressions: parseInt(row.metrics.impressions) || 0,
            clicks: parseInt(row.metrics.clicks) || 0
        }));
    } catch (error) {
        console.error("Erro ao buscar recursos pmax:", error);
        return [];
    }
};

export const getGoogleSearchTerms = async (userId: string, dateRange: { start: string, end: string }, customerId?: string) => {
    try {
        const data = await apiCall('/api/google-ads/search-terms', { 
            user_id: userId, 
            date_range: dateRange,
            customer_id: customerId
        });
        return (data.results || []).map((row: any) => ({
            searchTerm: row.searchTermView.searchTerm,
            campaignName: row.campaign.name,
            adGroupName: row.adGroup.name,
            clicks: parseInt(row.metrics.clicks) || 0,
            impressions: parseInt(row.metrics.impressions) || 0,
            spend: (parseInt(row.metrics.costMicros) || 0) / 1000000,
            conversions: parseFloat(row.metrics.conversions) || 0,
            ctr: parseFloat(row.metrics.ctr) || 0
        }));
    } catch (error) {
        console.error("Erro ao buscar search terms:", error);
        return [];
    }
};

export const getGoogleMccOverview = async (userId: string, dateRange: { start: string, end: string }) => {
    try {
        const data = await apiCall('/api/google-ads/mcc-overview', { 
            user_id: userId, 
            date_range: dateRange
        });
        return data.results || [];
    } catch (error) {
        console.error("Erro ao buscar MCC overview:", error);
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
