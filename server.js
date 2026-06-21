
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from "@google/genai";
import PDFDocument from 'pdfkit';
import crypto from 'crypto';

// Carrega variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- SUPABASE SETUP ---
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY ausente. Rotas CRM/Uazapi precisam dela.");
}
const supabaseAdmin = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY
);

// --- GEMINI SETUP ---
const API_KEY = process.env.API_KEY;
let aiClient = null;
if (API_KEY) {
    aiClient = new GoogleGenAI({ apiKey: API_KEY });
}

// --- CONFIGURAÇÕES GOOGLE ---
const GOOGLE_ADS_DEV_TOKEN = process.env.VITE_GOOGLE_ADS_DEV_TOKEN;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware de Log
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
});

app.use(express.static(path.join(__dirname, 'dist')));

// ==============================================================================
// 1. GERAR URL DE LOGIN (Para o Frontend)
// ==============================================================================
app.get('/api/auth/google-ads/url', (req, res) => {
    const { redirect_uri } = req.query;
    
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not set' });

    const scope = [
        'https://www.googleapis.com/auth/adwords'
    ].join(' ');

    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${redirect_uri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
    
    res.json({ url });
});

// ==============================================================================
// 2. TROCAR CODE POR TOKEN & VERIFICAR CONTAS (Callback)
// ==============================================================================
app.post('/api/auth/google-ads/exchange', async (req, res) => {
    const { code, redirect_uri, user_id } = req.body;

    if (!code || !user_id) return res.status(400).json({ error: 'Missing code or user_id' });

    try {
        // 1. Troca o Code por Tokens
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: redirect_uri,
                grant_type: 'authorization_code'
            })
        });

        const tokens = await tokenResponse.json();
        
        if (tokens.error) {
            console.error("Token Exchange Error:", tokens);
            return res.status(400).json({ error: tokens.error_description || tokens.error });
        }

        const { access_token, refresh_token, expires_in } = tokens;
        const expiresAt = Date.now() + (expires_in * 1000);

        // 2. Salvar Tokens Imediatamente (Status Pending se tiver refresh_token, senão Active com o que tem)
        const updatePayload = {
            user_id: user_id,
            access_token: access_token,
            token_expires_at: expiresAt,
            status: 'pending_selection', // Aguardando seleção de conta
            last_sync_at: new Date()
        };
        
        if (refresh_token) {
            updatePayload.refresh_token = refresh_token;
        }

        const { error: dbError } = await supabase.from('google_ads_integrations').upsert(updatePayload, { onConflict: 'user_id' });
        if (dbError) throw new Error("Erro ao salvar tokens: " + dbError.message);

        // 3. Listar Contas Acessíveis
        const listUrl = 'https://googleads.googleapis.com/v23/customers:listAccessibleCustomers';
        const listResp = await fetch(listUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'developer-token': GOOGLE_ADS_DEV_TOKEN,
            }
        });

        const rawText = await listResp.text();
        console.log('listAccessibleCustomers raw response:', rawText);
        let listData;
        try {
            listData = JSON.parse(rawText);
        } catch(e) {
            throw new Error('Google retornou resposta inválida: ' + rawText.substring(0, 200));
        }

        if (!listResp.ok) {
            console.error('Google listAccessibleCustomers error:', JSON.stringify(listData));
            throw new Error('Google API error: ' + JSON.stringify(listData));
        }
        
        const resourceNames = listData.resourceNames || [];

        // Helper para buscar nome da conta
        const fetchCustomerName = async (resourceName) => {
            const customerId = resourceName.replace('customers/', '');
            try {
                const query = `SELECT customer.descriptive_name, customer.id, customer.manager FROM customer LIMIT 1`;
                const searchResp = await fetch(`https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${access_token}`,
                        'developer-token': GOOGLE_ADS_DEV_TOKEN,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ query })
                });
                const searchData = await searchResp.json();
                const customer = searchData.results?.[0]?.customer;
                const name = customer?.descriptiveName || `Conta ${customerId}`;
                const isManager = customer?.manager || false;
                return { id: customerId, name: name, isManager: isManager };
            } catch (e) {
                return { id: customerId, name: `Conta ${customerId} (Erro Nome)`, isManager: false };
            }
        };

        // 4. Lógica de Decisão
        if (resourceNames.length === 0) {
            return res.status(400).json({ error: "Nenhuma conta de anúncios encontrada neste e-mail." });
        }

        if (resourceNames.length === 1) {
            // Apenas 1 conta: Se for MCC, retorna para seleção. Se for cliente, vincula.
            const accountInfo = await fetchCustomerName(resourceNames[0]);
            
            if (accountInfo.isManager) {
                 return res.json({ success: true, mode: 'selection_required', accounts: [accountInfo] });
            }

            await supabase.from('google_ads_integrations').update({
                customer_id: accountInfo.id,
                customer_name: accountInfo.name,
                manager_id: null, // Garante que limpa se não for MCC
                status: 'active'
            }).eq('user_id', user_id);

            return res.json({ success: true, mode: 'auto', account: accountInfo });
        } else {
            // Múltiplas contas: Retorna lista para o Frontend decidir
            // Limitamos a 10 requests paralelos para não estourar rate limit
            const accounts = [];
            const limit = Math.min(resourceNames.length, 10);
            
            for (let i = 0; i < limit; i++) {
                accounts.push(await fetchCustomerName(resourceNames[i]));
            }

            return res.json({ success: true, mode: 'selection_required', accounts });
        }

    } catch (error) {
        console.error("Exchange Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==============================================================================
// 2.1 FINALIZAR SELEÇÃO DE CONTA
// ==============================================================================
app.post('/api/auth/google-ads/select-account', async (req, res) => {
    const { user_id, customer_id, customer_name, manager_id } = req.body;

    if (!user_id || !customer_id) return res.status(400).json({ error: 'Dados incompletos.' });

    try {
        const { error } = await supabase.from('google_ads_integrations').update({
            customer_id: customer_id,
            customer_name: customer_name,
            manager_id: manager_id || null,
            status: 'active'
        }).eq('user_id', user_id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================================================================
// 2.1.5 LISTAR FILHOS DE MCC (Novo Endpoint)
// ==============================================================================
app.post('/api/google-ads/mcc-children', async (req, res) => {
    const { user_id, manager_id } = req.body;

    if (!user_id || !manager_id) return res.status(400).json({ error: 'Missing user_id or manager_id' });

    try {
        const { data: integration } = await supabase
            .from('google_ads_integrations')
            .select('access_token')
            .eq('user_id', user_id)
            .single();

        if (!integration) return res.status(404).json({ error: 'Integration not found' });

        const query = `
            SELECT 
                customer_client.client_customer, 
                customer_client.descriptive_name, 
                customer_client.manager, 
                customer_client.id 
            FROM customer_client 
            WHERE customer_client.level <= 1 
            AND customer_client.status = 'ENABLED'
            AND customer_client.manager = false
        `;

        const searchResp = await fetch(`https://googleads.googleapis.com/v23/customers/${manager_id}/googleAds:search`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${integration.access_token}`,
                'developer-token': GOOGLE_ADS_DEV_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query })
        });

        const searchData = await searchResp.json();
        
        if (searchData.error) {
             throw new Error(searchData.error.message);
        }

        const children = (searchData.results || []).map(row => ({
            id: row.customerClient.id,
            name: row.customerClient.descriptiveName || `Conta ${row.customerClient.id}`,
            isManager: row.customerClient.manager
        }));

        res.json({ children });

    } catch (error) {
        console.error("MCC Children Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==============================================================================
// 2.2 VERIFICAR STATUS (Nova Rota para o Frontend)
// ==============================================================================
app.get('/api/google-ads/status/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const { data } = await supabase
            .from('google_ads_integrations')
            .select('status, customer_name')
            .eq('user_id', userId)
            .single();
            
        if (data && data.status === 'active') {
            res.json({ connected: true, accountName: data.customer_name });
        } else {
            res.json({ connected: false });
        }
    } catch (error) {
        res.status(500).json({ connected: false, error: error.message });
    }
});

// ==============================================================================
// 3. BUSCAR DADOS (Usando Token do Banco)
// ==============================================================================

// Helper para validar e renovar token
async function getValidAccessToken(user_id, overrideCustomerId = null) {
    // 1. Buscar credenciais no banco
    const { data: integration, error } = await supabase
        .from('google_ads_integrations')
        .select('*')
        .eq('user_id', user_id)
        .single();

    if (error || !integration) throw new Error('Integração não encontrada.');
    
    if (integration.status === 'pending_selection') {
        throw new Error('Seleção de conta pendente.');
    }

    let accessToken = integration.access_token;
    const refreshToken = integration.refresh_token;
    
    // Default: Usar a conta vinculada no banco
    let customerId = integration.customer_id;
    let managerId = integration.manager_id;

    if (!customerId) throw new Error('Nenhuma conta de anúncios vinculada.');

    // 2. Verificar Validade e Renovar se necessário
    if (Date.now() > (integration.token_expires_at - 60000)) { // 1 min de margem
        console.log("Token vencido. Renovando...");
        const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token'
            })
        });

        const refreshData = await refreshResp.json();
        if (refreshData.error) {
            await supabase.from('google_ads_integrations').update({ status: 'error' }).eq('user_id', user_id);
            throw new Error('Falha ao renovar token. Reconecte a conta.');
        }

        accessToken = refreshData.access_token;
        const newExpiry = Date.now() + (refreshData.expires_in * 1000);

        await supabase.from('google_ads_integrations').update({
            access_token: accessToken,
            token_expires_at: newExpiry,
            status: 'active'
        }).eq('user_id', user_id);
    }

    // Lógica de Override (MCC View)
    if (overrideCustomerId) {
        managerId = customerId;
        customerId = overrideCustomerId;
    }

    const cleanId = customerId.replace(/-/g, '');
    
    // Headers padrão para chamadas
    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': GOOGLE_ADS_DEV_TOKEN,
        'Content-Type': 'application/json'
    };

    if (managerId) {
        headers['login-customer-id'] = managerId.replace(/-/g, '');
    }

    return { accessToken, cleanId, headers, managerId };
}

// Helper para executar query no Google Ads
async function executeGoogleAdsQuery(user_id, query, checkMcc = false, customerId = null) {
    const { cleanId, headers, managerId } = await getValidAccessToken(user_id, customerId);

    const adsResp = await fetch(`https://googleads.googleapis.com/v23/customers/${cleanId}/googleAds:search`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ query })
    });

    const adsData = await adsResp.json();
    
    if (adsData.error) {
        // Tratamento específico para erro de MCC
        if (adsData.error.message.includes('REQUESTED_METRICS_FOR_MANAGER') && !managerId) {
             throw new Error('Esta é uma conta gerenciadora (MCC). Por favor, desconecte e selecione uma conta cliente.');
        }
        console.error('Google Ads Query Error:', JSON.stringify(adsData.error));
        throw new Error(adsData.error.message || JSON.stringify(adsData.error));
    }

    const results = adsData.results || [];

    // Verificação extra de MCC se solicitado (apenas para queries que podem retornar vazio em MCC)
    if (checkMcc && results.length === 0 && !managerId && !customerId) {
         try {
            const mccQuery = `SELECT customer.manager FROM customer LIMIT 1`;
            const mccResp = await fetch(`https://googleads.googleapis.com/v23/customers/${cleanId}/googleAds:search`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ query: mccQuery })
            });
            const mccData = await mccResp.json();
            const isManager = mccData.results?.[0]?.customer?.manager;

            if (isManager) {
                throw new Error('Esta é uma conta gerenciadora (MCC). Selecione uma conta cliente para ver campanhas.');
            }
         } catch (e) {
             if (e.message.includes('MCC')) throw e;
             console.error("Erro ao verificar MCC:", e);
         }
    }

    return results;
}

// Rota: Campanhas (Mantida e refatorada)
app.post('/api/google-ads/campaigns', async (req, res) => {
    let { user_id, date_range, compare_start, compare_end, customer_id } = req.body;

    if (!date_range || !date_range.start || !date_range.end) {
        const end = new Date().toISOString().split('T')[0];
        const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        date_range = { start, end };
    }

    const buildQuery = (start, end) => `
        SELECT 
            campaign.id, 
            campaign.name, 
            campaign.status, 
            campaign.advertising_channel_type,
            campaign_budget.amount_micros,
            metrics.clicks, 
            metrics.impressions, 
            metrics.cost_micros, 
            metrics.conversions,
            metrics.conversions_value,
            metrics.ctr,
            metrics.average_cpc
        FROM campaign 
        WHERE campaign.status != 'REMOVED' 
        AND segments.date BETWEEN '${start}' AND '${end}'
    `;

    try {
        const currentQuery = buildQuery(date_range.start, date_range.end);
        
        const promises = [executeGoogleAdsQuery(user_id, currentQuery, true, customer_id)];
        
        if (compare_start && compare_end) {
            const compareQuery = buildQuery(compare_start, compare_end);
            promises.push(executeGoogleAdsQuery(user_id, compareQuery, true, customer_id));
        }

        const [currentResults, compareResults] = await Promise.all(promises);
        
        res.json({ 
            results: currentResults,
            comparison: compareResults || [] 
        });

    } catch (error) {
        console.error("Ads Fetch Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Rota: Overview (Gráfico)
app.post('/api/google-ads/overview', async (req, res) => {
    const { user_id, date_range, campaign_id, compare_start, compare_end, customer_id } = req.body;
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const campaignFilter = campaign_id ? `AND campaign.id = ${campaign_id}` : '';
        
        const buildQuery = (start, end) => `
            SELECT 
                segments.date, 
                metrics.clicks, 
                metrics.impressions, 
                metrics.cost_micros, 
                metrics.conversions,
                metrics.conversions_value
            FROM campaign 
            WHERE segments.date BETWEEN '${start}' AND '${end}'
            ${campaignFilter}
        `;

        const currentQuery = buildQuery(date_range.start, date_range.end);
        const promises = [executeGoogleAdsQuery(user_id, currentQuery, false, customer_id)];

        if (compare_start && compare_end) {
            const compareQuery = buildQuery(compare_start, compare_end);
            promises.push(executeGoogleAdsQuery(user_id, compareQuery, false, customer_id));
        }

        const [currentResults, compareResults] = await Promise.all(promises);

        res.json({ 
            results: currentResults,
            comparison: compareResults || []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota: Ad Groups
app.post('/api/google-ads/ad-groups', async (req, res) => {
    const { user_id, date_range, customer_id } = req.body;
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const query = `
            SELECT 
                ad_group.id, 
                ad_group.name, 
                ad_group.status, 
                campaign.name, 
                metrics.clicks, 
                metrics.impressions, 
                metrics.cost_micros, 
                metrics.conversions 
            FROM ad_group 
            WHERE segments.date BETWEEN '${date_range.start}' AND '${date_range.end}'
        `;
        const results = await executeGoogleAdsQuery(user_id, query, false, customer_id);
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota: Keywords
app.post('/api/google-ads/keywords', async (req, res) => {
    const { user_id, date_range, customer_id } = req.body;
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const query = `
            SELECT 
                ad_group_criterion.keyword.text, 
                ad_group_criterion.keyword.match_type, 
                ad_group_criterion.status, 
                ad_group_criterion.quality_info.quality_score, 
                campaign.name, 
                ad_group.name, 
                metrics.clicks, 
                metrics.impressions, 
                metrics.cost_micros, 
                metrics.conversions 
            FROM keyword_view 
            WHERE segments.date BETWEEN '${date_range.start}' AND '${date_range.end}'
        `;
        const results = await executeGoogleAdsQuery(user_id, query, false, customer_id);
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota: Ads
app.post('/api/google-ads/ads', async (req, res) => {
    const { user_id, date_range, customer_id } = req.body;
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const query = `
            SELECT 
                ad_group_ad.ad.id, 
                ad_group_ad.ad.responsive_search_ad.headlines, 
                ad_group_ad.status, 
                campaign.name, 
                ad_group.name, 
                metrics.clicks, 
                metrics.impressions, 
                metrics.cost_micros 
            FROM ad_group_ad 
            WHERE segments.date BETWEEN '${date_range.start}' AND '${date_range.end}'
        `;
        const results = await executeGoogleAdsQuery(user_id, query, false, customer_id);
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota: Asset Groups (P-MAX)
app.post('/api/google-ads/asset-groups', async (req, res) => {
    const { user_id, date_range, campaign_id, customer_id } = req.body;
    if (!user_id || !date_range || !campaign_id) return res.status(400).json({ error: 'Missing params' });

    try {
        const query = `
            SELECT 
                asset_group.id, 
                asset_group.name, 
                asset_group.status, 
                metrics.clicks, 
                metrics.impressions, 
                metrics.cost_micros, 
                metrics.conversions,
                metrics.conversions_value
            FROM asset_group 
            WHERE campaign.id = ${campaign_id}
            AND segments.date BETWEEN '${date_range.start}' AND '${date_range.end}'
        `;
        const results = await executeGoogleAdsQuery(user_id, query, false, customer_id);
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota: PMAX Assets
app.post('/api/google-ads/pmax-assets', async (req, res) => {
    const { user_id, campaign_id, customer_id } = req.body;
    if (!user_id || !campaign_id) return res.status(400).json({ error: 'Missing params' });

    try {
        const campaignResourceName = `customers/${customer_id}/campaigns/${campaign_id}`;
        const query = `
            SELECT 
                asset.name, 
                asset.resource_name, 
                asset.type,
                asset.text_asset.text, 
                asset.image_asset.full_size.url,
                asset.youtube_video_asset.youtube_video_id,
                asset_group_asset.field_type, 
                asset_group_asset.status,
                asset_group.name, 
                asset_group.status
            FROM asset_group_asset
            WHERE asset_group.campaign = '${campaignResourceName}'
        `;
        const results = await executeGoogleAdsQuery(user_id, query, false, customer_id);
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota: Search Terms (NOVA)
app.post('/api/google-ads/search-terms', async (req, res) => {
    const { user_id, date_range, customer_id } = req.body;
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const query = `
            SELECT 
                search_term_view.search_term, 
                campaign.name, 
                ad_group.name,
                metrics.clicks, 
                metrics.impressions, 
                metrics.cost_micros,
                metrics.conversions, 
                metrics.ctr
            FROM search_term_view
            WHERE segments.date BETWEEN '${date_range.start}' AND '${date_range.end}'
            AND metrics.impressions > 0
            ORDER BY metrics.cost_micros DESC
            LIMIT 100
        `;
        const results = await executeGoogleAdsQuery(user_id, query, false, customer_id);
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota: MCC Overview (NOVA)
app.post('/api/google-ads/mcc-overview', async (req, res) => {
    const { user_id, date_range } = req.body;
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        // 1. Busca a lista de contas filhas do MCC
        const accountsQuery = `
            SELECT 
                customer_client.client_customer, 
                customer_client.descriptive_name, 
                customer_client.id
            FROM customer_client
            WHERE customer_client.level = 1
            AND customer_client.status = 'ENABLED'
            AND customer_client.manager = false
        `;
        
        const accountsResults = await executeGoogleAdsQuery(user_id, accountsQuery);
        
        if (!accountsResults || accountsResults.length === 0) {
            return res.json({ results: [] });
        }

        // 2. Para cada conta filha, faz uma query separada de métricas
        const formattedResults = [];
        
        const metricsQuery = `
            SELECT 
                metrics.cost_micros, 
                metrics.clicks, 
                metrics.impressions, 
                metrics.conversions,
                metrics.conversions_value
            FROM customer
            WHERE segments.date BETWEEN '${date_range.start}' AND '${date_range.end}'
        `;

        // Executa as queries em paralelo para todas as contas filhas
        const metricsPromises = accountsResults.map(async (accountRow) => {
            const customerId = accountRow.customerClient.id;
            const accountName = accountRow.customerClient.descriptiveName;
            
            try {
                const metricsResult = await executeGoogleAdsQuery(user_id, metricsQuery, false, customerId);
                
                if (metricsResult && metricsResult.length > 0) {
                    const row = metricsResult[0];
                    formattedResults.push({
                        account_name: accountName,
                        customer_id: customerId,
                        cost: (parseInt(row.metrics.costMicros) || 0) / 1000000,
                        clicks: parseInt(row.metrics.clicks) || 0,
                        impressions: parseInt(row.metrics.impressions) || 0,
                        conversions: parseFloat(row.metrics.conversions) || 0,
                        conversions_value: parseFloat(row.metrics.conversionsValue) || 0
                    });
                } else {
                    // Conta sem dados no período
                    formattedResults.push({
                        account_name: accountName,
                        customer_id: customerId,
                        cost: 0, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0
                    });
                }
            } catch (err) {
                console.error(`Erro ao buscar métricas para conta ${customerId}:`, err.message);
                // Adiciona com zeros em caso de erro (ex: falta de permissão)
                formattedResults.push({
                    account_name: accountName,
                    customer_id: customerId,
                    cost: 0, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0
                });
            }
        });

        await Promise.all(metricsPromises);

        res.json({ results: formattedResults });

    } catch (error) {
        console.error("MCC Overview Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==============================================================================
// 4. SISTEMA DE ALERTAS
// ==============================================================================
app.post('/api/google-ads/check-alerts', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

    try {
        const alerts = [];
        const { cleanId, headers } = await getValidAccessToken(user_id);

        // 1. Orçamento Diário vs Gasto Hoje
        const todayStr = new Date().toISOString().split('T')[0];
        const budgetQuery = `
            SELECT 
                campaign.id, 
                campaign.name, 
                campaign_budget.amount_micros, 
                metrics.cost_micros 
            FROM campaign 
            WHERE segments.date = '${todayStr}' 
            AND campaign.status = 'ENABLED'
        `;
        
        try {
            const budgetResults = await executeGoogleAdsQuery(user_id, budgetQuery);
            budgetResults.forEach(row => {
                const budget = parseInt(row.campaignBudget.amountMicros || '0');
                const cost = parseInt(row.metrics.costMicros || '0');
                
                if (budget > 0 && cost > (budget * 0.9)) {
                    const percent = Math.round((cost / budget) * 100);
                    alerts.push({
                        id: `budget-${row.campaign.id}`,
                        type: 'budget_warning',
                        severity: percent >= 100 ? 'high' : 'medium',
                        message: `A campanha "${row.campaign.name}" consumiu ${percent}% do orçamento diário.`
                    });
                }
            });
        } catch (e) {
            console.error("Erro ao verificar orçamentos:", e);
        }

        // 2. CPL últimos 7 dias vs 7 dias anteriores
        // Datas
        const today = new Date();
        const formatDate = (d) => d.toISOString().split('T')[0];
        
        const last7End = new Date(today); last7End.setDate(today.getDate() - 1);
        const last7Start = new Date(today); last7Start.setDate(today.getDate() - 7);
        
        const prev7End = new Date(today); prev7End.setDate(today.getDate() - 8);
        const prev7Start = new Date(today); prev7Start.setDate(today.getDate() - 14);

        const cplQuery = (start, end) => `
            SELECT 
                metrics.cost_micros, 
                metrics.conversions 
            FROM customer 
            WHERE segments.date BETWEEN '${formatDate(start)}' AND '${formatDate(end)}'
        `;

        try {
            const [currentStats, prevStats] = await Promise.all([
                executeGoogleAdsQuery(user_id, cplQuery(last7Start, last7End)),
                executeGoogleAdsQuery(user_id, cplQuery(prev7Start, prev7End))
            ]);

            const calcCPA = (rows) => {
                const cost = rows.reduce((acc, r) => acc + parseInt(r.metrics.costMicros || '0'), 0);
                const conv = rows.reduce((acc, r) => acc + parseFloat(r.metrics.conversions || '0'), 0);
                return conv > 0 ? (cost / conv) / 1000000 : 0;
            };

            const currentCPA = calcCPA(currentStats);
            const prevCPA = calcCPA(prevStats);

            if (prevCPA > 0 && currentCPA > (prevCPA * 1.2)) {
                const increase = Math.round(((currentCPA - prevCPA) / prevCPA) * 100);
                alerts.push({
                    id: 'cpl-warning',
                    type: 'cpl_warning',
                    severity: 'medium',
                    message: `O Custo por Lead (CPL) aumentou ${increase}% nos últimos 7 dias (R$ ${currentCPA.toFixed(2)}) vs período anterior.`
                });
            }
        } catch (e) {
            console.error("Erro ao verificar CPL:", e);
        }

        // 3. Campanhas Pausadas nas últimas 24h
        const pausedQuery = `
            SELECT 
                change_event.change_time, 
                change_event.new_resource,
                change_event.campaign
            FROM change_event 
            WHERE change_event.change_resource_type = 'CAMPAIGN' 
            AND change_event.resource_change_operation = 'UPDATE' 
            AND change_event.change_time DURING LAST_24_HOURS
            LIMIT 50
        `;

        try {
            const pausedResults = await executeGoogleAdsQuery(user_id, pausedQuery);
            
            pausedResults.forEach(row => {
                // Verifica se o novo status é PAUSED e se o campo status foi alterado
                const changedFields = row.changeEvent.changedFields?.paths || [];
                if (changedFields.includes('status') && row.changeEvent.newResource.campaign.status === 'PAUSED') {
                    const name = row.changeEvent.newResource.campaign.name || 'Campanha';
                    alerts.push({
                        id: `paused-${row.changeEvent.changeTime}`,
                        type: 'status_change',
                        severity: 'high',
                        message: `A campanha "${name}" foi pausada nas últimas 24h.`
                    });
                }
            });
        } catch (e) {
            console.error("Erro ao verificar campanhas pausadas:", e);
            // change_event pode falhar dependendo das permissões ou tipo de conta, não bloqueamos o resto
        }

        res.json({ alerts });

    } catch (error) {
        console.error("Alert Check Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==============================================================================
// 5. GERAR RELATÓRIO PDF
// ==============================================================================
app.post('/api/google-ads/generate-report', async (req, res) => {
    const { 
        client_name, 
        agency_name, 
        date_range, 
        logo_url, 
        kpis, 
        campaigns, 
        chart_image 
    } = req.body;

    try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
            const pdfBuffer = Buffer.concat(chunks);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=relatorio.pdf');
            res.send(pdfBuffer);
        });

        // Formata valores monetários
        const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
        const formatNumber = (val) => new Intl.NumberFormat('pt-BR').format(val);

        // Header
        doc.fontSize(24).font('Helvetica-Bold').fillColor('#0f172a').text(agency_name || 'Agência', { align: 'left' });
        doc.fontSize(14).font('Helvetica').fillColor('#64748b').text('Relatório de Performance Google Ads', { align: 'left' });
        doc.moveDown(1);
        
        // Meta info
        doc.fontSize(12).fillColor('#64748b');
        doc.text(`Cliente: ${client_name || 'N/A'}`, { align: 'right' });
        doc.text(`Período: ${date_range.start} a ${date_range.end}`, { align: 'right' });
        doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, { align: 'right' });
        
        doc.moveDown(2);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').stroke();
        doc.moveDown(2);

        // KPIs Section
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#3b82f6').text('Resumo de KPIs');
        doc.moveDown(1);

        const kpiY = doc.y;
        const colWidth = 160;
        
        // Row 1
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#64748b').text('INVESTIMENTO', 50, kpiY);
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text(kpis.cost, 50, kpiY + 15);
        
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#64748b').text('IMPRESSÕES', 50 + colWidth, kpiY);
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text(kpis.impressions, 50 + colWidth, kpiY + 15);
        
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#64748b').text('CLIQUES', 50 + colWidth * 2, kpiY);
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text(kpis.clicks, 50 + colWidth * 2, kpiY + 15);

        // Row 2
        const kpiY2 = kpiY + 50;
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#64748b').text('CONVERSÕES', 50, kpiY2);
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text(kpis.conversions, 50, kpiY2 + 15);
        
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#64748b').text('CTR', 50 + colWidth, kpiY2);
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text(kpis.ctr, 50 + colWidth, kpiY2 + 15);
        
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#64748b').text('CPC MÉDIO', 50 + colWidth * 2, kpiY2);
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text(kpis.cpc, 50 + colWidth * 2, kpiY2 + 15);

        doc.moveDown(4);

        // Campaigns Table
        doc.x = 50;
        doc.y = kpiY2 + 60;
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#3b82f6').text('Detalhamento por Campanha');
        doc.moveDown(1);

        const tableTop = doc.y;
        const cols = [
            { x: 50, w: 150, label: 'Campanha' },
            { x: 200, w: 70, label: 'Status' },
            { x: 270, w: 70, label: 'Impr.' },
            { x: 340, w: 70, label: 'Cliques' },
            { x: 410, w: 70, label: 'Custo' },
            { x: 480, w: 70, label: 'Conv.' }
        ];

        // Table Header
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#475569');
        cols.forEach(col => {
            doc.text(col.label, col.x, tableTop);
        });
        
        doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#e2e8f0').stroke();
        
        // Table Rows
        let rowY = tableTop + 25;
        doc.font('Helvetica').fillColor('#334155');
        
        campaigns.forEach((c, i) => {
            if (rowY > 700) {
                doc.addPage();
                rowY = 50;
            }
            
            // Truncate campaign name if too long
            let campName = c.name;
            if (campName.length > 25) campName = campName.substring(0, 22) + '...';
            
            doc.text(campName, cols[0].x, rowY);
            doc.text(c.status, cols[1].x, rowY);
            doc.text(formatNumber(c.impressions), cols[2].x, rowY);
            doc.text(formatNumber(c.clicks), cols[3].x, rowY);
            doc.text(formatCurrency(c.cost), cols[4].x, rowY);
            doc.text(formatNumber(c.conversions), cols[5].x, rowY);
            
            rowY += 20;
            doc.moveTo(50, rowY - 5).lineTo(550, rowY - 5).strokeColor('#f1f5f9').stroke();
        });

        // Footer
        doc.fontSize(10).fillColor('#94a3b8').text(
            `Relatório gerado automaticamente por ${agency_name || 'Sistema de Gestão'}.`,
            50,
            750,
            { align: 'center' }
        );

        doc.end();

    } catch (error) {
        console.error("PDF Generation Error:", error);
        res.status(500).json({ error: 'Falha ao gerar relatório PDF: ' + error.message });
    }
});

// ==============================================================================
// UTILITÁRIO: REFRESH GENÉRICO (Para Calendar, se necessário)
// ==============================================================================
app.post('/api/google/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'No refresh token' });

    try {
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token'
            })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error_description);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ... (Resto das rotas do AXIS, WhatsApp e Catch-all mantidas)

// Mock do Context Builder (Simulando Drizzle/Neon)
async function buildClinicContext(clinicId) {
  return {
    financeiro: {
      receitaMes: "R$ 145.000,00",
      lucroLiquido: "R$ 42.000,00",
      meta: "85%",
      pendencias: 3
    },
    marketing: {
      leadsHoje: 12,
      campanhaAtiva: "Botox Week",
      custoPorLead: "R$ 15,40"
    },
    agenda: {
      ocupacaoHoje: "78%",
      proximaVaga: "14:30",
      faltasOntem: 2
    },
    vendas: {
      conversasAtivas: 24,
      taxaConversao: "18%"
    }
  };
}

app.post('/api/axis/chat', async (req, res) => {
    try {
        const { message, clinicId, context } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Mensagem vazia' });
        }

        if (!aiClient) {
             return res.status(500).json({ response: "IA não configurada (API Key ausente)." });
        }

        // 1. Buscar dados reais (Context Augmentation)
        const dbData = await buildClinicContext(clinicId || 'demo');

        // 2. Construir System Prompt
        const systemPrompt = `
          Você é o AXIS, o Conselheiro de Inteligência Artificial da Clínica.
          Você tem acesso em tempo real a todos os dados.
          
          DADOS ATUAIS DO SISTEMA:
          ${JSON.stringify(dbData, null, 2)}
          
          CONTEXTO DO USUÁRIO:
          ${JSON.stringify(context || {})}

          DIRETRIZES:
          1. Responda sempre em Português Brasileiro.
          2. Seja extremamente conciso (máximo 3 frases curtas). É uma conversa por voz.
          3. Cite números reais fornecidos acima para fundamentar sua resposta.
          4. Seja estratégico e proativo. Sugira uma ação se houver problemas (ex: faltas, leads baixos).
          5. Não use formatação markdown complexa (negrito, listas), use texto corrido natural para fala.
        `;

        // 3. Chamada Gemini
        const response = await aiClient.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{ role: "user", parts: [{ text: message }] }],
            config: {
                systemInstruction: systemPrompt
            }
        });

        const aiResponse = response.text;

        res.json({
            response: aiResponse,
            dataQueried: Object.keys(dbData),
            actions: []
        });

    } catch (error) {
        console.error('AXIS AI Error:', error);
        res.status(500).json({ response: "Desculpe, perdi a conexão com a base de dados. Tente novamente." });
    }
});
// ... (Evolution API requests mantidos) ...

// ==============================================================================
// 12. CRM & UAZAPI INTEGRATION BASE
// ==============================================================================

// Helper de Autenticação
async function getAuthUser(req) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const error = new Error('Não autorizado - SUPABASE_SERVICE_ROLE_KEY ausente no backend. As rotas CRM/Uazapi precisam dela.');
        error.status = 500;
        throw error;
    }
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        const error = new Error('Não autorizado - Bearer token ausente');
        error.status = 401;
        throw error;
    }
    const token = authHeader.split(' ')[1];
    const client = supabaseAdmin || supabase;
    const { data: { user }, error: authError } = await client.auth.getUser(token);
    if (authError || !user) {
        const error = new Error('Não autorizado - Token inválido ou expirado');
        error.status = 401;
        throw error;
    }
    return user;
}

// Helper para Conexões (Sanitização)
function sanitizeCrmConnection(connection) {
    if (!connection) return null;
    const sanitized = { ...connection };
    delete sanitized.instance_token;
    delete sanitized.webhook_secret;
    return sanitized;
}

// Helper para obter URL pública do App de forma robusta e segura
function getPublicUrl(req) {
    let publicUrl =
        process.env.APP_PUBLIC_URL ||
        process.env.APP_BASE_URL ||
        process.env.VITE_BACKEND_URL ||
        `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;

    if (publicUrl.includes('onrender.com') && publicUrl.startsWith('http://')) {
        publicUrl = publicUrl.replace('http://', 'https://');
    }
    return publicUrl.replace(/\/+$/, '');
}

// Função para mapear status da Uazapi pros valores internos
function mapUazapiStatus(payload) {
    if (!payload) {
        return 'error';
    }
    if (payload.error) {
        console.warn(`[Uazapi Status Mapeador] Payload contendo erro: ${payload.message || 'Erro desconhecido'}`);
        return 'error';
    }
    
    // Suportar diferentes locais de state/status/statusResult pelo payload da Uazapi
    const rawStatus = payload.status || (payload.instance && payload.instance.status) || payload.state || payload.connectionStatus;
    
    // Booleans diretos de conexão ou status online em campos diferentes
    const isConnectedBool = payload.connected === true || payload.isConnected === true || payload.online === true;
    const isDisconnectedBool = payload.connected === false || payload.isConnected === false || payload.online === false;

    if (isConnectedBool) return 'connected';
    if (isDisconnectedBool) return 'disconnected';

    if (rawStatus) {
        const s = String(rawStatus).toLowerCase();
        if (s === 'connected' || s === 'open' || s === 'online' || s === 'authenticated' || s === 'authorized' || s === 'logged' || s === 'true') {
            return 'connected';
        }
        if (s === 'disconnected' || s === 'close' || s === 'closed' || s === 'offline' || s === 'not_logged' || s === 'not_connected' || s === 'logout' || s === 'false') {
            return 'disconnected';
        }
        if (s === 'qrcode' || s === 'qr' || s === 'paircode' || s === 'notauthorized') {
            return 'qrcode'; 
        }
    }
    
    // Fallback analisando JSON.stringify(payload).toLowerCase()
    try {
        const str = JSON.stringify(payload).toLowerCase();
        if (str.includes('"connected"') || str.includes('"open"') || str.includes('"authenticated"') || str.includes('"online"')) {
            return 'connected';
        }
        if (str.includes('"disconnected"') || str.includes('"closed"') || str.includes('"offline"') || str.includes('"logout"') || str.includes('"not_logged"') || str.includes('"not_connected"')) {
            return 'disconnected';
        }
        if (str.includes('"qrcode"') || str.includes('"qr"') || str.includes('"paircode"') || str.includes('"notauthorized"')) {
            return 'qrcode';
        }
    } catch (_) {}
    
    return 'connecting';
}

// Helper Uazapi (Request Maker with 10s Timeout)
async function uazapiRequest(connection, pathStr, options = {}) {
    const { id: connectionId, api_base_url, instance_token } = connection;
    if (!api_base_url) {
        return { error: true, message: 'api_base_url ausente na conexão' };
    }
    
    const baseUrl = api_base_url.replace(/\/+$/, '');
    const cleanPath = pathStr.replace(/^\/+/, '');
    const url = `${baseUrl}/${cleanPath}`;
    
    // Log seguro do endpoint que está sendo testado (Tarefa 8: nunca expõe token)
    console.log(`[Uazapi HTTP Request] Testando endpoint seguro na Uazapi: ${cleanPath} para a conexão ${connectionId || 'manual'}`);

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    
    if (instance_token) {
        headers['token'] = instance_token;
        headers['Authorization'] = `Bearer ${instance_token}`;
    }
    
    // Suportar timeout de 10 segundos
    const controller = new AbortController();
    const timeoutVal = options.timeout || 10000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutVal);
    
    const fetchOptions = {
        method: options.method || 'GET',
        headers,
        signal: controller.signal
    };
    
    if (options.body) {
        fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    
    try {
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        
        const text = await response.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            if (!response.ok) {
                return { error: true, message: `Erro Uazapi HTTP ${response.status}: ${text}` };
            }
            return { raw: text };
        }
        
        if (!response.ok) {
            return { error: true, message: json.message || json.error || `Erro Uazapi HTTP ${response.status}` };
        }
        return json;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            console.error(`Erro na requisição Uazapi (${pathStr}): Tempo limite esgotado (${timeoutVal / 1000}s)`);
            return { error: true, message: `Tempo limite esgotado (${timeoutVal / 1000}s) ao se comunicar com a Uazapi` };
        }
        console.error(`Erro na requisição Uazapi (${pathStr}):`, err);
        return { error: true, message: err.message };
    }
}

// ROTA DE HEALTHCHECK: GET /api/crm/health
app.get('/api/crm/health', (req, res) => {
    try {
        const hasUrl = !!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
        const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
        const appPublicUrl = process.env.APP_PUBLIC_URL || process.env.APP_BASE_URL || process.env.VITE_BACKEND_URL || null;
        const appPublicUrlConfigured = !!appPublicUrl;
        
        res.json({
            ok: true,
            supabaseUrlConfigured: hasUrl,
            serviceRoleConfigured: hasServiceRole,
            appPublicUrlConfigured: appPublicUrlConfigured,
            appPublicUrl: appPublicUrl
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ROTA 1: GET /api/crm/connections
app.get('/api/crm/connections', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const client = supabaseAdmin || supabase;
        const { data: connections, error } = await client
            .from('crm_connections')
            .select('*')
            .eq('user_id', user.id);
            
        if (error) throw error;
        
        const sanitized = (connections || []).map(sanitizeCrmConnection);
        res.json({
            ok: true,
            connections: sanitized
        });
    } catch (err) {
        console.error('Erro ao ler conexões CRM:', err);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message || 'Erro ao ler conexões'
        });
    }
});

// ROTA 2: POST /api/crm/connections/uazapi/manual
app.post('/api/crm/connections/uazapi/manual', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { connectionName, apiBaseUrl, instanceToken, instanceName, connectionSettings } = req.body;
        
        if (!connectionName || !apiBaseUrl || !instanceToken) {
            return res.status(400).json({ error: 'Campos obrigatórios: connectionName, apiBaseUrl, instanceToken' });
        }
        
        const webhookSecret = crypto.randomBytes(16).toString('hex');
        
        const insertPayload = {
            user_id: user.id,
            channel: 'whatsapp',
            provider: 'uazapi',
            connection_name: connectionName,
            api_base_url: apiBaseUrl,
            instance_token: instanceToken,
            instance_name: instanceName || null,
            connection_settings: connectionSettings || {},
            connection_status: 'connecting',
            webhook_secret: webhookSecret
        };
        
        const client = supabaseAdmin || supabase;
        const { data: newConn, error: insertError } = await client
            .from('crm_connections')
            .insert(insertPayload)
            .select()
            .single();
            
        if (insertError || !newConn) {
            throw new Error(`Erro ao salvar conexão CRM: ${insertError?.message || 'registro não retornado'}`);
        }
        
        let publicUrl =
            process.env.APP_PUBLIC_URL ||
            process.env.APP_BASE_URL ||
            process.env.VITE_BACKEND_URL ||
            `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;

        if (publicUrl.includes('onrender.com') && publicUrl.startsWith('http://')) {
            publicUrl = publicUrl.replace('http://', 'https://');
        }
        const webhookUrl = `${publicUrl.replace(/\/+$/, '')}/api/webhooks/uazapi/${newConn.id}/${newConn.webhook_secret}`;
        
        const { error: updateWebErr } = await client
            .from('crm_connections')
            .update({ webhook_url: webhookUrl })
            .eq('id', newConn.id);
            
        if (updateWebErr) {
            console.error('[UazAPI Connection] Erro ao salvar webhook_url:', updateWebErr);
        }
        
        const updatedConnRecord = { ...newConn, webhook_url: webhookUrl };
        
        let warning = null;
        let lastStatusPayload = null;
        let connectionStatus = 'connecting';
        let lastError = null;
        let phone = null;
        
        try {
            let statusResult = await uazapiRequest(updatedConnRecord, 'instance/status');
            
            // Tenta o endpoint secundário se falhar
            if ((!statusResult || statusResult.error) && updatedConnRecord.instance_name) {
                console.log(`[Uazapi Status Manual] Endpoint "instance/status" falhou, tentando "instance/status/${updatedConnRecord.instance_name}"...`);
                const secondaryResult = await uazapiRequest(updatedConnRecord, `instance/status/${updatedConnRecord.instance_name}`);
                if (secondaryResult && !secondaryResult.error) {
                    statusResult = secondaryResult;
                }
            }
            
            connectionStatus = mapUazapiStatus(statusResult);
            
            if (statusResult) {
                lastStatusPayload = statusResult;
                if (statusResult.error) {
                    lastError = statusResult.message || 'Não foi possível se comunicar com Uazapi';
                    warning = `Aviso: Conexão criada, mas falhou ao validar status com a Uazapi: ${lastError}`;
                } else if (connectionStatus === 'connected') {
                    phone = statusResult.phone || statusResult.number || statusResult.jid || statusResult.wid || 
                            (statusResult.instance && (statusResult.instance.phone || statusResult.instance.number)) || null;
                    if (phone && typeof phone === 'string') {
                        phone = phone.replace(/[^0-9]/g, '');
                    }
                }
            } else {
                lastError = 'Não foi possível se comunicar com Uazapi';
                warning = `Aviso: Conexão criada, mas falhou ao validar status com a Uazapi`;
            }
        } catch (e) {
            lastError = e.message;
            warning = `Aviso: Conexão criada, mas falhou ao validar status: ${lastError}`;
        }
        
        const updatePayload = {
            connection_status: connectionStatus,
            last_status_payload: lastStatusPayload,
            last_error: lastError
        };
        
        if (phone) {
            updatePayload.connected_phone = phone;
        }
        
        const { data: finalRecord, error: finalUpdateErr } = await client
            .from('crm_connections')
            .update(updatePayload)
            .eq('id', newConn.id)
            .select()
            .single();
            
        const finalConnection = finalRecord || { ...updatedConnRecord, ...updatePayload };
        
        res.json({
            ok: true,
            connection: sanitizeCrmConnection(finalConnection),
            warning: warning
        });
        
    } catch (err) {
        console.error('Erro na criação de conexão Uazapi:', err);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message || 'Erro ao criar conexão manual'
        });
    }
});

// ROTA 3: GET /api/crm/connections/:connectionId/status
app.get('/api/crm/connections/:connectionId/status', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { connectionId } = req.params;
        const client = supabaseAdmin || supabase;
        
        const { data: connection, error: connError } = await client
            .from('crm_connections')
            .select('*')
            .eq('id', connectionId)
            .eq('user_id', user.id)
            .single();
            
        if (connError || !connection) {
            return res.status(404).json({
                ok: false,
                error: 'Conexão não encontrada para este usuário'
            });
        }
        
        let statusResult = await uazapiRequest(connection, 'instance/status');
        
        // Se falhar ou der erro, e tiver instance_name, tentar instance/status/{instance_name}
        if ((!statusResult || statusResult.error) && connection.instance_name) {
            console.log(`[Uazapi Status] Endpoint "instance/status" falhou para conexão ${connectionId}, tentando "instance/status/${connection.instance_name}"...`);
            const secondaryResult = await uazapiRequest(connection, `instance/status/${connection.instance_name}`);
            if (secondaryResult && !secondaryResult.error) {
                statusResult = secondaryResult;
            }
        }
        
        const updatedStatus = mapUazapiStatus(statusResult);
        let lastStatusPayload = statusResult;
        let lastError = (statusResult && statusResult.error) ? (statusResult.message || 'Erro desconhecido da Uazapi') : null;
        let phone = null;
        
        if (updatedStatus === 'connected' && statusResult) {
            phone = statusResult.phone || statusResult.number || statusResult.jid || statusResult.wid || 
                    (statusResult.instance && (statusResult.instance.phone || statusResult.instance.number)) || null;
            if (phone && typeof phone === 'string') {
                phone = phone.replace(/[^0-9]/g, ''); // só dígitos
            }
        }
        
        const updateFields = {
            last_status_payload: lastStatusPayload,
            last_error: lastError,
            connection_status: updatedStatus,
            updated_at: new Date()
        };
        
        if (phone) {
            updateFields.connected_phone = phone;
        }
        
        let updatedConnection = null;
        let { data: upConn, error: updateError } = await client
            .from('crm_connections')
            .update(updateFields)
            .eq('id', connectionId)
            .select()
            .single();
            
        if (updateError) {
            console.warn(`[Uazapi Status Update] Erro ao atualizar status (${updatedStatus}), tentando fallback...`, updateError.message);
            const fallbackFields = {
                ...updateFields,
                connection_status: 'connecting'
            };
            const { data: fbConn, error: fbErr } = await client
                .from('crm_connections')
                .update(fallbackFields)
                .eq('id', connectionId)
                .select()
                .single();
            if (fbErr) {
                console.error('[Uazapi Status Update] Falha no fallback:', fbErr.message);
            } else {
                updatedConnection = fbConn;
            }
        } else {
            updatedConnection = upConn;
        }
        
        const finalConn = updatedConnection || { ...connection, ...updateFields };
        
        res.json({
            ok: true,
            connection: sanitizeCrmConnection(finalConn),
            statusPayload: statusResult,
            mappedStatus: updatedStatus
        });
        
    } catch (err) {
        console.error('Erro ao verificar status da conexão:', err);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message || 'Erro ao consultar status da conexão'
        });
    }
});

// ROTA 4: DELETE /api/crm/connections/:connectionId
app.delete('/api/crm/connections/:connectionId', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { connectionId } = req.params;
        
        const client = supabaseAdmin || supabase;
        const { data: connection, error: connError } = await client
            .from('crm_connections')
            .select('*')
            .eq('id', connectionId)
            .eq('user_id', user.id)
            .single();
            
        if (connError || !connection) {
            return res.status(404).json({
                ok: false,
                error: 'Conexão não encontrada.'
            });
        }
        
        const { error: deleteError } = await client
            .from('crm_connections')
            .delete()
            .eq('id', connectionId)
            .eq('user_id', user.id);
            
        if (deleteError) {
            throw deleteError;
        }
        
        res.json({ ok: true });
    } catch (err) {
        console.error('Erro ao deletar conexão CRM:', err);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message || 'Erro ao deletar conexão.'
        });
    }
});

// NOVO ENDPOINT: POST /api/crm/connections/uazapi/create-instance
app.post('/api/crm/connections/uazapi/create-instance', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { connectionName, systemName, adminField01, adminField02 } = req.body;
        
        if (!connectionName) {
            return res.status(400).json({ ok: false, error: 'O nome da conexão é obrigatório.' });
        }
        
        const adminToken = process.env.UAZAPI_ADMIN_TOKEN;
        const apiBaseUrl = process.env.UAZAPI_BASE_URL || 'https://task-ai.uazapi.com';
        
        if (!adminToken) {
            console.error('[Uazapi Create Instance] UAZAPI_ADMIN_TOKEN ausente nas variáveis de ambiente.');
            return res.status(400).json({ 
                ok: false, 
                error: 'Servidor não configurado com UAZAPI_ADMIN_TOKEN. Por favor, adicione-o nas variáveis de ambiente da AXIS.' 
            });
        }
        
        const url = `${apiBaseUrl.replace(/\/+$/, '')}/instance/init`;
        const headers = {
            'Content-Type': 'application/json',
            'admintoken': adminToken
        };
        const bodyValue = {
            name: connectionName,
            systemName: systemName || "AXIS AI",
            adminField01: adminField01 || "AXIS CRM",
            adminField02: adminField02 || user.id
        };
        
        console.log(`[Uazapi Create Instance] Chamando /instance/init em ${apiBaseUrl}...`);
        
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(bodyValue)
        });
        
        const resultText = await response.text();
        let resultJson;
        try {
            resultJson = JSON.parse(resultText);
        } catch (_) {
            return res.status(400).json({ 
                ok: false, 
                error: `Uazapi retornou resposta não-JSON: ${resultText}` 
            });
        }
        
        if (!response.ok || (resultJson && resultJson.error)) {
            return res.status(400).json({ 
                ok: false, 
                error: (resultJson && resultJson.message) || `Uazapi HTTP Error ${response.status}: ${JSON.stringify(resultJson)}` 
            });
        }
        
        // Extrair token, id, name defensivamente
        const instance_token = resultJson.instance_token || resultJson.token || (resultJson.instance && (resultJson.instance.instance_token || resultJson.instance.token)) || null;
        const instance_id = resultJson.instance_id || resultJson.id || (resultJson.instance && (resultJson.instance.instance_id || resultJson.instance.id)) || null;
        const instance_name = resultJson.instance_name || resultJson.name || (resultJson.instance && (resultJson.instance.instance_name || resultJson.instance.name)) || null;
        
        if (!instance_token) {
            return res.status(400).json({ 
                ok: false, 
                error: 'Instância criada com sucesso na Uazapi, mas o token não foi retornado nas propriedades esperadas.',
                raw: resultJson 
            });
        }
        
        const webhookSecret = crypto.randomBytes(16).toString('hex');
        
        const insertPayload = {
            user_id: user.id,
            channel: 'whatsapp',
            provider: 'uazapi',
            connection_name: connectionName,
            api_base_url: apiBaseUrl,
            instance_token: instance_token,
            instance_id: instance_id ? String(instance_id) : null,
            instance_name: instance_name || connectionName,
            connection_status: 'connecting',
            webhook_secret: webhookSecret,
            connection_settings: { createdByAxis: true }
        };
        
        const client = supabaseAdmin || supabase;
        const { data: newConn, error: insertError } = await client
            .from('crm_connections')
            .insert(insertPayload)
            .select()
            .single();
            
        if (insertError || !newConn) {
            throw new Error(`Erro ao salvar nova conexão no banco de dados: ${insertError?.message || 'registro não retornado'}`);
        }
        
        const webhookUrl = `${getPublicUrl(req)}/api/webhooks/uazapi/${newConn.id}/${webhookSecret}`;
        
        const { data: finalConnRecord, error: updateWebErr } = await client
            .from('crm_connections')
            .update({ webhook_url: webhookUrl })
            .eq('id', newConn.id)
            .select()
            .single();
            
        if (updateWebErr) {
            console.error('[UazAPI Create Instance] Erro ao salvar webhook_url:', updateWebErr);
        }
        
        res.json({
            ok: true,
            connection: sanitizeCrmConnection(finalConnRecord || { ...newConn, webhook_url: webhookUrl })
        });
        
    } catch (err) {
        console.error('Erro ao processar criação de instância:', err);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message || 'Erro ao processar criação de instância.'
        });
    }
});

// NOVO ENDPOINT: POST /api/crm/connections/:connectionId/connect
app.post('/api/crm/connections/:connectionId/connect', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { connectionId } = req.params;
        
        const client = supabaseAdmin || supabase;
        const { data: connection, error: connError } = await client
            .from('crm_connections')
            .select('*')
            .eq('id', connectionId)
            .eq('user_id', user.id)
            .single();
            
        if (connError || !connection) {
            return res.status(404).json({
                ok: false,
                error: 'Conexão não encontrada para este usuário.'
            });
        }
        
        if (connection.provider !== 'uazapi') {
            return res.status(400).json({
                ok: false,
                error: 'Essa operação está disponível apenas para conexões Uazapi.'
            });
        }
        
        // Chamar Uazapi POST /instance/connect (sem enviar phone no body)
        console.log(`[Uazapi Connect] Solicitando conexão para ID ${connectionId}...`);
        const resultJson = await uazapiRequest(connection, 'instance/connect', {
            method: 'POST',
            body: {}
        });
        
        if (resultJson && resultJson.error) {
            return res.status(400).json({
                ok: false,
                error: resultJson.message || 'Erro retornado pela Uazapi ao solicitar conexão.'
            });
        }
        
        // Extrair qrCode/qrcode/qr/base64/image/code
        const qrCode = resultJson.qrCode || resultJson.qrcode || resultJson.qr || resultJson.base64 || resultJson.image || resultJson.code || 
                       (resultJson.instance && (resultJson.instance.qrCode || resultJson.instance.qrcode || resultJson.instance.qr)) || null;
        
        let updateFields = {
            connection_status: qrCode ? 'qrcode' : 'connecting',
            last_qr_code: qrCode || null,
            last_status_payload: { ...resultJson, qrCode: qrCode || null },
            updated_at: new Date()
        };
        
        let updatedConnection = null;
        let { data: upConn, error: updateError } = await client
            .from('crm_connections')
            .update(updateFields)
            .eq('id', connectionId)
            .select()
            .single();
            
        if (updateError) {
            console.warn('[Uazapi Connect] Erro na primeira tentativa de persistência, tentando fallback sem coluna last_qr_code ou status qrcode...', updateError.message);
            
            const isColumnMissing = updateError.message.includes('column') || updateError.message.includes('last_qr_code');
            
            const fallbackFields = {
                connection_status: 'connecting', // Sempre seguro se 'qrcode' violar check constraint
                last_status_payload: { 
                    ...resultJson, 
                    qrCode: qrCode || null,
                    last_qr_code_fallback: qrCode || null,
                    original_status: qrCode ? 'qrcode' : 'connecting'
                },
                updated_at: new Date()
            };
            
            if (!isColumnMissing) {
                fallbackFields.last_qr_code = qrCode || null;
            }
            
            const { data: fallbackConn, error: fallbackErr } = await client
                .from('crm_connections')
                .update(fallbackFields)
                .eq('id', connectionId)
                .select()
                .single();
                
            if (fallbackErr) {
                console.error('[Uazapi Connect] Falha definitiva no fallback de persistência:', fallbackErr.message);
                throw fallbackErr;
            }
            updatedConnection = fallbackConn;
        } else {
            updatedConnection = upConn;
        }
        
        res.json({
            ok: true,
            connection: sanitizeCrmConnection(updatedConnection || { ...connection, ...updateFields }),
            qrCode: qrCode,
            raw: resultJson
        });
        
    } catch (err) {
        console.error('Erro ao conectar instância Uazapi:', err);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message || 'Erro ao conectar com a Uazapi.'
        });
    }
});

