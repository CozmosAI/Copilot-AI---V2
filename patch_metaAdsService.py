import re

with open('services/metaAdsService.ts', 'r') as f:
    content = f.read()

new_functions = """
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
"""

if 'toggleMetaCampaignStatus' not in content:
    content += "\n" + new_functions

with open('services/metaAdsService.ts', 'w') as f:
    f.write(content)

print("Done patching metaAdsService.ts")
