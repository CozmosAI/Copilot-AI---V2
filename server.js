
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
        if (s === 'disconnected' || s === 'close' || s === 'closed' || s === 'offline' || s === 'notauthorized' || s === 'logout' || s === 'false') {
            return 'disconnected';
        }
    }
    
    // Fallback analisando JSON.stringify(payload).toLowerCase()
    try {
        const str = JSON.stringify(payload).toLowerCase();
        if (str.includes('"connected"') || str.includes('"open"') || str.includes('"authenticated"') || str.includes('"online"')) {
            return 'connected';
        }
        if (str.includes('"disconnected"') || str.includes('"closed"') || str.includes('"offline"') || str.includes('"logout"')) {
            return 'disconnected';
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
        
        const { data: updatedConnection, error: updateError } = await client
            .from('crm_connections')
            .update(updateFields)
            .eq('id', connectionId)
            .select()
            .single();
            
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
            events: ["messages.upsert", "MESSAGES_UPSERT", "STATUS_INSTANCE", "QRCODE_UPDATED"]
        };
        
        const endpoints = [];
        endpoints.push({ path: 'webhook', method: 'POST' });
        if (connection.instance_name) {
            endpoints.push({ path: `webhook/set/${connection.instance_name}`, method: 'POST' });
        }
        endpoints.push({ path: 'globalwebhook', method: 'POST' });
        
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
            // Remove dados sensíveis da resposta antes de salvar
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
                    updated_at: new Date()
                })
                .eq('id', connectionId);
                
            res.json({
                ok: true,
                message: "Webhook AXIS configurado na Uazapi.",
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
                error: "Não foi possível configurar o webhook automaticamente. Copie o webhook da AXIS e configure manualmente no painel da Uazapi."
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

// ROTA Webhook Placeholder: POST /api/webhooks/uazapi/:connectionId/:secret
app.post('/api/webhooks/uazapi/:connectionId/:secret', async (req, res) => {
    const { connectionId, secret } = req.params;
    const body = req.body;
    
    try {
        const client = supabaseAdmin || supabase;
        const { data: connection, error } = await client
            .from('crm_connections')
            .select('*')
            .eq('id', connectionId)
            .eq('webhook_secret', secret)
            .single();
            
        if (error || !connection) {
            console.error(`[Webhook Uazapi] Conexão não encontrada ou secret inválido: ${connectionId}`);
            return res.status(404).json({ error: 'Connection not found or secret invalid' });
        }
        
        const { error: updateError } = await client
            .from('crm_connections')
            .update({
                last_status_payload: body,
                updated_at: new Date()
            })
            .eq('id', connectionId);
            
        if (updateError) {
            console.error(`[Webhook Uazapi] Erro ao atualizar payload na conexão:`, updateError);
        }
        
        res.json({ ok: true });
    } catch (err) {
        console.error('[Webhook Uazapi] Erro interno:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