// ROTA 5: POST /api/crm/connections/:connectionId/configure-webhook
app.post('/api/crm/connections/:connectionId/configure-webhook', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { connectionId } = req.params;
        
        const client = supabaseAdmin || supabase;
        const { data: connection, error: connError } = await client
            .from('crm_connections')
            .select('*')
            .eq('id', connectionId)
            .eq('user_id', user.id)
            .single();
            
        if (connError || !connection) {
            return res.status(404).json({
                ok: false,
                error: 'Conexão não encontrada.'
            });
        }
        
        if (connection.provider !== 'uazapi') {
            return res.status(400).json({
                ok: false,
                error: 'Essa operação é suportada apenas para o provedor Uazapi.'
            });
        }
        
        if (!connection.webhook_url) {
            return res.status(400).json({
                ok: false,
                error: 'Webhook URL não gerado para esta conexão.'
            });
        }
        
        const webhookBody = {
            url: connection.webhook_url,
            webhookUrl: connection.webhook_url,
            enabled: true,
            method: "POST",
            events: ["history", "connection", "messages", "messages_update"],
            excludeMessages: ["wasSentByApi", "isGroupYes"],
            exclude: ["wasSentByApi", "isGroupYes"],
            addUrlEvents: false,
            addUrlTypesMessages: false
        };
        
        const endpoints = [
            { path: 'webhook', method: 'POST' },
            { path: 'webhook/new', method: 'POST' },
            { path: 'webhook/create', method: 'POST' }
        ];
        if (connection.instance_name) {
            endpoints.push({ path: `webhook/set/${connection.instance_name}`, method: 'POST' });
        }
        
        let successResult = null;
        let endpointUsado = null;
        let lastErrDetail = '';
        
        for (const ep of endpoints) {
            try {
                // timeout de 10s via options.timeout
                const result = await uazapiRequest(connection, ep.path, {
                    method: ep.method,
                    body: webhookBody,
                    timeout: 10000
                });
                
                if (result && !result.error) {
                    successResult = result;
                    endpointUsado = ep.path;
                    break;
                } else {
                    lastErrDetail = (result && result.message) || 'Erro sem mensagem específica';
                }
            } catch (err) {
                lastErrDetail = err.message;
            }
        }
        
        if (successResult) {
            // Se o endpoint responder com lista/slot/id, salvar em crm_connections.connection_settings
            let uazapiWebhookId = successResult.id || successResult.webhookId || (successResult.webhook && successResult.webhook.id) || (successResult.result && successResult.result.id) || null;
            let uazapiWebhookSlot = successResult.slot || successResult.webhookSlot || (successResult.webhook && successResult.webhook.slot) || (successResult.result && successResult.result.slot) || null;
            
            const existingSettings = connection.connection_settings || {};
            const updatedSettings = {
                ...existingSettings,
                uazapiWebhookId: uazapiWebhookId || undefined,
                uazapiWebhookSlot: uazapiWebhookSlot || undefined,
                webhookMode: "new_slot",
                webhookEvents: ["history", "connection", "messages", "messages_update"]
            };

            // Remove de dados sensíveis da resposta antes de salvar
            const respostaSemToken = { ...successResult };
            delete respostaSemToken.token;
            delete respostaSemToken.instance_token;
            delete respostaSemToken.key;
            
            const payloadToSave = {
                webhookConfigured: true,
                endpoint: endpointUsado,
                response: respostaSemToken
            };
            
            await client
                .from('crm_connections')
                .update({
                    last_status_payload: payloadToSave,
                    last_error: null,
                    connection_settings: updatedSettings,
                    updated_at: new Date()
                })
                .eq('id', connectionId);
                
            res.json({
                ok: true,
                message: "Webhook AXIS criado em novo slot.",
                endpoint: endpointUsado
            });
        } else {
            const finalErrorMsg = `Falha ao configurar webhook nos endpoints testados. Último erro: ${lastErrDetail}`;
            
            await client
                .from('crm_connections')
                .update({
                    last_error: finalErrorMsg,
                    updated_at: new Date()
                })
                .eq('id', connectionId);
                
            res.status(400).json({
                ok: false,
                error: "Não foi possível criar um novo webhook automaticamente. Abra o painel da Uazapi, vá em Webhooks, use Salvar com um novo e cole o Webhook AXIS."
            });
        }
        
    } catch (err) {
        console.error('Erro ao configurar webhook Uazapi:', err);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message || 'Erro interno ao configurar webhook'
        });
    }
});

