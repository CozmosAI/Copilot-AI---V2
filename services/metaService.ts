
const META_API_VERSION = 'v19.0';
const GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}`;

const handleMetaResponse = async (response: Response) => {
  const text = await response.text();
  let data;
  try {
      data = text ? JSON.parse(text) : {};
  } catch {
      throw new Error('Resposta inválida do Meta Ads');
  }
  return { ok: response.ok, data };
};

export const getMetaAdAccounts = async (token: string) => {
  try {
    const response = await fetch(`${GRAPH_URL}/me/adaccounts?fields=name,id,currency,account_status&access_token=${token}`);
    const { ok, data } = await handleMetaResponse(response);
    
    if (!ok) {
        throw new Error('Falha ao buscar contas de anúncio');
    }

    if (data.error) throw new Error(data.error.message);
    return data.data || [];
  } catch (error) {
    console.error("Meta API Error:", error);
    throw error;
  }
};

export const getMetaCampaigns = async (accountId: string, token: string) => {
  try {
    // Busca campanhas ativas ou pausadas (ignora arquivadas/deletadas)
    const response = await fetch(`${GRAPH_URL}/${accountId}/campaigns?fields=name,id,status,objective,effective_status&effective_status=['ACTIVE','PAUSED']&access_token=${token}`);
    const { ok, data } = await handleMetaResponse(response);
    
    if (!ok) {
        return [];
    }

    if (data.error) throw new Error(data.error.message);
    return data.data || [];
  } catch (error) {
    console.error("Meta Campaigns Error:", error);
    return [];
  }
};

export const getCampaignInsights = async (campaignId: string, token: string, range?: { start: string, end: string }) => {
  // Adiciona CPC e CTR aos campos solicitados
  let url = `${GRAPH_URL}/${campaignId}/insights?fields=spend,clicks,impressions,actions,cpc,ctr&access_token=${token}`;
  
  // Aplica filtro de data se fornecido
  if (range) {
    const timeRange = JSON.stringify({ 'since': range.start, 'until': range.end });
    url += `&time_range=${encodeURIComponent(timeRange)}`;
  } else {
    url += `&date_preset=maximum`; // Padrão se não houver data
  }

  try {
    const response = await fetch(url);
    const { ok, data } = await handleMetaResponse(response);
    
    if (!ok) {
        // Se falhar o insight específico, retorna zerado para não quebrar o map
        return { spend: 0, clicks: 0, impressions: 0, conversions: 0, cpc: 0, ctr: 0 };
    }

    if (data.error) throw new Error(data.error.message);
    
    // Se não tiver dados (campanha rodou mas não gastou no período, ou array vazio), retorna zeros
    const insights = data.data?.[0] || {};
    
    // Calcula conversões somando eventos relevantes
    const actions = insights.actions || [];
    const conversions = actions
      .filter((a: any) => 
        ['lead', 'purchase', 'contact', 'schedule', 'submit_application', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.messaging_conversation_started_7d']
        .includes(a.action_type)
      )
      .reduce((sum: number, item: any) => sum + Number(item.value), 0);
    
    return {
      spend: parseFloat(insights.spend || '0'),
      clicks: parseInt(insights.clicks || '0'),
      impressions: parseInt(insights.impressions || '0'),
      conversions: conversions,
      cpc: parseFloat(insights.cpc || '0'),
      ctr: parseFloat(insights.ctr || '0')
    };

  } catch (error) {
    console.warn(`Erro ao buscar insights da campanha ${campaignId}:`, error);
    return { spend: 0, clicks: 0, impressions: 0, conversions: 0, cpc: 0, ctr: 0 };
  }
};