// GET /api/crm/connections/:connectionId/webhook-events - Buscar logs de eventos webhook
app.get('/api/crm/connections/:connectionId/webhook-events', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { connectionId } = req.params;
        const client = supabaseAdmin || supabase;
        
        // Validar se a conexão existe e pertence a este user
        const { data: connection, error: connError } = await client
            .from('crm_connections')
            .select('id')
            .eq('id', connectionId)
            .eq('user_id', user.id)
            .single();
            
        if (connError || !connection) {
            return res.status(404).json({
                ok: false,
                error: "Conexão não encontrada ou não pertence a este usuário"
            });
        }
        
        const { data: events, error: eventsError } = await client
            .from('crm_webhook_events')
            .select('*')
            .eq('connection_id', connectionId)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(20);
            
        if (eventsError) throw eventsError;
        
        res.json({
            ok: true,
            events: events || []
        });
    } catch (err) {
        console.error('Erro ao buscar logs de webhook:', err);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message || 'Erro ao buscar eventos'
        });
    }
});

// POST /api/crm/conversations/:conversationId/send - Enviar mensagem de texto outbound do CRM via Uazapi e salvar
app.post('/api/crm/conversations/:conversationId/send', async (req, res) => {
    try {
        // 1. Validar Authorization Bearer com getAuthUser(req)
        const user = await getAuthUser(req);
        const { conversationId } = req.params;
        const { text } = req.body;

        // 2. Validar text obrigatório e não vazio
        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({
                ok: false,
                error: "O texto da mensagem é obrigatório e não pode ser vazio."
            });
        }

        const client = supabaseAdmin || supabase;

        // 3. Buscar crm_conversations por id = conversationId e user_id = user.id
        const { data: conversation, error: convErr } = await client
            .from('crm_conversations')
            .select('*')
            .eq('id', conversationId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (convErr || !conversation) {
            return res.status(404).json({
                ok: false,
                error: "Conversa não encontrada ou não pertence a este usuário."
            });
        }

        // 4. Buscar crm_contacts usando conversation.contact_id
        const { data: contact, error: contactErr } = await client
            .from('crm_contacts')
            .select('*')
            .eq('id', conversation.contact_id)
            .maybeSingle();

        if (contactErr || !contact) {
            return res.status(404).json({
                ok: false,
                error: "Contato associado à conversa não foi encontrado."
            });
        }

        // 5. Buscar crm_connections usando database query na tabela crm_connections
        const { data: connection, error: connErr } = await client
            .from('crm_connections')
            .select('*')
            .eq('id', conversation.connection_id)
            .maybeSingle();

        if (connErr || !connection) {
            return res.status(404).json({
                ok: false,
                error: "Conexão de CRM associada não encontrada."
            });
        }

        // 6. Validar provider = 'uazapi'
        if (connection.provider !== 'uazapi') {
            return res.status(400).json({
                ok: false,
                error: "Esta rota suporta apenas conexão via o provedor 'uazapi'."
            });
        }

        // 7. Montar destino para Uazapi
        let destino = null;
        if (contact.phone) {
            destino = normalizePhone(contact.phone);
        }
        if (!destino && contact.external_chat_id) {
            destino = normalizePhone(contact.external_chat_id);
        }
        if (!destino && contact.external_chat_id) {
            destino = contact.external_chat_id;
        }

        if (!destino) {
            return res.status(400).json({
                ok: false,
                error: "Nenhum número de telefone ou ID externo no formato correto foi encontrado para o contato."
            });
        }

        console.log(`[CRM Send] Enviando mensagem pela Uazapi para conversa ${conversationId}, destino: ${destino}`);

        // 8. Chamar Uazapi /send/text de forma defensiva com Timeout de 15 segundos
        const uazapiUrl = `${connection.api_base_url.replace(/\/$/, '')}/send/text`;
        const headers = {
            'Content-Type': 'application/json',
            'token': connection.instance_token,
            'Authorization': `Bearer ${connection.instance_token}`
        };

        const firstBody = {
            "number": destino,
            "text": text,
            "linkPreview": false,
            "readchat": true,
            "delay": 0
        };

        const fallbackBody = {
            "phone": destino,
            "message": text
        };

        let uazapiError = null;
        let responseJson = null;
        let extMessageId = null;

        // Implementar AbortController para timeout de 15 segundos
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const response = await fetch(uazapiUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(firstBody),
                signal: controller.signal
            });

            const responseText = await response.text();
            clearTimeout(timeoutId);

            if (!response.ok) {
                // Try fallback body
                const fallbackController = new AbortController();
                const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), 15000);

                const fallbackResponse = await fetch(uazapiUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(fallbackBody),
                    signal: fallbackController.signal
                });

                const fallbackText = await fallbackResponse.text();
                clearTimeout(fallbackTimeoutId);

                if (!fallbackResponse.ok) {
                    throw new Error(`Uazapi HTTP Error first body: ${responseText}, fallback body: ${fallbackText}`);
                } else {
                    responseJson = JSON.parse(fallbackText);
                }
            } else {
                responseJson = JSON.parse(responseText);
            }

            if (responseJson && responseJson.key && responseJson.key.id) {
                extMessageId = responseJson.key.id;
            } else if (responseJson && responseJson.id) {
                extMessageId = responseJson.id;
            } else if (responseJson && responseJson.messageId) {
                extMessageId = responseJson.messageId;
            } else {
                extMessageId = "axis_out_" + Date.now();
            }

        } catch (fetchErr) {
            clearTimeout(timeoutId);
            console.error(`[CRM Send] Erro de rede ou timeout ao chamar Uazapi:`, fetchErr);
            uazapiError = fetchErr.message || String(fetchErr);
        }

        // 9. Salvar mensagem outbound
        const finalStatus = uazapiError ? "failed" : "sent";
        const finalExtId = extMessageId || ("axis_out_" + Date.now());

        const outMessageData = {
            user_id: user.id,
            connection_id: conversation.connection_id,
            conversation_id: conversation.id,
            contact_id: conversation.contact_id,
            lead_id: conversation.lead_id || null,
            external_message_id: finalExtId,
            message_direction: "outbound",
            sender_type: "me",
            message_type: "text",
            message_text: text,
            message_status: finalStatus,
            from_me: true,
            raw_payload: responseJson ? sanitizePayloadForDb(responseJson) : { error: uazapiError },
            sent_at: new Date().toISOString()
        };

        function sanitizePayloadForDb(obj) {
            if (!obj) return obj;
            const cloned = JSON.parse(JSON.stringify(obj));
            delete cloned.token;
            delete cloned.instance_token;
            delete cloned.instanceToken;
            return cloned;
        }

        let createdMessage = null;
        try {
            const { data: insertedMsg, error: insertErr } = await client
                .from('crm_messages')
                .insert(outMessageData)
                .select()
                .single();

            if (insertErr) {
                if (insertErr.code === '23505') {
                    console.log(`[CRM Send] Mensagem duplicada ignorada (external_message_id unique constraint): ${finalExtId}`);
                    const { data: extMsg } = await client
                        .from('crm_messages')
                        .select('*')
                        .eq('connection_id', conversation.connection_id)
                        .eq('external_message_id', finalExtId)
                        .maybeSingle();
                    createdMessage = extMsg;
                } else {
                    throw insertErr;
                }
            } else {
                createdMessage = insertedMsg;
            }
        } catch (dbErr) {
            console.error(`[CRM Send] Falha ao tentar salvar crm_messages:`, dbErr);
            return res.status(500).json({
                ok: false,
                error: "Erro do banco de dados ao salvar a tentativa de envio de mensagem."
            });
        }

        // 10. Atualizar conversa e lead se o envio obteve sucesso
        if (!uazapiError && createdMessage) {
            const now = new Date().toISOString();
            
            const { error: updateConvErr } = await client
                .from('crm_conversations')
                .update({
                    last_message_text: text,
                    last_message_type: "text",
                    last_message_at: now,
                    last_sender: "me",
                    unread_count: 0,
                    updated_at: now
                })
                .eq('id', conversationId);

            if (updateConvErr) {
                console.error(`[CRM Send] Falha ao atualizar crm_conversations com última mensagem:`, updateConvErr);
            }

            if (conversation.lead_id) {
                const { error: updateLeadErr } = await client
                    .from('leads')
                    .update({
                        last_message: text,
                        last_sender: "me",
                        last_interaction: now
                    })
                    .eq('id', conversation.lead_id);

                if (updateLeadErr) {
                    console.error(`[CRM Send] Falha ao atualizar lead correspondente à conversa:`, updateLeadErr);
                }
            }

            console.log(`[CRM Send] Mensagem enviada e salva com sucesso: ID ${createdMessage.id}`);
            return res.json({
                ok: true,
                message: createdMessage
            });
        } else {
            console.log(`[CRM Send] Falha ao enviar pela Uazapi: ${uazapiError || 'Desconhecido'}`);
            return res.json({
                ok: false,
                message: createdMessage,
                error: "Erro ao enviar pela Uazapi."
            });
        }

    } catch (err) {
        console.error('Erro geral no endpoint de envio CRM:', err);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message || 'Erro interno ao processar envio de mensagem do CRM'
        });
    }
});

// --- HELPERS E PROCESSADORES DA UAZAPI ---

async function backfillLeadForConversation(connection, contact, conversation, message) {
    try {
        const client = supabaseAdmin || supabase;
        if (!connection || !contact || !conversation) {
            console.log(`[Webhook Uazapi Debug] Parâmetros insuficientes em backfillLeadForConversation.`);
            return;
        }

        let activeLeadId = conversation.lead_id;

        // DB fetch for absolute accuracy
        if (!activeLeadId && conversation.id) {
            const { data: freshConv, error: fetchConvError } = await client
                .from('crm_conversations')
                .select('lead_id')
                .eq('id', conversation.id)
                .maybeSingle();
            if (!fetchConvError && freshConv && freshConv.lead_id) {
                activeLeadId = freshConv.lead_id;
            }
        }

        // se conversation.lead_id já existe, não fazer nada;
        if (activeLeadId) {
            console.log(`[Webhook Uazapi] Conversa ${conversation.id} já possui lead_id ${activeLeadId}. Pulando backfill.`);
            return;
        }

        // se contact.phone ou contact.external_chat_id existir, criar/encontrar lead;
        const phone = contact.phone;
        const externalChatId = contact.external_chat_id || contact.externalChatId;
        const pushName = contact.push_name || contact.pushName || contact.display_name || contact.displayName;

        if (!phone && !externalChatId) {
            console.log(`[Webhook Uazapi] Sem telefone e sem externalChatId para backfill.`);
            return;
        }

        let leadId = null;
        let existingLead = null;

        // Buscar lead existente por phone
        if (phone) {
            const { data, error } = await client
                .from('leads')
                .select('*')
                .eq('user_id', connection.user_id)
                .eq('phone', phone)
                .maybeSingle();
            if (!error && data) {
                existingLead = data;
            }
        }

        // Se não achar por phone, buscar por external_chat_id
        if (!existingLead && externalChatId) {
            const { data, error } = await client
                .from('leads')
                .select('*')
                .eq('user_id', connection.user_id)
                .eq('external_chat_id', externalChatId)
                .maybeSingle();
            if (!error && data) {
                existingLead = data;
            }
        }

        const messageSummary = message?.text || message?.caption || (message?.mediaUrl ? "[mídia]" : "[mensagem]") || "[mensagem]";
        const senderTypeStr = message?.fromMe ? "me" : "contact";
        const interactionTime = message?.timestamp || message?.sentAt || new Date();

        if (existingLead) {
            leadId = existingLead.id;
            console.log(`[Webhook Uazapi] Lead encontrado no backfill: ID ${leadId}`);
            try {
                // Atualizar lead existente (Tarefa 3)
                const updateLeadData = {
                    name: existingLead.name || pushName || 'Lead WhatsApp',
                    phone: phone || existingLead.phone,
                    channel: 'whatsapp',
                    external_chat_id: externalChatId || existingLead.external_chat_id,
                    last_message: messageSummary,
                    last_sender: senderTypeStr,
                    last_interaction: interactionTime
                };
                const { error: updateLeadErr } = await client
                    .from('leads')
                    .update(updateLeadData)
                    .eq('id', leadId);
                if (updateLeadErr) {
                    console.warn(`[Webhook Uazapi] Erro ao atualizar lead no backfill:`, updateLeadErr);
                } else {
                    console.log(`[Webhook Uazapi] Lead criado/atualizado: ID ${leadId}`);
                }
            } catch (upErr) {
                console.error(`[Webhook Uazapi] Erro ao atualizar lead no backfill:`, upErr);
            }
        } else {
            // Criar novo lead
            try {
                const insertLeadData = {
                    user_id: connection.user_id,
                    name: pushName || phone || externalChatId || 'Lead WhatsApp',
                    phone: phone || '',
                    status: 'Novo',
                    temperature: 'Cold',
                    source: 'WhatsApp',
                    channel: 'whatsapp',
                    external_chat_id: externalChatId,
                    last_message: messageSummary,
                    last_sender: senderTypeStr,
                    last_interaction: interactionTime,
                    created_at: new Date()
                };
                const { data: newLead, error: insertLeadErr } = await client
                    .from('leads')
                    .insert(insertLeadData)
                    .select()
                    .single();

                if (insertLeadErr) {
                    console.warn(`[Webhook Uazapi] Erro ao criar lead no backfill (tentando fallback):`, insertLeadErr);
                    const insertBaseData = {
                        user_id: connection.user_id,
                        name: pushName || phone || externalChatId || 'Lead WhatsApp',
                        phone: phone || '',
                        status: 'Novo',
                        temperature: 'Cold',
                        source: 'WhatsApp',
                        created_at: new Date()
                    };
                    const { data: fallbackLead, error: fallbackInsertErr } = await client
                        .from('leads')
                        .insert(insertBaseData)
                        .select()
                        .single();
                    if (fallbackInsertErr) {
                        console.error(`[Webhook Uazapi] Falha no fallback de insercao de leads no backfill:`, fallbackInsertErr);
                    } else if (fallbackLead) {
                        leadId = fallbackLead.id;
                        console.log(`[Webhook Uazapi] Lead criado/atualizado: ID ${leadId}`);
                    }
                } else if (newLead) {
                    leadId = newLead.id;
                    console.log(`[Webhook Uazapi] Lead criado/atualizado: ID ${leadId}`);
                }
            } catch (insErr) {
                console.error(`[Webhook Uazapi] Falha ao criar lead no backfill:`, insErr);
            }
        }

        if (leadId) {
            // atualizar crm_conversations.lead_id;
            const { error: updateConvLeadErr } = await client
                .from('crm_conversations')
                .update({ lead_id: leadId })
                .eq('id', conversation.id);
            if (updateConvLeadErr) {
                console.error(`[Webhook Uazapi] Erro ao atualizar lead_id na conversa ${conversation.id}:`, updateConvLeadErr);
            } else {
                console.log(`[Webhook Uazapi] Conversa vinculada ao lead: ID ${conversation.id}`);
            }

            // atualizar crm_messages.lead_id para mensagens daquela conversa onde lead_id is null;
            const { error: updateMsgLeadErr } = await client
                .from('crm_messages')
                .update({ lead_id: leadId })
                .eq('conversation_id', conversation.id)
                .is('lead_id', null);
            if (updateMsgLeadErr) {
                console.error(`[Webhook Uazapi] Erro ao atualizar lead_id nas mensagens da conversa ${conversation.id}:`, updateMsgLeadErr);
            } else {
                console.log(`[Webhook Uazapi] Mensagens da conversa ${conversation.id} atualizadas com lead_id ${leadId}.`);
            }

            // atualizar leads.conversation_id.
            const { error: updateLeadConvErr } = await client
                .from('leads')
                .update({ conversation_id: conversation.id })
                .eq('id', leadId);
            if (updateLeadConvErr) {
                console.error(`[Webhook Uazapi] Erro ao associar conversation_id ${conversation.id} ao lead ${leadId}:`, updateLeadConvErr);
            } else {
                console.log(`[Webhook Uazapi] Lead ${leadId} associado à conversa ${conversation.id}`);
            }
        }
    } catch (globalBackfillErr) {
        console.error(`[Webhook Uazapi] Erro global na função backfillLeadForConversation:`, globalBackfillErr);
    }
}

// Normaliza telefone (remove sufixos e caracteres não numéricos)
function cleanMarkdownLink(val) {
    if (typeof val !== 'string') return val;
    const match = val.match(/\[([^\]]+)\]\([^)]+\)/);
    if (match) {
        return match[1];
    }
    return val;
}

function sanitizeWebhookPayloadForStorage(obj, depth = 0) {
    if (depth > 12) return "[OMITTED_MAX_DEPTH]";
    if (!obj || typeof obj !== 'object') {
        if (typeof obj === 'string') {
            if (obj.length > 5000) {
                return "[OMITTED_LARGE_STRING]";
            }
        }
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeWebhookPayloadForStorage(item, depth + 1));
    }
    
    const sanitized = {};
    const keysToRedact = [
        'token',
        'instance_token',
        'instancetoken',
        'instanceToken',
        'webhook_secret',
        'authorization',
        'Authorization'
    ];
    
    const keysForLargePayloads = [
        'base64',
        'jpegthumbnail',
        'file',
        'buffer',
        'data',
        'mediadata'
    ];

    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        
        if (keysToRedact.some(k => lowerKey === k.toLowerCase())) {
            sanitized[key] = "[REDACTED]";
        } else if (typeof value === 'string' && value.length > 5000) {
            sanitized[key] = "[OMITTED_LARGE_STRING]";
        } else if (keysForLargePayloads.some(k => lowerKey === k || lowerKey.includes(k)) && typeof value === 'string' && value.length > 100) {
            sanitized[key] = "[OMITTED_MEDIA_PAYLOAD]";
        } else {
            sanitized[key] = sanitizeWebhookPayloadForStorage(value, depth + 1);
        }
    }
    return sanitized;
}

function normalizePhone(value) {
    if (!value) return null;
    let clean = cleanMarkdownLink(value);
    clean = String(clean);
    clean = clean.split('@')[0];
    clean = clean.replace(/\D/g, '');
    return clean || null;
}

// Normaliza external_chat_id (usa valor existente ou phone, preserva identificador do grupo)
function normalizeExternalChatId(value, phone) {
    if (value) return String(value);
    if (phone) return String(phone);
    return null;
}

// Reconstrói e mapeia defensivamente o payload da Uazapi
function normalizeUazapiWebhookPayload(payload) {
    if (!payload) return { eventType: 'unknown', messages: [] };

    // 1. Detectar tipo de evento principal
    let eventType = payload.EventType || payload.event || payload.type || payload.payload_type || payload.eventType || 'unknown';
    eventType = String(eventType).toLowerCase();
    
    // Identificar explicitamente eventos de status/ack
    if (eventType.includes('ack') || eventType.includes('status') || eventType.includes('read') || eventType.includes('delivered') || payload.ack !== undefined || payload.status !== undefined) {
        const containsMessageBubble = payload.messages || payload.message || (payload.data && (payload.data.messages || payload.data.message));
        if (!containsMessageBubble) {
            eventType = 'status_update';
        }
    }
    
    if (eventType.includes('connection') || eventType.includes('presence') || eventType.includes('qr') || eventType.includes('instance') || eventType.includes('state')) {
        eventType = 'connection';
    }

    if (eventType !== 'status_update' && eventType !== 'connection') {
        const containsMessageBubble = payload.messages || payload.message || (payload.data && (payload.data.messages || payload.data.message)) || payload.key;
        if (containsMessageBubble) {
            eventType = 'messages';
        }
    }

    // Extrair lista de mensagens
    let rawMessagesList = [];
    if (Array.isArray(payload.messages)) {
        rawMessagesList = payload.messages;
    } else if (payload.messages) {
        rawMessagesList = [payload.messages];
    } else if (payload.data && Array.isArray(payload.data.messages)) {
        rawMessagesList = payload.data.messages;
    } else if (payload.data && payload.data.messages) {
        rawMessagesList = [payload.data.messages];
    } else if (payload.data && payload.data.message) {
        rawMessagesList = [payload.data.message];
    } else if (payload.message) {
        rawMessagesList = [payload.message];
    } else if (payload.key && (payload.message || payload.messageContent)) {
        rawMessagesList = [payload];
    } else if (payload.data && payload.data.key) {
        rawMessagesList = [payload.data];
    }

    const messages = [];

    for (const raw of rawMessagesList) {
        if (!raw) continue;

        const key = raw.key || (raw.message && raw.message.key) || (payload.data && payload.data.key) || {};
        
        let externalChatId = raw.remoteJid || raw.chatid || raw.chatId || raw.from || raw.to || raw.sender_pn || 
                             (payload.chat && (payload.chat.wa_chatid || payload.chat.wa_chatlid || payload.chat.id)) ||
                             (raw.key && raw.key.remoteJid) || null;
        
        externalChatId = cleanMarkdownLink(externalChatId);
        
        // Detectar se é grupo
        let isGroup = false;
        if (typeof raw.isGroup === 'boolean') {
            isGroup = raw.isGroup;
        } else if (raw.isGroupYes === true || raw.isGroupYes === 'true') {
            isGroup = true;
        } else if (raw.is_group === true || raw.is_group === 'true') {
            isGroup = true;
        } else if (payload.chat && (payload.chat.wa_isGroup === true || payload.chat.wa_isGroup === 'true')) {
            isGroup = true;
        }
        
        if (externalChatId && (externalChatId.includes('@g.us') || externalChatId.includes('-') || externalChatId.includes('@group'))) {
            isGroup = true;
        }

        let rawPhone = raw.sender_pn || raw.chatid ||
                       (payload.chat && (payload.chat.phone || payload.chat.wa_chatid || payload.chat.wa_fastid)) || null;
        
        rawPhone = cleanMarkdownLink(rawPhone);
        
        let phone = null;
        if (rawPhone) {
            if (typeof rawPhone === 'string' && rawPhone.includes(':')) {
                const parts = rawPhone.split(':');
                rawPhone = parts[parts.length - 1];
            }
            phone = normalizePhone(rawPhone);
        }
        
        if (!phone && externalChatId && !isGroup) {
            phone = normalizePhone(externalChatId);
        }

        const externalMessageId = cleanMarkdownLink(raw.messageId || raw.id || raw.messageid || key.id || (raw.key && raw.key.id) || null);
        const pushName = cleanMarkdownLink(raw.pushName || raw.senderName || raw.notifyName || raw.verifiedName ||
                         (payload.chat && (payload.chat.name || payload.chat.wa_name || payload.chat.lead_name)) || null);

        let fromMe = false;
        if (typeof raw.fromMe === 'boolean') {
            fromMe = raw.fromMe;
        } else if (key && typeof key.fromMe === 'boolean') {
            fromMe = key.fromMe;
        } else if (raw.from_me === true || raw.from_me === 'true') {
            fromMe = true;
        }

        let finalType = 'unknown';
        let text = null;
        let caption = null;
        let mediaUrl = null;
        let mediaMimeType = null;
        let mediaFilename = null;
        let durationSeconds = null;
        let sizeBytes = null;
        let thumbnailUrl = null;
        let extraInfo = {};

        const actualMessage = raw.message || raw.messageContent || raw;
        if (actualMessage) {
            // 1. Texto
            text = actualMessage.text || actualMessage.body || actualMessage.conversation || 
                   (actualMessage.extendedTextMessage && (actualMessage.extendedTextMessage.text || actualMessage.extendedTextMessage.conversation)) || null;

            // 2. Imagem
            const img = actualMessage.imageMessage || actualMessage.image;
            if (img || raw.messageType === 'image' || raw.type === 'image' || raw.mediaType === 'image') {
                finalType = 'image';
                if (img) {
                    caption = img.caption || null;
                    mediaUrl = img.url || img.fileUrl || img.directPath || null;
                    mediaMimeType = img.mimetype || img.mimeType || 'image/jpeg';
                    if (img.fileLength) sizeBytes = Number(img.fileLength);
                    if (img.jpegThumbnail) {
                        thumbnailUrl = "[THUMBNAIL_BASE64_OMITTED]";
                    }
                }
            }

            // 3. Áudio / Voz (PTT)
            const aud = actualMessage.audioMessage || actualMessage.audio || actualMessage.voiceMessage || actualMessage.voice;
            if (aud || raw.messageType === 'audio' || raw.type === 'audio' || raw.mediaType === 'audio' || raw.messageType === 'voice' || raw.type === 'voice' || raw.mediaType === 'voice' || raw.ptt === true) {
                const isPtt = (aud && (aud.ptt === true || aud.ptt === 'true')) || raw.ptt === true || String(raw.messageType).toLowerCase().includes('voice') || String(raw.type).toLowerCase().includes('voice');
                finalType = isPtt ? 'voice' : 'audio';
                if (aud) {
                    mediaUrl = aud.url || aud.fileUrl || aud.directPath || null;
                    mediaMimeType = aud.mimetype || aud.mimeType || (isPtt ? 'audio/ogg; codecs=opus' : 'audio/mp3');
                    if (aud.seconds) durationSeconds = Number(aud.seconds);
                    if (aud.duration) durationSeconds = Number(aud.duration);
                    if (aud.durationSeconds) durationSeconds = Number(aud.durationSeconds);
                    if (aud.fileLength) sizeBytes = Number(aud.fileLength);
                }
            }

            // 4. Vídeo
            const vid = actualMessage.videoMessage || actualMessage.video;
            if (vid || raw.messageType === 'video' || raw.type === 'video' || raw.mediaType === 'video') {
                finalType = 'video';
                if (vid) {
                    caption = vid.caption || null;
                    mediaUrl = vid.url || vid.fileUrl || vid.directPath || null;
                    mediaMimeType = vid.mimetype || vid.mimeType || 'video/mp4';
                    if (vid.seconds) durationSeconds = Number(vid.seconds);
                    if (vid.duration) durationSeconds = Number(vid.duration);
                    if (vid.durationSeconds) durationSeconds = Number(vid.durationSeconds);
                    if (vid.fileLength) sizeBytes = Number(vid.fileLength);
                    if (vid.gifPlayback) extraInfo.gifPlayback = vid.gifPlayback;
                }
            }

            // 5. Documento
            const doc = actualMessage.documentMessage || actualMessage.document;
            if (doc || raw.messageType === 'document' || raw.type === 'document' || raw.mediaType === 'document') {
                finalType = 'document';
                if (doc) {
                    caption = doc.caption || null;
                    mediaUrl = doc.url || doc.fileUrl || doc.directPath || null;
                    mediaMimeType = doc.mimetype || doc.mimeType || 'application/octet-stream';
                    mediaFilename = doc.fileName || doc.filename || doc.title || null;
                    if (doc.fileLength) sizeBytes = Number(doc.fileLength);
                }
            }

            // 6. Sticker
            const stk = actualMessage.stickerMessage || actualMessage.sticker;
            if (stk || raw.messageType === 'sticker' || raw.type === 'sticker' || raw.mediaType === 'sticker') {
                finalType = 'sticker';
                if (stk) {
                    mediaUrl = stk.url || stk.fileUrl || stk.directPath || null;
                    mediaMimeType = stk.mimetype || stk.mimeType || 'image/webp';
                    if (stk.fileLength) sizeBytes = Number(stk.fileLength);
                }
            }

            // 7. Localização
            const loc = actualMessage.locationMessage || actualMessage.location || actualMessage.liveLocationMessage;
            if (loc || raw.messageType === 'location' || raw.type === 'location' || raw.latitude !== undefined) {
                finalType = 'location';
                if (loc) {
                    extraInfo.latitude = loc.degreesLatitude || loc.latitude;
                    extraInfo.longitude = loc.degreesLongitude || loc.longitude;
                    extraInfo.address = loc.address || null;
                    extraInfo.name = loc.name || null;
                    text = `Localização: ${loc.name || loc.address || `${extraInfo.latitude}, ${extraInfo.longitude}`}`;
                } else if (raw.latitude) {
                    extraInfo.latitude = raw.latitude;
                    extraInfo.longitude = raw.longitude;
                    extraInfo.address = raw.address || null;
                    extraInfo.name = raw.name || null;
                    text = `Localização: ${raw.name || raw.address || `${raw.latitude}, ${raw.longitude}`}`;
                }
            }

            // 8. Contato / VCard
            const conCheck = actualMessage.contactMessage || actualMessage.contactsArrayMessage || raw.contactMessage || raw.contactsArrayMessage;
            if (conCheck || raw.messageType === 'contact' || raw.type === 'contact' || raw.vcard !== undefined) {
                finalType = 'contact';
                if (actualMessage.contactMessage) {
                    extraInfo.displayName = actualMessage.contactMessage.displayName || null;
                    extraInfo.vcard = actualMessage.contactMessage.vcard || null;
                    text = `Contato: ${actualMessage.contactMessage.displayName || 'VCard'}`;
                } else if (actualMessage.contactsArrayMessage) {
                    const cnts = actualMessage.contactsArrayMessage.contacts || [];
                    extraInfo.contacts = cnts;
                    text = `Contatos: ${cnts.map(c => c.displayName).join(', ') || 'VCard list'}`;
                } else {
                    extraInfo.displayName = raw.displayName || null;
                    extraInfo.vcard = raw.vcard || null;
                    text = `Contato: ${raw.displayName || 'VCard'}`;
                }
            }

            // 9. Reação
            const react = actualMessage.reactionMessage || actualMessage.reaction || raw.reactionMessage;
            if (react || raw.messageType === 'reaction' || raw.type === 'reaction') {
                finalType = 'reaction';
                if (react) {
                    extraInfo.emoji = react.text || react.emoji || null;
                    extraInfo.reactedMessageId = react.key?.id || null;
                    text = `Reação: ${extraInfo.emoji || ''}`;
                }
            }

            // 10. Mensagem Apagada / Revogada
            const protocol = actualMessage.protocolMessage || raw.protocolMessage;
            const isDeletedCheck = (protocol && (protocol.type === 3 || protocol.type === 'REVOKE' || protocol.type === 'REVOKE_MESSAGE')) || raw.revoked === true || raw.deleted === true || raw.messageDeleted === true || raw.type === 'revoked';
            if (isDeletedCheck) {
                finalType = 'deleted';
                if (protocol && protocol.key) {
                    extraInfo.deletedMessageId = protocol.key.id;
                }
                text = "Mensagem apagada";
            }

            // 11. Mensagem Editada
            const isEditedCheck = actualMessage.editedMessage || actualMessage.edited || raw.edited === true || raw.editedMessage || raw.message?.edited;
            if (isEditedCheck) {
                finalType = 'edited';
                const edMsg = actualMessage.editedMessage || actualMessage.edited || raw.editedMessage;
                if (edMsg) {
                    text = edMsg.message?.conversation || edMsg.message?.text || edMsg.text || edMsg.body || "Mensagem editada";
                }
            }

            if (finalType === 'unknown' && text) {
                finalType = 'text';
            }

            if (finalType === 'text' && !text) {
                text = actualMessage.conversation || actualMessage.text || raw.text || raw.body || null;
            }

            if (!mediaUrl) {
                mediaUrl = actualMessage.mediaUrl || actualMessage.url || actualMessage.fileUrl || raw.mediaUrl || raw.url || raw.fileUrl || null;
            }
            if (!mediaMimeType) {
                mediaMimeType = actualMessage.mimetype || actualMessage.mimeType || raw.mediaMimeType || raw.mimeType || raw.mimetype || null;
            }
            if (!mediaFilename) {
                mediaFilename = actualMessage.fileName || actualMessage.filename || raw.mediaFilename || raw.filename || raw.fileName || null;
            }
            if (!caption) {
                caption = actualMessage.caption || raw.caption || null;
            }
        }

        if (finalType === 'unknown') {
            if (mediaUrl) {
                if (mediaMimeType) {
                    if (mediaMimeType.startsWith('image/')) finalType = 'image';
                    else if (mediaMimeType.startsWith('video/')) finalType = 'video';
                    else if (mediaMimeType.startsWith('audio/')) finalType = 'audio';
                    else finalType = 'document';
                } else {
                    finalType = 'document';
                }
            } else {
                finalType = 'text';
            }
        }

        let rawTimestamp = raw.messageTimestamp || raw.timestamp || (payload.chat && payload.chat.wa_lastMsgTimestamp) || null;
        let timestamp = null;
        if (rawTimestamp) {
            const tsNum = Number(rawTimestamp);
            if (!isNaN(tsNum)) {
                if (tsNum < 100000000000) {
                    timestamp = new Date(tsNum * 1000);
                } else {
                    timestamp = new Date(tsNum);
                }
            } else {
                timestamp = new Date(rawTimestamp);
            }
        }
        if (!timestamp || isNaN(timestamp.getTime())) {
            timestamp = new Date();
        }

        messages.push({
            externalMessageId,
            externalChatId,
            phone,
            pushName,
            fromMe,
            isGroup: !!isGroup,
            messageType: finalType,
            text,
            caption,
            mediaUrl,
            mediaMimeType,
            mediaFilename,
            durationSeconds,
            sizeBytes,
            // ROTA Webhook Real: POST /api/webhooks/uazapi/:connectionId/:secret
app.post('/api/webhooks/uazapi/:connectionId/:secret', async (req, res) => {
    const { connectionId, secret } = req.params;
    const body = req.body;
    let webhookEventId = null;
    
    console.log(`[Webhook Uazapi] Recebido evento para a conexão ID: ${connectionId}`);
    
    try {
        const client = supabaseAdmin || supabase;
        
        // 1. Validar a conexão
        const { data: connection, error } = await client
            .from('crm_connections')
            .select('*')
            .eq('id', connectionId)
            .eq('webhook_secret', secret)
            .single();
            
        if (error || !connection) {
            console.error(`[Webhook Uazapi] Conexão não encontrada ou secret inválido: ${connectionId}`);
            return res.status(404).json({ ok: false, error: "Webhook inválido." });
        }
        
        // Salvar evento bruto sanitizado imediatamente
        try {
            const { data: newEvent, error: insertEventErr } = await client
                .from('crm_webhook_events')
                .insert({
                    connection_id: connection.id,
                    user_id: connection.user_id,
                    provider: 'uazapi',
                    event_type: 'raw_received',
                    processing_status: 'received',
                    raw_payload: sanitizeWebhookPayloadForStorage(body),
                    processed_messages: 0
                })
                .select('id')
                .single();
                
            if (insertEventErr) {
                console.error(`[Webhook Uazapi] Erro ao salvar evento bruto inicial:`, insertEventErr);
            } else if (newEvent) {
                webhookEventId = newEvent.id;
                console.log(`[Webhook Uazapi] Evento bruto salvo: ${webhookEventId}`);
            }
        } catch (dbErr) {
            console.error(`[Webhook Uazapi] Falha crítica de BD ao gravar evento bruto inicial:`, dbErr);
        }

        // 2. Interpretar eventos da Uazapi via normalizador tolerante
        const normalized = normalizeUazapiWebhookPayload(body);
        console.log(`[Webhook Uazapi] EventType: ${normalized.eventType}`);
        
        // 3. Tratar eventos de status/ack de mensagem (Tarefa 1 e 7)
        if (normalized.eventType === 'status_update') {
            let extMessageId = null;
            let currentStatus = 'sent'; // padrão
            
            // Tentar extrair do body/payload
            const keyId = body.messageId || body.id || body.msgId || body.key?.id || (body.data && (body.data.messageId || body.data.id || body.data.key?.id)) || null;
            extMessageId = keyId;

            let rawStatus = body.status || body.ack || (body.data && (body.data.status || body.data.ack)) || null;
            if (rawStatus !== null && rawStatus !== undefined) {
                rawStatus = String(rawStatus).toLowerCase();
                if (rawStatus === '3' || rawStatus === 'read' || rawStatus === 'viewed') {
                    currentStatus = 'read';
                } else if (rawStatus === '2' || rawStatus === 'delivered') {
                    currentStatus = 'delivered';
                } else if (rawStatus === '1' || rawStatus === 'sent') {
                    currentStatus = 'sent';
                } else if (rawStatus === 'failed' || rawStatus === 'error') {
                    currentStatus = 'failed';
                }
            }

            let updatedOk = false;
            let finalMsgId = extMessageId ? cleanMarkdownLink(extMessageId) : null;
            
            if (finalMsgId) {
                const { data: updatedMsgs, error: updateErr } = await client
                    .from('crm_messages')
                    .update({ message_status: currentStatus })
                    .eq('connection_id', connection.id)
                    .eq('external_message_id', finalMsgId)
                    .select();

                if (updateErr) {
                    console.error(`[Webhook Uazapi] Erro ao atualizar status de mensagem ${finalMsgId}:`, updateErr);
                } else if (updatedMsgs && updatedMsgs.length > 0) {
                    updatedOk = true;
                }
            }

            if (webhookEventId) {
                await client
                    .from('crm_webhook_events')
                    .update({
                        event_type: 'status_update',
                        normalized_payload: sanitizeWebhookPayloadForStorage(normalized),
                        processing_status: 'ignored',
                        processed_messages: 0,
                        error_message: updatedOk 
                            ? "Evento de status/ack sem bolha de chat." 
                            : `Evento de status/ack sem bolha de chat. Mensagem ${finalMsgId || 'indefinida'} não encontrada no banco.`,
                        updated_at: new Date()
                    })
                    .eq('id', webhookEventId);
            }

            return res.json({ 
                ok: true, 
                message: updatedOk 
                    ? `Status da mensagem ${finalMsgId} atualizado para ${currentStatus}.` 
                    : "Evento de status/ack catalogado como ignored sem bolha de chat."
            });
        }
        
        // 4. Tratar eventos de conexão/status da instância
        if (normalized.eventType === 'connection') {
            let connectedPhone = null;
            const rawJid = body.jid || body.data?.jid || body.data?.me?.id || body.me?.id || body.data?.me || body.connectedPhone || body.data?.phone || body.phone || null;
            if (rawJid) {
                connectedPhone = normalizePhone(rawJid);
            }

            const updateData = {
                last_status_payload: sanitizeWebhookPayloadForStorage(body),
                connection_status: mapUazapiStatus(body),
                updated_at: new Date()
            };
            if (connectedPhone) {
                updateData.connected_phone = connectedPhone;
            }

            console.log(`[Webhook Uazapi] Atualizando status da conexão para: ${updateData.connection_status}`);
            
            const { error: updateError } = await client
                .from('crm_connections')
                .update(updateData)
                .eq('id', connectionId);
                
            if (updateError) {
                console.error(`[Webhook Uazapi] Erro ao atualizar status na conexão:`, updateError);
            }
            
            if (webhookEventId) {
                await client
                    .from('crm_webhook_events')
                    .update({
                        event_type: normalized.eventType,
                        normalized_payload: sanitizeWebhookPayloadForStorage(normalized),
                        processing_status: 'ignored',
                        processed_messages: 0,
                        error_message: "Evento de conexão/status.",
                        updated_at: new Date()
                    })
                    .eq('id', webhookEventId);
            }
            
            console.log(`[Webhook Uazapi] Ignorado: Evento de conexão tratado, sem mensagens de CRM.`);
            
            return res.json({
                ok: true,
                eventType: 'connection',
                processedMessages: 0
            });
        }
        
        // Se não for nem de mensagem e nem de conexão, devolve warning saudável
        if (normalized.eventType !== 'messages' || normalized.messages.length === 0) {
            if (webhookEventId) {
                await client
                    .from('crm_webhook_events')
                    .update({
                        event_type: normalized.eventType,
                        normalized_payload: sanitizeWebhookPayloadForStorage(normalized),
                        processing_status: 'ignored',
                        processed_messages: 0,
                        error_message: "Atualização de mensagem sem conteúdo exibível.",
                        updated_at: new Date()
                    })
                    .eq('id', webhookEventId);
            }
            
            console.log(`[Webhook Uazapi] Ignorado: Tipo de evento diferente de mensagens ou lista de mensagens vazia.`);
            
            return res.json({
                ok: true,
                warning: "Payload sem mensagens processáveis."
            });
        }
        
        console.log(`[Webhook Uazapi] Mensagens normalizadas: ${normalized.messages.length}`);
        let processedCount = 0;
        let lastIgnoreReason = null;
        
        // 5. Processar mensagens recebidas
        for (const msg of normalized.messages) {
            try {
                const {
                    externalMessageId,
                    externalChatId,
                    phone,
                    pushName,
                    fromMe,
                    isGroup,
                    messageType,
                    text,
                    caption,
                    mediaUrl,
                    mediaMimeType,
                    mediaFilename,
                    durationSeconds,
                    sizeBytes,
                    thumbnailUrl,
                    extraInfo,
                    timestamp,
                    rawMessage
                } = msg;
                
                console.log(`[Webhook Uazapi] externalChatId: ${externalChatId}`);
                console.log(`[Webhook Uazapi] phone: ${phone}`);
                console.log(`[Webhook Uazapi] pushName: ${pushName}`);

                if (!externalChatId) {
                    console.log(`[Webhook Uazapi] Ignorado: chatId nulo.`);
                    lastIgnoreReason = "chatId nulo";
                    continue;
                }
                
                const listenGroups = connection.connection_settings?.listenGroups === true;
                if (isGroup && !listenGroups) {
                    console.log(`[Webhook Uazapi] Ignorado: Grupo ignorado de acordo com as configurações da conexão.`);
                    lastIgnoreReason = "mensagem de grupo ignorada";
                    continue;
                }
                
                // Classificação de automações / WasSentByApi (Tarefa 2)
                const wasSentByApi = rawMessage?.wasSentByApi === true || rawMessage?.isSentByApi === true || body?.wasSentByApi === true || rawMessage?.isApi === true;
                
                const isProtocolOrSystem = messageType === 'protocol' || messageType === 'system';
                const hasUsefulContent = !!(text || caption || mediaUrl || messageType === 'image' || messageType === 'audio' || messageType === 'voice' || messageType === 'video' || messageType === 'document' || messageType === 'sticker' || messageType === 'location');
                if (isProtocolOrSystem && !hasUsefulContent) {
                    console.log(`[Webhook Uazapi] Ignorado: Notificação de sistema sem conteúdo útil.`);
                    lastIgnoreReason = "notificacao de sistema sem conteudo util";
                    continue;
                }
                
                // Determinar sender_type de forma avançada (Tarefa 2)
                let senderTypeStr = "contact";
                if (fromMe) {
                    if (wasSentByApi) {
                        senderTypeStr = "ai";
                    } else {
                        senderTypeStr = "me";
                    }
                } else if (messageType === 'protocol' || messageType === 'system' || messageType === 'deleted') {
                    senderTypeStr = "system";
                }
                
                // --- FLUXO 1: crm_contacts ---
                let contactId = null;
                const { data: existingContact, error: findContactErr } = await client
                    .from('crm_contacts')
                    .select('*')
                    .eq('connection_id', connection.id)
                    .eq('external_chat_id', externalChatId)
                    .maybeSingle();
                    
                if (findContactErr) {
                    console.error(`[Webhook Uazapi] Erro ao buscar crm_contacts:`, findContactErr);
                }
                
                if (existingContact) {
                    contactId = existingContact.id;
                    const updateContactData = {
                        phone: phone || existingContact.phone,
                        push_name: pushName || existingContact.push_name,
                        display_name: pushName || phone || externalChatId || existingContact.display_name,
                        raw_profile: sanitizeWebhookPayloadForStorage(rawMessage) || existingContact.raw_profile,
                        updated_at: new Date()
                    };
                    const { error: updateContactErr } = await client
                        .from('crm_contacts')
                        .update(updateContactData)
                        .eq('id', contactId);
                        
                    if (updateContactErr) {
                        console.error(`[Webhook Uazapi] Erro ao atualizar crm_contacts:`, updateContactErr);
                    }
                } else {
                    const insertContactData = {
                        user_id: connection.user_id,
                        connection_id: connection.id,
                        external_chat_id: externalChatId,
                        phone: phone,
                        push_name: pushName,
                        display_name: pushName || phone || externalChatId,
                        is_group: !!isGroup,
                        raw_profile: sanitizeWebhookPayloadForStorage(rawMessage),
                        created_at: new Date(),
                        updated_at: new Date()
                    };
                    const { data: newContact, error: insertContactErr } = await client
                        .from('crm_contacts')
                        .insert(insertContactData)
                        .select()
                        .single();
                        
                    if (insertContactErr) {
                        console.error(`[Webhook Uazapi] Erro ao criar crm_contacts:`, insertContactErr);
                    } else if (newContact) {
                        contactId = newContact.id;
                        console.log(`[Webhook Uazapi] Novo crm_contacts criado: ID ${contactId}`);
                    }
                }
                
                // --- FLUXO 2: leads (CRM) (DEFENSIVO) ---
                let leadId = null;
                let existingLead = null;
                
                try {
                    if (phone) {
                        const { data, error } = await client
                            .from('leads')
                            .select('*')
                            .eq('user_id', connection.user_id)
                            .eq('phone', phone)
                            .maybeSingle();
                        if (!error && data) {
                            existingLead = data;
                        }
                    }
                    
                    if (!existingLead && externalChatId) {
                        const { data, error } = await client
                            .from('leads')
                            .select('*')
                            .eq('user_id', connection.user_id)
                            .eq('external_chat_id', externalChatId)
                            .maybeSingle();
                        if (!error && data) {
                            existingLead = data;
                        }
                    }
                } catch (leadFindErr) {
                    console.error(`[Webhook Uazapi] Erro ao buscar lead existente (continuando fluxo):`, leadFindErr);
                }
                
                const messageSummary = text || caption || (mediaUrl ? "[mídia]" : "[mensagem]");
                const interactionTime = timestamp || new Date();
                
                if (existingLead) {
                    leadId = existingLead.id;
                    try {
                        const updateLeadData = {
                            name: existingLead.name || pushName || phone || externalChatId || 'Lead WhatsApp',
                            phone: phone || existingLead.phone,
                            channel: 'whatsapp',
                            external_chat_id: externalChatId || existingLead.external_chat_id,
                            last_message: messageSummary,
                            last_sender: senderTypeStr,
                            last_interaction: interactionTime
                        };
                        const { error: updateLeadErr } = await client
                            .from('leads')
                            .update(updateLeadData)
                            .eq('id', leadId);
                            
                        if (updateLeadErr) {
                            console.warn(`[Webhook Uazapi] Erro ao atualizar lead com colunas extras, tentando fallback básico...`, updateLeadErr);
                            const { error: fallbackErr } = await client
                                .from('leads')
                                .update({
                                    name: existingLead.name || pushName || 'Lead WhatsApp'
                                })
                                .eq('id', leadId);
                            if (fallbackErr) {
                                console.error(`[Webhook Uazapi] Falha no fallback de update de leads:`, fallbackErr);
                            } else {
                                console.log(`[Webhook Uazapi] Lead criado/atualizado: ID ${leadId}`);
                            }
                        } else {
                            console.log(`[Webhook Uazapi] Lead criado/atualizado: ID ${leadId}`);
                        }
                    } catch (leadUpErr) {
                        console.error(`[Webhook Uazapi] Falha silenciosa no processamento do lead:`, leadUpErr);
                    }
                } else {
                    try {
                        const insertLeadData = {
                            user_id: connection.user_id,
                            name: pushName || phone || externalChatId || 'Lead WhatsApp',
                            phone: phone || '',
                            status: 'Novo',
                            temperature: 'Cold',
                            source: 'WhatsApp',
                            channel: 'whatsapp',
                            external_chat_id: externalChatId,
                            last_message: messageSummary,
                            last_sender: senderTypeStr,
                            last_interaction: interactionTime,
                            created_at: new Date()
                        };
                        const { data: newLead, error: insertLeadErr } = await client
                            .from('leads')
                            .insert(insertLeadData)
                            .select()
                            .single();
                            
                        if (insertLeadErr) {
                            console.warn(`[Webhook Uazapi] Erro ao criar lead com colunas novas, tentando fallback corporativo basico...`, insertLeadErr);
                            const insertBaseData = {
                                user_id: connection.user_id,
                                name: pushName || phone || externalChatId || 'Lead WhatsApp',
                                phone: phone || '',
                                status: 'Novo',
                                temperature: 'Cold',
                                source: 'WhatsApp',
                                created_at: new Date()
                            };
                            const { data: fallbackLead, error: fallbackInsertErr } = await client
                                .from('leads')
                                .insert(insertBaseData)
                                .select()
                                .single();
                            if (fallbackInsertErr) {
                                console.error(`[Webhook Uazapi] Falha no fallback de insercao de leads:`, fallbackInsertErr);
                            } else if (fallbackLead) {
                                leadId = fallbackLead.id;
                                console.log(`[Webhook Uazapi] Lead criado/atualizado: ID ${leadId}`);
                            }
                        } else if (newLead) {
                            leadId = newLead.id;
                            console.log(`[Webhook Uazapi] Lead criado/atualizado: ID ${leadId}`);
                        }
                    } catch (leadInsErr) {
                        console.error(`[Webhook Uazapi] Falha silenciosa de insercao de novo lead:`, leadInsErr);
                    }
                }
                
                // --- FLUXO 3: crm_conversations ---
                let conversationId = null;
                if (contactId) {
                    const { data: existingConv, error: findConvErr } = await client
                        .from('crm_conversations')
                        .select('*')
                        .eq('connection_id', connection.id)
                        .eq('contact_id', contactId)
                        .maybeSingle();
                        
                    if (findConvErr) {
                        console.error(`[Webhook Uazapi] Erro ao buscar crm_conversations:`, findConvErr);
                    }
                    
                    const msgTypeStr = messageType || 'text';
                    
                    if (existingConv) {
                        conversationId = existingConv.id;
                        const incUnread = !fromMe ? 1 : 0;
                        const updateConvData = {
                            unread_count: existingConv.unread_count + incUnread,
                            last_message_text: messageSummary,
                            last_message_type: msgTypeStr,
                            last_message_at: interactionTime,
                            last_sender: senderTypeStr,
                            updated_at: new Date()
                        };
                        
                        if (!existingConv.lead_id && leadId) {
                            updateConvData.lead_id = leadId;
                        }
                        
                        const { error: updateConvErr } = await client
                            .from('crm_conversations')
                            .update(updateConvData)
                            .eq('id', conversationId);
                            
                        if (updateConvErr) {
                            console.error(`[Webhook Uazapi] Erro ao atualizar conversa:`, updateConvErr);
                        }
                    } else {
                        const insertConvData = {
                            user_id: connection.user_id,
                            connection_id: connection.id,
                            contact_id: contactId,
                            lead_id: leadId,
                            conversation_status: 'open',
                            unread_count: !fromMe ? 1 : 0,
                            last_message_text: messageSummary,
                            last_message_type: msgTypeStr,
                            last_message_at: interactionTime,
                            last_sender: senderTypeStr,
                            created_at: new Date(),
                            updated_at: new Date()
                        };
                        const { data: newConv, error: insertConvErr } = await client
                            .from('crm_conversations')
                            .insert(insertConvData)
                            .select()
                            .single();
                            
                        if (insertConvErr) {
                            console.error(`[Webhook Uazapi] Erro ao criar conversa:`, insertConvErr);
                        } else if (newConv) {
                            conversationId = newConv.id;
                            console.log(`[Webhook Uazapi] Nova crm_conversations criada: ID ${conversationId}`);
                        }
                    }
                }
                
                // Vincular conversa recém-criada ao Lead
                if (leadId && conversationId) {
                    const { error: updateLeadConvErr } = await client
                        .from('leads')
                        .update({ conversation_id: conversationId })
                        .eq('id', leadId);
                        
                    if (updateLeadConvErr) {
                        console.error(`[Webhook Uazapi] Erro ao associar conversation_id ao lead:`, updateLeadConvErr);
                    } else {
                        console.log(`[Webhook Uazapi] Conversa vinculada ao lead: ID ${conversationId}`);
                    }
                }
                
                // --- FLUXO 4: crm_messages com IDEMPOTÊNCIA ---
                let finalExternalMessageId = externalMessageId;
                if (!finalExternalMessageId) {
                    const hashBase = `${connection.id}_${externalChatId}_${interactionTime.getTime ? interactionTime.getTime() : String(interactionTime)}_${messageSummary}`;
                    finalExternalMessageId = crypto.createHash('md5').update(hashBase).digest('hex');
                }
                
                // Verificar se a mensagem já foi salva (idempotência)
                const { data: existingMsg, error: checkMsgErr } = await client
                    .from('crm_messages')
                    .select('*')
                    .eq('connection_id', connection.id)
                    .eq('external_message_id', finalExternalMessageId)
                    .maybeSingle();
                    
                if (checkMsgErr) {
                    console.error(`[Webhook Uazapi] Erro ao verificar idempotência de crm_messages:`, checkMsgErr);
                }
                
                let actualSavedMsgId = null;

                if (existingMsg) {
                    console.log(`[Webhook Uazapi] Mensagem ${finalExternalMessageId} ja existe. Atualizando status/payload.`);
                    actualSavedMsgId = existingMsg.id;
                    
                    const updateMsgData = {
                        message_status: fromMe ? "sent" : "received",
                        raw_payload: sanitizeWebhookPayloadForStorage(rawMessage) || null,
                        updated_at: new Date()
                    };
                    
                    const { error: updateMsgErr } = await client
                        .from('crm_messages')
                        .update(updateMsgData)
                        .eq('id', existingMsg.id);
                        
                    if (updateMsgErr) {
                        console.error(`[Webhook Uazapi] Erro ao atualizar crm_messages:`, updateMsgErr);
                    }
                } else {
                    // Placeholder da mensagem de mídia sem legenda ocupando text (Tarefa 5)
                    let finalMessageText = text;
                    if (!finalMessageText) {
                        if (caption) {
                            finalMessageText = caption;
                        } else {
                            if (messageType === 'image') finalMessageText = '[imagem]';
                            else if (messageType === 'audio') finalMessageText = '[áudio]';
                            else if (messageType === 'voice') finalMessageText = '[áudio]';
                            else if (messageType === 'video') finalMessageText = '[vídeo]';
                            else if (messageType === 'document') finalMessageText = '[documento]';
                            else if (messageType === 'sticker') finalMessageText = '[sticker]';
                            else if (messageType === 'location') finalMessageText = '[localização]';
                            else if (messageType === 'contact') finalMessageText = '[contato]';
                            else if (messageType === 'reaction') finalMessageText = text || '[reação]';
                            else if (messageType === 'deleted') finalMessageText = 'Mensagem apagada';
                            else finalMessageText = '[mensagem]';
                        }
                    }

                    const insertMsgData = {
                        user_id: connection.user_id,
                        connection_id: connection.id,
                        conversation_id: conversationId,
                        contact_id: contactId,
                        lead_id: leadId,
                        external_message_id: finalExternalMessageId,
                        message_direction: fromMe ? "outbound" : "inbound",
                        sender_type: senderTypeStr,
                        message_type: messageType || 'text',
                        message_text: finalMessageText,
                        caption: caption || null,
                        media_url: mediaUrl || null,
                        media_mime_type: mediaMimeType || null,
                        media_filename: mediaFilename || null,
                        message_status: fromMe ? "sent" : "received",
                        from_me: !!fromMe,
                        raw_payload: sanitizeWebhookPayloadForStorage(rawMessage) || null,
                        sent_at: interactionTime,
                        created_at: new Date()
                    };
                    
                    const { data: insertedMsg, error: insertMsgErr } = await client
                        .from('crm_messages')
                        .insert(insertMsgData)
                        .select()
                        .maybeSingle();
                        
                    if (insertMsgErr) {
                        // Tratar erro unique silenciosamente
                        if (insertMsgErr.code === '23505') {
                            console.log(`[Webhook Uazapi] Conflito silent unique constraint de mensagem, buscando duplicada.`);
                            const { data: fallbackMsg } = await client
                                .from('crm_messages')
                                .select('id')
                                .eq('connection_id', connection.id)
                                .eq('external_message_id', finalExternalMessageId)
                                .maybeSingle();
                            if (fallbackMsg) {
                                actualSavedMsgId = fallbackMsg.id;
                            }
                        } else {
                            console.error(`[Webhook Uazapi] Erro ao salvar crm_messages:`, insertMsgErr);
                        }
                    } else if (insertedMsg) {
                        actualSavedMsgId = insertedMsg.id;
                        console.log(`[Webhook Uazapi] Mensagem ${finalExternalMessageId} salva com sucesso. ID: ${actualSavedMsgId}`);
                    }
                }

                // Salvar anexo técnico se aplicável (Tarefa 5)
                if (actualSavedMsgId && (mediaUrl || thumbnailUrl || messageType === 'image' || messageType === 'audio' || messageType === 'voice' || messageType === 'video' || messageType === 'document' || messageType === 'sticker' || messageType === 'location')) {
                    // Evitar duplicação
                    const { data: existingAttachment } = await client
                        .from('crm_message_attachments')
                        .select('id')
                        .eq('message_id', actualSavedMsgId)
                        .maybeSingle();

                    if (!existingAttachment) {
                        let finalSizeBytes = null;
                        if (sizeBytes !== null && sizeBytes !== undefined) {
                            const parsed = Number(sizeBytes);
                            if (!isNaN(parsed)) finalSizeBytes = parsed;
                        }
                        
                        let finalDuration = null;
                        if (durationSeconds !== null && durationSeconds !== undefined) {
                            const parsed = Number(durationSeconds);
                            if (!isNaN(parsed)) finalDuration = parsed;
                        }

                        const attachmentData = {
                            user_id: connection.user_id,
                            connection_id: connection.id,
                            conversation_id: conversationId,
                            message_id: actualSavedMsgId,
                            attachment_type: messageType || 'unknown',
                            source_url: mediaUrl || null,
                            storage_bucket: null,
                            storage_path: null,
                            mime_type: mediaMimeType || null,
                            filename: mediaFilename || null,
                            size_bytes: finalSizeBytes,
                            duration_seconds: finalDuration,
                            width: extraInfo?.width || null,
                            height: extraInfo?.height || null,
                            thumbnail_url: thumbnailUrl || null,
                            raw_metadata: sanitizeWebhookPayloadForStorage(extraInfo || {}),
                            created_at: new Date()
                        };

                        const { error: attachErr } = await client
                            .from('crm_message_attachments')
                            .insert(attachmentData);

                        if (attachErr) {
                            console.error(`[Webhook Uazapi] Erro ao criar crm_message_attachments para mensagem ${actualSavedMsgId}:`, attachErr);
                        } else {
                            console.log(`[Webhook Uazapi] Anexo de mídia registrado com sucesso para a mensagem ID ${actualSavedMsgId}`);
                        }
                    }
                }

                // Executar backfill para garantir retroatividade de conversas e mensagens sem lead_id
                try {
                    const contactArg = {
                        phone: phone,
                        external_chat_id: externalChatId,
                        push_name: pushName
                    };
                    const conversationArg = {
                        id: conversationId,
                        lead_id: leadId
                    };
                    const messageArg = {
                        text: text,
                        caption: caption,
                        mediaUrl: mediaUrl,
                        fromMe: fromMe,
                        timestamp: interactionTime
                    };
                    await backfillLeadForConversation(connection, contactArg, conversationArg, messageArg);
                } catch (backfillRunErr) {
                    console.error(`[Webhook Uazapi] Falha ao tentar executar backfill de lead/conversas:`, backfillRunErr);
                }
                
                processedCount++;
            } catch (singleMsgErr) {
                console.error(`[Webhook Uazapi] Erro no loop de processamento de mensagem específica:`, singleMsgErr);
            }
        }
        
        console.log(`[Webhook Uazapi] Mensagens processadas: ${processedCount}`);
        
        // Atualizar crm_webhook_events de mensagens com sucesso
        if (webhookEventId) {
            const updatePayload = {
                event_type: normalized.eventType,
                normalized_payload: sanitizeWebhookPayloadForStorage(normalized),
                processing_status: processedCount > 0 ? 'processed' : 'ignored',
                processed_messages: processedCount,
                updated_at: new Date()
            };
            
            // Mensagens duplicadas ou eventos silenciados amigavelmente (Tarefa 1)
            if (processedCount === 0) {
                if (lastIgnoreReason === "mensagem duplicada") {
                    updatePayload.error_message = "Mensagem enviada pela API já registrada.";
                } else if (lastIgnoreReason === "chatId nulo") {
                    updatePayload.error_message = "[Webhook Uazapi] Ignorado: chatId nulo.";
                } else if (lastIgnoreReason) {
                    updatePayload.error_message = `Ignorado: ${lastIgnoreReason}`;
                } else {
                    updatePayload.error_message = "Atualização de mensagem sem conteúdo exibível.";
                }
            }
            
            await client
                .from('crm_webhook_events')
                .update(updatePayload)
                .eq('id', webhookEventId);
        }
        
        res.json({
            ok: true,
            eventType: normalized.eventType,
            processedMessages: processedCount
        });
    } catch (err) {
        // Nunca perder payload, registrar erro em crm_webhook_events e responder ok: true
        console.error('[Webhook Uazapi] Erro interno crítico:', err);
        
        if (webhookEventId) {
            try {
                const client = supabaseAdmin || supabase;
                await client
                    .from('crm_webhook_events')
                    .update({
                        processing_status: 'error',
                        error_message: err.message || String(err),
                        updated_at: new Date()
                    })
                    .eq('id', webhookEventId);
            } catch (updateErr) {
                console.error('[Webhook Uazapi] Erro ao atualizar status de erro no evento de webhook:', updateErr);
            }
        }
        
        res.json({
            ok: true,
            error: "Erro processando webhook, porém payload foi registrado."
        });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
