
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Modality } from "@google/genai";
import PDFDocument from 'pdfkit';
import crypto from 'crypto';
import multer from 'multer';

// MCP helpers descontinuados (escopo ads_mcp_management rejeitado/descontinuado pela Meta)


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
const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;
let aiClient = null;
if (API_KEY) {
    aiClient = new GoogleGenAI({ apiKey: API_KEY });
}

// Helper utilitário para updates tolerantes a colunas faltantes (especialmente updated_at)
async function safeUpdate(client, tableName, data, eqColumn, eqValue) {
    const { data: resData, error } = await client
        .from(tableName)
        .update(data)
        .eq(eqColumn, eqValue);
        
    if (error) {
        const errMsg = error.message || String(error);
        const isColumnError = error.code === 'PGRST204' || 
                              errMsg.includes('updated_at') || 
                              (errMsg.includes('column') && (errMsg.includes('not found') || errMsg.includes('cache')));
                              
        if (isColumnError && 'updated_at' in data) {
            console.log(`[SafeUpdate] Coluna 'updated_at' ausente em ${tableName}. Retrying update sem ela...`);
            const cleanData = { ...data };
            delete cleanData.updated_at;
            return await client
                .from(tableName)
                .update(cleanData)
                .eq(eqColumn, eqValue);
        }
    }
    return { data: resData, error };
}

// --- CONFIGURAÇÕES GOOGLE ---
const GOOGLE_ADS_DEV_TOKEN = process.env.VITE_GOOGLE_ADS_DEV_TOKEN;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const allowedOrigins = [
    'https://axis-ai-1s3m.onrender.com',
    'http://localhost:5173',
    'http://localhost:3000'
];
app.use(cors({
    origin: function (origin, callback) {
        // Permitir qualquer origem para evitar bloqueios de CORS no preview e subdomínios do AI Studio
        callback(null, true);
    },
    credentials: true
}));

// Rate Limiting simples (100 req por minuto por IP)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX = 100;

app.use('/api/', (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }
    
    const record = rateLimitMap.get(ip);
    if (now > record.resetTime) {
        record.count = 1;
        record.resetTime = now + RATE_LIMIT_WINDOW;
        return next();
    }
    
    if (record.count >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Muitas requisições. Tente novamente em 1 minuto.' });
    }
    
    record.count++;
    next();
});
// --- HELPER VALIDAÇÃO ASSINATURA META WEBHOOK ---
function validateMetaWebhookSignature(rawBody, signatureHeader, appSecret) {
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
    if (!appSecret) return false;

    let payloadBuffer;
    if (Buffer.isBuffer(rawBody)) {
        payloadBuffer = rawBody;
    } else if (typeof rawBody === 'string') {
        payloadBuffer = Buffer.from(rawBody, 'utf8');
    } else {
        payloadBuffer = Buffer.from(JSON.stringify(rawBody || {}), 'utf8');
    }

    const expectedSignature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(payloadBuffer).digest('hex');

    try {
        const bufExpected = Buffer.from(expectedSignature, 'utf8');
        const bufReceived = Buffer.from(signatureHeader, 'utf8');
        if (bufExpected.length !== bufReceived.length) {
            return false;
        }
        return crypto.timingSafeEqual(bufExpected, bufReceived);
    } catch (e) {
        return false;
    }
}

// Helper para processamento assíncrono de Leadgen de formulários nativos do Meta Ads
async function processMetaLeadgen(entry, change, explicitUserId = null) {
    try {
        const client = supabaseAdmin || supabase;
        const changeVal = change.value || {};
        const leadgenId = changeVal.leadgen_id;
        if (!leadgenId) {
            console.warn('[Meta Leadgen] Evento sem leadgen_id:', change);
            return;
        }

        const formId = changeVal.form_id;
        const adId = changeVal.ad_id;
        const campaignId = changeVal.campaign_id;
        const adsetId = changeVal.adset_id;
        const pageId = entry?.id || changeVal.page_id;
        const createdTime = changeVal.created_time;

        // Identificar user_id
        let targetUserId = explicitUserId;
        if (!targetUserId) {
            const { data: integrations } = await client
                .from('meta_ads_integrations')
                .select('user_id, access_token, ad_account_id');

            if (integrations && integrations.length > 0) {
                if (integrations.length === 1) {
                    targetUserId = integrations[0].user_id;
                } else {
                    const match = integrations.find(i => 
                        (adId && i.ad_account_id && (String(i.ad_account_id).includes(String(adId)) || String(adId).includes(String(i.ad_account_id).replace(/^act_/, '')))) ||
                        (pageId && (String(i.ad_account_id) === String(pageId) || String(i.ad_account_id) === `act_${pageId}`))
                    );
                    targetUserId = match ? match.user_id : integrations[0].user_id;
                }
            }
        }

        if (!targetUserId) {
            console.warn('[Meta Leadgen] Nenhum usuário com integração Meta Ads encontrado para associar o lead.');
            return;
        }

        // Obter token válido do Meta
        let token = null;
        try {
            const tokenObj = await getValidMetaToken(targetUserId);
            token = tokenObj?.accessToken;
        } catch (tErr) {
            console.warn(`[Meta Leadgen] Falha em getValidMetaToken para user ${targetUserId}:`, tErr.message);
            const { data: fallbackConn } = await client
                .from('meta_ads_integrations')
                .select('access_token')
                .eq('user_id', targetUserId)
                .maybeSingle();
            token = fallbackConn?.access_token;
        }

        if (!token) {
            console.error(`[Meta Leadgen] Token do Meta Ads não disponível para user ${targetUserId}`);
            return;
        }

        // Buscar dados completos do lead via Graph API
        const apiVersion = process.env.META_API_VERSION || 'v25.0';
        const leadRes = await fetch(
            `https://graph.facebook.com/${apiVersion}/${leadgenId}?access_token=${token}`
        );
        const leadData = await leadRes.json();

        if (leadData.error) {
            console.error('[Meta Leadgen] Erro retornado pela Meta Graph API:', leadData.error);
        }

        // field_data é um array de {name, values}
        const fieldData = Array.isArray(leadData.field_data) ? leadData.field_data : [];

        // Extrair campos comuns
        const getFieldValue = (fieldName) => {
            const field = fieldData.find(f => f.name && f.name.toLowerCase() === fieldName.toLowerCase());
            return field && Array.isArray(field.values) && field.values.length > 0 ? field.values[0] : '';
        };

        const fullName = getFieldValue('full_name') || getFieldValue('nome_completo') || getFieldValue('nome') || getFieldValue('first_name') || getFieldValue('name') || '';
        const email = getFieldValue('email') || getFieldValue('e-mail') || '';
        const phone = getFieldValue('phone_number') || getFieldValue('phone') || getFieldValue('telefone') || getFieldValue('celular') || getFieldValue('whatsapp') || '';
        const city = getFieldValue('city') || getFieldValue('cidade') || '';

        // Salvar em meta_lead_forms
        try {
            await client.from('meta_lead_forms').upsert({
                user_id: targetUserId,
                leadgen_id: String(leadgenId),
                form_id: formId ? String(formId) : null,
                ad_id: adId ? String(adId) : null,
                campaign_id: campaignId ? String(campaignId) : null,
                adset_id: adsetId ? String(adsetId) : null,
                page_id: pageId ? String(pageId) : null,
                created_time: createdTime ? new Date(createdTime * 1000).toISOString() : new Date().toISOString(),
                field_data: fieldData,
                platform: 'meta',
                raw_payload: leadData
            }, { onConflict: 'leadgen_id' });
        } catch (dbErr) {
            console.warn('[Meta Leadgen] Aviso ao salvar em meta_lead_forms:', dbErr.message);
        }

        // Criar ou atualizar Lead no CRM (tabela leads)
        let existingLead = null;
        if (phone) {
            const { data } = await client.from('leads')
                .select('id')
                .eq('phone', phone)
                .eq('user_id', targetUserId)
                .maybeSingle();
            existingLead = data;
        }
        if (!existingLead && email) {
            const { data } = await client.from('leads')
                .select('id')
                .eq('email', email)
                .eq('user_id', targetUserId)
                .maybeSingle();
            existingLead = data;
        }

        if (!existingLead && (fullName || email || phone)) {
            const { data: newLead, error: insertLeadError } = await client.from('leads').insert({
                user_id: targetUserId,
                name: fullName || 'Lead Meta Ads',
                email: email,
                phone: phone,
                source: 'Meta Ads',
                channel: 'meta_lead_form',
                status: 'novo',
                temperature: 'quente',
                custom_fields: {
                    meta_leadgen_id: leadgenId,
                    meta_form_id: formId,
                    meta_campaign_id: campaignId,
                    meta_ad_id: adId,
                    city: city,
                    raw_field_data: fieldData
                }
            }).select('id').single();

            if (insertLeadError) {
                console.error('[Meta Leadgen] Erro ao inserir lead no CRM:', insertLeadError);
            } else if (newLead) {
                await client.from('meta_lead_forms')
                    .update({ lead_id: newLead.id })
                    .eq('leadgen_id', String(leadgenId));
                console.log(`[Meta Leadgen] Novo lead criado no CRM: ${fullName} (${phone || email}) - ID: ${newLead.id}`);
            }
        } else if (existingLead) {
            await client.from('meta_lead_forms')
                .update({ lead_id: existingLead.id })
                .eq('leadgen_id', String(leadgenId));
            console.log(`[Meta Leadgen] Lead já existente vinculado no CRM: ${existingLead.id} (${phone || email})`);
        }
    } catch (err) {
        console.error('[Meta Leadgen] Erro inesperado no processamento do lead:', err);
    }
}

// ROTA 3.2: POST /api/meta-ads/webhook (Receiver com RAW body + HMAC SHA256)
app.post('/api/meta-ads/webhook', express.raw({ type: '*/*' }), async (req, res) => {
    try {
        const rawBody = Buffer.isBuffer(req.body) 
            ? req.body 
            : (req.rawBody || Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})));
        const signature = req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256'];
        const appSecret = process.env.META_APP_SECRET;

        if (!validateMetaWebhookSignature(rawBody, signature, appSecret)) {
            console.warn('[Meta Webhook] Assinatura SHA256 inválida ou ausente.');
            return res.status(401).json({ error: 'Assinatura inválida' });
        }

        // Responder 200 OK imediatamente para a Meta
        res.status(200).send('EVENT_RECEIVED');

        // Processar salvamento assíncrono na fila
        let bodyJson;
        try {
            const rawString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
            bodyJson = JSON.parse(rawString);
        } catch (e) {
            console.error('[Meta Webhook] Corrupt JSON body:', e);
            return;
        }

        if (!bodyJson || !Array.isArray(bodyJson.entry)) {
            return;
        }

        const eventsToInsert = [];
        const client = supabaseAdmin || supabase;

        bodyJson.entry.forEach((entry) => {
            const adAccountId = entry.id || 'unknown';
            const entryTime = entry.time || Math.floor(Date.now() / 1000);
            const changes = Array.isArray(entry.changes) ? entry.changes : [];

            changes.forEach((change, index) => {
                const fieldName = change.field || 'unknown';
                const idempotencyId = `${adAccountId}-${entryTime}-${fieldName}-${index}`;

                eventsToInsert.push({
                    idempotency_id: idempotencyId,
                    ad_account_id: String(adAccountId),
                    field: String(fieldName),
                    raw_payload: change.value || change,
                    status: 'pending',
                    received_at: new Date().toISOString()
                });

                // Detectar e processar evento leadgen de formulário nativo do Meta Ads
                if (fieldName === 'leadgen') {
                    console.log(`[Meta Webhook] Evento leadgen recebido: form_id=${change.value?.form_id}, leadgen_id=${change.value?.leadgen_id}`);
                    processMetaLeadgen(entry, change).catch(err => {
                        console.error('[Meta Webhook Leadgen Immediate Processing Error]:', err);
                    });
                }
            });
        });

        if (eventsToInsert.length > 0) {
            const { error: insertError } = await client
                .from('meta_webhook_events')
                .upsert(eventsToInsert, { onConflict: 'idempotency_id', ignoreDuplicates: true });

            if (insertError) {
                console.error('[Meta Webhook] Erro ao salvar eventos na fila:', insertError);
            } else {
                console.log(`[Meta Webhook] ${eventsToInsert.length} eventos salvos na fila.`);
            }
        }
    } catch (err) {
        console.error('[Meta Webhook Error]:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
});

app.use(express.json({ 
    limit: '50mb',
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
})); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware de Log
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

app.get(['/exclusao-dados', '/exclusao-dados.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'exclusao-dados.html'));
});

app.get(['/politica', '/politica.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'politica.html'));
});

app.get(['/termo', '/termo.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'termo.html'));
});

// Servidor de estáticos movido para o final do arquivo para suportar o middleware do Vite em desenvolvimento

// ==============================================================================
// 1. GERAR URL DE LOGIN (Para o Frontend)
// ==============================================================================
app.get('/api/auth/google-ads/url', (req, res) => {
    try {
        const { redirect_uri, user_id } = req.query;
        
        if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not set' });

        const scope = [
            'https://www.googleapis.com/auth/adwords'
        ].join(' ');

        const state = `google-ads-oauth-${user_id || 'unknown'}`;

        const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${redirect_uri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
        
        res.json({ url });
    } catch (error) {
        console.error('Erro em /api/auth/google-ads/url:', error);
        res.status(500).json({ error: error.message });
    }
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
        const listUrl = 'https://googleads.googleapis.com/v24/customers:listAccessibleCustomers';
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
                const searchResp = await fetch(`https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`, {
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

        const searchResp = await fetch(`https://googleads.googleapis.com/v24/customers/${manager_id}/googleAds:search`, {
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
// 2.3 META ADS INTEGRATION ROUTES (Fase 1)
// ==============================================================================

const META_CONFIG_ID = process.env.META_CONFIG_ID;
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_API_VERSION = process.env.META_API_VERSION || 'v25.0';
const META_REDIRECT_URI = process.env.META_REDIRECT_URI;

// Helper backend para obter token válido - real implementation located below (getValidMetaToken)

// Rota de diagnóstico para debugar o fluxo OAuth do Meta Ads
app.get('/api/debug/oauth', (req, res) => {
    const rawRedirectUri = req.query.redirect_uri || META_REDIRECT_URI || 'https://axis-ai-1s3m.onrender.com/';
    const finalRedirectUri = rawRedirectUri.trim().endsWith('/') ? rawRedirectUri.trim() : rawRedirectUri.trim() + '/';
    
    const hostHeader = req.headers.host || '';
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const detectedOrigin = `${protocol}://${hostHeader}`;

    const configIdStatus = META_CONFIG_ID ? 'Configurado ✅' : 'Ausente ❌ (Usando config_id padrão se aplicável)';
    const appIdStatus = META_APP_ID ? 'Configurado ✅' : 'Ausente ❌';
    const appSecretStatus = META_APP_SECRET ? 'Configurado ✅' : 'Ausente ❌';
    
    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Diagnóstico de OAuth Meta Ads - AXIS AI</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; }
            code, pre { font-family: 'JetBrains Mono', monospace; }
        </style>
    </head>
    <body class="bg-slate-50 text-slate-800 min-h-screen py-12 px-4 sm:px-6 lg:px-8">
        <div class="max-w-4xl mx-auto bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
            <!-- Header -->
            <div class="bg-slate-900 text-white p-8 md:p-10">
                <div class="flex items-center gap-3 mb-2">
                    <span class="px-3 py-1 bg-blue-500/10 text-blue-400 text-xs font-bold uppercase tracking-wider rounded-full border border-blue-500/20">Ferramenta de Suporte</span>
                    <span class="text-xs text-slate-400">v1.1.0</span>
                </div>
                <h1 class="text-3xl font-black tracking-tight">Diagnóstico de Integração Meta Ads</h1>
                <p class="text-slate-400 text-sm mt-2">Esta página oculta analisa o handshake do Facebook Login for Business e as URIs de redirecionamento para evitar erros de <strong>redirect_uri_mismatch</strong>.</p>
            </div>

            <!-- Content -->
            <div class="p-8 md:p-10 space-y-8">
                <!-- Status das Chaves de Ambiente -->
                <div>
                    <h2 class="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                        1. Variáveis de Ambiente (.env) no Backend
                    </h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <p class="text-xs text-slate-400 uppercase font-bold tracking-wider">META_APP_ID</p>
                            <p class="text-sm font-semibold mt-1 text-slate-800">${appIdStatus}</p>
                            ${META_APP_ID ? `<p class="text-[10px] text-slate-400 font-mono mt-1">Valor: ${META_APP_ID.substring(0, 4)}...${META_APP_ID.slice(-4)}</p>` : ''}
                        </div>
                        <div class="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <p class="text-xs text-slate-400 uppercase font-bold tracking-wider">META_APP_SECRET</p>
                            <p class="text-sm font-semibold mt-1 text-slate-800">${appSecretStatus}</p>
                            ${META_APP_SECRET ? `<p class="text-[10px] text-slate-400 font-mono mt-1">Valor: ${META_APP_SECRET.substring(0, 3)}...${META_APP_SECRET.slice(-3)}</p>` : ''}
                        </div>
                        <div class="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <p class="text-xs text-slate-400 uppercase font-bold tracking-wider">META_CONFIG_ID (Facebook Business Login)</p>
                            <p class="text-sm font-semibold mt-1 text-slate-800">${configIdStatus}</p>
                            ${META_CONFIG_ID ? `<p class="text-[10px] text-slate-400 font-mono mt-1">Valor: ${META_CONFIG_ID}</p>` : ''}
                        </div>
                        <div class="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <p class="text-xs text-slate-400 uppercase font-bold tracking-wider">META_REDIRECT_URI (Configurada no .env)</p>
                            <p class="text-sm font-mono text-slate-800 mt-1 truncate">${META_REDIRECT_URI || 'Não configurada (Usando fallback automático)'}</p>
                        </div>
                    </div>
                </div>

                <!-- Handshake Redirect URIs -->
                <div>
                    <h2 class="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                        2. URIs de Redirecionamento em Tempo de Execução
                    </h2>
                    <div class="space-y-4">
                        <div class="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl">
                            <h3 class="text-xs font-bold text-blue-900 uppercase tracking-wider">URI enviada no Dialog de Login (Auth URL)</h3>
                            <p class="text-sm font-mono text-blue-900 font-semibold mt-1 select-all break-all">${finalRedirectUri}</p>
                            <p class="text-[11px] text-blue-700 mt-1">Esta é a URI exata passada ao Facebook no parâmetro <code>redirect_uri</code> para autenticação.</p>
                        </div>

                        <div class="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl">
                            <h3 class="text-xs font-bold text-emerald-900 uppercase tracking-wider">URI enviada na Troca de Token (Exchange URL)</h3>
                            <p class="text-sm font-mono text-emerald-900 font-semibold mt-1 select-all break-all">${finalRedirectUri}</p>
                            <p class="text-[11px] text-emerald-700 mt-1">Esta URI é enviada no POST da troca de código por token (<code>/oauth/access_token</code>) e **DEVE** ser idêntica à de cima.</p>
                        </div>

                        <div class="p-4 bg-amber-50/50 border border-amber-100 rounded-2xl">
                            <h3 class="text-xs font-bold text-amber-900 uppercase tracking-wider">Origem Autodetectada desta Requisição</h3>
                            <p class="text-sm font-mono text-amber-900 mt-1 break-all">${detectedOrigin}</p>
                            <p class="text-[11px] text-amber-700 mt-1">Detectado a partir dos cabeçalhos do servidor. Caso seu app mude de domínio, configure a <code>META_REDIRECT_URI</code> para o domínio correto.</p>
                        </div>
                    </div>
                </div>

                <!-- Solução passo a passo -->
                <div class="p-6 bg-slate-900 text-white rounded-3xl space-y-4">
                    <h3 class="text-base font-black flex items-center gap-2">
                        💡 Como resolver o erro "redirect_uri_mismatch"?
                    </h3>
                    <ol class="list-decimal pl-5 space-y-2.5 text-xs text-slate-300">
                        <li>Acesse o <a href="https://developers.facebook.com/" target="_blank" class="text-blue-400 hover:underline font-bold">Meta for Developers</a> e entre no seu Aplicativo.</li>
                        <li>No menu lateral esquerdo, vá em <strong>Facebook Login para Empresas (Facebook Login for Business)</strong> ou <strong>Facebook Login</strong> e clique em <strong>Configurações</strong>.</li>
                        <li>No campo <strong>URIs de redirecionamento do OAuth válidas</strong>, você DEVE inserir exatamente o seguinte link:
                            <div class="mt-2 p-3 bg-slate-800 text-slate-200 font-mono text-xs rounded-xl border border-slate-700 select-all break-all">
                                ${finalRedirectUri}
                            </div>
                        </li>
                        <li>Se você usa múltiplos ambientes ou domínios (como Render, Vercel ou o preview do AI Studio), certifique-se de adicionar **TODAS** as URLs de redirecionamento correspondentes como válidas.</li>
                        <li>Clique em <strong>Salvar alterações</strong> no rodapé do painel do Facebook.</li>
                    </ol>
                </div>

                <!-- Testes Rápidos -->
                <div>
                    <h3 class="text-sm font-bold text-slate-900 mb-2">Simular Geração de Link</h3>
                    <p class="text-xs text-slate-400 mb-3">Teste a montagem do link de login com o usuário padrão <code>test-user</code>:</p>
                    <a href="/api/auth/meta-ads/url?user_id=test-user&redirect_uri=${encodeURIComponent(finalRedirectUri)}" target="_blank" class="inline-flex items-center gap-1 text-xs font-bold text-blue-500 hover:text-blue-700 hover:underline">
                        Testar endpoint de geração de URL &rarr;
                    </a>
                </div>
            </div>

            <!-- Footer -->
            <div class="bg-slate-50 px-8 py-6 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-400">
                <p>&copy; AXIS AI - Todos os direitos reservados.</p>
                <div class="flex gap-4">
                    <a href="/" class="hover:text-slate-600 underline">Voltar para o App</a>
                    <span class="text-slate-300">|</span>
                    <span class="font-mono text-[10px] text-emerald-500 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100/50">Status: Prontidão Operacional</span>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

// 1. Gerar URL de Auth Meta Ads
app.get('/api/auth/meta-ads/url', (req, res) => {
    try {
        const { user_id, redirect_uri } = req.query;
        
        if (!user_id) {
            return res.status(400).json({ error: 'Missing user_id' });
        }

        if (!META_APP_ID) {
            return res.status(500).json({ error: 'META_APP_ID não configurado no backend.' });
        }

        const rawRedirectUri = redirect_uri || META_REDIRECT_URI || 'https://axis-ai-1s3m.onrender.com/';
        const finalRedirectUri = rawRedirectUri.trim().endsWith('/') ? rawRedirectUri.trim() : rawRedirectUri.trim() + '/';
        const state = `meta-ads-oauth-${user_id}`;
        
        const params = new URLSearchParams({
            client_id: META_APP_ID,
            redirect_uri: finalRedirectUri,
            scope: 'ads_read,ads_management,business_management,pages_show_list,pages_read_engagement',
            state: state,
            response_type: 'code'
        });

        const url = `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params.toString()}`;
        
        console.log(`[Meta Ads] Auth URL gerada para user ${user_id}, scope: ads_read, redirect_uri: ${finalRedirectUri}`);
        res.json({ ok: true, url });
    } catch (error) {
        console.error('Erro em /api/auth/meta-ads/url:', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Trocar Code por Token (Exchange)
app.post('/api/auth/meta-ads/exchange', async (req, res) => {
    try {
        const { code, redirect_uri, user_id } = req.body;

        if (!code || !user_id) {
            return res.status(400).json({ error: 'Missing code or user_id' });
        }

        if (!META_APP_ID || !META_APP_SECRET) {
            return res.status(500).json({ error: 'Meta App credentials are not configured on the server.' });
        }

        const rawRedirectUri = redirect_uri || META_REDIRECT_URI || 'https://axis-ai-1s3m.onrender.com/';
        const finalRedirectUri = rawRedirectUri.trim().endsWith('/') ? rawRedirectUri.trim() : rawRedirectUri.trim() + '/';

        // Logs de depuração profunda para redirect_uri
        console.log(`[Meta Ads] Exchange - redirect_uri sendo enviado: "${finalRedirectUri}" (com barra: ${finalRedirectUri.endsWith('/')})`);
        console.log('[Meta Ads Debug] Detalhes da Redirect URI para o Handshake:');
        console.log(`- Recebido do Request Body (redirect_uri): "${redirect_uri || ''}"`);
        console.log(`- META_REDIRECT_URI do .env: "${META_REDIRECT_URI || ''}"`);
        console.log(`- Final processado (finalRedirectUri): "${finalRedirectUri}"`);
        console.log(`- Comprimento da string final: ${finalRedirectUri.length} caracteres`);
        
        // Exibe representação em array de códigos para detectar caracteres invisíveis/Unicode extras (\r, \n, %20, etc.)
        const charCodes = Array.from(finalRedirectUri).map(char => `${char}:${char.charCodeAt(0)}`).join(', ');
        console.log(`- Mapeamento de Caracteres [char:charCode]: [${charCodes}]`);
        
        // Verifica se há espaços, barras ou quebras de linha escondidos
        if (/\s/.test(finalRedirectUri)) console.warn('[Meta Ads Debug] ALERTA: A finalRedirectUri contém espaços em branco!');
        if (/\r|\n/.test(finalRedirectUri)) console.warn('[Meta Ads Debug] ALERTA: A finalRedirectUri contém quebras de linha (\\r ou \\n)!');

        // 2.1 Trocar code por short-lived token
        const shortLivedUrl = `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` + new URLSearchParams({
            client_id: META_APP_ID,
            redirect_uri: finalRedirectUri,
            client_secret: META_APP_SECRET,
            code: code
        }).toString();

        console.log(`[Meta Ads] Chamando OAuth Graph API...`);
        console.log(`- URL completa de requisição (sem secret): https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(finalRedirectUri)}&code=[OMITTED]&client_secret=[OMITTED]`);
        console.log(`- redirect_uri exato que está sendo enviado ao Facebook: "${finalRedirectUri}"`);
        const shortResp = await fetch(shortLivedUrl);
        const shortData = await shortResp.json();
        
        if (shortData.error) {
            console.error('[Meta Ads] Short Token Error:', shortData.error);
            return res.status(400).json({ error: shortData.error.message || 'Erro ao obter short-lived token' });
        }

        const shortToken = shortData.access_token;

        // 2.2 Trocar por long-lived token
        const longLivedUrl = `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` + new URLSearchParams({
            grant_type: 'fb_exchange_token',
            client_id: META_APP_ID,
            client_secret: META_APP_SECRET,
            fb_exchange_token: shortToken
        }).toString();

        const longResp = await fetch(longLivedUrl);
        const longData = await longResp.json();

        if (longData.error) {
            console.error('[Meta Ads] Long Token Error:', longData.error);
            return res.status(400).json({ error: longData.error.message || 'Erro ao obter long-lived token' });
        }

        const longToken = longData.access_token;
        const expires_in = longData.expires_in;
        const tokenExpiresAt = expires_in ? Date.now() + expires_in * 1000 : null;

        console.log(`[Meta Ads] Token trocado com sucesso para user ${user_id}`);

        // 2.3 Buscar contas de anúncio
        const accountsUrl = `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts?` + new URLSearchParams({
            fields: 'id,name,account_status,currency,timezone_name',
            access_token: longToken
        }).toString();

        const accountsResp = await fetch(accountsUrl);
        const accountsData = await accountsResp.json();

        if (accountsData.error) {
            console.error('[Meta Ads] Fetch Accounts Error:', accountsData.error);
            return res.status(400).json({ error: accountsData.error.message || 'Erro ao buscar contas de anúncio' });
        }

        const accounts = accountsData.data || [];
        console.log(`[Meta Ads] ${accounts.length} contas encontradas`);

        if (accounts.length === 0) {
            const insertData = {
                user_id,
                access_token: longToken,
                token_expires_at: tokenExpiresAt,
                status: 'no_accounts',
                updated_at: new Date()
            };
            
            const { data: upsertData, error: upsertErr } = await supabase
                .from('meta_ads_integrations')
                .upsert(insertData, { onConflict: 'user_id' })
                .select();

            if (upsertErr) {
                console.error('[Meta Ads] ERRO ao salvar integração no Supabase:', JSON.stringify(upsertErr, null, 2));
                console.error('[Meta Ads] Dados que tentou salvar:', JSON.stringify({ ...insertData, access_token: '[OMITIDO]' }, null, 2));
                return res.status(500).json({ error: 'Falha ao salvar integração: ' + (upsertErr.message || 'erro desconhecido') });
            }

            console.log(`[Meta Ads] Integração salva com sucesso. ID: ${upsertData?.[0]?.id || 'N/A'}, Status: ${insertData.status}`);
            return res.json({ ok: false, error: 'Nenhuma conta de anúncio encontrada neste perfil do Facebook.' });
        } else if (accounts.length === 1) {
            const account = accounts[0];
            const insertData = {
                user_id,
                access_token: longToken,
                token_expires_at: tokenExpiresAt,
                ad_account_id: account.id,
                ad_account_name: account.name || `Conta ${account.id}`,
                currency: account.currency || null,
                timezone_name: account.timezone_name || null,
                business_id: account.business?.id || null,
                business_name: account.business?.name || null,
                status: 'active',
                last_sync_at: new Date(),
                updated_at: new Date()
            };
            
            const { data: upsertData, error: upsertErr } = await supabase
                .from('meta_ads_integrations')
                .upsert(insertData, { onConflict: 'user_id' })
                .select();

            if (upsertErr) {
                console.error('[Meta Ads] ERRO ao salvar integração no Supabase:', JSON.stringify(upsertErr, null, 2));
                console.error('[Meta Ads] Dados que tentou salvar:', JSON.stringify({ ...insertData, access_token: '[OMITIDO]' }, null, 2));
                return res.status(500).json({ error: 'Falha ao salvar integração: ' + (upsertErr.message || 'erro desconhecido') });
            }

            console.log(`[Meta Ads] Integração salva com sucesso. ID: ${upsertData?.[0]?.id || 'N/A'}, Status: ${insertData.status}`);
            console.log(`[Meta Ads] Conta selecionada: ${account.id}`);
            return res.json({ ok: true, mode: 'active', account: { id: account.id, name: account.name } });
        } else {
            const insertData = {
                user_id,
                access_token: longToken,
                token_expires_at: tokenExpiresAt,
                status: 'pending_selection',
                ad_account_id: null,
                ad_account_name: null,
                currency: null,
                timezone_name: null,
                business_id: null,
                business_name: null,
                updated_at: new Date()
            };
            
            const { data: upsertData, error: upsertErr } = await supabase
                .from('meta_ads_integrations')
                .upsert(insertData, { onConflict: 'user_id' })
                .select();

            if (upsertErr) {
                console.error('[Meta Ads] ERRO ao salvar integração no Supabase:', JSON.stringify(upsertErr, null, 2));
                console.error('[Meta Ads] Dados que tentou salvar:', JSON.stringify({ ...insertData, access_token: '[OMITIDO]' }, null, 2));
                return res.status(500).json({ error: 'Falha ao salvar integração: ' + (upsertErr.message || 'erro desconhecido') });
            }

            console.log(`[Meta Ads] Integração salva com sucesso. ID: ${upsertData?.[0]?.id || 'N/A'}, Status: ${insertData.status}`);
            return res.json({
                ok: true,
                mode: 'selection_required',
                accounts: accounts.map(acc => ({
                    id: acc.id,
                    name: acc.name || `Conta ${acc.id}`,
                    currency: acc.currency,
                    timezone_name: acc.timezone_name,
                    business_name: acc.business?.name || null
                }))
            });
        }
    } catch (err) {
        console.error('[Meta Ads] Erro no fluxo OAuth Exchange:', err);
        res.status(500).json({ error: err.message || 'Erro interno no processamento de token.' });
    }
});

// 3. Selecionar Conta Manualmente (múltiplas contas)
app.post('/api/auth/meta-ads/select-account', async (req, res) => {
    const { user_id, ad_account_id } = req.body;
    if (!user_id || !ad_account_id) {
        return res.status(400).json({ error: 'Missing user_id or ad_account_id' });
    }

    try {
        const { data: integration, error } = await supabase
            .from('meta_ads_integrations')
            .select('*')
            .eq('user_id', user_id)
            .single();

        if (error || !integration) {
            return res.status(404).json({ error: 'Integração Meta Ads não encontrada.' });
        }

        const token = integration.access_token;
        if (!token) {
            return res.status(400).json({ error: 'Token de acesso não encontrado. Refaça o login.' });
        }

        const adAccountUrl = `https://graph.facebook.com/${META_API_VERSION}/${ad_account_id}?` + new URLSearchParams({
            fields: 'id,name,currency,timezone_name',
            access_token: token
        }).toString();

        const accountResp = await fetch(adAccountUrl);
        const accountData = await accountResp.json();

        if (accountData.error) {
            console.error('[Meta Ads] Erro ao validar conta:', accountData.error);
            return res.status(400).json({ error: accountData.error.message || 'Erro ao validar conta de anúncio no Meta Ads.' });
        }

        const updateData = {
            ad_account_id: accountData.id,
            ad_account_name: accountData.name || `Conta ${accountData.id}`,
            currency: accountData.currency || null,
            timezone_name: accountData.timezone_name || null,
            business_id: accountData.business?.id || null,
            business_name: accountData.business?.name || null,
            status: 'active',
            last_sync_at: new Date(),
            updated_at: new Date()
        };

        const { error: updateError } = await safeUpdate(supabase, 'meta_ads_integrations', updateData, 'user_id', user_id);
        if (updateError) {
            throw updateError;
        }

        const safeIntegration = { ...integration, ...updateData };
        delete safeIntegration.access_token;

        console.log(`[Meta Ads] Conta selecionada: ${ad_account_id} para user ${user_id}`);

        res.json({ ok: true, integration: safeIntegration });
    } catch (err) {
        console.error('[Meta Ads] Erro ao selecionar conta:', err);
        res.status(500).json({ error: err.message || 'Erro interno ao selecionar conta.' });
    }
});

// 4. Obter status da integração Meta Ads
app.get('/api/meta-ads/status/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const { data, error } = await supabase
            .from('meta_ads_integrations')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error || !data) {
            return res.json({ ok: true, connected: false });
        }

        res.json({
            ok: true,
            connected: data.status === 'active' || data.status === 'pending_selection',
            status: data.status,
            ad_account_id: data.ad_account_id,
            ad_account_name: data.ad_account_name,
            business_name: data.business_name,
            currency: data.currency,
            timezone_name: data.timezone_name,
            token_expires_at: data.token_expires_at
        });
    } catch (err) {
        console.error('[Meta Ads] Erro ao obter status:', err);
        res.status(500).json({ error: err.message || 'Erro interno ao obter status.' });
    }
});

app.get('/api/meta-ads/mcp-status/:userId', async (req, res) => {
    // MCP desabilitado (escopo rejeitado pela Meta)
    res.json({ mcpEnabled: false });
});

// 5. Desconectar Meta Ads (Deleta a linha)
app.post('/api/meta-ads/disconnect', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) {
        return res.status(400).json({ error: 'Missing user_id' });
    }

    try {
        await supabase
            .from('meta_ads_integrations')
            .delete()
            .eq('user_id', user_id);

        res.json({ ok: true });
    } catch (err) {
        console.error('[Meta Ads] Erro ao desconectar:', err);
        res.status(500).json({ error: err.message || 'Erro ao desconectar.' });
    }
});

// Helper backend para obter credenciais do Meta do Banco
async function getMetaCredentials(user_id) {
    if (!user_id) {
        throw new Error('User ID inválido');
    }
    const { data, error } = await supabase
        .from('meta_ads_integrations')
        .select('access_token, ad_account_id')
        .eq('user_id', user_id)
        .single();

    if (error || !data) {
        throw new Error('Meta Ads não conectado');
    }

    if (!data.access_token || !data.ad_account_id) {
        throw new Error('Meta Ads não conectado ou conta não selecionada');
    }

    return {
        accessToken: data.access_token,
        adAccountId: data.ad_account_id
    };
}

// Helper para validar e renovar o token do Meta Ads
const metaAdsRefreshLocks = new Map();

async function getValidMetaToken(user_id) {
    if (!user_id) {
        throw new Error('User ID inválido');
    }
    const { data: integration, error } = await supabase
        .from('meta_ads_integrations')
        .select('*')
        .eq('user_id', user_id)
        .single();

    if (error || !integration) {
        throw new Error('Meta Ads não conectado');
    }

    if (!integration.access_token || !integration.ad_account_id) {
        throw new Error('Meta Ads não conectado ou conta não selecionada');
    }

    let accessToken = integration.access_token;
    const expiresAt = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : null;

    // Se estiver próximo de expirar (menos de 1 hora) ou já expirado
    if (expiresAt && Date.now() > (expiresAt - 3600000)) {
        console.log(`[Meta Ads Token Refresh] Token próximo de expirar para user ${user_id}. Renovando...`);
        
        const lockKey = user_id;
        if (metaAdsRefreshLocks.has(lockKey)) {
            await metaAdsRefreshLocks.get(lockKey);
            // Buscar o token fresco do banco
            const { data: freshIntegration } = await supabase
                .from('meta_ads_integrations')
                .select('access_token, token_expires_at')
                .eq('user_id', user_id)
                .single();
            if (freshIntegration && freshIntegration.access_token) {
                return { accessToken: freshIntegration.access_token, adAccountId: integration.ad_account_id };
            }
        }

        const refreshPromise = (async () => {
            const refreshUrl = `https://graph.facebook.com/v25.0/oauth/access_token`;
            const params = new URLSearchParams({
                grant_type: 'fb_exchange_token',
                client_id: META_APP_ID,
                client_secret: META_APP_SECRET,
                fb_exchange_token: accessToken
            });

            const refreshResp = await fetch(`${refreshUrl}?${params.toString()}`, { method: 'POST' });
            const refreshData = await refreshResp.json();

            if (refreshData.error) {
                console.error('[Meta Ads Token Refresh Error]:', refreshData.error);
                if (Date.now() > expiresAt) {
                    throw new Error(`Falha ao renovar token do Meta: ${refreshData.error.message}`);
                }
                return accessToken;
            } else {
                const newAccessToken = refreshData.access_token;
                const expires_in = refreshData.expires_in;
                const tokenExpiresAt = expires_in ? Date.now() + expires_in * 1000 : null;

                await supabase
                    .from('meta_ads_integrations')
                    .update({
                        access_token: newAccessToken,
                        token_expires_at: tokenExpiresAt,
                        updated_at: new Date()
                    })
                    .eq('user_id', user_id);

                console.log(`[Meta Ads Token Refresh] Token renovado com sucesso para user ${user_id}`);
                return newAccessToken;
            }
        })();

        metaAdsRefreshLocks.set(lockKey, refreshPromise);
        try {
            accessToken = await refreshPromise;
        } catch (refreshErr) {
            console.error('[Meta Ads Token Refresh Exception]:', refreshErr);
            if (Date.now() > expiresAt) {
                throw refreshErr;
            }
        } finally {
            metaAdsRefreshLocks.delete(lockKey);
        }
    }

    return {
        accessToken,
        adAccountId: integration.ad_account_id
    };
}


async function executeMetaMutation(url, method, token, body = null) {
    const options = {
        method,
        headers: { 'Authorization': `Bearer ${token}` }
    };
    if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    const resp = await fetch(url, options);
    const data = await resp.json();
    if (data.error) {
        console.error('[Meta Ads Mutation] Error:', JSON.stringify(data.error));
        throw new Error(data.error.message || 'Erro na mutação Meta Ads');
    }
    return data;
}

const CONVERSION_TYPES = [
    'offsite_conversion',
    'offsite_conversion.fb_pixel_purchase',
    'offsite_conversion.fb_pixel_lead',
    'offsite_conversion.fb_pixel_add_to_cart',
    'offsite_conversion.fb_pixel_complete_registration',
    'offsite_conversion.fb_pixel_contact',
    'purchase',
    'lead',
    'add_to_cart',
    'complete_registration',
    'contact',
    'messenger_dialog_app_dialog_message_send',
    'onsite_conversion.messaging_conversation_started_7d'
];

function extractConversions(insights) {
    if (!insights) return 0;
    
    let total = 0;
    const actionsList = insights.actions || insights.conversions || [];
    if (Array.isArray(actionsList)) {
        for (const action of actionsList) {
            const isConversion = CONVERSION_TYPES.some(type => 
                action.action_type === type || 
                action.action_type.startsWith('offsite_conversion.') ||
                action.action_type.includes('purchase') ||
                action.action_type.includes('lead') ||
                action.action_type.includes('conversion')
            );
            
            if (isConversion) {
                total += parseInt(action.value || '0', 10);
            }
        }
    }
    
    // Fallback if there is a direct conversions value field
    if (total === 0 && insights.conversions !== undefined && insights.conversions !== null) {
        if (typeof insights.conversions === 'number') return insights.conversions;
        if (typeof insights.conversions === 'string') {
            const parsed = parseInt(insights.conversions, 10);
            if (!isNaN(parsed)) return parsed;
        }
    }

    return total;
}

function getFieldValue(fieldName, rowData) {
    if (!rowData) return 0;
    
    // 1. Check direct property
    if (rowData[fieldName] !== undefined && rowData[fieldName] !== null) {
        const val = parseFloat(rowData[fieldName]);
        return isNaN(val) ? 0 : val;
    }
    
    // 2. Check actions or action_values array
    const searchInArray = (arr, typeName) => {
        if (!Array.isArray(arr)) return null;
        const found = arr.find(item => 
            item.action_type === typeName || 
            item.action_type?.startsWith(typeName + '.') ||
            item.action_type?.includes(typeName)
        );
        return found ? parseFloat(found.value) : null;
    };

    // Try actions
    let actionVal = searchInArray(rowData.actions || rowData.conversions, fieldName);
    if (actionVal !== null && !isNaN(actionVal)) return actionVal;

    // Try action_values
    let actionValueVal = searchInArray(rowData.action_values || rowData.conversion_values, fieldName);
    if (actionValueVal !== null && !isNaN(actionValueVal)) return actionValueVal;

    return 0;
}

function extractResultsByObjective(objective, insights) {
    if (!insights) return 0;
    
    // Fallback if actions is empty
    if (!insights.actions && !insights.conversions) {
        if (objective === 'OUTBOUND_CLICKS' && insights.outbound_clicks) {
            return parseInt(insights.outbound_clicks) || 0;
        }
        return 0;
    }

    const actions = insights.actions || insights.conversions || [];
    if (!Array.isArray(actions)) return 0;

    // Map objectives to their primary action types
    let targetActionTypes = [];
    
    const obj = (objective || '').toUpperCase();
    if (obj.includes('CONVERSIONS') || obj.includes('OUTCOME_SALES') || obj.includes('SALES')) {
        targetActionTypes = ['purchase', 'offsite_conversion.fb_pixel_purchase', 'offsite_conversion', 'onsite_conversion.messaging_conversation_started_7d'];
    } else if (obj.includes('LEAD') || obj.includes('OUTCOME_LEADS')) {
        targetActionTypes = ['lead', 'offsite_conversion.fb_pixel_lead', 'submit_application', 'lead_grouped'];
    } else if (obj.includes('TRAFFIC') || obj.includes('OUTBOUND_CLICKS') || obj.includes('LINK_CLICKS')) {
        targetActionTypes = ['link_click', 'outbound_click'];
    } else if (obj.includes('POST_ENGAGEMENT') || obj.includes('ENGAGEMENT')) {
        targetActionTypes = ['post_engagement', 'post_reaction', 'comment', 'share', 'page_engagement'];
    } else if (obj.includes('APP_INSTALLS') || obj.includes('APP_PROMOTION')) {
        targetActionTypes = ['mobile_app_install', 'app_install'];
    } else if (obj.includes('VIDEO_VIEWS')) {
        targetActionTypes = ['video_view', 'video_play'];
    } else if (obj.includes('MESSAGING') || obj.includes('OUTCOME_TRAFFIC')) {
        targetActionTypes = ['onsite_conversion.messaging_conversation_started_7d', 'link_click'];
    }

    // Default list of conversion action types if objective doesn't map perfectly
    if (targetActionTypes.length === 0) {
        targetActionTypes = CONVERSION_TYPES;
    }

    let total = 0;
    for (const action of actions) {
        const match = targetActionTypes.some(type => 
            action.action_type === type || 
            action.action_type.startsWith(type + '.') ||
            action.action_type.endsWith('.' + type) ||
            action.action_type.includes(type)
        );
        if (match) {
            total += parseInt(action.value || '0', 10);
        }
    }

    // If still 0, return any purchase or lead or general conversions
    if (total === 0) {
        for (const action of actions) {
            const isGeneralConversion = CONVERSION_TYPES.some(type => 
                action.action_type === type || 
                action.action_type.startsWith('offsite_conversion.')
            );
            if (isGeneralConversion) {
                total += parseInt(action.value || '0', 10);
            }
        }
    }

    return total;
}

function formatValue(value, format) {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value)) {
        return '0';
    }
    if (format === 'percentage') {
        return (value * 100).toFixed(2) + '%';
    }
    if (format === 'currency') {
        return 'R$ ' + value.toFixed(2).replace('.', ',');
    }
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function evaluateCustomMetric(formula, rowData) {
    if (!formula || typeof formula !== 'string') {
        throw new Error('Fórmula não fornecida ou inválida');
    }

    // 1. Substituir {{field_name}} pelo valor correspondente
    let expr = formula.replace(/\{\{(\w+)\}\}/g, (match, fieldName) => {
        const val = getFieldValue(fieldName, rowData);
        return val.toString();
    });

    // 2. Validar que a expressão resultante só contém caracteres seguros
    let tempExpr = expr;
    const allowedWords = ['min', 'max', 'abs', 'round', 'sqrt', 'log10', 'if'];
    for (const word of allowedWords) {
        tempExpr = tempExpr.replace(new RegExp(`\\b${word}\\b`, 'g'), '');
    }

    const unsafeCharMatch = tempExpr.match(/[^0-9+\-*/%^().,\s]/);
    if (unsafeCharMatch) {
        throw new Error(`Fórmula inválida: caracteres não permitidos ou termo suspeito encontrado: "${unsafeCharMatch[0]}"`);
    }

    // Substituir "^" por "**" para potenciação real em JS
    let jsExpr = expr.replace(/\^/g, '**');

    // 5. Avaliar usando Function constructor com whitelist de funções matemáticas
    const allowedFns = { 
        min: Math.min, 
        max: Math.max, 
        abs: Math.abs, 
        round: Math.round, 
        sqrt: Math.sqrt, 
        log10: Math.log10, 
        if: (c, a, b) => c ? a : b 
    };

    try {
        const fn = new Function(...Object.keys(allowedFns), `return ${jsExpr};`);
        const result = fn(...Object.values(allowedFns));
        
        if (result === null || result === undefined || isNaN(result) || !isFinite(result)) {
            return 0;
        }
        return result;
    } catch (evalError) {
        throw new Error(`Erro ao avaliar a fórmula: ${evalError.message}`);
    }
}

// 6. Rota POST /api/meta-ads/overview
app.post('/api/meta-ads/overview', async (req, res) => {
    const { user_id, date_range } = req.body;
    try {
        const { accessToken, adAccountId } = await getValidMetaToken(user_id);
        const ad_account_id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
        const start = date_range?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const end = date_range?.end || new Date().toISOString().split('T')[0];

        const overviewUrl = `https://graph.facebook.com/v25.0/${ad_account_id}/insights?` + new URLSearchParams({
            fields: 'spend,impressions,clicks,reach,frequency,ctr,cpc,cpm,cpp,actions,action_values,conversions,conversion_values,website_purchase_roas,purchase_roas,cost_per_action_type,cost_per_conversion,cost_per_purchase,cost_per_lead,cost_per_add_to_cart,cost_per_initiate_checkout,cost_per_view_content,cost_per_complete_registration,cost_per_add_payment_info,post_engagement,outbound_clicks,unique_clicks,unique_ctr,video_play_actions,video_30_sec_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking,cost_per_unique_click,cost_per_outbound_click,cost_per_landing_page_view,estimated_ad_recallers,cost_per_estimated_ad_recallers',
            time_range: JSON.stringify({ since: start, until: end }),
            level: 'account',
            time_increment: '1',
            limit: '1000',
            access_token: accessToken
        }).toString();

        console.log(`[Meta Ads Dashboard] user_id: ${user_id}, ad_account_id: ${ad_account_id}, date_range:`, date_range);
        console.log(`[Meta Ads Dashboard] URL Graph API: ${overviewUrl}`);

        const response = await fetch(overviewUrl);
        const overviewData = await response.json();

        if (overviewData.error) {
            console.error('[Meta Ads API Error - Overview]:', overviewData.error);
            return res.status(400).json({ error: overviewData.error.message || 'Erro na Graph API do Meta' });
        }

        const rawResults = overviewData.data || [];
        const results = rawResults.map(item => {
            const parsedConversions = extractConversions(item);

            const parsedSpend = parseFloat(item.spend || '0');
            const parsedImpressions = parseInt(item.impressions || '0');
            const parsedClicks = parseInt(item.clicks || '0');

            return {
                ...item,
                date: item.date_start,
                spend: parsedSpend,
                impressions: parsedImpressions,
                clicks: parsedClicks,
                conversions: parsedConversions
            };
        });

        res.json({ results });
    } catch (err) {
        console.error('[Meta Ads Overview Endpoint Error]:', err);
        res.status(err.message === 'Meta Ads não conectado' ? 400 : 500).json({ error: err.message });
    }
});

// 7. Rota POST /api/meta-ads/campaigns
app.post('/api/meta-ads/campaigns', async (req, res) => {
    const { user_id, date_range } = req.body;
    try {
        const { accessToken, adAccountId } = await getValidMetaToken(user_id);
        const ad_account_id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
        const start = date_range?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const end = date_range?.end || new Date().toISOString().split('T')[0];

        const time_range_str = JSON.stringify({ since: start, until: end });
        const campaignsUrl = `https://graph.facebook.com/v25.0/${ad_account_id}/campaigns?` + new URLSearchParams({
            fields: `id,name,status,effective_status,buying_type,objective,daily_budget,lifetime_budget,insights.time_range(${time_range_str}){spend,impressions,clicks,reach,frequency,ctr,cpc,cpm,cpp,actions,action_values,conversions,conversion_values,website_purchase_roas,purchase_roas,cost_per_action_type,cost_per_conversion,cost_per_purchase,cost_per_lead,cost_per_add_to_cart,cost_per_initiate_checkout,cost_per_view_content,cost_per_complete_registration,cost_per_add_payment_info,post_engagement,outbound_clicks,unique_clicks,unique_ctr,video_play_actions,video_30_sec_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking,cost_per_unique_click,cost_per_outbound_click,cost_per_landing_page_view,estimated_ad_recallers,cost_per_estimated_ad_recallers}`,
            limit: '150',
            access_token: accessToken
        }).toString();

        console.log(`[Meta Ads Dashboard] user_id: ${user_id}, ad_account_id: ${ad_account_id}, date_range:`, date_range);
        console.log(`[Meta Ads Dashboard] URL Graph API: ${campaignsUrl}`);

        const campsResponse = await fetch(campaignsUrl);
        const campaignsData = await campsResponse.json();

        if (campaignsData.error) {
            console.error('[Meta Ads API Error - Campaigns List]:', campaignsData.error);
            return res.status(400).json({ error: campaignsData.error.message || 'Erro ao buscar campanhas' });
        }

        const campaigns = campaignsData.data || [];
        const results = campaigns.map(c => {
            const insights = c.insights?.data?.[0] || {};
            const parsedConversions = extractResultsByObjective(c.objective, insights);

            const parsedBudget = parseFloat(c.daily_budget || c.lifetime_budget || '0') / 100;
            const parsedSpend = parseFloat(insights.spend || '0');
            const parsedImpressions = parseInt(insights.impressions || '0');
            const parsedClicks = parseInt(insights.clicks || '0');

            return {
                ...insights,
                id: c.id,
                name: c.name,
                status: c.status,
                objective: c.objective,
                budget: parsedBudget,
                spend: parsedSpend,
                impressions: parsedImpressions,
                clicks: parsedClicks,
                conversions: parsedConversions,
                effective_status: c.effective_status || c.status,
                buying_type: c.buying_type,
                daily_budget: c.daily_budget,
                lifetime_budget: c.lifetime_budget
            };
        });

        res.json({ results });
    } catch (err) {
        console.error('[Meta Ads Campaigns Endpoint Error]:', err);
        res.status(err.message === 'Meta Ads não conectado' ? 400 : 500).json({ error: err.message });
    }
});

// 8. Rota POST /api/meta-ads/ad-groups
app.post('/api/meta-ads/ad-groups', async (req, res) => {
    const { user_id, date_range, campaign_id } = req.body;
    try {
        const { accessToken, adAccountId } = await getValidMetaToken(user_id);
        const ad_account_id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
        const start = date_range?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const end = date_range?.end || new Date().toISOString().split('T')[0];

        const time_range_str = JSON.stringify({ since: start, until: end });
        const adsetsUrl = `https://graph.facebook.com/v25.0/${ad_account_id}/adsets?` + new URLSearchParams({
            fields: `id,name,status,effective_status,bid_strategy,daily_budget,lifetime_budget,campaign{id,name},insights.time_range(${time_range_str}){spend,impressions,clicks,reach,frequency,ctr,cpc,cpm,cpp,actions,action_values,conversions,conversion_values,website_purchase_roas,purchase_roas,cost_per_action_type,cost_per_conversion,cost_per_purchase,cost_per_lead,cost_per_add_to_cart,cost_per_initiate_checkout,cost_per_view_content,cost_per_complete_registration,cost_per_add_payment_info,post_engagement,outbound_clicks,unique_clicks,unique_ctr,video_play_actions,video_30_sec_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking,cost_per_unique_click,cost_per_outbound_click,cost_per_landing_page_view,estimated_ad_recallers,cost_per_estimated_ad_recallers}`,
            limit: '150',
            access_token: accessToken
        }).toString();

        console.log(`[Meta Ads Dashboard] user_id: ${user_id}, ad_account_id: ${ad_account_id}, date_range:`, date_range);
        console.log(`[Meta Ads Dashboard] URL Graph API: ${adsetsUrl}`);

        const adsetsResponse = await fetch(adsetsUrl);
        const adsetsData = await adsetsResponse.json();

        if (adsetsData.error) {
            console.error('[Meta Ads API Error - Adsets List]:', adsetsData.error);
            return res.status(400).json({ error: adsetsData.error.message || 'Erro ao buscar conjuntos de anúncios' });
        }

        let adsetsList = adsetsData.data || [];

        if (campaign_id) {
            adsetsList = adsetsList.filter(adset => adset.campaign?.id === campaign_id);
        }

        const results = adsetsList.map(adset => {
            const insights = adset.insights?.data?.[0] || {};
            const parsedConversions = extractConversions(insights);

            const parsedSpend = parseFloat(insights.spend || '0');
            const parsedImpressions = parseInt(insights.impressions || '0');
            const parsedClicks = parseInt(insights.clicks || '0');

            return {
                ...insights,
                id: adset.id,
                name: adset.name,
                status: adset.status,
                budget: adset.daily_budget ? (parseFloat(adset.daily_budget) / 100) : 0,
                campaignName: adset.campaign?.name || 'Campanha desconhecida',
                spend: parsedSpend,
                impressions: parsedImpressions,
                clicks: parsedClicks,
                conversions: parsedConversions,
                effective_status: adset.effective_status || adset.status,
                bid_strategy: adset.bid_strategy,
                daily_budget: adset.daily_budget,
                lifetime_budget: adset.lifetime_budget
            };
        });

        res.json({ results });
    } catch (err) {
        console.error('[Meta Ads Ad-Groups Endpoint Error]:', err);
        res.status(err.message === 'Meta Ads não conectado' ? 400 : 500).json({ error: err.message });
    }
});

// 9. Rota POST /api/meta-ads/ads
app.post('/api/meta-ads/ads', async (req, res) => {
    const { user_id, date_range } = req.body;
    try {
        const { accessToken, adAccountId } = await getValidMetaToken(user_id);
        const ad_account_id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
        const start = date_range?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const end = date_range?.end || new Date().toISOString().split('T')[0];

        const time_range_str = JSON.stringify({ since: start, until: end });
        const adsUrl = `https://graph.facebook.com/v25.0/${ad_account_id}/ads?` + new URLSearchParams({
            fields: `id,name,status,effective_status,adset_id,campaign_id,adset{id,name},campaign{id,name},adcreatives{body,title,image_url,thumbnail_url,video_id,object_story_spec,link_url},insights.time_range(${time_range_str}){spend,impressions,clicks,reach,frequency,ctr,cpc,cpm,cpp,actions,action_values,conversions,conversion_values,website_purchase_roas,purchase_roas,cost_per_action_type,cost_per_conversion,cost_per_purchase,cost_per_lead,cost_per_add_to_cart,cost_per_initiate_checkout,cost_per_view_content,cost_per_complete_registration,cost_per_add_payment_info,post_engagement,outbound_clicks,unique_clicks,unique_ctr,video_play_actions,video_30_sec_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking,cost_per_unique_click,cost_per_outbound_click,cost_per_landing_page_view,estimated_ad_recallers,cost_per_estimated_ad_recallers}`,
            limit: '150',
            access_token: accessToken
        }).toString();

        console.log(`[Meta Ads Dashboard] user_id: ${user_id}, ad_account_id: ${ad_account_id}, date_range:`, date_range);
        console.log(`[Meta Ads Dashboard] URL Graph API: ${adsUrl}`);

        const adsResponse = await fetch(adsUrl);
        const adsData = await adsResponse.json();

        if (adsData.error) {
            console.error('[Meta Ads API Error - Ads List]:', adsData.error);
            return res.status(400).json({ error: adsData.error.message || 'Erro ao buscar anúncios' });
        }

        const adsList = adsData.data || [];

        const results = adsList.map(ad => {
            const insights = ad.insights?.data?.[0] || {};
            const parsedConversions = extractConversions(insights);

            const parsedSpend = parseFloat(insights.spend || '0');
            const parsedImpressions = parseInt(insights.impressions || '0');
            const parsedClicks = parseInt(insights.clicks || '0');

            const adCreative = ad.adcreatives?.data?.[0] || {};

            return {
                ...insights,
                id: ad.id,
                name: ad.name,
                status: ad.status,
                campaignName: ad.campaign?.name || 'Campanha desconhecida',
                adGroupName: ad.adset?.name || 'Conjunto desconhecido',
                spend: parsedSpend,
                impressions: parsedImpressions,
                clicks: parsedClicks,
                conversions: parsedConversions,
                imageUrl: adCreative.image_url || adCreative.thumbnail_url || null,
                videoId: adCreative.video_id || null,
                body: adCreative.body || null,
                title: adCreative.title || null,
                effective_status: ad.effective_status || ad.status,
                adset_id: ad.adset_id,
                campaign_id: ad.campaign_id,
                adcreatives: ad.adcreatives
            };
        });

        res.json({ results });
    } catch (err) {
        console.error('[Meta Ads Ads Endpoint Error]:', err);
        res.status(err.message === 'Meta Ads não conectado' ? 400 : 500).json({ error: err.message });
    }
});

// ==============================================================================
// METAS ADS CUSTOM METRICS ENDPOINTS (CRUD + VALIDATION)
// ==============================================================================

app.get('/api/meta-ads/custom-metrics', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        const { ad_account_id } = req.query;

        let query = supabase.from('meta_custom_metrics')
            .select('*')
            .eq('is_archived', false);

        if (ad_account_id) {
            query = query.eq('ad_account_id', ad_account_id);
        }

        const { data, error } = await query;
        if (error) throw error;

        const filtered = (data || []).filter(m => m.user_id === authUser.id || m.is_shared === true);
        res.json({ metrics: filtered });
    } catch (err) {
        console.error('[Meta Ads Custom Metrics List Error]:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/meta-ads/custom-metrics', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        const { ad_account_id, name, description, formula, format, is_shared } = req.body;
        
        if (!name || !formula || !format) {
            return res.status(400).json({ error: 'Campos name, formula e format são obrigatórios' });
        }
        
        const validFormats = ['numeric', 'percentage', 'currency'];
        if (!validFormats.includes(format)) {
            return res.status(400).json({ error: 'Formato inválido. Use numeric, percentage ou currency' });
        }

        try {
            evaluateCustomMetric(formula, {});
        } catch (fError) {
            return res.status(400).json({ error: `Fórmula inválida: ${fError.message}` });
        }

        const { data, error } = await supabase.from('meta_custom_metrics').insert({
            user_id: authUser.id,
            ad_account_id,
            name,
            description: description || '',
            formula,
            format,
            is_shared: !!is_shared,
            is_archived: false
        }).select();

        if (error) throw error;
        res.status(201).json({ ok: true, metric: data[0] });
    } catch (err) {
        console.error('[Meta Ads Custom Metrics Create Error]:', err);
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/meta-ads/custom-metrics/:id', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        const { id } = req.params;
        const { name, description, formula, format, is_shared } = req.body;

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (formula !== undefined) {
            try {
                evaluateCustomMetric(formula, {});
            } catch (fError) {
                return res.status(400).json({ error: `Fórmula inválida: ${fError.message}` });
            }
            updateData.formula = formula;
        }
        if (format !== undefined) {
            const validFormats = ['numeric', 'percentage', 'currency'];
            if (!validFormats.includes(format)) {
                return res.status(400).json({ error: 'Formato inválido. Use numeric, percentage ou currency' });
            }
            updateData.format = format;
        }
        if (is_shared !== undefined) updateData.is_shared = !!is_shared;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'Nenhum dado para atualizar fornecido' });
        }

        const { data, error } = await supabase.from('meta_custom_metrics')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', authUser.id)
            .select();

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Métrica não encontrada ou você não tem permissão para editá-la' });
        }

        res.json({ ok: true, metric: data[0] });
    } catch (err) {
        console.error('[Meta Ads Custom Metrics Update Error]:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/meta-ads/custom-metrics/:id', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        const { id } = req.params;

        const { data, error } = await supabase.from('meta_custom_metrics')
            .update({ is_archived: true })
            .eq('id', id)
            .eq('user_id', authUser.id)
            .select();

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Métrica não encontrada ou você não tem permissão para deletá-la' });
        }

        res.json({ ok: true, message: 'Métrica removida com sucesso' });
    } catch (err) {
        console.error('[Meta Ads Custom Metrics Delete Error]:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/meta-ads/custom-metrics/:id/validate', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        const { id } = req.params;
        const { row_data } = req.body;

        const { data, error } = await supabase.from('meta_custom_metrics')
            .select('*')
            .eq('id', id)
            .eq('is_archived', false)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Métrica não encontrada ou arquivada' });
        }

        if (data.user_id !== authUser.id && !data.is_shared) {
            return res.status(403).json({ error: 'Você não tem permissão para acessar esta métrica' });
        }

        try {
            const rawValue = evaluateCustomMetric(data.formula, row_data || {});
            res.json({
                valid: true,
                value: rawValue,
                formatted: formatValue(rawValue, data.format)
            });
        } catch (evalErr) {
            res.status(400).json({ valid: false, error: evalErr.message });
        }
    } catch (err) {
        console.error('[Meta Ads Custom Metrics Validate Error]:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==============================================================================

// ==============================================================================
// MUTAÇÕES DO META ADS (Fase 3A)
// ==============================================================================

app.post('/api/meta-ads/campaigns/toggle-status', async (req, res) => {
    const { campaign_id, action } = req.body;
    try {
        const authUser = await getAuthUser(req);
        const user_id = authUser.id;
        const { accessToken, adAccountId } = await getValidMetaToken(user_id);
        
        let campaignName = 'Unknown';
        let oldStatus = null;
        try {
            const getCampaignUrl = `https://graph.facebook.com/v25.0/${campaign_id}?fields=name,status`;
            const campaignDetails = await executeMetaMutation(getCampaignUrl, 'GET', accessToken);
            campaignName = campaignDetails.name || 'Unknown';
            oldStatus = campaignDetails.status || null;
        } catch (e) {
            console.warn('[Meta Ads Audit Log] Falhou ao buscar dados da campanha:', e.message);
        }

        const url = `https://graph.facebook.com/v25.0/${campaign_id}`;
        const newStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE';
        const body = { status: newStatus };
        
        await executeMetaMutation(url, 'POST', accessToken, body);
        
        // Audit log
        await supabaseAdmin.from('meta_ads_audit_logs').insert({
            user_id: authUser.id,
            ad_account_id: adAccountId,
            campaign_id: campaign_id,
            campaign_name: campaignName,
            action: action === 'pause' ? 'pause' : 'activate',
            old_value: oldStatus,
            new_value: newStatus
        });
        
        res.json({ ok: true, message: `Campanha ${action === 'pause' ? 'pausada' : 'ativada'} com sucesso` });
    } catch (err) {
        console.error('[Meta Ads Toggle Campaign Error]:', err);
        res.status(err.message === 'Meta Ads não conectado' ? 400 : 500).json({ error: err.message });
    }
});

app.post('/api/meta-ads/campaigns/update-budget', async (req, res) => {
    const { adset_id, new_amount } = req.body;
    try {
        const authUser = await getAuthUser(req);
        const user_id = authUser.id;
        const { accessToken, adAccountId } = await getValidMetaToken(user_id);

        let campaignName = 'Unknown';
        let oldBudget = null;
        try {
            const getAdsetUrl = `https://graph.facebook.com/v25.0/${adset_id}?fields=name,daily_budget,lifetime_budget`;
            const adsetDetails = await executeMetaMutation(getAdsetUrl, 'GET', accessToken);
            campaignName = adsetDetails.name || 'Unknown';
            const rawOldBudget = adsetDetails.daily_budget || adsetDetails.lifetime_budget;
            oldBudget = rawOldBudget ? (rawOldBudget / 100).toString() : null;
        } catch (e) {
            console.warn('[Meta Ads Audit Log] Falhou ao buscar dados do adset:', e.message);
        }

        const url = `https://graph.facebook.com/v25.0/${adset_id}`;
        const body = { daily_budget: Math.round(new_amount * 100) };
        await executeMetaMutation(url, 'POST', accessToken, body);
        
        // Audit log
        await supabaseAdmin.from('meta_ads_audit_logs').insert({
            user_id: authUser.id,
            ad_account_id: adAccountId,
            campaign_id: adset_id,
            campaign_name: campaignName,
            action: 'update_budget',
            old_value: oldBudget ? String(oldBudget) : null,
            new_value: new_amount ? String(new_amount) : null
        });
        
        res.json({ ok: true, message: 'Orçamento atualizado com sucesso' });
    } catch (err) {
        console.error('[Meta Ads Update Budget Error]:', err);
        res.status(err.message === 'Meta Ads não conectado' ? 400 : 500).json({ error: err.message });
    }
});

// --- META ADS WEBHOOK AUXILIARY ROUTES ---

// 3.1) GET /api/meta-ads/webhook (Verificação inicial de desafio da Meta)
app.get('/api/meta-ads/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && token && expectedToken && token === expectedToken) {
        console.log('[Meta Webhook Verification] Token verificado com sucesso.');
        return res.status(200).send(challenge);
    } else {
        console.warn('[Meta Webhook Verification] Token ou modo inválido.');
        return res.sendStatus(403);
    }
});

// 3.3) POST /api/meta-ads/webhook/subscribe (Configurar inscrição - protegida por getAuthUser)
app.post('/api/meta-ads/webhook/subscribe', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        const { ad_account_id } = req.body || {};
        const client = supabaseAdmin || supabase;

        const { data: integration, error } = await client
            .from('meta_ads_integrations')
            .select('access_token, ad_account_id')
            .eq('user_id', authUser.id)
            .maybeSingle();

        if (error || !integration || !integration.access_token) {
            return res.status(400).json({ error: 'Conexão Meta Ads não encontrada para este usuário.' });
        }

        const targetAccountId = ad_account_id || integration.ad_account_id;
        if (!targetAccountId) {
            return res.status(400).json({ error: 'ID da conta de anúncio (ad_account_id) é obrigatório.' });
        }

        const cleanAccountId = String(targetAccountId).replace(/^act_/, '');
        const accountPath = `act_${cleanAccountId}`;
        const apiVersion = process.env.META_API_VERSION || 'v25.0';
        const url = `https://graph.facebook.com/${apiVersion}/${accountPath}/subscribed_apps`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${integration.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                subscribed_fields: 'effective_status,with_issues_ad_objects,leadgen'
            })
        });

        const resData = await response.json();
        if (!response.ok) {
            console.error('[Meta Webhook Subscribe Error]:', resData);
            return res.status(response.status).json({ 
                error: resData.error?.message || 'Falha ao subscrever na Meta Graph API',
                details: resData 
            });
        }

        return res.json({ ok: true, subscribed: true, meta_response: resData });
    } catch (err) {
        console.error('[Meta Webhook Subscribe Exception]:', err);
        return res.status(err.status || 500).json({ error: err.message || 'Erro ao configurar inscrição de Webhook' });
    }
});

// 3.4) GET /api/meta-ads/leads (Listar leads capturados de formulários nativos do Meta Ads)
app.get('/api/meta-ads/leads', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const client = supabaseAdmin || supabase;
        
        // Tenta buscar os leads com join na tabela leads
        const { data: leads, error } = await client
            .from('meta_lead_forms')
            .select(`
                *,
                lead:leads(id, name, phone, email, status, temperature)
            `)
            .eq('user_id', authUser.id)
            .order('created_time', { ascending: false })
            .limit(100);

        if (error) {
            console.warn('[Meta Leads API] Aviso ao buscar meta_lead_forms com relação:', error.message);
            // Se tabela ainda não foi criada no Supabase ou relação não existe, fallback gracioso
            if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('does not exist')) {
                // Tenta buscar sem a relação
                const { data: simpleLeads, error: simpleErr } = await client
                    .from('meta_lead_forms')
                    .select('*')
                    .eq('user_id', authUser.id)
                    .order('created_time', { ascending: false })
                    .limit(100);

                if (simpleErr) {
                    return res.json({ leads: [] });
                }
                return res.json({ leads: simpleLeads || [] });
            }
            return res.json({ leads: [] });
        }

        return res.json({ leads: leads || [] });
    } catch (err) {
        console.error('[Meta Leads Exception]:', err);
        return res.status(500).json({ error: err.message || 'Erro ao buscar leads do Meta Ads' });
    }
});

// 3.4) GET /api/meta-ads/webhook/status (Debug/Status - protegida)
app.get('/api/meta-ads/webhook/status', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        const client = supabaseAdmin || supabase;

        const { data: events, error } = await client
            .from('meta_webhook_events')
            .select('status, received_at')
            .order('received_at', { ascending: false });

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        const total_events = events ? events.length : 0;
        const pending = events ? events.filter(e => e.status === 'pending' || e.status === 'processing').length : 0;
        const processed = events ? events.filter(e => e.status === 'processed').length : 0;
        const failed = events ? events.filter(e => e.status === 'failed' || e.status === 'dead_letter').length : 0;
        const last_event_at = events && events.length > 0 ? events[0].received_at : null;

        return res.json({
            ok: true,
            total_events,
            pending,
            processed,
            failed,
            last_event_at
        });
    } catch (err) {
        return res.status(err.status || 500).json({ error: err.message || 'Erro interno' });
    }
});

// 3. BUSCAR DADOS (Usando Token do Banco)
// ==============================================================================

// Mapa para evitar múltiplas renovações de token simulâneas do mesmo usuário
const googleAdsRefreshLocks = new Map();

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
        const lockKey = user_id;

        if (googleAdsRefreshLocks.has(lockKey)) {
            // Aguarda o refresh que já está em andamento
            await googleAdsRefreshLocks.get(lockKey);
            // Busca o token fresco do banco recém salvo pela outra promise
            const { data: freshIntegration } = await supabase
                .from('google_ads_integrations')
                .select('access_token')
                .eq('user_id', user_id)
                .single();
            if (freshIntegration && freshIntegration.access_token) {
                accessToken = freshIntegration.access_token;
            }
        } else {
            const refreshPromise = (async () => {
                console.log(`Token vencido. Renovando uma única vez para user: ${user_id}...`);
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
                    throw new Error(`Falha ao renovar token. Reconecte a conta. Detalhe: ${refreshData.error_description || refreshData.error}`);
                }

                const newAccessToken = refreshData.access_token;
                const newExpiry = Date.now() + (refreshData.expires_in * 1000);

                await supabase.from('google_ads_integrations').update({
                    access_token: newAccessToken,
                    token_expires_at: newExpiry,
                    status: 'active'
                }).eq('user_id', user_id);
                
                return newAccessToken;
            })();

            googleAdsRefreshLocks.set(lockKey, refreshPromise);
            try {
                accessToken = await refreshPromise;
            } finally {
                googleAdsRefreshLocks.delete(lockKey);
            }
        }
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

    const adsResp = await fetch(`https://googleads.googleapis.com/v24/customers/${cleanId}/googleAds:search`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ query })
    });

    const adsData = await adsResp.json();
    
    if (adsData.error) {
        // Tratamento específico para erro de cota
        if (adsData.error.code === 429 || 
            (adsData.error.message && adsData.error.message.includes('RESOURCE_EXHAUSTED'))) {
            console.warn('[Google Ads] Cota excedida, retornando vazio. Aguarde 15min.');
            return [];
        }
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
            const mccResp = await fetch(`https://googleads.googleapis.com/v24/customers/${cleanId}/googleAds:search`, {
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

async function executeGoogleAdsMutation(user_id, customerId, operations, typeName) {
    const { cleanId, headers, managerId } = await getValidAccessToken(user_id, customerId);
    
    const mutateUrl = `https://googleads.googleapis.com/v24/customers/${cleanId}/googleAds:mutate`;
    console.log(`[Google Ads Mutation] Executando mutação para tipo: ${typeName}. CustomerId original: ${customerId}, Resolved cleanId: ${cleanId}, URL: ${mutateUrl}`);
    const body = JSON.stringify({
        mutate_operations: operations
    });
    
    const requestHeaders = { ...headers, 'Content-Type': 'application/json' };
    if (managerId) {
        requestHeaders['login-customer-id'] = managerId.replace(/-/g, '');
    }
    
    const resp = await fetch(mutateUrl, {
        method: 'POST',
        headers: requestHeaders,
        body
    });
    
    const data = await resp.json();
    if (data.error) {
        console.error('[Google Ads Mutation] Error Completo:', JSON.stringify(data.error, null, 2));
        let errorMsg = data.error.message || 'Erro na mutação Google Ads';
        if (data.error.details && Array.isArray(data.error.details)) {
            const detailsStr = JSON.stringify(data.error.details);
            errorMsg += ` - Detalhes: ${detailsStr}`;
        }
        throw new Error(errorMsg);
    }
    return data;
}

// Rota: Campanhas (Mantida e refatorada)
app.post('/api/google-ads/campaigns', async (req, res) => {
    try {
        let { user_id, date_range, compare_start, compare_end, customer_id } = req.body;

        if (!date_range || !date_range.start || !date_range.end) {
            const end = new Date().toISOString().split('T')[0];
            const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            date_range = { start, end };
        }

        let sanitizedStart = String(date_range.start || '').replace(/[^0-9-]/g, '');
        let sanitizedEnd = String(date_range.end || '').replace(/[^0-9-]/g, '');

        if (!sanitizedStart) {
          sanitizedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        if (!sanitizedEnd) {
          sanitizedEnd = new Date().toISOString().split('T')[0];
        }

        let sanitizedCompareStart = '';
        let sanitizedCompareEnd = '';
        if (compare_start && compare_end) {
            sanitizedCompareStart = String(compare_start).replace(/[^0-9-]/g, '');
            sanitizedCompareEnd = String(compare_end).replace(/[^0-9-]/g, '');
        }

        const buildQuery = (start, end) => `
            SELECT 
                campaign.id, 
                campaign.name, 
                campaign.status, 
                campaign.advertising_channel_type,
                campaign_budget.id,
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

        const currentQuery = buildQuery(sanitizedStart, sanitizedEnd);
        
        const promises = [executeGoogleAdsQuery(user_id, currentQuery, true, customer_id)];
        
        if (compare_start && compare_end) {
            const compareQuery = buildQuery(sanitizedCompareStart, sanitizedCompareEnd);
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

function getFriendlyAdsErrorMessage(error) {
    if (!error) return 'Erro desconhecido na API do Google Ads.';
    
    const message = error.message || '';
    const details = error.stack || '';
    
    const errorStr = (message + ' ' + details + ' ' + JSON.stringify(error)).toUpperCase();
    
    if (errorStr.includes('BAD_RESOURCE_ID') || errorStr.includes('RESOURCE_NAME_IS_INVALID')) {
        return 'Identificador inválido: Um ID de campanha ou orçamento fornecido não pôde ser encontrado no Google Ads.';
    }
    if (errorStr.includes('NOT_FOUND') || errorStr.includes('REQUESTED ENTITY WAS NOT FOUND')) {
        return 'Não Encontrado (404): A campanha, orçamento ou conta do Google Ads não foi encontrada.';
    }
    if (errorStr.includes('CUSTOMER_NOT_ENABLED') || errorStr.includes('ACCOUNT_NOT_ENABLED')) {
        return 'Conta Inativa: A conta do Google Ads está desativada, suspensa ou ainda em processo de configuração.';
    }
    if (errorStr.includes('USER_PERMISSION_DENIED') || errorStr.includes('NOT_MUTABLE') || errorStr.includes('AUTHORIZATION_ERROR')) {
        return 'Permissão Negada: O usuário autenticado não possui permissão para modificar recursos nesta conta do Google Ads (verifique o nível de acesso).';
    }
    if (errorStr.includes('MUTATE_NOT_ALLOWED')) {
        return 'Mutação Não Permitida: Esta campanha ou recurso não pode ser modificado através da API no momento.';
    }
    if (errorStr.includes('DEVELOPER_TOKEN_PROHIBITED') || errorStr.includes('DEVELOPER_TOKEN_NOT_APPROVED')) {
        return 'Token de Desenvolvedor: O token de desenvolvedor do Google Ads não tem permissão para acessar esta conta ou ainda está em análise.';
    }
    if (errorStr.includes('BUDGET_CANNOT_BE_SHARED') || errorStr.includes('CANNOT_MODIFY_SHARED_BUDGET')) {
        return 'Orçamento Compartilhado: O orçamento selecionado é compartilhado com outras campanhas e não pode ser editado individualmente por esta via.';
    }
    if (errorStr.includes('TEMPORARILY_UNAVAILABLE') || errorStr.includes('INTERNAL_ERROR')) {
        return 'Serviço Indisponível: O Google Ads está temporariamente instável. Por favor, tente novamente em instantes.';
    }
    if (errorStr.includes('RESOURCE_EXHAUSTED')) {
        return 'Limite de Cota Atingido: Muitas requisições foram feitas ao Google Ads recentemente. Aguarde alguns minutos e tente novamente.';
    }
    if (errorStr.includes('AUTHENTICATION_ERROR') || errorStr.includes('INVALID_GRANT') || errorStr.includes('TOKEN')) {
        return 'Erro de Autenticação: A conexão com a sua conta do Google Ads expirou. Por favor, desconecte e reconecte sua conta nas configurações.';
    }
    
    return message || 'Ocorreu um erro ao processar a solicitação no Google Ads.';
}

app.post('/api/google-ads/campaigns/toggle-status', async (req, res) => {
    const { user_id, customer_id, campaign_id, action } = req.body;
    if (!user_id || !campaign_id || !action) {
        return res.status(400).json({ error: 'Missing params' });
    }

    try {
        // Resolve the real and clean customer_id using getValidAccessToken
        const { cleanId } = await getValidAccessToken(user_id, customer_id);

        // Fetch current status to log using customer_id
        const query = `SELECT campaign.name, campaign.status FROM campaign WHERE campaign.id = ${Number(campaign_id)}`;
        const queryResults = await executeGoogleAdsQuery(user_id, query, false, customer_id);
        const currentCampaign = queryResults[0]?.campaign;
        
        if (!currentCampaign) {
             throw new Error('Campanha não encontrada para auditar o status.');
        }

        const oldStatus = currentCampaign.status;
        const newStatus = action === 'pause' ? 'PAUSED' : 'ENABLED';
        const campaignName = currentCampaign.name;

        const operations = [{
            campaign_operation: {
                update: {
                    resource_name: `customers/${cleanId}/campaigns/${campaign_id}`,
                    status: newStatus
                },
                update_mask: 'status'
            }
        }];
        
        await executeGoogleAdsMutation(user_id, customer_id, operations, 'campaign');

        // Log audit
        try {
            await supabase
                .from('google_ads_audit_logs')
                .insert([{
                    user_id,
                    customer_id: cleanId,
                    campaign_id,
                    campaign_name: campaignName,
                    action: action,
                    old_value: oldStatus,
                    new_value: newStatus
                }]);
        } catch (auditError) {
            console.warn('[Google Ads Audit Log] Erro tolerado ao inserir log de auditoria para toggle status:', auditError.message);
        }

        res.json({ ok: true, message: `Campanha ${action === 'pause' ? 'pausada' : 'ativada'} com sucesso` });
    } catch (error) {
        console.error("Ads Toggle Status Error:", error);
        const friendlyMessage = getFriendlyAdsErrorMessage(error);
        res.status(500).json({ error: friendlyMessage });
    }
});

app.post('/api/google-ads/campaigns/update-budget', async (req, res) => {
    const { user_id, customer_id, budget_id, new_amount } = req.body;
    if (!user_id || !budget_id || new_amount === undefined) {
        return res.status(400).json({ error: 'Missing params' });
    }

    try {
        // Resolve the real and clean customer_id using getValidAccessToken
        const { cleanId } = await getValidAccessToken(user_id, customer_id);

        // Fetch current budget to log using customer_id
        const query = `
            SELECT campaign.id, campaign.name, campaign_budget.amount_micros 
            FROM campaign 
            WHERE campaign_budget.id = ${Number(budget_id)}
            LIMIT 1
        `;
        const queryResults = await executeGoogleAdsQuery(user_id, query, false, customer_id);
        const currentCampaign = queryResults[0]?.campaign;
        const currentBudget = queryResults[0]?.campaign_budget;

        const oldAmount = currentBudget?.amount_micros ? (parseInt(currentBudget.amount_micros) / 1000000).toString() : null;
        
        const operations = [{
            campaign_budget_operation: {
                update: {
                    resource_name: `customers/${cleanId}/campaignBudgets/${budget_id}`,
                    amount_micros: Math.round(new_amount * 1000000)
                },
                update_mask: 'amount_micros'
            }
        }];
        
        await executeGoogleAdsMutation(user_id, customer_id, operations, 'campaign_budget');

        // Log audit
        try {
            await supabase
                .from('google_ads_audit_logs')
                .insert([{
                    user_id,
                    customer_id: cleanId,
                    campaign_id: currentCampaign?.id || null,
                    campaign_name: currentCampaign?.name || 'Unknown',
                    action: 'update_budget',
                    old_value: oldAmount,
                    new_value: new_amount.toString()
                }]);
        } catch (auditError) {
            console.warn('[Google Ads Audit Log] Erro tolerado ao inserir log de auditoria para update budget:', auditError.message);
        }

        res.json({ ok: true, message: 'Orçamento atualizado com sucesso', new_amount: new_amount });
    } catch (error) {
        console.error("Ads Update Budget Error:", error);
        const friendlyMessage = getFriendlyAdsErrorMessage(error);
        res.status(500).json({ error: friendlyMessage });
    }
});

// Rota: Overview (Gráfico)
app.post('/api/google-ads/overview', async (req, res) => {
    const { user_id, date_range, campaign_id, compare_start, compare_end, customer_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing params' });

    try {
        let sanitizedStart = String(date_range?.start || '').replace(/[^0-9-]/g, '');
        let sanitizedEnd = String(date_range?.end || '').replace(/[^0-9-]/g, '');

        if (!sanitizedStart) {
          sanitizedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        if (!sanitizedEnd) {
          sanitizedEnd = new Date().toISOString().split('T')[0];
        }

        let sanitizedCompareStart = '';
        let sanitizedCompareEnd = '';
        if (compare_start && compare_end) {
            sanitizedCompareStart = String(compare_start).replace(/[^0-9-]/g, '');
            sanitizedCompareEnd = String(compare_end).replace(/[^0-9-]/g, '');
        }

        const campaignFilter = campaign_id ? `AND campaign.id = ${Number(campaign_id)}` : '';
        
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

        const currentQuery = buildQuery(sanitizedStart, sanitizedEnd);
        const promises = [executeGoogleAdsQuery(user_id, currentQuery, false, customer_id)];

        if (compare_start && compare_end) {
            const compareQuery = buildQuery(sanitizedCompareStart, sanitizedCompareEnd);
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
    if (!user_id) return res.status(400).json({ error: 'Missing params' });

    try {
        let sanitizedStart = String(date_range?.start || '').replace(/[^0-9-]/g, '');
        let sanitizedEnd = String(date_range?.end || '').replace(/[^0-9-]/g, '');

        if (!sanitizedStart) {
          sanitizedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        if (!sanitizedEnd) {
          sanitizedEnd = new Date().toISOString().split('T')[0];
        }

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
            WHERE segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
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
    if (!user_id) return res.status(400).json({ error: 'Missing params' });

    try {
        let sanitizedStart = String(date_range?.start || '').replace(/[^0-9-]/g, '');
        let sanitizedEnd = String(date_range?.end || '').replace(/[^0-9-]/g, '');

        if (!sanitizedStart) {
          sanitizedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        if (!sanitizedEnd) {
          sanitizedEnd = new Date().toISOString().split('T')[0];
        }

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
            WHERE segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
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
    if (!user_id) return res.status(400).json({ error: 'Missing params' });

    try {
        let sanitizedStart = String(date_range?.start || '').replace(/[^0-9-]/g, '');
        let sanitizedEnd = String(date_range?.end || '').replace(/[^0-9-]/g, '');

        if (!sanitizedStart) {
          sanitizedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        if (!sanitizedEnd) {
          sanitizedEnd = new Date().toISOString().split('T')[0];
        }

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
            WHERE segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
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
    if (!campaign_id || campaign_id === 'undefined' || campaign_id === 'null') {
        return res.json({ results: [] });
    }
    if (!user_id) return res.status(400).json({ error: 'Missing params' });

    try {
        let sanitizedStart = String(date_range?.start || '').replace(/[^0-9-]/g, '');
        let sanitizedEnd = String(date_range?.end || '').replace(/[^0-9-]/g, '');

        if (!sanitizedStart) {
          sanitizedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        if (!sanitizedEnd) {
          sanitizedEnd = new Date().toISOString().split('T')[0];
        }

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
            WHERE campaign.id = ${Number(campaign_id)}
            AND segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
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
    if (!campaign_id || campaign_id === 'undefined' || campaign_id === 'null') {
        return res.json({ results: [] });
    }
    if (!user_id) return res.status(400).json({ error: 'Missing params' });

    try {
        const sanitizedCustomerId = customer_id ? String(customer_id).replace(/[^0-9-]/g, '') : '';
        const campaignResourceName = `customers/${sanitizedCustomerId}/campaigns/${Number(campaign_id)}`;
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
    if (!user_id) return res.status(400).json({ error: 'Missing params' });

    try {
        let sanitizedStart = String(date_range?.start || '').replace(/[^0-9-]/g, '');
        let sanitizedEnd = String(date_range?.end || '').replace(/[^0-9-]/g, '');

        if (!sanitizedStart) {
          sanitizedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        if (!sanitizedEnd) {
          sanitizedEnd = new Date().toISOString().split('T')[0];
        }

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
            WHERE segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
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
    if (!user_id) return res.status(400).json({ error: 'Missing params' });

    try {
        let sanitizedStart = String(date_range?.start || '').replace(/[^0-9-]/g, '');
        let sanitizedEnd = String(date_range?.end || '').replace(/[^0-9-]/g, '');

        if (!sanitizedStart) {
          sanitizedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        if (!sanitizedEnd) {
          sanitizedEnd = new Date().toISOString().split('T')[0];
        }

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
            WHERE segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
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
        if (error.message?.includes('Integração não encontrada') || error.message?.includes('Seleção de conta pendente')) {
            return res.status(200).json({ results: [] });
        }
        console.error("MCC Overview Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==============================================================================
// 4. SISTEMA DE ALERTAS
// ==============================================================================
app.post('/api/google-ads/check-alerts', async (req, res) => {
    const { user_id, date_range } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

    try {
        let sanitizedStart = String(date_range?.start || '').replace(/[^0-9-]/g, '');
        let sanitizedEnd = String(date_range?.end || '').replace(/[^0-9-]/g, '');

        if (!sanitizedStart) {
          sanitizedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        if (!sanitizedEnd) {
          sanitizedEnd = new Date().toISOString().split('T')[0];
        }
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
                change_event.change_date_time, 
                change_event.changed_fields,
                change_event.resource_change_operation,
                change_event.new_resource,
                change_event.campaign
            FROM change_event 
            WHERE change_event.change_resource_type = 'CAMPAIGN' 
            AND change_event.resource_change_operation = 'UPDATE' 
            AND change_event.change_date_time DURING TODAY
            LIMIT 50
        `;

        try {
            const pausedResults = await executeGoogleAdsQuery(user_id, pausedQuery);
            
            pausedResults.forEach(row => {
                // Verifica se o novo status é PAUSED e se o campo status foi alterado
                const changedFields = row.changeEvent?.changedFields?.paths || [];
                if (changedFields.includes('status') && row.changeEvent?.newResource?.campaign?.status === 'PAUSED') {
                    const name = row.changeEvent.newResource.campaign.name || 'Campanha';
                    alerts.push({
                        id: `paused-${row.changeEvent.changeDateTime}`,
                        type: 'status_change',
                        severity: 'high',
                        message: `A campanha "${name}" foi pausada hoje.`
                    });
                }
            });
        } catch (e) {
            console.error(`[Google Ads Alerts] Falha ao consultar change_event: ${e.message || String(e)}`);
            // Retorna JSON controlado sem falhar toda a rota para o front
            return res.json({
                ok: false,
                alerts: alerts,
                error: "Não foi possível verificar alertas do Google Ads no momento."
            });
        }

        res.json({ ok: true, alerts });

    } catch (error) {
        if (error.message?.includes('Integração não encontrada') || error.message?.includes('Seleção de conta pendente')) {
            return res.status(200).json({ ok: true, alerts: [] });
        }
        console.error("Alert Check Error:", error);
        res.json({ ok: false, alerts: [], error: "Não foi possível verificar alertas do Google Ads no momento." });
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
        let sanitizedStart = String(date_range?.start || '').replace(/[^0-9-]/g, '');
        let sanitizedEnd = String(date_range?.end || '').replace(/[^0-9-]/g, '');

        if (!sanitizedStart) {
          sanitizedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        }
        if (!sanitizedEnd) {
          sanitizedEnd = new Date().toISOString().split('T')[0];
        }
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

// Context Builder Real (Buscando dados no Supabase via supabaseAdmin)
async function buildClinicContext(userId) {
  const context = {
    usuario: {
      nome: "Não identificado",
      email: "Não informado"
    },
    leads: {
      total: 0,
      quentes: 0,
      mornos: 0,
      frios: 0,
      semResposta: 0,
      recentes: []
    },
    financeiro: {
      receitaBruta: "R$ 0,00",
      gastosTotais: "R$ 0,00",
      lucroLiquido: "R$ 0,00",
      pendencias: 0,
      detalhamento: {
        receitasEfetuadas: 0,
        despesasEfetuadas: 0,
        gastosMarketing: "R$ 0,00"
      }
    },
    marketing: {
      googleAdsStatus: "Não conectado",
      googleAdsAccountName: null,
      googleAdsAccountId: null,
      metaAdsStatus: "Não conectado",
      metaAdsAccountName: null,
      metaAdsAccountId: null
    }
  };

  try {
    const client = supabaseAdmin || supabase;
    
    // Se o userId não for passado, tenta pegar o primeiro perfil disponível no banco
    if (!userId) {
      const { data: allProfiles } = await client.from('profiles').select('id').limit(1);
      if (allProfiles && allProfiles.length > 0) {
        userId = allProfiles[0].id;
      }
    }

    if (userId) {
      // 1. Profile do usuário
      const { data: profile } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (profile) {
        context.usuario.nome = profile.name || profile.username || "Usuário do AXIS";
        context.usuario.email = profile.email || "Não informado";
      }

      // 2. Leads (total, quentes/mornos/frios, sem resposta)
      const { data: leads } = await client.from('leads').select('*').eq('user_id', userId);
      if (leads) {
        context.leads.total = leads.length;
        context.leads.quentes = leads.filter(l => l.temperature === 'Hot').length;
        context.leads.mornos = leads.filter(l => l.temperature === 'Warm').length;
        context.leads.frios = leads.filter(l => l.temperature === 'Cold').length;
        
        // Leads sem resposta: last_sender === 'contact'
        context.leads.semResposta = leads.filter(l => l.last_sender === 'contact').length;
        
        // 5 leads mais recentes
        context.leads.recentes = leads
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
          .slice(0, 5)
          .map(l => ({
            nome: l.name,
            status: l.status,
            temperatura: l.temperature,
            origem: l.source || "Manual",
            ultimaInteracao: l.created_at
          }));
      }

      // 3. Transações financeiras (receita/despesa, incluindo os gastos de marketing)
      const { data: transactions } = await client.from('transactions').select('*').eq('user_id', userId);
      if (transactions) {
        const receitas = transactions.filter(t => t.type === 'receivable' && t.status === 'efetuada');
        const despesas = transactions.filter(t => t.type === 'payable' && t.status === 'efetuada');
        const marketing = transactions.filter(t => t.type === 'payable' && t.category === 'Marketing');
        const pendentes = transactions.filter(t => t.status !== 'efetuada' && t.status !== 'cancelada');

        const totalReceitas = receitas.reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const totalDespesas = despesas.reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const totalMarketing = marketing.reduce((sum, t) => sum + (Number(t.total) || 0), 0);
        const lucro = totalReceitas - totalDespesas;

        context.financeiro.receitaBruta = totalReceitas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        context.financeiro.gastosTotais = totalDespesas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        context.financeiro.lucroLiquido = lucro.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        context.financeiro.pendencias = pendentes.length;
        
        context.financeiro.detalhamento.receitasEfetuadas = receitas.length;
        context.financeiro.detalhamento.despesasEfetuadas = despesas.length;
        context.financeiro.detalhamento.gastosMarketing = totalMarketing.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      }

      // 4. Contas de Ads conectadas (Google/Meta)
      const { data: googleAds } = await client.from('google_ads_integrations').select('*').eq('user_id', userId).maybeSingle();
      if (googleAds) {
        context.marketing.googleAdsStatus = googleAds.status || "Conectado";
        context.marketing.googleAdsAccountName = googleAds.customer_name || null;
        context.marketing.googleAdsAccountId = googleAds.customer_id || null;
      }

      const { data: metaAds } = await client.from('meta_ads_integrations').select('*').eq('user_id', userId).maybeSingle();
      if (metaAds) {
        context.marketing.metaAdsStatus = metaAds.status || "Conectado";
        context.marketing.metaAdsAccountName = metaAds.ad_account_name || null;
        context.marketing.metaAdsAccountId = metaAds.ad_account_id || null;
      }
    }
  } catch (error) {
    console.error('[AXIS AI] Erro ao construir contexto:', error);
  }

  return context;
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

        // Tenta obter o usuário autenticado ou busca o primeiro do banco como fallback
        let userId = null;
        try {
            const authUser = await getAuthUser(req);
            userId = authUser ? authUser.id : null;
        } catch (authErr) {
            try {
                const client = supabaseAdmin || supabase;
                const { data: profiles } = await client.from('profiles').select('id').limit(1);
                if (profiles && profiles.length > 0) {
                    userId = profiles[0].id;
                }
            } catch (dbErr) {
                console.error('[AXIS AI] Fallback profile fetch failed:', dbErr);
            }
        }

        // 1. Buscar dados reais (Context Augmentation)
        const dbData = await buildClinicContext(userId);

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

        // Resposta normal
        res.json({
            response: response.text,
            mcpUsed: false,
            dataQueried: Object.keys(dbData),
            actions: []
        });

    } catch (error) {
        console.error('AXIS AI Error:', error);
        res.status(500).json({ response: "Desculpe, perdi a conexão com a base de dados. Tente novamente." });
    }
});

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
    let authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader && req.query && req.query.token) {
        authHeader = `Bearer ${req.query.token}`;
    }
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
            events: ["history", "connection", "messages", "messages_update", "contacts", "chats"],
            excludeMessages: ["wasSentByApi"],
            exclude: ["wasSentByApi"],
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
                webhookEvents: ["history", "connection", "messages", "messages_update", "contacts", "chats"]
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

// GET /api/crm/attachments/:attachmentId/download — Download seguro pela AXIS
app.get('/api/crm/attachments/:attachmentId/download', async (req, res) => {
    const { attachmentId } = req.params;
    console.log(`[CRM Attachment] Download solicitado: attachmentId ${attachmentId}`);
    try {
        const user = await getAuthUser(req);
        const client = supabaseAdmin || supabase;

        const { data: attachment, error: fetchErr } = await client
            .from('crm_message_attachments')
            .select('*')
            .eq('id', attachmentId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (fetchErr || !attachment) {
            console.log(`[CRM Attachment] Attachment não encontrado para id ${attachmentId}`);
            return res.status(404).json({ ok: false, error: "Anexo não encontrado." });
        }

        const sourceUrl = attachment.source_url;
        if (!sourceUrl) {
            console.log(`[CRM Attachment] Source indisponível para attachmentId ${attachmentId}`);
            return res.status(404).json({ ok: false, error: "Arquivo ainda não disponível." });
        }

        const cleanLogUrl = String(sourceUrl).split('?')[0];
        console.log(`[CRM Attachment] Realizando fetch server-side de ${cleanLogUrl}`);

        const response = await fetch(sourceUrl);
        if (!response.ok) {
            console.log(`[CRM Attachment] Erro na requisição ao arquivo remoto. Status: ${response.status}`);
            return res.status(response.status).json({ ok: false, error: "Erro ao baixar o arquivo de mídia." });
        }

        const filename = attachment.filename || "arquivo";
        const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');

        res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
        res.setHeader('Cache-Control', 'private, max-age=3600');

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        console.log(`[CRM Attachment] Arquivo servido com filename ${filename} (${buffer.length} bytes)`);
        return res.send(buffer);
    } catch (err) {
        console.error(`[CRM Attachment] Erro na rota /download:`, err.message || err);
        return res.status(err.status || 500).json({ ok: false, error: err.message || 'Erro interno do servidor' });
    }
});

// GET /api/crm/attachments/:attachmentId/view — Visualização inline segura pela AXIS
app.get('/api/crm/attachments/:attachmentId/view', async (req, res) => {
    const { attachmentId } = req.params;
    console.log(`[CRM Attachment] Visualização (view) solicitada: attachmentId ${attachmentId}`);
    try {
        const user = await getAuthUser(req);
        const client = supabaseAdmin || supabase;

        const { data: attachment, error: fetchErr } = await client
            .from('crm_message_attachments')
            .select('*')
            .eq('id', attachmentId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (fetchErr || !attachment) {
            console.log(`[CRM Attachment] Attachment não encontrado para id ${attachmentId}`);
            return res.status(404).json({ ok: false, error: "Anexo não encontrado." });
        }

        const sourceUrl = attachment.source_url;
        if (!sourceUrl) {
            console.log(`[CRM Attachment] Source indisponível para attachmentId ${attachmentId}`);
            return res.status(404).json({ ok: false, error: "Arquivo ainda não disponível." });
        }

        const cleanLogUrl = String(sourceUrl).split('?')[0];
        console.log(`[CRM Attachment] Realizando fetch server-side de ${cleanLogUrl}`);

        const response = await fetch(sourceUrl);
        if (!response.ok) {
            console.log(`[CRM Attachment] Erro na requisição ao arquivo remoto. Status: ${response.status}`);
            return res.status(response.status).json({ ok: false, error: "Erro ao obter o arquivo de mídia." });
        }

        const filename = attachment.filename || "arquivo";
        const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');

        res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedFilename}`);
        res.setHeader('Cache-Control', 'private, max-age=3600');

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        console.log(`[CRM Attachment] Arquivo servido para visualização com filename ${filename} (${buffer.length} bytes)`);
        return res.send(buffer);
    } catch (err) {
        console.error(`[CRM Attachment] Erro na rota /view:`, err.message || err);
        return res.status(err.status || 500).json({ ok: false, error: err.message || 'Erro interno do servidor' });
    }
});

// POST /api/crm/conversations/:conversationId/mark-read - Marcar conversa como lida no CRM
app.post('/api/crm/conversations/:conversationId/mark-read', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { conversationId } = req.params;

        const client = supabaseAdmin || supabase;

        // Atualizar crm_conversations
        const { data: updatedConv, error: updateErr } = await client
            .from('crm_conversations')
            .update({ unread_count: 0 })
            .eq('id', conversationId)
            .eq('user_id', user.id)
            .select()
            .maybeSingle();

        if (updateErr) throw updateErr;

        if (!updatedConv) {
             return res.status(404).json({ ok: false, error: "Conversa não encontrada." });
        }

        return res.status(200).json({ ok: true, conversation: updatedConv });

    } catch (err) {
        console.error("Erro ao marcar conversa como lida:", err);
        return res.status(500).json({ ok: false, error: "Erro interno ao marcar conversa como lida." });
    }
});

// POST /api/crm/conversations/:conversationId/clear-chat - Apagar o histórico de mensagens e anexos do lead
app.post('/api/crm/conversations/:conversationId/clear-chat', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { conversationId } = req.params;

        const client = supabaseAdmin || supabase;

        // 1. Verificar se a conversa pertence ao usuário logado
        const { data: conv, error: convFetchError } = await client
            .from('crm_conversations')
            .select('id, lead_id')
            .eq('id', conversationId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (convFetchError) throw convFetchError;
        if (!conv) {
            return res.status(404).json({ ok: false, error: "Conversa não encontrada ou não pertence a este usuário." });
        }

        // 2. Deletar os anexos vinculados a esta conversa
        const { error: deleteAttachmentsError } = await client
            .from('crm_message_attachments')
            .delete()
            .eq('conversation_id', conversationId);

        if (deleteAttachmentsError) throw deleteAttachmentsError;

        // 3. Deletar as mensagens desta conversa
        const { error: deleteMessagesError } = await client
            .from('crm_messages')
            .delete()
            .eq('conversation_id', conversationId);

        if (deleteMessagesError) throw deleteMessagesError;

        // 4. Limpar o status de última mensagem na tabela de conversas
        const { error: updateConvError } = await client
            .from('crm_conversations')
            .update({
                last_message_text: null,
                last_message_type: null,
                last_message_at: null
            })
            .eq('id', conversationId);

        if (updateConvError) throw updateConvError;

        // 5. Limpar last_message e last_interaction do lead vinculado
        if (conv.lead_id) {
            await client
                .from('leads')
                .update({
                    last_message: null,
                    last_interaction: null
                })
                .eq('id', conv.lead_id);
        }

        return res.status(200).json({ ok: true, message: "Histórico de mensagens apagado com sucesso." });

    } catch (err) {
        console.error("Erro ao apagar histórico de mensagens:", err);
        return res.status(500).json({ ok: false, error: "Erro interno ao apagar histórico de mensagens." });
    }
});

// POST /api/crm/leads/:leadId/delete - Deletar lead e dados relacionados
app.post('/api/crm/leads/:leadId/delete', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { leadId } = req.params;
        const client = supabaseAdmin || supabase;

        // 1. Verificar se o lead pertence ao usuário (usando supabaseAdmin que bypassa RLS)
        const { data: lead, error: leadErr } = await client
            .from('leads')
            .select('id, user_id')
            .eq('id', leadId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (leadErr) throw leadErr;
        if (!lead) {
            return res.status(404).json({ ok: false, error: "Lead não encontrado." });
        }

        // 2. Buscar conversas do lead
        const { data: conversations, error: convErr } = await client
            .from('crm_conversations')
            .select('id')
            .eq('lead_id', leadId);

        if (convErr) throw convErr;

        // 3. Deletar anexos e mensagens das conversas (se existirem)
        if (conversations && conversations.length > 0) {
            const convIds = conversations.map(c => c.id);
            
            // Deletar anexos primeiro
            const { error: attachErr } = await client
                .from('crm_message_attachments')
                .delete()
                .in('conversation_id', convIds);
            if (attachErr) console.warn('[Delete Lead] Erro ao deletar anexos:', attachErr.message);

            // Deletar mensagens
            const { error: msgErr } = await client
                .from('crm_messages')
                .delete()
                .in('conversation_id', convIds);
            if (msgErr) console.warn('[Delete Lead] Erro ao deletar mensagens:', msgErr.message);

            // Deletar conversas
            const { error: convDelErr } = await client
                .from('crm_conversations')
                .delete()
                .in('id', convIds);
            if (convDelErr) console.warn('[Delete Lead] Erro ao deletar conversas:', convDelErr.message);
        }

        // 4. Deletar o lead
        const { error: deleteLeadErr } = await client
            .from('leads')
            .delete()
            .eq('id', leadId);

        if (deleteLeadErr) throw deleteLeadErr;

        return res.json({ ok: true, message: "Lead e dados relacionados apagados com sucesso." });
    } catch (err) {
        console.error("Erro ao deletar lead:", err);
        return res.status(500).json({ ok: false, error: err.message || "Erro interno ao deletar lead." });
    }
});

// POST /api/crm/leads - Criar lead com normalização
app.post('/api/crm/leads', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const client = supabaseAdmin || supabase;
        const leadData = req.body;

        if (!leadData.name) {
            return res.status(400).json({ ok: false, error: "Nome do lead é obrigatório." });
        }

        if (leadData.phone) {
            leadData.phone = normalizePhoneE164(leadData.phone);
        }

        const payload = {
            user_id: user.id,
            name: leadData.name,
            phone: leadData.phone || '',
            email: leadData.email || null,
            status: leadData.status || 'Novo',
            temperature: leadData.temperature || 'Cold',
            last_message: leadData.lastMessage || leadData.last_message || 'Adicionado manualmente',
            potential_value: leadData.potentialValue || leadData.potential_value || 0,
            source: leadData.source || 'Manual',
            procedure: leadData.procedure || null,
            objective: leadData.objective || 'Consulta',
            ad_name: leadData.adName || leadData.ad_name || null,
            notes: leadData.notes || null,
            created_at: leadData.created_at || new Date().toISOString(),
            last_sender: 'me'
        };

        const { data, error } = await client
            .from('leads')
            .insert([payload])
            .select()
            .single();

        if (error) throw error;

        return res.json({ ok: true, lead: data });
    } catch (err) {
        console.error("Erro ao criar lead no backend:", err);
        return res.status(500).json({ ok: false, error: err.message || "Erro interno ao criar lead." });
    }
});

// PUT /api/crm/leads/:leadId - Editar lead com normalização
app.put('/api/crm/leads/:leadId', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { leadId } = req.params;
        const client = supabaseAdmin || supabase;
        const leadData = req.body;

        // Verificar se pertence ao usuário
        const { data: existingLead, error: fetchErr } = await client
            .from('leads')
            .select('id, user_id')
            .eq('id', leadId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!existingLead) {
            return res.status(404).json({ ok: false, error: "Lead não encontrado." });
        }

        if (leadData.phone) {
            leadData.phone = normalizePhoneE164(leadData.phone);
        }

        const updatePayload = {};
        if (leadData.name !== undefined) updatePayload.name = leadData.name;
        if (leadData.phone !== undefined) updatePayload.phone = leadData.phone;
        if (leadData.status !== undefined) updatePayload.status = leadData.status;
        if (leadData.temperature !== undefined) updatePayload.temperature = leadData.temperature;
        if (leadData.last_message !== undefined) updatePayload.last_message = leadData.last_message;
        if (leadData.lastMessage !== undefined) updatePayload.last_message = leadData.lastMessage;
        if (leadData.potential_value !== undefined) updatePayload.potential_value = leadData.potential_value;
        if (leadData.potentialValue !== undefined) updatePayload.potential_value = leadData.potentialValue;
        if (leadData.email !== undefined) updatePayload.email = leadData.email;
        if (leadData.notes !== undefined) updatePayload.notes = leadData.notes;
        if (leadData.source !== undefined) updatePayload.source = leadData.source;
        if (leadData.procedure !== undefined) updatePayload.procedure = leadData.procedure;
        if (leadData.objective !== undefined) updatePayload.objective = leadData.objective;
        if (leadData.ad_name !== undefined) updatePayload.ad_name = leadData.ad_name;
        if (leadData.adName !== undefined) updatePayload.ad_name = leadData.adName;

        const { data, error } = await client
            .from('leads')
            .update(updatePayload)
            .eq('id', leadId)
            .select()
            .single();

        if (error) throw error;

        return res.json({ ok: true, lead: data });
    } catch (err) {
        console.error("Erro ao editar lead no backend:", err);
        return res.status(500).json({ ok: false, error: err.message || "Erro interno ao editar lead." });
    }
});

// GET /api/crm/debug/phone-normalize
app.get('/api/crm/debug/phone-normalize', async (req, res) => {
    try {
        await getAuthUser(req);
        const phone = req.query.phone || '';
        const result = normalizeLeadPhoneForBrazil(phone);
        return res.json(result);
    } catch (err) {
        return res.status(401).json({ ok: false, error: "Não autorizado" });
    }
});

// POST /api/crm/leads/:leadId/start-whatsapp-conversation - Criar conversa com lead manual
app.post('/api/crm/leads/:leadId/start-whatsapp-conversation', async (req, res) => {
    try {
        const user = await getAuthUser(req);
        const { leadId } = req.params;

        const client = supabaseAdmin || supabase;

        // 1. Validar e buscar lead
        const { data: lead, error: leadErr } = await client
            .from('leads')
            .select('*')
            .eq('id', leadId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (leadErr || !lead) {
            return res.status(404).json({ ok: false, error: "Lead não encontrado." });
        }

        if (!lead.phone) {
            return res.status(400).json({ ok: false, error: "Lead não possui telefone para iniciar WhatsApp." });
        }

        // TAREFA 3: Se o lead já tem uma conversation_id ligada, usar ela imediatamente
        if (lead.conversation_id) {
            const { data: earlyConv } = await client
                .from('crm_conversations')
                .select(`
                    *,
                    contact:crm_contacts(*)
                `)
                .eq('id', lead.conversation_id)
                .maybeSingle();

            if (earlyConv && earlyConv.lead_id === lead.id) {
                const earlyContact = earlyConv.contact;
                delete earlyConv.contact;
                return res.status(200).json({ 
                    ok: true, 
                    contact: earlyContact, 
                    conversation: earlyConv, 
                    lead 
                });
            }
        }

        // 2. Encontrar conexão ativa do usuário
        const { data: connections, error: connErr } = await client
            .from('crm_connections')
            .select('*')
            .eq('user_id', user.id)
            .eq('provider', 'uazapi')
            .eq('connection_status', 'connected')
            .order('created_at', { ascending: false });

        if (connErr) throw connErr;
        
        if (!connections || connections.length === 0) {
            return res.status(400).json({ ok: false, error: "Nenhuma conexão WhatsApp/Uazapi conectada foi encontrada. Conecte um WhatsApp em Conexões antes de iniciar conversa manual." });
        }

        const activeConnection = connections[0]; // TODO: Seletor de conexão no futuro

        // 3. Normalizar telefone e gerar external_chat_id
        const phoneValidation = normalizeLeadPhoneForBrazil(lead.phone);
        if (!phoneValidation.ok) {
            console.log(`[CRM Phone] Telefone inválido para lead manual: ${lead.phone} motivo: ${phoneValidation.error}`);
            return res.status(400).json({
                ok: false,
                code: "INVALID_LEAD_PHONE",
                error: "Telefone inválido. Corrija o telefone no cadastro do lead antes de iniciar a conversa.",
                phone_validation: phoneValidation
            });
        }
        const finalPhone = phoneValidation.normalized;
        const externalChatId = phoneValidation.jid;
        console.log(`[CRM Phone] raw=${lead.phone}, clean=${phoneValidation.clean}, normalized=${finalPhone}, source=lead`);

        // 4. Criar ou buscar contato no CRM
        let contact = null;
        const { data: existingContact } = await client
            .from('crm_contacts')
            .select('*')
            .eq('user_id', user.id)
            .eq('connection_id', activeConnection.id)
            .eq('external_chat_id', externalChatId)
            .maybeSingle();

        if (existingContact) {
            contact = existingContact;
        } else {
            // Verificar se temos uma conversa existente com este lead_id
            const { data: convWithLead } = await client
                .from('crm_conversations')
                .select('contact_id')
                .eq('user_id', user.id)
                .eq('lead_id', lead.id)
                .maybeSingle();

            if (convWithLead && convWithLead.contact_id) {
                const { data: contactByConv } = await client
                    .from('crm_contacts')
                    .select('*')
                    .eq('id', convWithLead.contact_id)
                    .maybeSingle();
                
                if (contactByConv) {
                    contact = contactByConv;
                }
            }


        }

        if (contact) {
            if (contact.phone !== finalPhone || contact.external_chat_id !== externalChatId) {
                const { data: updatedContact, error: updateContactErr } = await client
                    .from('crm_contacts')
                    .update({
                        phone: finalPhone,
                        external_chat_id: externalChatId,
                        display_name: lead.name || contact.display_name,
                        push_name: lead.name || contact.push_name,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', contact.id)
                    .select()
                    .single();

                if (!updateContactErr && updatedContact) {
                    contact = updatedContact;
                }
            }
        } else {
            const { data: newContact, error: insertContactErr } = await client
                .from('crm_contacts')
                .insert({
                    user_id: user.id,
                    connection_id: activeConnection.id,
                    external_chat_id: externalChatId,
                    display_name: lead.name,
                    push_name: lead.name,
                    phone: finalPhone,
                    is_group: false
                })
                .select()
                .single();

            if (insertContactErr) throw insertContactErr;
            contact = newContact;
        }

        // 5. Criar ou buscar conversation
        let conversation;
        const { data: existingConv } = await client
            .from('crm_conversations')
            .select('*')
            .eq('user_id', user.id)
            .eq('contact_id', contact.id)
            .maybeSingle();

        if (existingConv) {
            conversation = existingConv;
            
            // Se a conversa JÁ tem um lead_id DIFERENTE, NÃO sequestrar!
            // Criar uma nova conversa pro lead atual em vez de roubar a do outro lead
            if (existingConv.lead_id && existingConv.lead_id !== lead.id) {
                console.log(`[CRM] Conversa ${existingConv.id} já pertence ao lead ${existingConv.lead_id}. Criando nova conversa pro lead ${lead.id}.`);
                
                const { data: newConv, error: insertConvErr } = await client
                    .from('crm_conversations')
                    .insert({
                        user_id: user.id,
                        connection_id: activeConnection.id,
                        contact_id: contact.id,
                        lead_id: lead.id,
                        conversation_status: 'open',
                        unread_count: 0,
                        last_message_text: null,
                        last_message_type: null,
                        last_message_at: null,
                        last_sender: null,
                        created_at: new Date(),
                        updated_at: new Date()
                    })
                    .select()
                    .single();

                if (insertConvErr) throw insertConvErr;
                conversation = newConv;
            } else if (!existingConv.lead_id) {
                // Se a conversa NÃO tem lead_id, vincular com segurança
                await client
                    .from('crm_conversations')
                    .update({
                        lead_id: lead.id,
                        conversation_status: 'open',
                        updated_at: new Date()
                    })
                    .eq('id', conversation.id);
            }
            // Se existingConv.lead_id === lead.id, não fazer nada (já está vinculado corretamente)
        } else {
            const insertConversationData = {
                user_id: user.id,
                connection_id: activeConnection.id,
                contact_id: contact.id,
                lead_id: lead.id,
                conversation_status: 'open',
                unread_count: 0,
                last_message_text: null,
                last_message_type: null,
                last_message_at: null,
                last_sender: null,
                created_at: new Date(),
                updated_at: new Date()
            };
            const { data: newConv, error: insertConvErr } = await client
                .from('crm_conversations')
                .insert(insertConversationData)
                .select()
                .single();

            if (insertConvErr) throw insertConvErr;
            conversation = newConv;
        }

        // 6. Atualizar lead com conversation_id, external_chat_id, e channel
        const updateLeadPayload = {
            conversation_id: conversation.id,
            external_chat_id: externalChatId
        };
        // Tentar atualizar channel também se a coluna existir, mas ignoramos eventual erro
        await client.from('leads').update({ ...updateLeadPayload, channel: 'whatsapp' }).eq('id', lead.id).then(({error})=> {
            if(error && error.code === 'PGRST204') {
                // Coluna não existe, tenta sem ela
                client.from('leads').update(updateLeadPayload).eq('id', lead.id).then(()=>{}).catch(()=>{});
            }
        }).catch(()=>{});

        return res.status(200).json({
            ok: true,
            contact,
            conversation,
            lead: { ...lead, conversation_id: conversation.id, external_chat_id: externalChatId }
        });

    } catch (err) {
        console.error("Erro ao iniciar conversa do WhatsApp:", err);
        return res.status(500).json({ ok: false, error: "Erro interno ao iniciar conversa." });
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

        const destinationResult = await resolveConversationDestination(client, user.id, conversationId);
        if (!destinationResult.ok) {
            return res.status(400).json({
                ok: false,
                code: "INVALID_LEAD_PHONE",
                error: destinationResult.error,
                phone_validation: destinationResult.phone_validation
            });
        }

        const { destino, contact, conversation } = destinationResult;

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

        console.log(`[CRM Send] Enviando mensagem pela Uazapi para conversa ${conversationId}, destino normalizado: ${destino}`);

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

        let isNotOnWhatsApp = false;
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

            if (responseText && (responseText.toLowerCase().includes("is not on whatsapp") || responseText.toLowerCase().includes("not on whatsapp"))) {
                isNotOnWhatsApp = true;
            }

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

                if (fallbackText && (fallbackText.toLowerCase().includes("is not on whatsapp") || fallbackText.toLowerCase().includes("not on whatsapp"))) {
                    isNotOnWhatsApp = true;
                }

                if (!fallbackResponse.ok) {
                    throw new Error(`Uazapi HTTP Error first body: ${responseText}, fallback body: ${fallbackText}`);
                } else {
                    responseJson = JSON.parse(fallbackText);
                }
            } else {
                responseJson = JSON.parse(responseText);
            }

            if (responseJson && JSON.stringify(responseJson).toLowerCase().includes("not on whatsapp")) {
                isNotOnWhatsApp = true;
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
            if (uazapiError.toLowerCase().includes("is not on whatsapp") || uazapiError.toLowerCase().includes("not on whatsapp")) {
                isNotOnWhatsApp = true;
            }
        }

        if (isNotOnWhatsApp) {
            uazapiError = "A Uazapi informou que este número não possui WhatsApp ou está cadastrado incorretamente. Verifique o telefone do lead com DDI/DDD.";
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
            if (isNotOnWhatsApp) {
                return res.json({
                    ok: false,
                    message: createdMessage,
                    error: "A Uazapi informou que este número não possui WhatsApp ou está cadastrado incorretamente. Verifique o telefone do lead com DDI/DDD."
                });
            }
            return res.json({
                ok: false,
                message: createdMessage,
                error: (typeof uazapiError === 'string' && uazapiError) || "Erro ao enviar pela Uazapi."
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

// CONFIGURAÇÃO LOCAL DO MULTER COM MEMORY STORAGE E LIMITE DE 50MB
const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
});

// POST /api/crm/conversations/:conversationId/send-media — Enviar mídia do CRM via Uazapi e salvar
app.post('/api/crm/conversations/:conversationId/send-media', uploadMiddleware.single('file'), async (req, res) => {
    try {
        console.log(`[CRM Send Media] Iniciando processamento de envio de mídia.`);
        
        // 1. Validar Authorization Bearer com getAuthUser(req)
        const user = await getAuthUser(req);
        const { conversationId } = req.params;
        const caption = req.body.caption || '';

        // 2. Validar arquivo obrigatório
        if (!req.file) {
            return res.status(400).json({
                ok: false,
                error: "O arquivo é obrigatório no campo 'file'."
            });
        }

        const mime = req.file.mimetype || 'application/octet-stream';
        const originalName = req.file.originalname || 'arquivo';
        const fileSizeBytes = req.file.size;

        console.log(`[CRM Send Media] Upload recebido: tipo=${mime}/tamanho=${fileSizeBytes} bytes/nome=${originalName}`);

        const client = supabaseAdmin || supabase;

        // 3. Buscar destino resolvido usando a nova lógica centralizada de lead.phone e contact fallback
        const destinationResult = await resolveConversationDestination(client, user.id, conversationId);
        if (!destinationResult.ok) {
            return res.status(400).json({
                ok: false,
                code: "INVALID_LEAD_PHONE",
                error: destinationResult.error,
                phone_validation: destinationResult.phone_validation
            });
        }

        const { destino, contact, conversation } = destinationResult;

        // 5. Buscar crm_connections
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

        // 6. Validar provider = 'uazapi' e tokens
        if (connection.provider !== 'uazapi') {
            return res.status(400).json({
                ok: false,
                error: "Esta rota suporta apenas conexão via o provedor 'uazapi'."
            });
        }

        const uazapiToken = connection.instance_token || connection.provider_token;
        if (!uazapiToken) {
            return res.status(400).json({
                ok: false,
                error: "Token do provedor Uazapi não configurado para esta conexão."
            });
        }

        // 7. Determinar tipos (Uazapi e interno)
        let tipoUazapi = 'document';
        let internalMessageType = 'document';

        if (mime.startsWith('image/')) {
            tipoUazapi = 'image';
            internalMessageType = 'image';
        } else if (mime.startsWith('video/')) {
            tipoUazapi = 'video';
            internalMessageType = 'video';
        } else if (mime.startsWith('audio/')) {
            tipoUazapi = 'audio';
            internalMessageType = 'audio';
        } else {
            tipoUazapi = 'document';
            internalMessageType = 'document';
        }

        // 8. Upload para o Supabase Storage bucket crm-media
        const timestamp = Date.now();
        
        function fixMulterFilenameEncoding(name) {
            if (!name) return 'arquivo';
            try {
                const fixed = Buffer.from(name, 'latin1').toString('utf8');
                if (fixed && !fixed.includes('')) return fixed;
            } catch (e) {}
            return name;
        }

        const fixedOriginalName = fixMulterFilenameEncoding(req.file.originalname || 'arquivo');
        const extname = path.extname(fixedOriginalName);
        const baseNameWithoutExt = path.basename(fixedOriginalName, extname);
        // Sanitizar nome do arquivo de forma segura
        const safeBaseName = baseNameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeOriginalName = `${safeBaseName}${extname || ''}`;
        const storagePath = `${user.id}/${connection.id}/${conversation.id}/outbound/${timestamp}_${safeOriginalName}`;

        console.log(`[CRM Send Media] Tentando upload para bucket crm-media, path: ${storagePath} (${fileSizeBytes} bytes)`);

        const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
            .from('crm-media')
            .upload(storagePath, req.file.buffer, {
                contentType: mime,
                upsert: true
            });

        if (uploadErr) {
            console.error(`[CRM Send Media] Erro ao subir para o Supabase Storage:`, uploadErr);
            return res.status(500).json({
                ok: false,
                error: "Erro ao realizar o upload do arquivo para o storage da AXIS."
            });
        }

        // Obter URL pública
        const { data: publicUrlData } = supabaseAdmin.storage
            .from('crm-media')
            .getPublicUrl(storagePath);

        const publicUrl = publicUrlData?.publicUrl;
        if (!publicUrl) {
            return res.status(500).json({
                ok: false,
                error: "Erro ao recuperar o link público do arquivo armazenado."
            });
        }

        console.log(`[CRM Send Media] Arquivo salvo no Storage. Link: ${publicUrl.split('?')[0]}`);

        // 9. Montar destino para Uazapi
        // 10. Chamar endpoint Uazapi de mídia
        const baseUrl = (connection.api_base_url || connection.base_url || '').replace(/\/$/, '');
        const uazapiUrl = `${baseUrl}/send/media`;

        const headers = {
            'Content-Type': 'application/json',
            'token': uazapiToken,
            'Authorization': `Bearer ${uazapiToken}`
        };

        const body1 = {
            "number": destino,
            "type": tipoUazapi,
            "file": publicUrl,
            "text": caption || "",
            "caption": caption || "",
            "filename": fixedOriginalName
        };

        const body2 = {
            "number": destino,
            "type": tipoUazapi,
            "media": publicUrl,
            "caption": caption || "",
            "filename": fixedOriginalName
        };

        const body3 = {
            "number": destino,
            "type": tipoUazapi,
            "url": publicUrl,
            "caption": caption || "",
            "filename": fixedOriginalName
        };

        let isNotOnWhatsApp = false;
        let uazapiError = null;
        let responseJson = null;
        let extMessageId = null;

        console.log(`[CRM Send Media] Enviando mídia via Uazapi para conversa ${conversationId}, destino: ${destino}`);

        // Tentativa de envio com fallback
        const controller1 = new AbortController();
        const timeoutId1 = setTimeout(() => controller1.abort(), 15000);

        try {
            const response = await fetch(uazapiUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(body1),
                signal: controller1.signal
            });
            const responseText = await response.text();
            clearTimeout(timeoutId1);

            if (responseText && (responseText.toLowerCase().includes("is not on whatsapp") || responseText.toLowerCase().includes("not on whatsapp"))) {
                isNotOnWhatsApp = true;
            }

            if (!response.ok) {
                console.log(`[CRM Send Media] Endpoint principal de mídia recusado (${response.status}), tentando fallback 1...`);
                const controller2 = new AbortController();
                const timeoutId2 = setTimeout(() => controller2.abort(), 15000);
                try {
                    const fallbackResponse = await fetch(uazapiUrl, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(body2),
                        signal: controller2.signal
                    });
                    const fbText = await fallbackResponse.text();
                    clearTimeout(timeoutId2);

                    if (fbText && (fbText.toLowerCase().includes("is not on whatsapp") || fbText.toLowerCase().includes("not on whatsapp"))) {
                        isNotOnWhatsApp = true;
                    }

                    if (!fallbackResponse.ok) {
                        console.log(`[CRM Send Media] Fallback 1 recusado (${fallbackResponse.status}), tentando fallback 2...`);
                        const controller3 = new AbortController();
                        const timeoutId3 = setTimeout(() => controller3.abort(), 15000);
                        try {
                            const fallbackResponse2 = await fetch(uazapiUrl, {
                                method: 'POST',
                                headers,
                                body: JSON.stringify(body3),
                                signal: controller3.signal
                            });
                            const fbText2 = await fallbackResponse2.text();
                            clearTimeout(timeoutId3);

                            if (fbText2 && (fbText2.toLowerCase().includes("is not on whatsapp") || fbText2.toLowerCase().includes("not on whatsapp"))) {
                                isNotOnWhatsApp = true;
                            }

                            if (!fallbackResponse2.ok) {
                                throw new Error(`Falha total em todos os corpos do payload da Uazapi.`);
                            } else {
                                responseJson = JSON.parse(fbText2);
                            }
                        } catch (err3) {
                            clearTimeout(timeoutId3);
                            throw err3;
                        }
                    } else {
                        responseJson = JSON.parse(fbText);
                    }
                } catch (err2) {
                    clearTimeout(timeoutId2);
                    throw err2;
                }
            } else {
                responseJson = JSON.parse(responseText);
            }

            if (responseJson && JSON.stringify(responseJson).toLowerCase().includes("not on whatsapp")) {
                isNotOnWhatsApp = true;
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
            clearTimeout(timeoutId1);
            console.error(`[CRM Send Media] Erro ao chamar endpoint de envio Uazapi:`, fetchErr.message || fetchErr);
            uazapiError = fetchErr.message || String(fetchErr);
            if (uazapiError.toLowerCase().includes("is not on whatsapp") || uazapiError.toLowerCase().includes("not on whatsapp")) {
                isNotOnWhatsApp = true;
            }
        }

        if (isNotOnWhatsApp) {
            uazapiError = "A Uazapi informou que este número não possui WhatsApp ou está cadastrado incorretamente. Verifique o telefone do lead com DDI/DDD.";
        }

        // 11. Salvar crm_messages outbound
        const finalStatus = uazapiError ? "failed" : "sent";
        const finalExtId = extMessageId || ("axis_out_" + Date.now());

        const defaultPlaceholder = {
            'image': '[imagem]',
            'video': '[vídeo]',
            'audio': '[áudio]',
            'document': '[documento]'
        }[internalMessageType] || '[documento]';

        const textBody = caption || defaultPlaceholder;

        const outMessageData = {
            user_id: user.id,
            connection_id: conversation.connection_id,
            conversation_id: conversation.id,
            contact_id: conversation.contact_id,
            lead_id: conversation.lead_id || null,
            external_message_id: finalExtId,
            message_direction: "outbound",
            sender_type: "me",
            message_type: internalMessageType,
            message_text: textBody,
            caption: caption || null,
            media_url: publicUrl,
            media_mime_type: mime,
            media_filename: fixedOriginalName,
            message_status: finalStatus,
            from_me: true,
            raw_payload: responseJson ? sanitizePayload(responseJson) : { error: uazapiError },
            sent_at: new Date().toISOString(),
            created_at: new Date().toISOString()
        };

        function sanitizePayload(obj) {
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
                    console.log(`[CRM Send Media] Mensagem de mídia duplicada ignorada (external_message_id unique): ${finalExtId}`);
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
            console.error(`[CRM Send Media] Falha ao tentar salvar em crm_messages:`, dbErr);
            return res.status(500).json({
                ok: false,
                error: "Erro do banco de dados ao salvar a tentativa de envio da mídia."
            });
        }

        console.log(`[CRM Send Media] Mensagem outbound salva. ID: ${createdMessage?.id}`);

        // 12. Salvar crm_message_attachments outbound
        let createdAttachment = null;
        if (createdMessage) {
            const attachmentData = {
                user_id: user.id,
                connection_id: conversation.connection_id,
                conversation_id: conversation.id,
                message_id: createdMessage.id,
                attachment_type: internalMessageType,
                source_url: publicUrl,
                storage_bucket: "crm-media",
                storage_path: storagePath,
                mime_type: mime,
                filename: fixedOriginalName,
                size_bytes: fileSizeBytes,
                raw_metadata: {
                    direction: "outbound",
                    uazapiSendOk: !uazapiError,
                    originalName: fixedOriginalName,
                    mime: mime
                },
                created_at: new Date()
            };

            try {
                const { data: insertedAttach, error: attachErr } = await client
                    .from('crm_message_attachments')
                    .insert(attachmentData)
                    .select()
                    .single();

                if (attachErr) {
                    console.error(`[CRM Send Media] Erro ao criar crm_message_attachments:`, attachErr);
                } else {
                    createdAttachment = insertedAttach;
                }
            } catch (dbAttachErr) {
                console.error(`[CRM Send Media] Exceção ao gravar crm_message_attachments:`, dbAttachErr);
            }
        }

        // 13. Atualizar conversa e lead (mesmo se falhou o envio para Uazapi, queremos registrar a tentativa no CRM)
        if (createdMessage) {
            const now = new Date().toISOString();
            
            const { error: updateConvErr } = await client
                .from('crm_conversations')
                .update({
                    last_message_text: textBody,
                    last_message_type: internalMessageType,
                    last_message_at: now,
                    last_sender: "me",
                    unread_count: 0,
                    updated_at: now
                })
                .eq('id', conversationId);

            if (updateConvErr) {
                console.error(`[CRM Send Media] Falha ao atualizar crm_conversations com última mensagem:`, updateConvErr);
            }

            if (conversation.lead_id) {
                const { error: updateLeadErr } = await client
                    .from('leads')
                    .update({
                        last_message: textBody,
                        last_sender: "me",
                        last_interaction: now
                    })
                    .eq('id', conversation.lead_id);

                if (updateLeadErr) {
                    console.error(`[CRM Send Media] Falha ao atualizar lead correspondente à conversa:`, updateLeadErr);
                }
            }
        }

        if (uazapiError) {
            console.log(`[CRM Send Media] Falha de envio pelo Uazapi: ${uazapiError}`);
            if (isNotOnWhatsApp) {
                return res.json({
                    ok: false,
                    message: createdMessage,
                    attachment: createdAttachment,
                    error: "A Uazapi informou que este número não possui WhatsApp ou está cadastrado incorretamente. Verifique o telefone do lead com DDI/DDD."
                });
            }
            return res.json({
                ok: false,
                message: createdMessage,
                attachment: createdAttachment,
                error: (typeof uazapiError === 'string' && uazapiError) || "Falha ao enviar pela Uazapi, mensagem registrada como failed."
            });
        }

        console.log(`[CRM Send Media] Mídia enviada e salva com sucesso absoluto.`);
        return res.json({
            ok: true,
            message: createdMessage,
            attachment: createdAttachment
        });

    } catch (err) {
        console.error('Erro geral no endpoint de envio de mídia CRM:', err);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message || 'Erro interno ao processar envio de mídia do CRM'
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

        const messageSummary = message?.text || message?.caption || (() => {
            const t = String(message?.messageType || message?.type || '').toLowerCase();
            if (t.includes('image')) return '[imagem]';
            if (t.includes('audio') || t.includes('voice')) return '[áudio]';
            if (t.includes('video')) return '[vídeo]';
            if (t.includes('document')) return '[documento]';
            if (t.includes('sticker')) return '[figurinha]';
            if (message?.mediaUrl) return '[mídia]';
            return '[mensagem]';
        })();
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
        } else if (typeof value === 'string' && value.length > 5000 && !value.toLowerCase().startsWith('http')) {
            sanitized[key] = "[OMITTED_LARGE_STRING]";
        } else if (keysForLargePayloads.some(k => lowerKey === k || lowerKey.includes(k)) && typeof value === 'string' && value.length > 100 && !value.toLowerCase().startsWith('http')) {
            sanitized[key] = "[OMITTED_MEDIA_PAYLOAD]";
        } else {
            sanitized[key] = sanitizeWebhookPayloadForStorage(value, depth + 1);
        }
    }
    return sanitized;
}

function deepFindMediaAndMime(obj) {
    let fileUrl = null;
    let mimeType = null;

    if (!obj || typeof obj !== 'object') {
        return { fileUrl, mimeType };
    }

    function search(current) {
        if (!current || typeof current !== 'object') return;

        const urlKeys = ['fileurl', 'url', 'downloadurl', 'mediaurl'];
        if (!Array.isArray(current)) {
            for (const [k, v] of Object.entries(current)) {
                const lowerK = k.toLowerCase();
                if (urlKeys.includes(lowerK) && typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))) {
                    if (!fileUrl) fileUrl = v;
                }
                const mimeKeys = ['mimetype', 'mime_type'];
                if (mimeKeys.includes(lowerK) && typeof v === 'string' && v.includes('/')) {
                    if (!mimeType) mimeType = v;
                }
            }
        }

        if (Array.isArray(current)) {
            for (const item of current) {
                search(item);
                if (fileUrl && mimeType) return;
            }
        } else {
            for (const [k, v] of Object.entries(current)) {
                if (v && typeof v === 'object') {
                    search(v);
                    if (fileUrl && mimeType) return;
                }
            }
        }
    }

    search(obj);
    return { fileUrl, mimeType };
}

// Normaliza telefone para padrão E.164 (+5511999998888)
function normalizePhoneE164(phone) {
    if (!phone) return null;
    // Remove tudo que não for dígito
    let cleaned = String(phone).replace(/\D/g, '');
    // Remove zeros à esquerda
    cleaned = cleaned.replace(/^0+/, '');
    // Se não tem DDI, adiciona 55 (Brasil)
    if (!cleaned.startsWith('55')) {
        cleaned = '55' + cleaned;
    }
    // Validação: deve ter entre 12 e 13 dígitos (55 + DDD + número)
    if (cleaned.length < 12 || cleaned.length > 13) {
        return null; // Inválido
    }
    return '+' + cleaned;
}

function normalizeLeadPhoneForBrazil(value) {
    const raw = String(value || '');
    let clean = cleanMarkdownLink(raw);
    clean = String(clean)
        .trim()
        .split('@')[0]
        .replace(/\D/g, '');

    if (!clean) {
        return {
            ok: false,
            raw,
            clean,
            normalized: null,
            jid: null,
            reason: "O telefone não pode ser vazio.",
            hasCountryCode: false
        };
    }

    const hasCountryCode = clean.startsWith('55');

    // Sem DDI: aceitar apenas 10 ou 11 dígitos.
    if (!hasCountryCode) {
        if (clean.length === 10 || clean.length === 11) {
            const normalized = `55${clean}`;
            return {
                ok: true,
                raw,
                clean,
                normalized,
                jid: `${normalized}@s.whatsapp.net`,
                reason: null,
                hasCountryCode: false
            };
        }
        return {
            ok: false,
            raw,
            clean,
            normalized: null,
            jid: null,
            reason: `Telefone inválido: sem DDI deve ter 10 ou 11 dígitos. Recebido: ${clean.length}. Exemplo correto: 4187348600 ou 41998734860.`,
            hasCountryCode: false
        };
    }

    // Com DDI 55: aceitar apenas 12 ou 13 dígitos.
    if (clean.length === 12 || clean.length === 13) {
        return {
            ok: true,
            raw,
            clean,
            normalized: clean,
            jid: `${clean}@s.whatsapp.net`,
            reason: null,
            hasCountryCode: true
        };
    }
    return {
        ok: false,
        raw,
        clean,
        normalized: null,
        jid: null,
        reason: `Telefone inválido: com DDI 55 deve ter 12 ou 13 dígitos. Recebido: ${clean.length}. Exemplo correto: 554187348600 ou 5541998734860.`,
        hasCountryCode: true
    };
}

async function resolveConversationDestination(client, userId, conversationId) {
    // 1. Buscar conversation
    const { data: conversation, error: convErr } = await client
        .from('crm_conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();

    if (convErr || !conversation) {
        return {
            ok: false,
            error: "Conversa não encontrada ou não pertence a este usuário."
        };
    }

    // 2. Buscar contact
    const { data: contact, error: contactErr } = await client
        .from('crm_contacts')
        .select('*')
        .eq('id', conversation.contact_id)
        .maybeSingle();

    if (contactErr || !contact) {
        return {
            ok: false,
            error: "Contato associado à conversa não foi encontrado."
        };
    }

    let destino = null;
    let source = null;

    // 3. Buscar lead se existir lead_id
    if (conversation.lead_id) {
        const { data: lead, error: leadErr } = await client
            .from('leads')
            .select('*')
            .eq('id', conversation.lead_id)
            .maybeSingle();

        if (lead && lead.phone) {
            const validation = normalizeLeadPhoneForBrazil(lead.phone);
            if (validation.ok) {
                destino = validation.normalized;
                source = 'lead';
                console.log(`[CRM Phone] raw=${lead.phone}, clean=${validation.clean}, normalized=${destino}, source=lead`);
            } else {
                console.log(`[CRM Phone] Lead ${lead.id} phone validation failed: ${validation.reason}`);
            }
        }
    }

    // 4. Fallback para contact se não resolveu com o lead
    if (!destino) {
        // Validar contact.phone
        let validation = normalizeLeadPhoneForBrazil(contact.phone);
        if (!validation.ok) {
            // Se falhar e external_chat_id tiver, tentar validar o external_chat_id
            validation = normalizeLeadPhoneForBrazil(contact.external_chat_id);
        }

        if (validation.ok) {
            destino = validation.normalized;
            source = 'contact';
            console.log(`[CRM Phone] raw=${contact.phone || contact.external_chat_id}, clean=${validation.clean}, normalized=${destino}, source=contact`);
        } else {
            console.log(`[CRM Phone] Contact ${contact.id} phone and external_chat_id validation failed: ${validation.reason}`);
            return {
                ok: false,
                error: validation.reason || "Telefone do contato inválido para WhatsApp. Revise o cadastro.",
                phone_validation: validation
            };
        }
    }

    // 5. Atualizar o crm_contacts se estiver diferente e for válido
    if (destino && (contact.phone !== destino || contact.external_chat_id !== `${destino}@s.whatsapp.net`)) {
        console.log(`[CRM Phone] Updating crm_contacts ${contact.id} reference to correct destination: ${destino}`);
        const { error: updateErr } = await client
            .from('crm_contacts')
            .update({
                phone: destino,
                external_chat_id: `${destino}@s.whatsapp.net`,
                updated_at: new Date().toISOString()
            })
            .eq('id', contact.id);

        if (updateErr) {
            console.error(`[CRM Phone] Error updating crm_contacts:`, updateErr);
        } else {
            contact.phone = destino;
            contact.external_chat_id = `${destino}@s.whatsapp.net`;
        }
    }

    return {
        ok: true,
        destino,
        source,
        contact,
        conversation,
        error: null
    };
}

function normalizePhone(value) {
    if (!value) return null;
    let clean = cleanMarkdownLink(value);
    clean = String(clean);
    clean = clean.split('@')[0];
    clean = clean.replace(/\D/g, '');
    return clean || null;
}

function normalizeBrazilWhatsAppNumberDetailed(value, options = {}) {
    const allowInboundAsSourceOfTruth = Boolean(options.allowInboundAsSourceOfTruth);

    if (!value) {
        return {
            ok: false,
            raw: value,
            normalized: null,
            jid: null,
            reason: "Telefone vazio."
        };
    }

    let clean = cleanMarkdownLink(value);
    clean = String(clean)
        .trim()
        .split('@')[0]
        .replace(/\D/g, '');

    if (!clean) {
        return {
            ok: false,
            raw: value,
            normalized: null,
            jid: null,
            reason: "Telefone sem dígitos válidos."
        };
    }

    if (clean.startsWith('00')) {
        clean = clean.slice(2);
    }

    if (clean.startsWith('0') && clean.length >= 11) {
        clean = clean.slice(1);
    }

    // Se veio do WhatsApp/Uazapi inbound, aceitar como fonte de verdade,
    // desde que tenha pelo menos 10 dígitos.
    if (allowInboundAsSourceOfTruth && clean.startsWith('55') && clean.length >= 12 && clean.length <= 13) {
        return {
            ok: true,
            raw: value,
            normalized: clean,
            jid: `${clean}@s.whatsapp.net`,
            reason: null
        };
    }

    // Já vem com DDI 55.
    if (clean.startsWith('55')) {
        if (clean.length === 12 || clean.length === 13) {
            return {
                ok: true,
                raw: value,
                normalized: clean,
                jid: `${clean}@s.whatsapp.net`,
                reason: null
            };
        }

        return {
            ok: false,
            raw: value,
            normalized: clean,
            jid: null,
            reason: `Telefone com DDI 55 deve ter 12 ou 13 dígitos. Recebido: ${clean.length}.`
        };
    }

    // Sem DDI: aceitar só 10 ou 11 dígitos.
    if (clean.length === 10 || clean.length === 11) {
        const normalized = `55${clean}`;
        return {
            ok: true,
            raw: value,
            normalized,
            jid: `${normalized}@s.whatsapp.net`,
            reason: null
        };
    }

    // Caso comum de erro: 12 dígitos sem DDI.
    if (clean.length === 12) {
        return {
            ok: false,
            raw: value,
            normalized: null,
            jid: null,
            reason: "Telefone parece inválido: possui 12 dígitos sem DDI. Revise o número. Use DDD + número, exemplo 41998734860, ou DDI + DDD + número, exemplo 5541998734860."
        };
    }

    return {
        ok: false,
        raw: value,
        normalized: null,
        jid: null,
        reason: `Telefone com quantidade inválida de dígitos: ${clean.length}.`
    };
}

function normalizeBrazilWhatsAppNumber(value, options = {}) {
    const result = normalizeBrazilWhatsAppNumberDetailed(value, options);
    return result.ok ? result.normalized : null;
}

function buildWhatsappJid(phone, options = {}) {
    const result = normalizeBrazilWhatsAppNumberDetailed(phone, options);
    return result.ok ? result.jid : null;
}

async function downloadUazapiMedia({ baseUrl, token, messageId }) {
    if (!baseUrl || !token || !messageId) {
        console.log("[CRM Media] Sem parâmetros necessários para downloadUazapiMedia.");
        return { fileUrl: null, mimeType: null, base64: null };
    }
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const cleanMsgId = cleanMarkdownLink(messageId);
    console.log(`[CRM Media] Baixando mídia via Uazapi. messageId: ${cleanMsgId}, baseUrl: ${cleanUrl}`);

    const endpoints = [
        {
            path: '/message/download',
            body: { id: cleanMsgId }
        },
        {
            path: '/message/download',
            body: { id: cleanMsgId, return_link: true, return_base64: false }
        },
        {
            path: '/message/find',
            body: { id: cleanMsgId, limit: 1 }
        }
    ];

    for (const ep of endpoints) {
        try {
            console.log(`[CRM Media] Tentando POST ${ep.path} para ID ${cleanMsgId}...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            const response = await fetch(`${cleanUrl}${ep.path}`, {
                method: 'POST',
                headers: {
                    'token': token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(ep.body),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                const found = deepFindMediaAndMime(data);
                
                // Extrair base64 se disponível
                let base64 = data.base64 || data.data?.base64 || (data.content && data.content.base64) || null;
                if (!base64 && typeof data.data === 'string' && data.data.startsWith('data:')) {
                    const parts = data.data.split(',');
                    base64 = parts[1] || parts[0];
                }

                if (found.fileUrl || base64) {
                    console.log(`[CRM Media] Download resolvido por URL: ${found.fileUrl ? 'sim' : 'não'} (Mime: ${found.mimeType || 'não'}), base64: ${base64 ? 'sim' : 'não'}`);
                    return {
                        fileUrl: found.fileUrl,
                        mimeType: found.mimeType,
                        base64: base64
                    };
                }
            } else {
                console.log(`[CRM Media] Resposta mal-sucedida do endpoint ${ep.path}: ${response.status}`);
            }
        } catch (err) {
            console.error(`[CRM Media] Erro ao tentar endpoint ${ep.path}:`, err.message || err);
        }
    }

    console.log(`[CRM Media] Todas as tentativas de download falharam para a mensagem ID ${cleanMsgId}`);
    return { fileUrl: null, mimeType: null, base64: null };
}

async function uploadMediaToSupabaseStorage({ base64, userId, connectionId, conversationId, messageId, mimeType }) {
    if (!base64) return null;
    try {
        console.log(`[CRM Media] Base64 recebido, subindo para Supabase Storage... MessageId: ${messageId}`);
        // Determinar extensão
        let ext = 'bin';
        if (mimeType) {
            const m = String(mimeType).toLowerCase();
            if (m.includes('jpeg') || m.includes('jpg')) ext = 'jpg';
            else if (m.includes('png')) ext = 'png';
            else if (m.includes('gif')) ext = 'gif';
            else if (m.includes('mp4')) ext = 'mp4';
            else if (m.includes('ogg') || m.includes('opus')) ext = 'ogg';
            else if (m.includes('mp3') || m.includes('mpeg')) ext = 'mp3';
            else if (m.includes('pdf')) ext = 'pdf';
            else if (m.includes('docx') || m.includes('word')) ext = 'docx';
            else if (m.includes('xlsx') || m.includes('excel')) ext = 'xlsx';
        }
        
        const cleanMsgId = cleanMarkdownLink(messageId);
        const storagePath = `${userId}/${connectionId}/${conversationId}/${cleanMsgId}.${ext}`;
        const buffer = Buffer.from(base64, 'base64');

        console.log(`[CRM Media] Tentando upload para bucket crm-media, path: ${storagePath} (size: ${buffer.length} bytes, mime: ${mimeType || 'auto'})`);

        // Usar supabaseAdmin no backend para service role
        const { data, error } = await supabaseAdmin.storage
            .from('crm-media')
            .upload(storagePath, buffer, {
                contentType: mimeType || 'application/octet-stream',
                upsert: true
            });

        if (error) {
            console.error(`[CRM Media] Erro ao subir mídia para o Supabase Storage:`, error);
            return null;
        }

        // Obter publicURL
        const { data: publicUrlData } = supabaseAdmin.storage
            .from('crm-media')
            .getPublicUrl(storagePath);

        const publicUrl = publicUrlData?.publicUrl || null;
        console.log(`[CRM Media] Mídia salva em Storage: sim. PublicUrl: ${publicUrl}`);
        
        return {
            storageBucket: 'crm-media',
            storagePath: storagePath,
            publicUrl: publicUrl
        };
    } catch (err) {
        console.error(`[CRM Media] Erro na função uploadMediaToSupabaseStorage:`, err.message || err);
        return null;
    }
}

function isEncryptedUrl(url, metadata) {
    if (!url) return false;
    const u = String(url).toLowerCase();
    if (u.includes('mmg.whatsapp.net') || u.includes('.enc')) {
        return true;
    }
    if (metadata && (metadata.mediaKey || metadata.media_key || metadata.directPath || metadata.direct_path || metadata.fileEncSHA256 || metadata.file_enc_sha256)) {
        return true;
    }
    return false;
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
            const validation = normalizeLeadPhoneForBrazil(rawPhone);
            if (validation.ok) {
                phone = validation.normalized;
                console.log(`[CRM Phone] raw=${rawPhone}, clean=${validation.clean}, normalized=${phone}, source=inbound_rawPhone`);
            } else {
                phone = validation.clean; // Fallback to numbers only
            }
        }
        
        if (!phone && externalChatId && !isGroup) {
            const validation = normalizeLeadPhoneForBrazil(externalChatId);
            if (validation.ok) {
                phone = validation.normalized;
                console.log(`[CRM Phone] raw=${externalChatId}, clean=${validation.clean}, normalized=${phone}, source=inbound_externalChatId`);
            } else {
                phone = validation.clean; // Fallback to numbers only
            }
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

        // Formato Uazapi: messageType em PascalCase, content com detalhes, fileURL no raiz
        const msgType = raw.messageType || raw.type || '';
        const content = raw.content || {};
        const fileURL = raw.fileURL || raw.fileUrl || null;

        // 1. Texto (ExtendedTextMessage ou Conversation)
        if (msgType === 'ExtendedTextMessage' || msgType === 'Conversation' || msgType === 'text') {
            text = content.text || raw.text || raw.body || content.conversation || null;
        }

        // 2. Imagem (ImageMessage)
        if (msgType === 'ImageMessage' || msgType === 'image') {
            finalType = 'image';
            mediaUrl = fileURL || content.URL || content.url || null;
            mediaMimeType = content.mimetype || content.mimeType || 'image/jpeg';
            caption = content.caption || raw.text || null;
            if (content.fileLength) sizeBytes = Number(content.fileLength);
            if (content.JPEGThumbnail || content.jpegThumbnail) thumbnailUrl = "[THUMBNAIL_BASE64]";
        }

        // 3. Áudio / Voz (AudioMessage)
        if (msgType === 'AudioMessage' || msgType === 'audio' || msgType === 'voice') {
            const isPtt = content.PTT === true || raw.ptt === true;
            finalType = isPtt ? 'voice' : 'audio';
            mediaUrl = fileURL || content.URL || content.url || null;
            mediaMimeType = content.mimetype || content.mimeType || (isPtt ? 'audio/ogg; codecs=opus' : 'audio/mpeg');
            if (content.seconds) durationSeconds = Number(content.seconds);
            if (content.duration) durationSeconds = Number(content.duration);
            if (content.fileLength) sizeBytes = Number(content.fileLength);
        }

        // 4. Vídeo (VideoMessage)
        if (msgType === 'VideoMessage' || msgType === 'video') {
            finalType = 'video';
            mediaUrl = fileURL || content.URL || content.url || null;
            mediaMimeType = content.mimetype || content.mimeType || 'video/mp4';
            caption = content.caption || raw.text || null;
            if (content.seconds) durationSeconds = Number(content.seconds);
            if (content.fileLength) sizeBytes = Number(content.fileLength);
        }

        // 5. Documento (DocumentMessage)
        if (msgType === 'DocumentMessage' || msgType === 'document') {
            finalType = 'document';
            mediaUrl = fileURL || content.URL || content.url || null;
            mediaMimeType = content.mimetype || content.mimeType || 'application/octet-stream';
            mediaFilename = content.fileName || content.filename || content.title || `document_${externalMessageId}.${(mediaMimeType.split('/')[1] || 'bin')}`;
            text = content.caption || content.fileName || '[documento]';
        }

        // 6. Sticker (StickerMessage)
        if (msgType === 'StickerMessage' || msgType === 'sticker') {
            finalType = 'sticker';
            mediaUrl = fileURL || content.URL || content.url || null;
            mediaMimeType = content.mimetype || content.mimeType || 'image/webp';
            mediaFilename = `sticker_${externalMessageId}.webp`;
        }

        // 7. Contato (ContactMessage)
        if (msgType === 'ContactMessage' || msgType === 'contact') {
            finalType = 'contact';
            text = `Contato: ${content.displayName || content.name || 'VCard'}`;
            extraInfo.vcard = content.vcard || content.contactVcard || null;
        }

        // 8. Localização (LocationMessage)
        if (msgType === 'LocationMessage' || msgType === 'location' || msgType === 'liveLocationMessage') {
            finalType = 'location';
            text = `Localização: ${content.degreesLatitude || ''},${content.degreesLongitude || ''}`;
            extraInfo.latitude = content.degreesLatitude || content.latitude || null;
            extraInfo.longitude = content.degreesLongitude || content.longitude || null;
        }

        if (actualMessage) {

            // Poll (Enquete)
            const poll = actualMessage.pollCreationMessage || actualMessage.pollCreationV2Message || actualMessage.pollMessage || raw.pollCreationMessage;
            if (poll) {
                finalType = 'poll';
                const pollName = poll.name || poll.pollName || 'Enquete';
                const options = (poll.options || poll.pollOptions || []).map((opt, i) => 
                    opt.optionName || opt.text || `Opção ${i+1}`
                );
                text = `Enquete: ${pollName}\nOpções: ${options.join(', ')}`;
                extraInfo.pollName = pollName;
                extraInfo.pollOptions = options;
            }

            // Event (Evento)
            const event = actualMessage.eventMessage || actualMessage.eventCreationMessage || raw.eventMessage;
            if (event) {
                finalType = 'event';
                const eventName = event.name || event.eventName || 'Evento';
                const eventDesc = event.description || '';
                const eventTime = event.startTime ? new Date(event.startTime * 1000).toLocaleString('pt-BR') : '';
                text = `Evento: ${eventName}${eventTime ? ' - ' + eventTime : ''}${eventDesc ? ' - ' + eventDesc : ''}`;
                extraInfo.eventName = eventName;
                extraInfo.eventTime = eventTime;
                extraInfo.eventDescription = eventDesc;
            }

            // PIX / Payment
            const payment = actualMessage.requestPaymentMessage || actualMessage.paymentMessage || raw.requestPaymentMessage;
            if (payment) {
                finalType = 'payment';
                const amount = payment.amount1000 ? (payment.amount1000 / 1000).toFixed(2) : '';
                const currency = payment.currencyCode || 'BRL';
                const note = payment.note || '';
                text = `Pagamento PIX: R$ ${amount}${note ? ' - ' + note : ''}`;
                extraInfo.paymentAmount = amount;
                extraInfo.paymentCurrency = currency;
            }

            // Order (Pedido de catálogo)
            const order = actualMessage.orderMessage || raw.orderMessage;
            if (order) {
                finalType = 'order';
                const orderTitle = order.title || 'Pedido';
                const itemCount = order.itemCount || 0;
                text = `Pedido: ${orderTitle} (${itemCount} itens)`;
                extraInfo.orderTitle = orderTitle;
                extraInfo.orderItemCount = itemCount;
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

            if (!text) {
                text = actualMessage.conversation || actualMessage.text || raw.text || raw.body || raw.conversation || null;
            }
            // Se encontramos texto via fallback, promover tipo para text
            if (finalType === 'unknown' && text) {
                finalType = 'text';
            }

            if (!mediaUrl) {
                mediaUrl = actualMessage.mediaUrl || actualMessage.url || actualMessage.fileUrl || raw.mediaUrl || raw.url || raw.fileUrl || null;
            }
            if (!mediaMimeType) {
                mediaMimeType = actualMessage.mimetype || actualMessage.mimeType || raw.mediaMimeType || raw.mimeType || raw.mimetype || null;
            }

            // Extract filename following Task 1 guidelines
            let extractedFilename = null;
            const messageContentObj = actualMessage.content || raw.content || (raw.message && raw.message.content) || {};
            if (messageContentObj.fileName) extractedFilename = messageContentObj.fileName;
            else if (messageContentObj.title) extractedFilename = messageContentObj.title;
            else if (actualMessage.fileName) extractedFilename = actualMessage.fileName;
            else if (actualMessage.filename) extractedFilename = actualMessage.filename;
            else if (raw.fileName) extractedFilename = raw.fileName;
            else if (raw.filename) extractedFilename = raw.filename;
            else if (payload.chat && payload.chat.wa_lastMessageFileName) extractedFilename = payload.chat.wa_lastMessageFileName;

            if (extractedFilename) {
                mediaFilename = extractedFilename;
            } else if (finalType !== 'text' && finalType !== 'deleted' && finalType !== 'reaction' && finalType !== 'unknown') {
                let ext = 'bin';
                if (mediaMimeType) {
                    const m = String(mediaMimeType).toLowerCase();
                    if (m.includes('jpeg') || m.includes('jpg')) ext = 'jpg';
                    else if (m.includes('png')) ext = 'png';
                    else if (m.includes('gif')) ext = 'gif';
                    else if (m.includes('mp4')) ext = 'mp4';
                    else if (m.includes('ogg') || m.includes('opus')) ext = 'ogg';
                    else if (m.includes('mp3') || m.includes('mpeg')) ext = 'mp3';
                    else if (m.includes('pdf')) ext = 'pdf';
                    else if (m.includes('docx') || m.includes('word')) ext = 'docx';
                    else if (m.includes('xlsx') || m.includes('excel')) ext = 'xlsx';
                }
                mediaFilename = `${finalType}_${externalMessageId}.${ext}`;
            }

            // Extract caption following Task 2 guidelines
            let extractedCaption = null;
            if (messageContentObj.caption) extractedCaption = messageContentObj.caption;
            else if (actualMessage.caption) extractedCaption = actualMessage.caption;
            else if (raw.caption) extractedCaption = raw.caption;
            else if (actualMessage.text) extractedCaption = actualMessage.text;
            else if (raw.text) extractedCaption = raw.text;
            else if (actualMessage.body) extractedCaption = actualMessage.body;
            else if (messageContentObj.text) extractedCaption = messageContentObj.text;
            else if (messageContentObj.conversation) extractedCaption = messageContentObj.conversation;

            // Se for mensagem de mídia
            if (['image', 'audio', 'voice', 'video', 'document', 'sticker'].includes(finalType)) {
                if (extractedCaption && String(extractedCaption).trim() !== '') {
                    caption = String(extractedCaption).trim();
                    text = caption;
                } else {
                    caption = null;
                    if (finalType === 'image') text = '[imagem]';
                    else if (finalType === 'audio' || finalType === 'voice') text = '[áudio]';
                    else if (finalType === 'video') text = '[vídeo]';
                    else if (finalType === 'document') text = '[documento]';
                    else if (finalType === 'sticker') text = '[sticker]';
                    else text = '[mensagem]';
                }
            } else {
                caption = null;
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

        if (finalType === 'unknown') {
            // console.warn('[Webhook Debug] Tipo UNKNOWN. Chaves do actualMessage:', Object.keys(actualMessage || {}));
            // console.warn('[Webhook Debug] Chaves do raw:', Object.keys(raw || {}));
        }

        // console.log(`[Webhook Debug] Tipo identificado: ${finalType}, text: ${text ? text.substring(0, 50) : 'null'}, mediaUrl: ${mediaUrl ? 'sim' : 'nao'}, mediaMimeType: ${mediaMimeType || 'null'}`);

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
            thumbnailUrl,
            extraInfo,
            timestamp,
            rawMessage: raw
        });
    }

    return {
        eventType,
        messages,
        connectionStatus: null,
        rawPayload: sanitizeWebhookPayloadForStorage(payload)
    };
}

// ROTA Webhook Real: POST /api/webhooks/uazapi/:connectionId/:secret
app.post('/api/webhooks/uazapi/:connectionId/:secret', async (req, res) => {
    const { connectionId, secret } = req.params;
    const body = req.body;
    // console.log('[Webhook Debug] Body cru recebido:', JSON.stringify(body, null, 2).substring(0, 3000));
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
        const statusTypes = ["Read", "Delivered", "Sent", "Failed", "Played", "read", "delivered", "sent", "failed", "played"];
        
        // Determinar se é um evento estrito de FileDownloaded
        const isFileDownloaded = 
            body.type === "FileDownloadedMessage" ||
            body.event?.Type === "FileDownloaded" ||
            body.state === "FileDownloaded";

        const hasMessageIDs = body.event?.MessageIDs && Array.isArray(body.event.MessageIDs) && body.event.MessageIDs.length > 0;
        const isMediaDownloadEvent = isFileDownloaded && hasMessageIDs;

        // É status update se satisfizer condições explícitas de status
        const isStatusUpdate = 
            body.type === "ReadReceipt" ||
            (body.event?.Type && statusTypes.includes(body.event.Type)) ||
            (body.state && statusTypes.includes(body.state)) ||
            (body.EventType === "messages_update" && !isMediaDownloadEvent);

        if (isStatusUpdate) {
            let messageIdsToUpdate = [];
            if (body.event?.MessageIDs && Array.isArray(body.event.MessageIDs)) {
                messageIdsToUpdate = body.event.MessageIDs.map(id => cleanMarkdownLink(id)).filter(Boolean);
            } else if (body?.MessageIDs && Array.isArray(body.MessageIDs)) {
                messageIdsToUpdate = body.MessageIDs.map(id => cleanMarkdownLink(id)).filter(Boolean);
            } else if (body.event?.MessageID) {
                messageIdsToUpdate = [cleanMarkdownLink(body.event.MessageID)].filter(Boolean);
            } else {
                const singleId = body.messageId || body.id || body.msgId || body.key?.id || (body.data && (body.data.messageId || body.data.id || body.data.key?.id)) || null;
                if (singleId) {
                    messageIdsToUpdate = [cleanMarkdownLink(singleId)].filter(Boolean);
                }
            }

            console.log(`[Webhook Uazapi] ReadReceipt recebido para ${messageIdsToUpdate.length} mensagens.`);

            // Mapear status
            let rawStatus = body.event?.Type || body.state || body.type || body.status || body.ack || (body.data && (body.data.status || body.data.ack)) || 'sent';
            let currentStatus = 'sent';
            if (rawStatus) {
                const sStr = String(rawStatus).toLowerCase();
                if (sStr === '3' || sStr === 'read' || sStr === 'played' || sStr === 'readreceipt' || sStr === 'viewed') {
                    currentStatus = 'read';
                } else if (sStr === '2' || sStr === 'delivered') {
                    currentStatus = 'delivered';
                } else if (sStr === '1' || sStr === 'sent') {
                    currentStatus = 'sent';
                } else if (sStr === 'failed' || sStr === 'error') {
                    currentStatus = 'failed';
                }
            }

            let updatedCount = 0;
            for (const messageIdCode of messageIdsToUpdate) {
                // Busca e update exato
                const { data: updatedMsgs, error: updateErr } = await client
                    .from('crm_messages')
                    .update({ message_status: currentStatus })
                    .eq('connection_id', connection.id)
                    .eq('external_message_id', messageIdCode)
                    .select();

                if (updateErr) {
                    console.error(`[Webhook Uazapi] Erro ao atualizar status exato para ${messageIdCode}:`, updateErr);
                }

                if (updatedMsgs && updatedMsgs.length > 0) {
                    updatedCount += updatedMsgs.length;
                } else {
                    // Busca e update parcial (por sufixo)
                    const { data: suffixUpdated, error: suffixUpdateErr } = await client
                        .from('crm_messages')
                        .update({ message_status: currentStatus })
                        .eq('connection_id', connection.id)
                        .ilike('external_message_id', `%${messageIdCode}`)
                        .select();

                    if (suffixUpdateErr) {
                        console.error(`[Webhook Uazapi] Erro ao atualizar status parcial para ${messageIdCode}:`, suffixUpdateErr);
                    }
                    if (suffixUpdated && suffixUpdated.length > 0) {
                        updatedCount += suffixUpdated.length;
                    }
                }
            }

            if (webhookEventId) {
                await safeUpdate(client, 'crm_webhook_events', {
                    event_type: 'status_update',
                    normalized_payload: sanitizeWebhookPayloadForStorage(body),
                    processing_status: 'ignored',
                    processed_messages: 0,
                    error_message: "Evento de status/ack sem bolha de chat.",
                    updated_at: new Date()
                }, 'id', webhookEventId);
            }

            return res.json({
                ok: true,
                message: "Evento de status processado com sucesso. " + updatedCount + " mensagens atualizadas."
            });
        }
        
        // 3.5. Tratar eventos de mídia (FileDownloadedMessage / FileDownloaded)
        if (isMediaDownloadEvent) {
            const rawMessageId = body.event.MessageIDs[0];
            const messageId = rawMessageId ? cleanMarkdownLink(rawMessageId) : null;
            console.log(`[Webhook Uazapi] FileDownloadedMessage recebido para messageId: ${messageId}`);

            if (!messageId) {
                if (webhookEventId) {
                    await safeUpdate(client, 'crm_webhook_events', {
                        event_type: 'messages_update',
                        normalized_payload: sanitizeWebhookPayloadForStorage(body),
                        processing_status: 'ignored',
                        processed_messages: 0,
                        error_message: "Mídia baixada, mas MessageIDs inválido.",
                        updated_at: new Date()
                    }, 'id', webhookEventId);
                }
                return res.json({ ok: true, message: "MessageIDs inválido no evento de mídia." });
            }

            // Localizar a mensagem correspondente (exata ou parcial usando ilike)
            let targetMsg = null;
            const { data: exactMsg, error: exactErr } = await client
                .from('crm_messages')
                .select('*')
                .eq('connection_id', connection.id)
                .eq('external_message_id', messageId)
                .maybeSingle();

            if (exactErr) {
                console.error(`[Webhook Uazapi] Erro na busca exata de crm_messages para mídia:`, exactErr);
            }

            if (exactMsg) {
                targetMsg = exactMsg;
            } else {
                const { data: partialMsgs, error: partialErr } = await client
                    .from('crm_messages')
                    .select('*')
                    .eq('connection_id', connection.id)
                    .ilike('external_message_id', `%${messageId}`);
                
                if (partialErr) {
                    console.error(`[Webhook Uazapi] Erro na busca parcial de crm_messages para mídia:`, partialErr);
                }
                if (partialMsgs && partialMsgs.length > 0) {
                    targetMsg = partialMsgs[0];
                }
            }

            if (!targetMsg) {
                console.log(`[Webhook Uazapi] Mídia recebida, mas mensagem original ${messageId} não encontrada.`);
                if (webhookEventId) {
                    await safeUpdate(client, 'crm_webhook_events', {
                        event_type: 'messages_update',
                        normalized_payload: sanitizeWebhookPayloadForStorage(body),
                        processing_status: 'pending_media_match',
                        processed_messages: 0,
                        error_message: "Mídia baixada, mas mensagem original não encontrada.",
                        updated_at: new Date()
                    }, 'id', webhookEventId);
                }
                return res.json({ ok: true, message: "Mensagem original não encontrada para vincular mídia." });
            }

            // Tarefa 3 — Extrair FileURL antes da sanitização do original req.body
            const originalBody = req.body || {};
            const oEvent = originalBody.event || {};
            let fileUrl = oEvent.FileURL || oEvent.fileURL || oEvent.URL || oEvent.url || oEvent.downloadUrl || oEvent.mediaUrl || null;
            if (typeof fileUrl !== 'string' || (!fileUrl.startsWith('http://') && !fileUrl.startsWith('https://'))) {
                fileUrl = null;
            }

            let mimeType = oEvent.MimeType || oEvent.mimeType || oEvent.Mimetype || oEvent.mimetype || null;
            let base64Available = false;
            let storagePending = false;
            let encryptedUrlFound = null;

            if (isEncryptedUrl(fileUrl, oEvent)) {
                console.log(`[CRM Media] Detectada mídia criptografada WhatsApp. Baixando via Uazapi... Url: ${fileUrl}`);
                encryptedUrlFound = fileUrl;
                fileUrl = null;
            }

            let base64Data = null;
            let storageBucket = null;
            let storagePath = null;

            // Tarefa 4 e 5 — Fallbacks Uazapi
            if ((!fileUrl || encryptedUrlFound) && connection.instance_token) {
                try {
                    const apiBaseUrl = connection.api_base_url || originalBody.BaseUrl || 'https://task-ai.uazapi.com';
                    const downloadResult = await downloadUazapiMedia({
                        baseUrl: apiBaseUrl,
                        token: connection.instance_token,
                        messageId: messageId
                    });

                    if (downloadResult.fileUrl && !isEncryptedUrl(downloadResult.fileUrl)) {
                        fileUrl = downloadResult.fileUrl;
                    }
                    if (downloadResult.mimeType) {
                        mimeType = mimeType || downloadResult.mimeType;
                    }
                    if (downloadResult.base64) {
                        base64Data = downloadResult.base64;
                        base64Available = true;
                        storagePending = true;
                    }
                } catch (fallbackErr) {
                    console.error(`[Webhook Uazapi] Erro ao tentar fallback na Uazapi:`, fallbackErr.message || fallbackErr);
                }
            }

            // Subir base64 para Supabase se disponível
            if (base64Data) {
                const uploadResult = await uploadMediaToSupabaseStorage({
                    base64: base64Data,
                    userId: connection.user_id,
                    connectionId: connection.id,
                    conversationId: targetMsg.conversation_id,
                    messageId: messageId,
                    mimeType: mimeType
                });

                if (uploadResult) {
                    fileUrl = uploadResult.publicUrl;
                    storageBucket = uploadResult.storageBucket;
                    storagePath = uploadResult.storagePath;
                    storagePending = false;
                }
            }

            console.log(`[Webhook Uazapi] FileURL encontrada: ${fileUrl ? 'sim' : 'não'}, Base64: ${base64Data ? 'sim' : 'não'}, Saved to bucket: ${storageBucket ? 'sim' : 'não'}`);

            // Mapear tipo de mensagem com base no MimeType
            let updatedType = targetMsg.message_type || 'unknown';
            if (mimeType) {
                const mimeLower = String(mimeType).toLowerCase();
                if (mimeLower.startsWith('image/')) {
                    updatedType = 'image';
                } else if (mimeLower.startsWith('audio/')) {
                    updatedType = mimeLower.includes('ogg') ? 'voice' : 'audio';
                } else if (mimeLower.startsWith('video/')) {
                    updatedType = 'video';
                } else if (mimeLower.startsWith('application/') || mimeLower.startsWith('text/') || mimeLower.startsWith('doc') || mimeLower.includes('pdf') || mimeLower.includes('word') || mimeLower.includes('excel')) {
                    updatedType = 'document';
                }
            } else {
                if (targetMsg.message_type && targetMsg.message_type !== 'unknown' && targetMsg.message_type !== 'text') {
                    updatedType = targetMsg.message_type;
                }
            }

            // Atribuir texto mais específico conforme o placeholder correto
            let updatedText = targetMsg.message_text || '';
            if (!updatedText || updatedText === '[mensagem]' || updatedText === '[documento]' || updatedText === '[imagem]' || updatedText === '[áudio]' || updatedText === '[vídeo]' || updatedText === '[sticker]') {
                if (updatedType === 'image') updatedText = '[imagem]';
                else if (updatedType === 'audio') updatedText = '[áudio]';
                else if (updatedType === 'voice') updatedText = '[áudio]';
                else if (updatedType === 'video') updatedText = '[vídeo]';
                else if (updatedType === 'document') updatedText = '[documento]';
                else if (updatedType === 'sticker') updatedText = '[sticker]';
                else updatedText = '[mensagem]';
            }

            // Atribuir filename correto
            let filename = null;
            if (oEvent.content?.fileName) filename = oEvent.content.fileName;
            else if (oEvent.content?.title) filename = oEvent.content.title;
            else if (oEvent.fileName) filename = oEvent.fileName;
            else if (oEvent.filename) filename = oEvent.filename;
            else if (oEvent.Name) filename = oEvent.Name;
            else if (originalBody?.chat?.wa_lastMessageFileName) filename = originalBody.chat.wa_lastMessageFileName;

            if (!filename) {
                let ext = '.bin';
                if (mimeType) {
                    const m = String(mimeType).toLowerCase();
                    if (m.includes('jpeg') || m.includes('jpg')) ext = '.jpg';
                    else if (m.includes('png')) ext = '.png';
                    else if (m.includes('gif')) ext = '.gif';
                    else if (m.includes('mp4')) ext = '.mp4';
                    else if (m.includes('ogg')) ext = '.ogg';
                    else if (m.includes('mp3') || m.includes('mpeg')) ext = '.mp3';
                    else if (m.includes('pdf')) ext = '.pdf';
                    else if (m.includes('docx') || m.includes('word')) ext = '.docx';
                    else if (m.includes('xlsx') || m.includes('excel')) ext = '.xlsx';
                } else {
                    if (updatedType === 'image') ext = '.jpg';
                    else if (updatedType === 'video') ext = '.mp4';
                    else if (updatedType === 'audio' || updatedType === 'voice') ext = '.mp3';
                }
                filename = `${updatedType}_${messageId}${ext}`;
            }

            // Atualizar crm_messages
            const updateMsgFields = {
                media_url: fileUrl || targetMsg.media_url,
                media_mime_type: mimeType || targetMsg.media_mime_type,
                media_filename: filename || targetMsg.media_filename,
                message_type: updatedType,
                message_text: updatedText,
                updated_at: new Date()
            };

            const { error: updateMsgErr } = await safeUpdate(client, 'crm_messages', updateMsgFields, 'id', targetMsg.id);

            if (updateMsgErr) {
                console.error(`[Webhook Uazapi] Erro ao atualizar mídias na mensagem ${targetMsg.id}:`, updateMsgErr);
            } else {
                console.log(`[Webhook Uazapi] Mídia vinculada à mensagem ${targetMsg.id}`);
            }

            console.log(`[Webhook Uazapi] Front receberá UPDATE com media_url: ${fileUrl ? 'sim' : 'não'}`);

            // Atualizar a conversa correspondente se aplicável
            if (targetMsg.conversation_id) {
                await safeUpdate(client, 'crm_conversations', {
                    last_message_text: updatedText,
                    last_message_at: new Date(),
                    updated_at: new Date()
                }, 'id', targetMsg.conversation_id);
            }

            // Criar ou atualizar crm_message_attachments
            const { data: existingAttachment } = await client
                .from('crm_message_attachments')
                .select('id')
                .eq('message_id', targetMsg.id)
                .maybeSingle();

            let sizeBytes = null;
            if (oEvent.Size || oEvent.size || oEvent.fileLength) {
                sizeBytes = Number(oEvent.Size || oEvent.size || oEvent.fileLength) || null;
            }
            let durationSeconds = null;
            if (oEvent.duration || oEvent.seconds || oEvent.durationSeconds) {
                durationSeconds = Number(oEvent.duration || oEvent.seconds || oEvent.durationSeconds) || null;
            }

            let extraMetadata = sanitizeWebhookPayloadForStorage(oEvent || {});
            if (base64Available) {
                extraMetadata = {
                    ...extraMetadata,
                    base64Available: true,
                    storagePending: !storagePath
                };
            }
            if (!fileUrl) {
                extraMetadata = {
                    ...extraMetadata,
                    mediaUrlPending: true,
                    downloadAttempted: true,
                    encrypted_url: encryptedUrlFound
                };
            } else {
                extraMetadata = {
                    ...extraMetadata,
                    mediaUrlPending: false,
                    downloadResolved: true,
                    encrypted_url: encryptedUrlFound
                };
            }

            const attachmentData = {
                user_id: targetMsg.user_id,
                connection_id: targetMsg.connection_id,
                conversation_id: targetMsg.conversation_id,
                message_id: targetMsg.id,
                attachment_type: updatedType,
                source_url: fileUrl || null,
                storage_bucket: storageBucket || null,
                storage_path: storagePath || null,
                mime_type: mimeType || targetMsg.media_mime_type,
                filename: filename,
                size_bytes: sizeBytes,
                duration_seconds: durationSeconds,
                raw_metadata: extraMetadata,
                created_at: new Date()
            };

            if (existingAttachment) {
                const { error: updateAttachErr } = await safeUpdate(
                    client,
                    'crm_message_attachments',
                    attachmentData,
                    'id',
                    existingAttachment.id
                );

                if (updateAttachErr) {
                    console.error(`[Webhook Uazapi] Erro ao atualizar crm_message_attachments:`, updateAttachErr);
                } else {
                    console.log(`[Webhook Uazapi] Attachment atualizado para a mensagem ID: ${targetMsg.id}`);
                    console.log(`[Webhook Uazapi] Attachment atualizado/criado para messageId ${messageId}`);
                }
            } else {
                const { error: insertAttachErr } = await client
                    .from('crm_message_attachments')
                    .insert(attachmentData);

                if (insertAttachErr) {
                    console.error(`[Webhook Uazapi] Erro ao criar crm_message_attachments:`, insertAttachErr);
                } else {
                    console.log(`[Webhook Uazapi] Attachment criado para a mensagem ID: ${targetMsg.id}`);
                    console.log(`[Webhook Uazapi] Attachment atualizado/criado para messageId ${messageId}`);
                }
            }

            // Atualizar status do webhook_event (Tarefa 3)
            if (webhookEventId) {
                let statusMsg = null;
                let pStatus = "processed";
                let pCount = 1;
                
                if (updateMsgErr) {
                    pStatus = "error";
                    pCount = 0;
                    statusMsg = updateMsgErr.message || String(updateMsgErr);
                } else if (!fileUrl) {
                    statusMsg = "Mídia identificada, mas URL ainda indisponível.";
                    pStatus = "processed";
                }
                
                await safeUpdate(client, 'crm_webhook_events', {
                    event_type: 'messages_update',
                    normalized_payload: sanitizeWebhookPayloadForStorage(body),
                    processing_status: pStatus,
                    processed_messages: pCount,
                    error_message: statusMsg,
                    updated_at: new Date()
                }, 'id', webhookEventId);
            }

            return res.json({
                ok: true,
                message: fileUrl ? "Mídia vinculada com sucesso à mensagem existente." : "Mídia vinculada com sucesso, mas URL está pendente."
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
            
            const { error: updateError } = await safeUpdate(client, 'crm_connections', updateData, 'id', connectionId);
                
            if (updateError) {
                console.error(`[Webhook Uazapi] Erro ao atualizar status na conexão:`, updateError);
            }
            
            if (webhookEventId) {
                await safeUpdate(client, 'crm_webhook_events', {
                    event_type: normalized.eventType,
                    normalized_payload: sanitizeWebhookPayloadForStorage(normalized),
                    processing_status: 'ignored',
                    processed_messages: 0,
                    error_message: "Evento de conexão/status.",
                    updated_at: new Date()
                }, 'id', webhookEventId);
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
                await safeUpdate(client, 'crm_webhook_events', {
                    event_type: normalized.eventType,
                    normalized_payload: sanitizeWebhookPayloadForStorage(normalized),
                    processing_status: 'ignored',
                    processed_messages: 0,
                    error_message: "Atualização de mensagem sem conteúdo exibível.",
                    updated_at: new Date()
                }, 'id', webhookEventId);
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
                    const { error: updateContactErr } = await safeUpdate(client, 'crm_contacts', updateContactData, 'id', contactId);
                        
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
                
                // --- CRM Sync: Sincronizar nome do lead com pushName se atualizado ---
                if (pushName && pushName.trim() && externalChatId) {
                    try {
                        const { data: leadToSync } = await client.from('leads')
                            .select('id, name')
                            .eq('external_chat_id', externalChatId)
                            .maybeSingle();
                        
                        if (leadToSync && leadToSync.name !== pushName.trim()) {
                            await client.from('leads')
                                .update({ 
                                    name: pushName.trim(),
                                    last_interaction: new Date().toISOString()
                                })
                                .eq('id', leadToSync.id);
                            console.log(`[CRM Sync] Lead ${leadToSync.id} nome atualizado: "${leadToSync.name}" → "${pushName.trim()}"`);
                        }
                    } catch (syncErr) {
                        console.error(`[CRM Sync] Erro ao sincronizar nome do lead com pushName:`, syncErr);
                    }
                }
                
                // --- FLUXO 2: leads (CRM) (DEFENSIVO) ---
                let leadId = null;
                let existingLead = null;
                
                const normalizedWebhookPhone = phone ? (normalizePhoneE164(phone) || phone) : phone;
                
                try {
                    // Função helper pra normalizar telefone (remover +, espaços, traços, e DDI 55)
                    const normalizePhone = (p) => {
                        if (!p) return '';
                        let cleaned = String(p).replace(/\D/g, '');
                        if (cleaned.startsWith('55') && cleaned.length > 11) {
                            cleaned = cleaned.substring(2);
                        }
                        return cleaned;
                    };

                    const searchPhone = phone || normalizedWebhookPhone || '';
                    const normalizedIncomingPhone = normalizePhone(searchPhone);

                    if (normalizedIncomingPhone) {
                        // Antes de criar lead novo, buscar por telefone normalizado ou external_chat_id
                        const { data: foundLeads, error: findErr } = await client
                            .from('leads')
                            .select('*')
                            .eq('user_id', connection.user_id)
                            .or(`phone.ilike.%${normalizedIncomingPhone}%,external_chat_id.ilike.%${normalizedIncomingPhone}%`);

                        if (!findErr && foundLeads && foundLeads.length > 0) {
                            existingLead = foundLeads[0];
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
                
                const msgTypeStr = messageType || 'text';
                let messageSummary = text || caption || '';
                if (!messageSummary) {
                    const msgTypeLower = String(msgTypeStr || messageType || '').toLowerCase();
                    if (msgTypeLower.includes('image')) messageSummary = '[imagem]';
                    else if (msgTypeLower.includes('audio') || msgTypeLower.includes('voice')) messageSummary = '[áudio]';
                    else if (msgTypeLower.includes('video')) messageSummary = '[vídeo]';
                    else if (msgTypeLower.includes('document')) messageSummary = '[documento]';
                    else if (msgTypeLower.includes('sticker')) messageSummary = '[figurinha]';
                    else if (mediaUrl) messageSummary = '[mídia]';
                    else messageSummary = '[mensagem]';
                }
                const interactionTime = timestamp || new Date();
                
                if (existingLead) {
                    leadId = existingLead.id;
                    try {
                        const targetLeadName = (pushName && pushName.trim()) ? pushName.trim() : (existingLead.name || normalizedWebhookPhone || externalChatId || 'Lead WhatsApp');
                        const updateLeadData = {
                            name: targetLeadName,
                            phone: normalizedWebhookPhone || existingLead.phone,
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
                                    name: targetLeadName
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
                            name: pushName || normalizedWebhookPhone || externalChatId || 'Lead WhatsApp',
                            phone: normalizedWebhookPhone || '',
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
                                name: pushName || normalizedWebhookPhone || externalChatId || 'Lead WhatsApp',
                                phone: normalizedWebhookPhone || '',
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
                        
                        const { error: updateConvErr } = await safeUpdate(client, 'crm_conversations', updateConvData, 'id', conversationId);
                            
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
                    
                    const { error: updateMsgErr } = await safeUpdate(client, 'crm_messages', updateMsgData, 'id', existingMsg.id);
                        
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

                    let encryptedUrlFound = null;
                    let initialMediaUrl = mediaUrl || null;
                    if (isEncryptedUrl(initialMediaUrl, extraInfo)) {
                        console.log(`[CRM Media] URL criptografada detectada no recebimento de mensagens: ${initialMediaUrl}`);
                        encryptedUrlFound = initialMediaUrl;
                        initialMediaUrl = null;
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
                        media_url: initialMediaUrl,
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

                        let encryptedUrlFound = null;
                        let initialMediaUrl = mediaUrl || null;
                        if (isEncryptedUrl(initialMediaUrl, extraInfo)) {
                            encryptedUrlFound = initialMediaUrl;
                            initialMediaUrl = null;
                        }

                        const initialMeta = {
                            ...(extraInfo || {}),
                            mediaUrlPending: (messageType !== 'location' && messageType !== 'contact') && !initialMediaUrl,
                            encrypted_url: encryptedUrlFound
                        };

                        const attachmentData = {
                            user_id: connection.user_id,
                            connection_id: connection.id,
                            conversation_id: conversationId,
                            message_id: actualSavedMsgId,
                            attachment_type: messageType || 'unknown',
                            source_url: initialMediaUrl,
                            storage_bucket: null,
                            storage_path: null,
                            mime_type: mediaMimeType || null,
                            filename: mediaFilename || null,
                            size_bytes: finalSizeBytes,
                            duration_seconds: finalDuration,
                            width: extraInfo?.width || null,
                            height: extraInfo?.height || null,
                            thumbnail_url: thumbnailUrl || null,
                            raw_metadata: initialMeta,
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

                        // Chamar downloadUazapiMedia em background controlado se for mídia criptografada ou pendente
                        if ((messageType !== 'location' && messageType !== 'contact') && (!initialMediaUrl || encryptedUrlFound) && connection.instance_token) {
                            // Executa em background (não bloqueia resposta do webhook)
                            (async () => {
                                try {
                                    console.log(`[CRM Media] [Background] Iniciando download para mensagem ID ${actualSavedMsgId} (externo: ${finalExternalMessageId})`);
                                    const apiBaseUrl = connection.api_base_url || originalBody.BaseUrl || 'https://task-ai.uazapi.com';
                                    const downloadResult = await downloadUazapiMedia({
                                        baseUrl: apiBaseUrl,
                                        token: connection.instance_token,
                                        messageId: finalExternalMessageId
                                    });

                                    let finalUrl = downloadResult.fileUrl;
                                    let storageBucket = null;
                                    let storagePath = null;

                                    if (downloadResult.base64) {
                                        const uploadResult = await uploadMediaToSupabaseStorage({
                                            base64: downloadResult.base64,
                                            userId: connection.user_id,
                                            connectionId: connection.id,
                                            conversationId: conversationId,
                                            messageId: finalExternalMessageId,
                                            mimeType: downloadResult.mimeType || mediaMimeType
                                        });
                                        if (uploadResult) {
                                            finalUrl = uploadResult.publicUrl;
                                            storageBucket = uploadResult.storageBucket;
                                            storagePath = uploadResult.storagePath;
                                        }
                                    }

                                    if (finalUrl && !isEncryptedUrl(finalUrl)) {
                                        // 1. Atualizar crm_messages
                                        await safeUpdate(client, 'crm_messages', {
                                            media_url: finalUrl,
                                            media_mime_type: downloadResult.mimeType || mediaMimeType,
                                            updated_at: new Date()
                                        }, 'id', actualSavedMsgId);

                                        // 2. Atualizar crm_message_attachments
                                        const extraMeta = {
                                            ...(extraInfo || {}),
                                            mediaUrlPending: false,
                                            downloadResolved: true,
                                            encrypted_url: encryptedUrlFound
                                        };

                                        await safeUpdate(client, 'crm_message_attachments', {
                                            source_url: finalUrl,
                                            storage_bucket: storageBucket,
                                            storage_path: storagePath,
                                            mime_type: downloadResult.mimeType || mediaMimeType,
                                            raw_metadata: extraMeta
                                        }, 'message_id', actualSavedMsgId);

                                        console.log(`[CRM Media] [Background] Mídia de mensagem ID ${actualSavedMsgId} resolvida com sucesso! URL: ${finalUrl}`);
                                    } else {
                                        console.log(`[CRM Media] [Background] Mídia de mensagem ID ${actualSavedMsgId} não pôde ser resolvida.`);
                                    }
                                } catch (bgErr) {
                                    console.error(`[CRM Media] [Background] Erro ao resolver mídia da mensagem ${actualSavedMsgId}:`, bgErr);
                                }
                            })();
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
            
            await safeUpdate(client, 'crm_webhook_events', updatePayload, 'id', webhookEventId);
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
                await safeUpdate(client, 'crm_webhook_events', {
                    processing_status: 'error',
                    error_message: err.message || String(err),
                    updated_at: new Date()
                }, 'id', webhookEventId);
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

// Rotas Proxy do Gemini (Migradas do Frontend)

app.post('/api/gemini/insights', async (req, res) => {
    try {
        if (!aiClient) return res.status(500).json({ error: "Gemini não configurado." });
        const { data } = req.body;
        const prompt = `Analise os seguintes dados de uma clínica médica e forneça um diagnóstico estratégico curto (3-4 frases). O médico não quer dados, ele quer saber onde está perdendo dinheiro e o que fazer. Seja direto, autoritário mas parceiro. Use português do Brasil.\n\nDADOS:\n${JSON.stringify(data)}`;
        
        const response = await aiClient.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                systemInstruction: "Você é um consultor sênior de gestão para médicos. Seu foco é lucro real e eficiência operacional."
            }
        });
        res.json({ text: response.text });
    } catch (error) {
        console.error("Erro /api/gemini/insights:", error);
        res.status(500).json({ error: "Erro ao gerar insights." });
    }
});

app.post('/api/gemini/analyze-lead', async (req, res) => {
    try {
        if (!aiClient) return res.status(500).json({ error: "Gemini não configurado." });
        const { name, history } = req.body;
        const prompt = `Analise a conversa de WhatsApp com o lead "${name}".\nHistórico: "${history}"\n\nResponda em 3 tópicos curtos:\n1. Humor/Temperatura (Frio, Morno, Quente).\n2. Principal Objeção (se houver).\n3. Próximo Passo sugerido para fechar a venda.\nSeja extremamente conciso.`;
        
        const response = await aiClient.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                systemInstruction: "Você é um especialista em vendas médicas e análise de CRM. Sua função é ajudar a secretária a converter o lead em agendamento."
            }
        });
        res.json({ text: response.text });
    } catch (error) {
        console.error("Erro /api/gemini/analyze-lead:", error);
        res.status(500).json({ error: "Erro ao analisar lead." });
    }
});

app.post('/api/gemini/soap', async (req, res) => {
    try {
        if (!aiClient) return res.status(500).json({ error: "Gemini não configurado." });
        const { transcript } = req.body;
        const prompt = `Aja como um médico especialista experiente.\nAnalise a transcrição abaixo de uma consulta médica (ou simulação) e gere um registro médico no formato SOAP (Subjetivo, Objetivo, Avaliação, Plano).\n\nTRANSCRIÇÃO:\n"${transcript}"\n\nRetorne APENAS um JSON válido no seguinte formato, sem formatação markdown:\n{\n  "s": "Texto do Subjetivo...",\n  "o": "Texto do Objetivo...",\n  "a": "Texto da Avaliação...",\n  "p": "Texto do Plano..."\n}`;
        
        const response = await aiClient.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                responseMimeType: "application/json"
            }
        });
        const text = response.text || "{}";
        res.json(JSON.parse(text));
    } catch (error) {
        console.error("Erro /api/gemini/soap:", error);
        res.status(500).json({ error: "Erro ao gerar SOAP." });
    }
});

app.post('/api/gemini/tts', async (req, res) => {
    try {
        if (!aiClient) return res.json({ audio: null, fallback: true });
        const { text } = req.body;
        
        try {
            const response = await aiClient.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: `Diga de forma profissional e encorajadora: ${text}` }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Kore' },
                        },
                    },
                },
            });
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            res.json({ audio: base64Audio || null, fallback: !base64Audio });
        } catch (innerError) {
            console.error("Erro interno ao chamar modelo Gemini TTS:", innerError);
            res.json({ audio: null, fallback: true });
        }
    } catch (error) {
        console.error("Erro /api/gemini/tts:", error);
        // Retornar audio null em vez de erro 500 — frontend usa speechSynthesis nativo como fallback
        res.json({ audio: null, fallback: true });
    }
});

// ==============================================================================
// MERCADO LIVRE INTEGRATION (OAuth 2.0 & Webhooks)
// ==============================================================================

const ML_APP_ID = process.env.ML_APP_ID;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const ML_REDIRECT_URI = process.env.ML_REDIRECT_URI || 'https://axis-ai-1s3m.onrender.com/api/auth/ml/callback';

const mlRefreshLocks = new Map();

async function refreshMlToken(userId) {
    if (mlRefreshLocks.has(userId)) {
        return mlRefreshLocks.get(userId);
    }
    
    const promise = (async () => {
        const client = supabaseAdmin || supabase;
        const { data: conn } = await client.from('ml_connections')
            .select('refresh_token, ml_user_id')
            .eq('user_id', userId)
            .maybeSingle();
        
        if (!conn || !conn.refresh_token) throw new Error('Sem refresh_token');

        const oldRefreshToken = conn.refresh_token;
        const appId = ML_APP_ID || process.env.ML_APP_ID;
        const clientSecret = ML_CLIENT_SECRET || process.env.ML_CLIENT_SECRET;
        
        const response = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                client_id: appId,
                client_secret: clientSecret,
                refresh_token: oldRefreshToken
            })
        });
        
        const data = await response.json();
        
        if (!data.access_token) {
            throw new Error('Erro no refresh ML: ' + JSON.stringify(data));
        }
        
        const expiresAt = Date.now() + (data.expires_in * 1000);
        const newRefreshToken = data.refresh_token || oldRefreshToken;
        
        // Gravação atômica filtrada pelo refresh_token antigo
        const { data: updated, error: updateErr } = await client.from('ml_connections')
            .update({
                access_token: data.access_token,
                refresh_token: newRefreshToken,
                token_expires_at: new Date(expiresAt).toISOString(),
                last_refreshed_at: new Date().toISOString(),
                status: 'active',
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .eq('refresh_token', oldRefreshToken)
            .select('access_token');
        
        if (updateErr) {
            console.error('[ML Refresh] Erro ao atualizar ml_connections:', updateErr);
        }

        // Se a atualização atômica afetou 0 linhas (outra instância renovou em paralelo)
        if (!updated || updated.length === 0) {
            const { data: freshConn } = await client.from('ml_connections')
                .select('access_token')
                .eq('user_id', userId)
                .maybeSingle();
            if (freshConn && freshConn.access_token) {
                return freshConn.access_token;
            }
        }
        
        return data.access_token;
    })();
    
    mlRefreshLocks.set(userId, promise);
    try {
        return await promise;
    } finally {
        mlRefreshLocks.delete(userId);
    }
}

async function getValidMlToken(userId) {
    const client = supabaseAdmin || supabase;
    const { data: conn } = await client.from('ml_connections')
        .select('access_token, token_expires_at')
        .eq('user_id', userId)
        .maybeSingle();
    
    if (!conn || !conn.access_token) throw new Error('Mercado Livre não conectado');
    
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;
    
    if (conn.token_expires_at) {
        const expiresTime = new Date(conn.token_expires_at).getTime();
        if (expiresTime < now + tenMinutes) {
            return await refreshMlToken(userId);
        }
    }
    
    return conn.access_token;
}

// 1) GET /api/auth/ml (OAuth URL protegida)
app.get('/api/auth/ml', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
        
        const state = `ml-oauth-${authUser.id}`;
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: ML_APP_ID,
            redirect_uri: ML_REDIRECT_URI,
            state: state
        });
        
        const url = `https://auth.mercadolivre.com.br/authorization?${params.toString()}`;
        res.json({ ok: true, authUrl: url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2) GET /api/auth/ml/url (OAuth URL simples)
app.get('/api/auth/ml/url', (req, res) => {
    try {
        const { user_id } = req.query;
        if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
        
        const state = `ml-oauth-${user_id}`;
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: ML_APP_ID,
            redirect_uri: ML_REDIRECT_URI,
            state: state
        });
        
        const url = `https://auth.mercadolivre.com.br/authorization?${params.toString()}`;
        res.json({ ok: true, url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3) GET /api/auth/ml/callback (OAuth Callback)
app.get('/api/auth/ml/callback', async (req, res) => {
    try {
        const { code, state } = req.query;
        
        if (!code) return res.status(400).send('Código de autorização não recebido');
        
        const userId = state?.replace('ml-oauth-', '');
        if (!userId) return res.status(400).send('State inválido');
        
        const tokenResponse = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: ML_APP_ID,
                client_secret: ML_CLIENT_SECRET,
                code: code,
                redirect_uri: ML_REDIRECT_URI
            })
        });
        
        const tokenData = await tokenResponse.json();
        
        if (!tokenData.access_token) {
            throw new Error('Erro ao obter token: ' + JSON.stringify(tokenData));
        }
        
        const userResponse = await fetch('https://api.mercadolibre.com/users/me', {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        });
        const userData = await userResponse.json();
        
        const client = supabaseAdmin || supabase;
        const expiresAt = Date.now() + (tokenData.expires_in * 1000);
        
        await client.from('ml_connections')
            .upsert({
                user_id: userId,
                ml_user_id: String(userData.id),
                ml_nickname: userData.nickname,
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                token_expires_at: new Date(expiresAt).toISOString(),
                status: 'active',
                scopes: tokenData.scope ? tokenData.scope.split(' ') : [],
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
        
        res.redirect('/?ml_connected=true');
    } catch (error) {
        console.error('Erro no callback ML:', error);
        res.redirect('/?ml_error=' + encodeURIComponent(error.message));
    }
});

// 4) POST /api/auth/ml/refresh (OAuth Refresh)
app.post('/api/auth/ml/refresh', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
        
        await getValidMlToken(authUser.id);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4.1) POST /api/ml/refresh-all (Cron/Bulk Refresh para conexões prestes a expirar)
app.post('/api/ml/refresh-all', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        const authHeader = req.headers['authorization'];
        const isSecretAuth = authHeader && (
            authHeader === `Bearer ${process.env.ML_CLIENT_SECRET}` ||
            authHeader === `Bearer ${ML_CLIENT_SECRET}`
        );

        if (!authUser && !isSecretAuth) {
            return res.status(401).json({ error: 'Não autorizado' });
        }

        const client = supabaseAdmin || supabase;
        const { data: connections, error } = await client.from('ml_connections')
            .select('user_id, ml_user_id, token_expires_at')
            .eq('status', 'active');

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        let refreshedCount = 0;
        let errorCount = 0;
        const details = [];
        const nowMs = Date.now();
        const tenMinutesMs = 10 * 60 * 1000;

        for (const conn of (connections || [])) {
            const expiresTime = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
            if (!expiresTime || expiresTime < nowMs + tenMinutesMs) {
                try {
                    await refreshMlToken(conn.user_id);
                    refreshedCount++;
                    details.push({ user_id: conn.user_id, ml_user_id: conn.ml_user_id, status: 'success' });
                } catch (refreshErr) {
                    errorCount++;
                    details.push({ user_id: conn.user_id, ml_user_id: conn.ml_user_id, status: 'error', error: refreshErr.message });
                }
            }
        }

        console.log(`[ML Refresh All] Renovados: ${refreshedCount}, Erros: ${errorCount}`);
        res.json({ refreshed: refreshedCount, errors: errorCount, details });
    } catch (err) {
        console.error('[ML Refresh All Exception]:', err);
        res.status(500).json({ error: err.message });
    }
});

// 5) GET /api/ml/status e GET /api/ml/status/:userId (Conexão status)
app.get('/api/ml/status', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
        
        const client = supabaseAdmin || supabase;
        const { data: conn } = await client.from('ml_connections')
            .select('ml_user_id, ml_nickname, status, token_expires_at')
            .eq('user_id', authUser.id)
            .maybeSingle();
        
        if (!conn) return res.json({ connected: false });
        
        const now = Date.now();
        let status = conn.status;
        if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() < now) {
            status = 'expired';
            await client.from('ml_connections').update({ status: 'expired' }).eq('user_id', authUser.id);
        }
        
        res.json({
            connected: status === 'active',
            nickname: conn.ml_nickname,
            mlUserId: conn.ml_user_id,
            status: status,
            token_expires_at: conn.token_expires_at
        });
    } catch (err) {
        res.json({ connected: false, error: err.message });
    }
});

app.get('/api/ml/status/:userId', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
        
        const client = supabaseAdmin || supabase;
        const { data: conn } = await client.from('ml_connections')
            .select('ml_user_id, ml_nickname, status, token_expires_at')
            .eq('user_id', authUser.id)
            .maybeSingle();
        
        if (!conn) return res.json({ connected: false });
        
        const now = Date.now();
        let status = conn.status;
        if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() < now) {
            status = 'expired';
            await client.from('ml_connections').update({ status: 'expired' }).eq('user_id', authUser.id);
        }
        
        res.json({
            connected: status === 'active',
            nickname: conn.ml_nickname,
            mlUserId: conn.ml_user_id,
            status: status,
            token_expires_at: conn.token_expires_at
        });
    } catch (err) {
        res.json({ connected: false, error: err.message });
    }
});

// 6) POST /api/ml/disconnect (Desconectar)
app.post('/api/ml/disconnect', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
        
        const client = supabaseAdmin || supabase;
        
        const { data: conn } = await client.from('ml_connections')
            .select('access_token')
            .eq('user_id', authUser.id)
            .maybeSingle();
            
        if (conn && conn.access_token) {
            try {
                await fetch('https://api.mercadolibre.com/oauth/revoke', {
                    method: 'POST',
                    body: new URLSearchParams({
                        token: conn.access_token
                    })
                });
            } catch (revokeErr) {
                console.error('Erro ao revogar token ML:', revokeErr);
            }
        }
        
        await client.from('ml_connections')
            .delete()
            .eq('user_id', authUser.id);
        
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6.1) GET /api/ml/orders (Listar pedidos sincronizados do Mercado Livre)
app.get('/api/ml/orders', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const client = supabaseAdmin || supabase;
        const { status, limit: limitQuery, offset: offsetQuery, date_from, date_to } = req.query;

        const limit = Math.min(Math.max(parseInt(String(limitQuery || '50'), 10) || 50, 1), 100);
        const offset = Math.max(parseInt(String(offsetQuery || '0'), 10) || 0, 0);

        const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const defaultTo = new Date().toISOString();

        let query = client.from('ml_orders')
            .select('*, raw', { count: 'exact' })
            .eq('user_id', authUser.id);

        if (date_from) {
            query = query.gte('date_created', date_from);
        }
        if (date_to) {
            query = query.lte('date_created', date_to);
        }

        if (status) {
            query = query.eq('status', String(status));
        }

        query = query
            .order('date_created', { ascending: false, nullsFirst: false })
            .range(offset, offset + limit - 1);

        const { data: orders, count, error } = await query;

        if (error) {
            console.error('[ML Orders API Error]:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({
            orders: orders || [],
            total: count || 0,
            limit,
            offset
        });
    } catch (err) {
        console.error('[ML Orders Exception]:', err);
        return res.status(500).json({ error: err.message });
    }
});

// 6.2) GET /api/ml/questions (Listar perguntas sincronizadas do Mercado Livre)
app.get('/api/ml/questions', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const client = supabaseAdmin || supabase;
        const { status, limit: limitQuery, offset: offsetQuery } = req.query;

        const limit = Math.min(Math.max(parseInt(String(limitQuery || '50'), 10) || 50, 1), 100);
        const offset = Math.max(parseInt(String(offsetQuery || '0'), 10) || 0, 0);

        let query = client.from('ml_questions')
            .select('id, ml_question_id, item_id, buyer_nickname, question_text, answer_text, status, date_created, date_answered', { count: 'exact' })
            .eq('user_id', authUser.id);

        if (status) {
            query = query.ilike('status', String(status));
        }

        query = query
            .order('date_created', { ascending: false, nullsFirst: false })
            .range(offset, offset + limit - 1);

        const { data: questions, count, error } = await query;

        if (error) {
            console.error('[ML Questions API Error]:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({
            questions: questions || [],
            total: count || 0,
            limit,
            offset
        });
    } catch (err) {
        console.error('[ML Questions Exception]:', err);
        return res.status(500).json({ error: err.message });
    }
});

// 6.2b) POST /api/ml/questions/:id/answer (Responder pergunta no Mercado Livre e atualizar banco)
app.post('/api/ml/questions/:id/answer', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const { id } = req.params;
        const { text } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Texto da resposta é obrigatório' });
        }

        const token = await getValidMlToken(authUser.id);
        if (!token) {
            return res.status(400).json({ error: 'Conta Mercado Livre não conectada ou token expirado' });
        }

        const client = supabaseAdmin || supabase;

        // Buscar ml_question_id da pergunta no banco
        let { data: question } = await client.from('ml_questions')
            .select('id, ml_question_id')
            .eq('id', id)
            .eq('user_id', authUser.id)
            .maybeSingle();

        if (!question?.ml_question_id) {
            const { data: qAlt } = await client.from('ml_questions')
                .select('id, ml_question_id')
                .eq('ml_question_id', id)
                .eq('user_id', authUser.id)
                .maybeSingle();
            if (!qAlt?.ml_question_id) {
                return res.status(404).json({ error: 'Pergunta não encontrada' });
            }
            question = qAlt;
        }

        // Chamar API ML: POST /answers
        const answerRes = await fetch('https://api.mercadolibre.com/answers', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                question_id: Number(question.ml_question_id) || String(question.ml_question_id),
                text: text.trim()
            })
        });

        if (!answerRes.ok) {
            const errText = await answerRes.text();
            console.error('[ML Answer API Error]:', answerRes.status, errText);
            return res.status(answerRes.status).json({ error: `Erro ML: ${errText}` });
        }

        const answerData = await answerRes.json();

        // Atualizar no banco
        await client.from('ml_questions')
            .update({
                answer_text: text.trim(),
                status: 'answered',
                date_answered: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('user_id', authUser.id)
            .or(`id.eq.${id},ml_question_id.eq.${id}`);

        return res.json({ ok: true, answer: answerData });
    } catch (err) {
        console.error('[ML Answer] Erro:', err);
        return res.status(500).json({ error: err.message });
    }
});

// 6.3) GET /api/ml/messages (Listar mensagens de conversas/packs sincronizados do Mercado Livre)
app.get('/api/ml/messages', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const client = supabaseAdmin || supabase;
        const { pack_id, limit: limitQuery, offset: offsetQuery } = req.query;

        const limit = Math.min(Math.max(parseInt(String(limitQuery || '50'), 10) || 50, 1), 100);
        const offset = Math.max(parseInt(String(offsetQuery || '0'), 10) || 0, 0);

        let query = client.from('ml_messages')
            .select('id, message_uuid, pack_id, from_name, from_role, text, status, has_attachments, message_created_at', { count: 'exact' })
            .eq('user_id', authUser.id);

        if (pack_id) {
            query = query.eq('pack_id', Number(pack_id));
        }

        query = query
            .order('message_created_at', { ascending: true })
            .range(offset, offset + limit - 1);

        const { data: messages, count, error } = await query;

        if (error) {
            console.error('[ML Messages API Error]:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({
            messages: messages || [],
            pack_id: pack_id ? Number(pack_id) : null,
            total: count || 0,
            limit,
            offset
        });
    } catch (err) {
        console.error('[ML Messages Exception]:', err);
        return res.status(500).json({ error: err.message });
    }
});

// 6.3b) GET /api/ml/items (Listar anúncios do Mercado Livre com filtro de tipo)
app.get('/api/ml/items', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const client = supabaseAdmin || supabase;
        const { status, limit: limitQuery, offset: offsetQuery, search, type } = req.query;

        const limit = Math.min(Math.max(parseInt(String(limitQuery || '50'), 10) || 50, 1), 100);
        const offset = Math.max(parseInt(String(offsetQuery || '0'), 10) || 0, 0);

        let query = client.from('ml_items')
            .select('*', { count: 'exact' })
            .eq('user_id', authUser.id);

        if (status) {
            query = query.ilike('status', String(status));
        }

        if (type === 'sponsored') {
            query = query.eq('is_sponsored', true);
        } else if (type === 'organic') {
            query = query.eq('is_sponsored', false);
        } else if (type === 'catalog') {
            query = query.eq('catalog_listing', true);
        }

        if (search) {
            query = query.or(`title.ilike.%${search}%,seller_sku.ilike.%${search}%,item_id.ilike.%${search}%`);
        }

        query = query
            .order('updated_at', { ascending: false, nullsFirst: false })
            .range(offset, offset + limit - 1);

        const { data: items, count, error } = await query;

        if (error) {
            console.error('[ML Items API Error]:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({
            items: items || [],
            total: count || 0,
            limit,
            offset
        });
    } catch (err) {
        console.error('[ML Items Exception]:', err);
        return res.status(500).json({ error: err.message });
    }
});

// 6.3c) POST /api/ml/items/sync (Backfill completo de anúncios do Mercado Livre)
app.post('/api/ml/items/sync', async (req, res) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
    
    const client = supabaseAdmin || supabase;
    
    // 1. Buscar ml_user_id do usuário
    const { data: conn } = await client.from('ml_connections')
      .select('ml_user_id')
      .eq('user_id', authUser.id)
      .maybeSingle();
    
    if (!conn?.ml_user_id) {
      return res.status(400).json({ error: 'Mercado Livre não conectado' });
    }
    
    const sellerId = conn.ml_user_id;
    const token = await getValidMlToken(authUser.id);
    
    // 2. Buscar TODOS os item_ids via paginação
    const statusParam = req.query.status || req.body?.status;
    const statusQuery = statusParam ? `&status=${statusParam}` : '';

    const allItemIds = [];
    let offset = 0;
    const limit = 50;
    let hasMore = true;
    
    while (hasMore) {
      const searchUrl = `https://api.mercadolibre.com/users/${sellerId}/items/search?limit=${limit}&offset=${offset}${statusQuery}`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!searchRes.ok) {
        throw new Error(`Erro search (${searchRes.status}): ${await searchRes.text()}`);
      }
      
      const searchData = await searchRes.json();
      const results = searchData.results || [];
      allItemIds.push(...results);
      
      const total = searchData.paging?.total || 0;
      if (allItemIds.length >= total || offset + limit >= 10000 || results.length === 0) {
        hasMore = false;
      } else {
        offset += limit;
      }
      
      // Rate limit: aguardar 200ms entre páginas
      await new Promise(r => setTimeout(r, 200));
    }
    
    // 3. Para cada item_id, buscar detalhes + upsert em ml_items
    let synced = 0;
    let errors = 0;
    const batchSize = 10;
    
    for (let i = 0; i < allItemIds.length; i += batchSize) {
      const batch = allItemIds.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (itemId) => {
        try {
          const itemRes = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (!itemRes.ok) {
            errors++;
            return;
          }
          
          const itemData = await itemRes.json();
          const tags = Array.isArray(itemData.tags) ? itemData.tags : [];
          const sku = itemData.seller_custom_field || itemData.attributes?.find(a => a.id === 'SELLER_SKU')?.value_name || '';
          
          await client.from('ml_items').upsert({
            user_id: authUser.id,
            ml_user_id: Number(sellerId),
            item_id: String(itemData.id),
            title: itemData.title || '',
            category_id: itemData.category_id || '',
            price: itemData.price || 0,
            currency_id: itemData.currency_id || 'BRL',
            available_quantity: itemData.available_quantity || 0,
            sold_quantity: itemData.sold_quantity || 0,
            condition: itemData.condition || '',
            listing_type_id: itemData.listing_type_id || '',
            status: itemData.status || '',
            permalink: itemData.permalink || '',
            thumbnail: itemData.thumbnail || '',
            seller_sku: sku,
            variation_id: itemData.variations?.[0]?.id ? String(itemData.variations[0].id) : null,
            catalog_listing: itemData.catalog_listing === true,
            is_sponsored: tags.includes('paid_listing'),
            tags: tags,
            raw_payload: itemData,
            last_synced_at: new Date().toISOString()
          }, { onConflict: 'item_id' });
          
          synced++;
        } catch (e) {
          errors++;
          console.error(`[ML Sync] Erro no item ${itemId}:`, e.message);
        }
      }));
      
      await new Promise(r => setTimeout(r, 200));
    }
    
    res.json({
      ok: true,
      total_found: allItemIds.length,
      synced,
      errors,
      message: `Sincronizados ${synced} anúncios de ${allItemIds.length} encontrados`
    });
    
  } catch (err) {
    console.error('[ML Items Sync] Erro:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6.3d) POST /api/ml/orders/sync (Backfill de pedidos históricos do Mercado Livre)
app.post('/api/ml/orders/sync', async (req, res) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
    
    const client = supabaseAdmin || supabase;
    
    const { data: conn } = await client.from('ml_connections')
      .select('ml_user_id')
      .eq('user_id', authUser.id)
      .maybeSingle();
    
    if (!conn?.ml_user_id) {
      return res.status(400).json({ error: 'Mercado Livre não conectado' });
    }
    
    const sellerId = conn.ml_user_id;
    const token = await getValidMlToken(authUser.id);
    
    const days = parseInt(req.body?.days || req.query?.days || '90', 10) || 90;
    const now = new Date();
    const fromDateObj = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    
    const dateFrom = req.body?.date_from || req.query?.date_from || fromDateObj.toISOString();
    const dateTo = req.body?.date_to || req.query?.date_to || now.toISOString();
    
    let offset = 0;
    const limit = 50;
    let hasMore = true;
    let synced = 0;
    let totalFound = 0;
    let errors = 0;
    
    while (hasMore) {
      const searchUrl = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&order.date_created.from=${encodeURIComponent(dateFrom)}&order.date_created.to=${encodeURIComponent(dateTo)}&limit=${limit}&offset=${offset}&order.field=date_created&order.direction=desc`;
      
      const searchRes = await fetch(searchUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!searchRes.ok) {
        throw new Error(`Erro orders search (${searchRes.status}): ${await searchRes.text()}`);
      }
      
      const searchData = await searchRes.json();
      const results = searchData.results || [];
      totalFound = searchData.paging?.total || results.length;
      
      for (const orderData of results) {
        try {
          const firstItem = orderData.order_items?.[0] || {};
          const firstPayment = orderData.payments?.[0] || {};
          
          await client.from('ml_orders').upsert({
            user_id: authUser.id,
            ml_order_id: String(orderData.id),
            buyer_nickname: orderData.buyer?.nickname || '',
            buyer_email: orderData.buyer?.email || '',
            buyer_phone: orderData.buyer?.phone?.number || '',
            buyer_id: orderData.buyer?.id ? Number(orderData.buyer.id) : null,
            item_id: firstItem.item?.id || '',
            item_title: firstItem.item?.title || '',
            quantity: firstItem.quantity || 1,
            unit_price: firstItem.unit_price || 0,
            total_amount: orderData.total_amount || 0,
            currency: orderData.currency_id || 'BRL',
            status: orderData.status || '',
            payment_status: firstPayment.status || '',
            payment_id: firstPayment.id ? String(firstPayment.id) : null,
            payment_method_id: firstPayment.payment_method_id || '',
            shipping_id: orderData.shipping?.id ? String(orderData.shipping.id) : null,
            shipping_cost: orderData.shipping_cost || 0,
            tags: orderData.tags || [],
            pack_id: orderData.pack_id ? Number(orderData.pack_id) : null,
            date_created: orderData.date_created ? new Date(orderData.date_created).toISOString() : null,
            date_closed: orderData.date_closed ? new Date(orderData.date_closed).toISOString() : null,
            raw: orderData,
            imported_at: new Date().toISOString()
          }, { onConflict: 'ml_order_id' });
          
          synced++;
        } catch (e) {
          errors++;
          console.error(`[ML Orders Sync] Erro no pedido ${orderData.id}:`, e.message);
        }
      }
      
      if (offset + limit >= totalFound || offset + limit >= 10000 || results.length === 0) {
        hasMore = false;
      } else {
        offset += limit;
      }
      
      await new Promise(r => setTimeout(r, 200));
    }
    
    res.json({
      ok: true,
      total_found: totalFound,
      synced,
      errors,
      message: `Sincronizados ${synced} pedidos dos últimos ${days} dias (${totalFound} encontrados)`
    });
    
  } catch (err) {
    console.error('[ML Orders Sync] Erro:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6.3e) GET /api/ml/reputation (Reputação do vendedor no Mercado Livre)
app.get('/api/ml/reputation', async (req, res) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
    
    const client = supabaseAdmin || supabase;
    const { data: conn } = await client.from('ml_connections')
      .select('ml_user_id')
      .eq('user_id', authUser.id)
      .maybeSingle();
    
    if (!conn?.ml_user_id) return res.status(400).json({ error: 'Mercado Livre não conectado' });
    
    const token = await getValidMlToken(authUser.id);
    
    const userRes = await fetch(`https://api.mercadolibre.com/users/${conn.ml_user_id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!userRes.ok) return res.status(userRes.status).json({ error: await userRes.text() });
    
    const userData = await userRes.json();
    const reputation = userData.seller_reputation || {};
    res.json(reputation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6.3f) GET /api/ml/visits (Visitas acumuladas dos anúncios)
app.get('/api/ml/visits', async (req, res) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

    const client = supabaseAdmin || supabase;
    const days = Number(req.query.days) || 7;

    const { data: itemRows } = await client.from('ml_items')
      .select('item_id')
      .eq('user_id', authUser.id);

    const itemIds = (itemRows || []).map(i => i.item_id).filter(Boolean);
    if (itemIds.length === 0) {
      return res.json({ total_visits: 0, results: [] });
    }

    const idsParam = itemIds.slice(0, 50).join(',');
    const token = await getValidMlToken(authUser.id);

    const visitsRes = await fetch(`https://api.mercadolibre.com/visits/items?ids=${idsParam}&last=${days}&unit=day`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!visitsRes.ok) {
      return res.status(visitsRes.status).json({ error: await visitsRes.text() });
    }

    const data = await visitsRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6.3g) GET /api/ml/financial (Coleções e transações financeiras)
app.get('/api/ml/financial', async (req, res) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

    const client = supabaseAdmin || supabase;
    const { data: conn } = await client.from('ml_connections')
      .select('ml_user_id')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (!conn?.ml_user_id) return res.status(400).json({ error: 'Mercado Livre não conectado' });

    const token = await getValidMlToken(authUser.id);
    const collRes = await fetch(`https://api.mercadolibre.com/collections/search?seller_id=${conn.ml_user_id}&limit=50`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!collRes.ok) {
      return res.status(collRes.status).json({ error: await collRes.text() });
    }

    const data = await collRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6.4) GET /api/ml/dashboard (Métricas agregadas do Mercado Livre para o Painel)
app.get('/api/ml/dashboard', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const client = supabaseAdmin || supabase;
        const { period: periodQuery, date_from, date_to } = req.query;

        const period = String(periodQuery || '30d').toLowerCase();
        const days = period === '1d' ? 1 : period === '7d' ? 7 : period === '90d' ? 90 : 30;

        const now = new Date();
        const fromDate = date_from ? new Date(date_from).toISOString() : new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
        const toDate = date_to ? new Date(date_to).toISOString() : now.toISOString();

        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const startOf7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        // Buscar todos os pedidos no período
        const { data: orders } = await client.from('ml_orders')
            .select('ml_order_id, status, shipping_status, payment_status, total_amount, quantity, unit_price, item_id, item_title, date_created, raw')
            .eq('user_id', authUser.id)
            .gte('date_created', fromDate)
            .lte('date_created', toDate);

        // Buscar perguntas no período
        const { data: questions } = await client.from('ml_questions')
            .select('status')
            .eq('user_id', authUser.id)
            .gte('date_created', fromDate)
            .lte('date_created', toDate);

        // Buscar itens cadastrados
        const { data: items } = await client.from('ml_items')
            .select('item_id, title, thumbnail, status, available_quantity, sold_quantity, catalog_listing, is_sponsored')
            .eq('user_id', authUser.id);

        // Buscar mensagens
        const { data: messages } = await client.from('ml_messages')
            .select('status')
            .eq('user_id', authUser.id);

        // Buscar gastos com campanhas de publicidade
        let totalAdsCost = 0;
        try {
            const { data: campaigns } = await client.from('ml_ad_campaigns')
                .select('cost')
                .eq('user_id', authUser.id);
            if (campaigns) {
                totalAdsCost = campaigns.reduce((sum, c) => sum + Number(c.cost || 0), 0);
            }
        } catch (adErr) {
            console.warn('[ML Dashboard] Erro ad_campaigns:', adErr.message);
        }

        // Reputação & Visitas do Mercado Livre API
        let reputation = null;
        let totalVisits = 0;
        let token = null;
        let itemIds = [];
        let topItemIds = [];
        try {
            const { data: conn } = await client.from('ml_connections')
                .select('ml_user_id')
                .eq('user_id', authUser.id)
                .maybeSingle();

            if (conn?.ml_user_id) {
                token = await getValidMlToken(authUser.id);
                const userRes = await fetch(`https://api.mercadolibre.com/users/${conn.ml_user_id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (userRes.ok) {
                    const userData = await userRes.json();
                    reputation = userData.seller_reputation || null;
                }

                const itemRows = await client.from('ml_items')
                    .select('item_id')
                    .eq('user_id', authUser.id);
                itemIds = (itemRows || []).map(i => i.item_id).filter(Boolean);

                if (itemIds.length > 0) {
                    topItemIds = itemIds.slice(0, 50);
                    const visitsPromises = topItemIds.map(id =>
                        fetch(`https://api.mercadolibre.com/items/${id}/visits/time_window?last=${days}&unit=day`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        })
                        .then(r => r.ok ? r.json() : null)
                        .catch(() => null)
                    );
                    const visitsResults = await Promise.all(visitsPromises);
                    totalVisits = visitsResults.reduce((sum, data) => {
                        if (!data) return sum;
                        return sum + (Number(data.total_visits || data.total || 0) || 0);
                    }, 0);
                }
            }
        } catch (repErr) {
            console.warn('[ML Dashboard] Reputação/Visitas erro:', repErr.message);
        }

        const orderList = orders || [];
        const validOrders = orderList.filter(o => o.status !== 'cancelled' && o.payment_status !== 'cancelled');
        const cancelledOrdersList = orderList.filter(o => o.status === 'cancelled' || o.payment_status === 'cancelled');

        const totalOrders = validOrders.length;
        const paidOrders = validOrders.filter(o => o.status === 'paid').length;
        const readyToShipOrders = validOrders.filter(o => o.shipping_status === 'ready_to_ship').length;
        const awaitingShippingOrders = validOrders.filter(o => o.status === 'paid' && !o.shipping_status).length;
        const shippedOrders = validOrders.filter(o => o.status === 'shipped' || o.shipping_status === 'shipped').length;
        const deliveredOrders = validOrders.filter(o => o.status === 'delivered' || o.shipping_status === 'delivered').length;
        
        const cancelledOrders = cancelledOrdersList.length;
        const cancelledValue = cancelledOrdersList.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

        const revenue = validOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

        // 1.1) Unidades vendidas & Desempenho por anúncio
        let unitsSold = 0;
        const itemPerformance = {}; // item_id -> { item_id, units, revenue }

        try {
            const { data: orderItems } = await client.from('ml_order_items')
                .select('item_id, quantity, unit_price')
                .eq('user_id', authUser.id)
                .in('ml_order_id', orderList.map(o => o.ml_order_id).filter(Boolean));

            if (orderItems && orderItems.length > 0) {
                orderItems.forEach(it => {
                    const qty = Number(it.quantity) || 1;
                    const price = Number(it.unit_price) || 0;
                    unitsSold += qty;
                    const id = it.item_id;
                    if (id) {
                        if (!itemPerformance[id]) itemPerformance[id] = { item_id: id, units: 0, revenue: 0 };
                        itemPerformance[id].units += qty;
                        itemPerformance[id].revenue += price * qty;
                    }
                });
            }
        } catch (oiErr) {
            // Se tabela não existir, ignora
        }

        // Fallback: Se unitsSold for 0 mas houver validOrders, extrair de validOrders
        if (unitsSold === 0 && validOrders.length > 0) {
            validOrders.forEach(o => {
                const rawItems = o.raw?.order_items;
                if (Array.isArray(rawItems) && rawItems.length > 0) {
                    rawItems.forEach(it => {
                        const qty = Number(it.quantity) || 1;
                        const price = Number(it.unit_price) || 0;
                        unitsSold += qty;
                        const id = it.item?.id || o.item_id;
                        if (id) {
                            if (!itemPerformance[id]) itemPerformance[id] = { item_id: id, units: 0, revenue: 0 };
                            itemPerformance[id].units += qty;
                            itemPerformance[id].revenue += (price > 0 ? price * qty : Number(o.total_amount || 0));
                        }
                    });
                } else {
                    const qty = Number(o.quantity) || 1;
                    const price = Number(o.unit_price) || (o.total_amount ? Number(o.total_amount) / qty : 0);
                    unitsSold += qty;
                    const id = o.item_id;
                    if (id) {
                        if (!itemPerformance[id]) itemPerformance[id] = { item_id: id, units: 0, revenue: 0 };
                        itemPerformance[id].units += qty;
                        itemPerformance[id].revenue += Number(o.total_amount || (price * qty));
                    }
                }
            });
        }

        const avgPricePerUnit = unitsSold > 0 ? (revenue / unitsSold) : 0;

        // 1.2) Tarifas ML estimadas e Receita Líquida
        const estimatedFees = revenue * 0.14;
        const netRevenue = revenue - estimatedFees - totalAdsCost;

        // 1.3) Mapa de Calor (vendas por dia da semana [0..6] e hora [0..23] - Brasília UTC-3)
        const heatmapObj = {};
        validOrders.forEach(o => {
            if (o.date_created) {
                const date = new Date(o.date_created);
                const brasiliaDate = new Date(date.getTime() - 3 * 60 * 60 * 1000);
                const day = brasiliaDate.getUTCDay(); // 0=Dom, 1=Seg...
                const hour = brasiliaDate.getUTCHours(); // 0..23
                const key = `${day}-${hour}`;
                heatmapObj[key] = (heatmapObj[key] || 0) + 1;
            }
        });
        const heatmapArray = [];
        for (let d = 0; d < 7; d++) {
            for (let h = 0; h < 24; h++) {
                const count = heatmapObj[`${d}-${h}`] || 0;
                heatmapArray.push({ day: d, hour: h, count });
            }
        }

        // 1.4) Top Anúncios por Vendas
        const topItemsSorted = Object.values(itemPerformance)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        for (const item of topItemsSorted) {
            try {
                const { data: itemData } = await client.from('ml_items')
                    .select('title, thumbnail, item_id')
                    .eq('user_id', authUser.id)
                    .eq('item_id', item.item_id)
                    .maybeSingle();
                item.title = itemData?.title || 'Anúncio ML';
                item.thumbnail = itemData?.thumbnail || '';
            } catch (e) {
                item.title = 'Anúncio ML';
                item.thumbnail = '';
            }
        }

        // 1.5) Dados diários para o gráfico de linha Vendas Brutas
        const dailyMap = {};
        const startTs = new Date(fromDate).getTime();
        const endTs = new Date(toDate).getTime();
        for (let ts = startTs; ts <= endTs; ts += 86400000) {
            const dStr = new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            dailyMap[dStr] = 0;
        }
        validOrders.forEach(o => {
            if (o.date_created) {
                const dStr = new Date(o.date_created).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                dailyMap[dStr] = (dailyMap[dStr] || 0) + (Number(o.total_amount) || 0);
            }
        });
        const dailySales = Object.entries(dailyMap).map(([date, rev]) => ({
            date,
            revenue: Number(rev.toFixed(2))
        }));

        const conversionRate = totalVisits > 0 ? Number(((totalOrders / totalVisits) * 100).toFixed(2)) : 0;

        // Período anterior para variações
        const currentStart = new Date(fromDate);
        const currentEnd = new Date(toDate);
        const durationMs = Math.max(86400000, currentEnd.getTime() - currentStart.getTime());
        const prevEnd = new Date(currentStart.getTime() - 1);
        const prevStart = new Date(prevEnd.getTime() - durationMs);

        let prevRevenue = 0;
        let prevOrdersCount = 0;
        let prevUnitsSold = 0;
        let prevCancelledCount = 0;
        let prevCancelledValue = 0;
        try {
            const { data: prevOrders } = await client.from('ml_orders')
                .select('total_amount, status, payment_status, quantity, raw')
                .eq('user_id', authUser.id)
                .gte('date_created', prevStart.toISOString())
                .lte('date_created', prevEnd.toISOString());

            if (prevOrders && prevOrders.length > 0) {
                const validPrev = prevOrders.filter(o => o.status !== 'cancelled' && o.payment_status !== 'cancelled');
                prevRevenue = validPrev.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
                prevOrdersCount = validPrev.length;
                validPrev.forEach(o => {
                    const rawItems = o.raw?.order_items;
                    if (Array.isArray(rawItems) && rawItems.length > 0) {
                        rawItems.forEach(it => { prevUnitsSold += (Number(it.quantity) || 1); });
                    } else {
                        prevUnitsSold += (Number(o.quantity) || 1);
                    }
                });

                const cancelledPrev = prevOrders.filter(o => o.status === 'cancelled' || o.payment_status === 'cancelled');
                prevCancelledCount = cancelledPrev.length;
                prevCancelledValue = cancelledPrev.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
            }
        } catch (prevErr) {
            console.warn('[ML Dashboard] Erro ao buscar pedidos do período anterior:', prevErr.message);
        }

        const varRevenue = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue * 100) : (revenue > 0 ? 100 : 0);
        const varOrders = prevOrdersCount > 0 ? ((totalOrders - prevOrdersCount) / prevOrdersCount * 100) : (totalOrders > 0 ? 100 : 0);
        const prevTicket = prevOrdersCount > 0 ? (prevRevenue / prevOrdersCount) : 0;
        const currentTicket = totalOrders > 0 ? (revenue / totalOrders) : 0;
        const varTicket = prevTicket > 0 ? ((currentTicket - prevTicket) / prevTicket * 100) : (currentTicket > 0 ? 100 : 0);

        const varUnits = prevUnitsSold > 0 ? ((unitsSold - prevUnitsSold) / prevUnitsSold * 100) : (unitsSold > 0 ? 100 : 0);
        const prevAvgPrice = prevUnitsSold > 0 ? (prevRevenue / prevUnitsSold) : 0;
        const varAvgPrice = prevAvgPrice > 0 ? ((avgPricePerUnit - prevAvgPrice) / prevAvgPrice * 100) : (avgPricePerUnit > 0 ? 100 : 0);

        const varCancelled = prevCancelledCount > 0 ? ((cancelledOrders - prevCancelledCount) / prevCancelledCount * 100) : (cancelledOrders > 0 ? 100 : 0);
        const varCancelledVal = prevCancelledValue > 0 ? ((cancelledValue - prevCancelledValue) / prevCancelledValue * 100) : (cancelledValue > 0 ? 100 : 0);

        let prevVisits = 0;
        try {
            if (topItemIds.length > 0 && days > 0 && token) {
                const doubleDays = days * 2;
                const prevVisitsPromises = topItemIds.map(id =>
                    fetch(`https://api.mercadolibre.com/items/${id}/visits/time_window?last=${doubleDays}&unit=day`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                    .then(r => r.ok ? r.json() : null)
                    .catch(() => null)
                );
                const prevVisitsResults = await Promise.all(prevVisitsPromises);
                const totalDoublePeriod = prevVisitsResults.reduce((sum, data) => {
                    if (!data) return sum;
                    return sum + (Number(data.total_visits || data.total || 0) || 0);
                }, 0);
                prevVisits = Math.max(0, totalDoublePeriod - totalVisits);
            }
        } catch (prevVisitsErr) {
            console.warn('[ML Dashboard] Erro visitas anterior:', prevVisitsErr.message);
        }

        const varVisits = prevVisits > 0 ? ((totalVisits - prevVisits) / prevVisits * 100) : (totalVisits > 0 ? 100 : 0);
        const prevConversionRate = prevVisits > 0 ? Number(((prevOrdersCount / prevVisits) * 100).toFixed(2)) : 0;
        const varConversion = prevConversionRate > 0 ? Number((conversionRate - prevConversionRate).toFixed(1)) : 0;

        const variations = {
            revenue: Number(varRevenue.toFixed(1)),
            orders: Number(varOrders.toFixed(1)),
            ticket: Number(varTicket.toFixed(1)),
            conversion: Number(varConversion.toFixed(1)),
            units: Number(varUnits.toFixed(1)),
            avg_price: Number(varAvgPrice.toFixed(1)),
            cancelled: Number(varCancelled.toFixed(1)),
            cancelled_val: Number(varCancelledVal.toFixed(1)),
            visits: Number(varVisits.toFixed(1)),
            prev_revenue: Number(prevRevenue.toFixed(2)),
            prev_orders: prevOrdersCount,
            prev_visits: prevVisits || 0
        };

        const validOrdersList = orderList.filter(o => o.status !== 'cancelled' && o.payment_status !== 'cancelled');
        const salesToday = validOrdersList.filter(o => o.date_created && o.date_created >= startOfToday);
        const salesWeek = validOrdersList.filter(o => o.date_created && o.date_created >= startOf7d);
        const salesMonth = validOrdersList.filter(o => o.date_created && o.date_created >= startOfMonth);

        const sales_totals = {
            today: {
                count: salesToday.length,
                revenue: Number(salesToday.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0).toFixed(2))
            },
            this_week: {
                count: salesWeek.length,
                revenue: Number(salesWeek.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0).toFixed(2))
            },
            this_month: {
                count: salesMonth.length,
                revenue: Number(salesMonth.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0).toFixed(2))
            }
        };

        const questionList = questions || [];
        const totalQuestions = questionList.length;
        const unansweredQuestions = questionList.filter(q => String(q.status).toLowerCase() === 'unanswered').length;
        const answeredQuestions = questionList.filter(q => String(q.status).toLowerCase() === 'answered').length;

        const itemList = items || [];
        const totalActiveItems = itemList.filter(i => String(i.status).toLowerCase() === 'active').length;
        const totalPausedItems = itemList.filter(i => String(i.status).toLowerCase() === 'paused').length;

        const listing_breakdown = {
            catalog: itemList.filter(i => i.catalog_listing === true).length,
            sponsored: itemList.filter(i => i.is_sponsored === true).length,
            organic: itemList.filter(i => !i.catalog_listing && !i.is_sponsored).length
        };

        const messageList = messages || [];
        const totalMessages = messageList.length;
        const unreadMessages = messageList.filter(m => String(m.status).toLowerCase() === 'unread').length;

        // 1.6) Reviews e Avaliações Médias dos top itens
        let reviews = [];
        let avgRating = 0;
        if (topItemIds.length > 0 && token) {
            try {
                const reviewsTopIds = topItemIds.slice(0, 5);
                const reviewsPromises = reviewsTopIds.map(id =>
                    fetch(`https://api.mercadolibre.com/reviews/item/${id}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                    .then(r => r.ok ? r.json() : null)
                    .catch(() => null)
                );
                const reviewsData = await Promise.all(reviewsPromises);
                reviews = reviewsData.filter(Boolean).map(r => ({
                    item_id: r.item_id,
                    rating_average: r.rating_average,
                    total_reviews: r.paging?.total || 0,
                    rating_levels: r.rating_levels
                }));
                if (reviews.length > 0) {
                    avgRating = reviews.reduce((sum, r) => sum + (r.rating_average || 0), 0) / reviews.length;
                }
            } catch (revErr) {
                console.warn('[ML Dashboard] Erro ao buscar reviews:', revErr.message);
            }
        }

        // 1.7) TACOS (Total ACOS = gasto ads / faturamento total * 100)
        const tacos = revenue > 0 ? (totalAdsCost / revenue * 100) : 0;

        // 1.8) Phone Views (cliques no telefone dos top itens)
        let totalPhoneViews = 0;
        if (topItemIds.length > 0 && token) {
            try {
                const phoneViewsPromises = topItemIds.slice(0, 10).map(id =>
                    fetch(`https://api.mercadolibre.com/items/${id}/contacts/phone_views/time_window?last=${days}&unit=day`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                    .then(r => r.ok ? r.json() : null)
                    .catch(() => null)
                );
                const phoneViewsData = await Promise.all(phoneViewsPromises);
                totalPhoneViews = phoneViewsData.filter(Boolean).reduce((sum, data) => {
                    return sum + (data.total || (data.results ? data.results.reduce((s, r) => s + (r.total || 0), 0) : 0));
                }, 0);
            } catch (pvErr) {
                console.warn('[ML Dashboard] Erro ao buscar phone views:', pvErr.message);
            }
        }

        // 1.9) Unidades Orgânicas e Faturamento Orgânico de ad_campaigns
        let organicUnits = 0;
        let organicAmount = 0;
        try {
            const { data: campaignsData } = await client.from('ml_ad_campaigns')
                .select('organic_units_quantity, organic_units_amount')
                .eq('user_id', authUser.id);
            if (campaignsData) {
                organicUnits = campaignsData.reduce((sum, c) => sum + Number(c.organic_units_quantity || 0), 0);
                organicAmount = campaignsData.reduce((sum, c) => sum + Number(c.organic_units_amount || 0), 0);
            }
        } catch (orgErr) {
            console.warn('[ML Dashboard] Erro ao buscar métricas orgânicas:', orgErr.message);
        }

        return res.json({
            orders: {
                total: totalOrders,
                paid: paidOrders,
                ready_to_ship: readyToShipOrders,
                awaiting_shipping: awaitingShippingOrders,
                shipped: shippedOrders,
                delivered: deliveredOrders,
                cancelled: cancelledOrders,
                cancelled_value: Number(cancelledValue.toFixed(2)),
                revenue: Number(revenue.toFixed(2))
            },
            units_sold: unitsSold,
            avg_price_per_unit: Number(avgPricePerUnit.toFixed(2)),
            estimated_fees: Number(estimatedFees.toFixed(2)),
            net_revenue: Number(netRevenue.toFixed(2)),
            total_ads_cost: Number(totalAdsCost.toFixed(2)),
            heatmap: heatmapArray,
            top_items: topItemsSorted,
            daily_sales: dailySales,
            sales_totals,
            visits: totalVisits,
            conversion_rate: conversionRate,
            variations,
            questions: {
                total: totalQuestions,
                unanswered: unansweredQuestions,
                answered: answeredQuestions
            },
            items: {
                total_active: totalActiveItems,
                total_paused: totalPausedItems,
                breakdown: listing_breakdown
            },
            messages: {
                total: totalMessages,
                unread: unreadMessages
            },
            reputation,
            avg_rating: Number(avgRating.toFixed(1)),
            reviews: reviews,
            tacos: Number(tacos.toFixed(1)),
            phone_views: totalPhoneViews,
            organic_units_quantity: organicUnits,
            organic_units_amount: Number(organicAmount.toFixed(2)),
            period: {
                from: fromDate.split('T')[0],
                to: toDate.split('T')[0]
            }
        });
    } catch (err) {
        console.error('[ML Dashboard Exception]:', err);
        return res.status(500).json({ error: err.message });
    }
});

// TAREFA 3: GET & POST /api/ml/items/:itemId/preview (Preview de produto ML)
app.get('/api/ml/items/:itemId/preview', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
        
        const { itemId } = req.params;
        const token = await getValidMlToken(authUser.id);
        
        // Buscar item completo
        const itemRes = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!itemRes.ok) {
            return res.status(itemRes.status).json({ error: `Item ${itemId} não encontrado no Mercado Livre.` });
        }
        const itemData = await itemRes.json();
        
        // Buscar descrição
        const descRes = await fetch(`https://api.mercadolibre.com/items/${itemId}/description`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const descData = descRes.ok ? await descRes.json() : { plain_text: '' };
        
        // Buscar reviews
        const reviewRes = await fetch(`https://api.mercadolibre.com/reviews/item/${itemId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const reviewData = reviewRes.ok ? await reviewRes.json() : null;
        
        // Buscar visitas
        const visitsRes = await fetch(`https://api.mercadolibre.com/items/${itemId}/visits/time_window?last=30&unit=day`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const visitsData = visitsRes.ok ? await visitsRes.json() : { total_visits: 0, results: [] };
        
        return res.json({
            item: itemData,
            description: descData.plain_text || '',
            reviews: reviewData,
            visits: visitsData,
            preview_url: itemData.permalink,
            thumbnail: itemData.thumbnail,
            pictures: itemData.pictures || [],
            variations: itemData.variations || [],
            attributes: itemData.attributes || [],
            shipping: itemData.shipping || {},
            seller_address: itemData.seller_address || {}
        });
    } catch (err) {
        console.error('[ML Item Preview] Erro:', err);
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/ml/items/:itemId/preview', (req, res) => {
    return req.app._router.handle(Object.assign(req, { method: 'GET' }), res);
});

// FUNÇÃO AUXILIAR: Executar exportação de Google Ads para Google Sheets
async function executeGoogleSheetsAdsExport(userId, spreadsheetId, campaignIds, aggregation, startDate, endDate, sheetsToken) {
    const client = supabaseAdmin || supabase;
    const { data: profile } = await client.from('profiles')
        .select('google_sheets_token, google_sheets_refresh_token')
        .eq('id', userId)
        .maybeSingle();
    
    let tokenToUse = sheetsToken || profile?.google_sheets_token;
    if (!tokenToUse) {
        throw new Error('Sua conta do Google Sheets não está conectada ou o token expirou.');
    }

    // 1. Buscar metadados para validar o token e obter abas existentes
    let metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
        headers: { 'Authorization': `Bearer ${tokenToUse}` }
    });
    
    if (metaRes.status === 401 && profile?.google_sheets_refresh_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
        try {
            const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    refresh_token: profile.google_sheets_refresh_token,
                    grant_type: 'refresh_token'
                })
            });
            if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                if (refreshData.access_token) {
                    tokenToUse = refreshData.access_token;
                    await client.from('profiles').update({ google_sheets_token: tokenToUse }).eq('id', userId);
                    metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
                        headers: { 'Authorization': `Bearer ${tokenToUse}` }
                    });
                }
            }
        } catch (refErr) {
            console.warn('[Sheets Export Helper] Erro na renovação automática do token:', refErr);
        }
    }
    
    if (!metaRes.ok) {
        const errText = await metaRes.text();
        throw new Error(`Erro ao acessar a planilha do Google Sheets: ${errText}`);
    }
    
    const meta = await metaRes.json();
    const existingSheets = (meta.sheets || []).map(s => s.properties?.title || '');

    const { data: googleAds } = await client.from('google_ads_integrations').select('*').eq('user_id', userId).maybeSingle();
    if (!googleAds || !googleAds.customer_id) {
        throw new Error('Sua conta do Google Ads não está conectada ou não possui um ID de cliente configurado.');
    }
    const customerId = googleAds.customer_id;

    const sanitizedStart = startDate ? String(startDate).replace(/[^0-9-]/g, '') : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const sanitizedEnd = endDate ? String(endDate).replace(/[^0-9-]/g, '') : new Date().toISOString().split('T')[0];

    const campaignQuery = `
        SELECT 
            campaign.id, 
            campaign.name, 
            campaign.status, 
            campaign.advertising_channel_type,
            segments.date,
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
        AND segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
    `;
    const keywordQuery = `
        SELECT 
            ad_group_criterion.keyword.text, 
            ad_group_criterion.keyword.match_type, 
            ad_group_criterion.status, 
            ad_group_criterion.quality_info.quality_score, 
            campaign.id,
            campaign.name, 
            ad_group.name, 
            metrics.clicks, 
            metrics.impressions, 
            metrics.cost_micros, 
            metrics.conversions,
            metrics.conversions_value
        FROM keyword_view 
        WHERE segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
    `;
    const searchTermQuery = `
        SELECT 
            search_term_view.search_term, 
            campaign.id,
            campaign.name, 
            ad_group.name,
            metrics.clicks, 
            metrics.impressions, 
            metrics.cost_micros,
            metrics.conversions, 
            metrics.conversions_value,
            metrics.ctr
        FROM search_term_view
        WHERE segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
        AND metrics.impressions > 0
        ORDER BY metrics.cost_micros DESC
        LIMIT 200
    `;

    const [campaignResults, keywordResults, searchTermResults] = await Promise.all([
        executeGoogleAdsQuery(userId, campaignQuery, false, customerId).catch(err => { console.error('Erro campanhas ads:', err); return []; }),
        executeGoogleAdsQuery(userId, keywordQuery, false, customerId).catch(err => { console.error('Erro keywords ads:', err); return []; }),
        executeGoogleAdsQuery(userId, searchTermQuery, false, customerId).catch(err => { console.error('Erro search terms ads:', err); return []; })
    ]);

    const campaignIdSet = new Set();
    if (Array.isArray(campaignIds) && campaignIds.length > 0 && !campaignIds.includes('all')) {
        campaignIds.forEach(id => campaignIdSet.add(String(id)));
    }

    const filteredCampaignResults = (campaignResults || []).filter(row => {
        const cid = row.campaign?.id ? String(row.campaign.id) : '';
        if (campaignIdSet.size > 0 && !campaignIdSet.has(cid)) {
            return false;
        }
        return true;
    });

    const filteredKeywordResults = (keywordResults || []).filter(row => {
        const cid = row.campaign?.id ? String(row.campaign.id) : '';
        if (campaignIdSet.size > 0 && !campaignIdSet.has(cid)) {
            return false;
        }
        return true;
    });

    const filteredSearchTermResults = (searchTermResults || []).filter(row => {
        const cid = row.campaign?.id ? String(row.campaign.id) : '';
        if (campaignIdSet.size > 0 && !campaignIdSet.has(cid)) {
            return false;
        }
        return true;
    });

    const agg = aggregation || 'total';
    let campaignHeaders = [];
    let campaignRows = [];

    if (agg === 'daily') {
        campaignHeaders = [
            'Data', 'ID da Campanha', 'Nome da Campanha', 'Status', 'Tipo de Canal', 
            'Orçamento Diário', 'Impressões', 'Cliques', 'CTR (%)', 'CPC Médio', 
            'Gasto Total', 'Conversões', 'Custo por Conversão (CPA)', 'Taxa de Conversão (%)', 
            'Valor de Conversão (Receita)', 'ROAS'
        ];
        
        campaignRows = filteredCampaignResults.map(row => {
            const budget = (parseInt(row.campaignBudget?.amountMicros) || 0) / 1000000;
            const clicks = parseInt(row.metrics?.clicks) || 0;
            const impressions = parseInt(row.metrics?.impressions) || 0;
            const cost = (parseInt(row.metrics?.costMicros) || 0) / 1000000;
            const conversions = parseFloat(row.metrics?.conversions) || 0;
            const convValue = parseFloat(row.metrics?.conversionsValue) || 0;
            
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            const averageCpc = clicks > 0 ? (cost / clicks) : 0;
            const cpa = conversions > 0 ? (cost / conversions) : 0;
            const convRate = clicks > 0 ? (conversions / clicks) * 100 : 0;
            const roas = cost > 0 ? (convValue / cost) : 0;
            
            return [
                row.segments?.date || '',
                row.campaign?.id || '',
                row.campaign?.name || '',
                row.campaign?.status || '',
                row.campaign?.advertisingChannelType || '',
                `R$ ${budget.toFixed(2)}`,
                impressions,
                clicks,
                `${ctr.toFixed(2)}%`,
                `R$ ${averageCpc.toFixed(2)}`,
                `R$ ${cost.toFixed(2)}`,
                conversions,
                conversions > 0 ? `R$ ${cpa.toFixed(2)}` : 'R$ 0.00',
                `${convRate.toFixed(2)}%`,
                `R$ ${convValue.toFixed(2)}`,
                `${roas.toFixed(2)}x`
            ];
        });
        campaignRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])));
    } else if (agg === 'monthly') {
        campaignHeaders = [
            'Mês', 'ID da Campanha', 'Nome da Campanha', 'Status', 'Tipo de Canal', 
            'Orçamento Diário', 'Impressões', 'Cliques', 'CTR (%)', 'CPC Médio', 
            'Gasto Total', 'Conversões', 'Custo por Conversão (CPA)', 'Taxa de Conversão (%)', 
            'Valor de Conversão (Receita)', 'ROAS'
        ];

        const monthlyGroups = {};
        for (const row of filteredCampaignResults) {
            const date = row.segments?.date || '';
            const month = date ? date.substring(0, 7) : 'Desconhecido';
            const campaignId = row.campaign?.id || 'unknown';
            const key = `${campaignId}_${month}`;
            
            if (!monthlyGroups[key]) {
                monthlyGroups[key] = {
                    month,
                    id: row.campaign?.id || '',
                    name: row.campaign?.name || '',
                    status: row.campaign?.status || '',
                    channelType: row.campaign?.advertisingChannelType || '',
                    budgetMicros: parseInt(row.campaignBudget?.amountMicros) || 0,
                    impressions: 0,
                    clicks: 0,
                    costMicros: 0,
                    conversions: 0,
                    conversionsValue: 0
                };
            }
            
            monthlyGroups[key].impressions += parseInt(row.metrics?.impressions) || 0;
            monthlyGroups[key].clicks += parseInt(row.metrics?.clicks) || 0;
            monthlyGroups[key].costMicros += parseInt(row.metrics?.costMicros) || 0;
            monthlyGroups[key].conversions += parseFloat(row.metrics?.conversions) || 0;
            monthlyGroups[key].conversionsValue += parseFloat(row.metrics?.conversionsValue) || 0;
        }
        
        campaignRows = Object.values(monthlyGroups).map(g => {
            const budget = g.budgetMicros / 1000000;
            const cost = g.costMicros / 1000000;
            const ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
            const averageCpc = g.clicks > 0 ? (cost / g.clicks) : 0;
            const cpa = g.conversions > 0 ? (cost / g.conversions) : 0;
            const convRate = g.clicks > 0 ? (g.conversions / g.clicks) * 100 : 0;
            const roas = cost > 0 ? (g.conversionsValue / cost) : 0;
            
            return [
                g.month,
                g.id,
                g.name,
                g.status,
                g.channelType,
                `R$ ${budget.toFixed(2)}`,
                g.impressions,
                g.clicks,
                `${ctr.toFixed(2)}%`,
                `R$ ${averageCpc.toFixed(2)}`,
                `R$ ${cost.toFixed(2)}`,
                g.conversions,
                g.conversions > 0 ? `R$ ${cpa.toFixed(2)}` : 'R$ 0.00',
                `${convRate.toFixed(2)}%`,
                `R$ ${g.conversionsValue.toFixed(2)}`,
                `${roas.toFixed(2)}x`
            ];
        });
        campaignRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])));
    } else {
        campaignHeaders = [
            'ID da Campanha', 'Nome da Campanha', 'Status', 'Tipo de Canal', 
            'Orçamento Diário', 'Impressões', 'Cliques', 'CTR (%)', 'CPC Médio', 
            'Gasto Total', 'Conversões', 'Custo por Conversão (CPA)', 'Taxa de Conversão (%)', 
            'Valor de Conversão (Receita)', 'ROAS'
        ];

        const totalGroups = {};
        for (const row of filteredCampaignResults) {
            const campaignId = row.campaign?.id || 'unknown';
            
            if (!totalGroups[campaignId]) {
                totalGroups[campaignId] = {
                    id: row.campaign?.id || '',
                    name: row.campaign?.name || '',
                    status: row.campaign?.status || '',
                    channelType: row.campaign?.advertisingChannelType || '',
                    budgetMicros: parseInt(row.campaignBudget?.amountMicros) || 0,
                    impressions: 0,
                    clicks: 0,
                    costMicros: 0,
                    conversions: 0,
                    conversionsValue: 0
                };
            }
            
            totalGroups[campaignId].impressions += parseInt(row.metrics?.impressions) || 0;
            totalGroups[campaignId].clicks += parseInt(row.metrics?.clicks) || 0;
            totalGroups[campaignId].costMicros += parseInt(row.metrics?.costMicros) || 0;
            totalGroups[campaignId].conversions += parseFloat(row.metrics?.conversions) || 0;
            totalGroups[campaignId].conversionsValue += parseFloat(row.metrics?.conversionsValue) || 0;
        }
        
        campaignRows = Object.values(totalGroups).map(g => {
            const budget = g.budgetMicros / 1000000;
            const cost = g.costMicros / 1000000;
            const ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
            const averageCpc = g.clicks > 0 ? (cost / g.clicks) : 0;
            const cpa = g.conversions > 0 ? (cost / g.conversions) : 0;
            const convRate = g.clicks > 0 ? (g.conversions / g.clicks) * 100 : 0;
            const roas = cost > 0 ? (g.conversionsValue / cost) : 0;
            
            return [
                g.id,
                g.name,
                g.status,
                g.channelType,
                `R$ ${budget.toFixed(2)}`,
                g.impressions,
                g.clicks,
                `${ctr.toFixed(2)}%`,
                `R$ ${averageCpc.toFixed(2)}`,
                `R$ ${cost.toFixed(2)}`,
                g.conversions,
                g.conversions > 0 ? `R$ ${cpa.toFixed(2)}` : 'R$ 0.00',
                `${convRate.toFixed(2)}%`,
                `R$ ${g.conversionsValue.toFixed(2)}`,
                `${roas.toFixed(2)}x`
            ];
        });
        campaignRows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    }

    const keywordHeaders = [
        'Palavra-Chave', 'Tipo de Correspondência', 'Status', 'Índice de Qualidade', 
        'ID da Campanha', 'Campanha', 'Grupo de Anúncios', 'Impressões', 'Cliques', 
        'CTR (%)', 'CPC Médio', 'Gasto Total', 'Conversões', 'Custo por Conversão (CPA)', 
        'Taxa de Conversão (%)', 'Valor de Conversão (Receita)', 'ROAS'
    ];
    const keywordRows = filteredKeywordResults.map(row => {
        const clicks = parseInt(row.metrics?.clicks) || 0;
        const impressions = parseInt(row.metrics?.impressions) || 0;
        const cost = (parseInt(row.metrics?.costMicros) || 0) / 1000000;
        const conversions = parseFloat(row.metrics?.conversions) || 0;
        const convValue = parseFloat(row.metrics?.conversionsValue) || 0;
        
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const averageCpc = clicks > 0 ? (cost / clicks) : 0;
        const cpa = conversions > 0 ? (cost / conversions) : 0;
        const convRate = clicks > 0 ? (conversions / clicks) * 100 : 0;
        const roas = cost > 0 ? (convValue / cost) : 0;
        
        return [
            row.adGroupCriterion?.keyword?.text || '',
            row.adGroupCriterion?.keyword?.matchType || '',
            row.adGroupCriterion?.status || '',
            row.adGroupCriterion?.qualityInfo?.qualityScore || '-',
            row.campaign?.id || '',
            row.campaign?.name || '',
            row.adGroup?.name || '',
            impressions,
            clicks,
            `${ctr.toFixed(2)}%`,
            `R$ ${averageCpc.toFixed(2)}`,
            `R$ ${cost.toFixed(2)}`,
            conversions,
            conversions > 0 ? `R$ ${cpa.toFixed(2)}` : 'R$ 0.00',
            `${convRate.toFixed(2)}%`,
            `R$ ${convValue.toFixed(2)}`,
            `${roas.toFixed(2)}x`
        ];
    });

    const searchTermHeaders = [
        'Termo de Pesquisa', 'ID da Campanha', 'Campanha', 'Grupo de Anúncios', 
        'Impressões', 'Cliques', 'CTR (%)', 'CPC Médio', 'Gasto Total', 
        'Conversões', 'Custo por Conversão (CPA)', 'Taxa de Conversão (%)', 
        'Valor de Conversão (Receita)', 'ROAS'
    ];
    const searchTermRows = filteredSearchTermResults.map(row => {
        const clicks = parseInt(row.metrics?.clicks) || 0;
        const impressions = parseInt(row.metrics?.impressions) || 0;
        const cost = (parseInt(row.metrics?.costMicros) || 0) / 1000000;
        const conversions = parseFloat(row.metrics?.conversions) || 0;
        const convValue = parseFloat(row.metrics?.conversionsValue) || 0;
        
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const averageCpc = clicks > 0 ? (cost / clicks) : 0;
        const cpa = conversions > 0 ? (cost / conversions) : 0;
        const convRate = clicks > 0 ? (conversions / clicks) * 100 : 0;
        const roas = cost > 0 ? (convValue / cost) : 0;
        
        return [
            row.searchTermView?.searchTerm || '',
            row.campaign?.id || '',
            row.campaign?.name || '',
            row.adGroup?.name || '',
            impressions,
            clicks,
            `${ctr.toFixed(2)}%`,
            `R$ ${averageCpc.toFixed(2)}`,
            `R$ ${cost.toFixed(2)}`,
            conversions,
            conversions > 0 ? `R$ ${cpa.toFixed(2)}` : 'R$ 0.00',
            `${convRate.toFixed(2)}%`,
            `R$ ${convValue.toFixed(2)}`,
            `${roas.toFixed(2)}x`
        ];
    });

    const sheetsData = [
        {
            title: 'Google Ads - Campanhas',
            headers: campaignHeaders,
            rows: campaignRows
        },
        {
            title: 'Google Ads - Palavras-Chave',
            headers: keywordHeaders,
            rows: keywordRows
        },
        {
            title: 'Google Ads - Termos de Pesquisa',
            headers: searchTermHeaders,
            rows: searchTermRows
        }
    ];

    const requiredSheets = sheetsData.map(s => s.title);
    const sheetsToAdd = requiredSheets.filter(title => !existingSheets.includes(title));

    if (sheetsToAdd.length > 0) {
        const addRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenToUse}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                requests: sheetsToAdd.map(title => ({
                    addSheet: {
                        properties: { title }
                    }
                }))
            })
        });
        if (!addRes.ok) {
            const addText = await addRes.text();
            console.warn('[Sheets Export Helper] Erro ao adicionar abas:', addText);
        }
    }

    for (const sheet of sheetsData) {
        const values = [sheet.headers, ...sheet.rows];
        
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheet.title + '!A1:Z20000')}:clear`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenToUse}`
            }
        });

        const range = `${sheet.title}!A1`;
        const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${tokenToUse}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values })
        });

        if (!writeRes.ok) {
            const errText = await writeRes.text();
            throw new Error(`Erro ao escrever na aba ${sheet.title}: ${errText}`);
        }
    }

    return `Dados do Google Ads exportados com sucesso em 3 abas (Agregação: ${agg === 'daily' ? 'Diária' : agg === 'monthly' ? 'Mensal' : 'Total acumulado'})!`;
}

// FUNÇÃO AUXILIAR: Executar exportação de Mercado Livre para Google Sheets
async function executeGoogleSheetsMLExport(userId, spreadsheetId, sheetName, dataType, startDate, endDate, sheetsToken) {
    const client = supabaseAdmin || supabase;
    const { data: profile } = await client.from('profiles')
        .select('google_sheets_token, google_sheets_refresh_token')
        .eq('id', userId)
        .maybeSingle();

    let tokenToUse = sheetsToken || profile?.google_sheets_token;
    if (!tokenToUse) {
        throw new Error('Sua conta do Google Sheets não está conectada ou o token expirou.');
    }

    // 1. Validar e renovar token se necessário
    let metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
        headers: { 'Authorization': `Bearer ${tokenToUse}` }
    });

    if (metaRes.status === 401 && profile?.google_sheets_refresh_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
        try {
            const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    refresh_token: profile.google_sheets_refresh_token,
                    grant_type: 'refresh_token'
                })
            });
            if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                if (refreshData.access_token) {
                    tokenToUse = refreshData.access_token;
                    await client.from('profiles').update({ google_sheets_token: tokenToUse }).eq('id', userId);
                    metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
                        headers: { 'Authorization': `Bearer ${tokenToUse}` }
                    });
                }
            }
        } catch (refErr) {
            console.warn('[ML Sheets Export Helper] Erro na renovação automática do token:', refErr);
        }
    }

    if (!metaRes.ok) {
        const errText = await metaRes.text();
        throw new Error(`Erro ao acessar a planilha do Google Sheets: ${errText}`);
    }

    const meta = await metaRes.json();
    const existingSheets = (meta.sheets || []).map(s => s.properties?.title || '');

    // Criar aba se não existir
    const sheet_name = sheetName || 'AXIS_ML';
    if (!existingSheets.includes(sheet_name)) {
        const addRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenToUse}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                requests: [{
                    addSheet: {
                        properties: { title: sheet_name }
                    }
                }]
            })
        });
        if (!addRes.ok) {
            const addText = await addRes.text();
            console.warn(`[ML Sheets Export] Erro ao adicionar aba ${sheet_name}:`, addText);
        }
    }

    // Datas ISO
    let sDate = startDate ? new Date(startDate) : new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    let eDate = endDate ? new Date(endDate) : new Date();
    if (isNaN(sDate.getTime())) sDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    if (isNaN(eDate.getTime())) eDate = new Date();

    sDate.setHours(0, 0, 0, 0);
    eDate.setHours(23, 59, 59, 999);

    const startISO = sDate.toISOString();
    const endISO = eDate.toISOString();

    let rows = [];
    let headers = [];

    const data_type = dataType || 'daily_metrics';

    if (data_type === 'daily_metrics') {
        headers = [
            'Data',
            'Dia da Semana',
            'Faturamento Total',
            'Pedidos',
            'Unidades Vendidas',
            'Ticket Médio',
            'Gasto Ads',
            'Vendas Ads',
            'ROAS',
            'TACOS'
        ];
        
        // Buscar pedidos no período
        const { data: orders } = await client.from('ml_orders')
            .select('date_created, total_amount, quantity, status, payment_status')
            .eq('user_id', userId)
            .gte('date_created', startISO)
            .lte('date_created', endISO);
            
        // Buscar métricas de campanhas
        const { data: campaigns } = await client.from('ml_ad_campaigns')
            .select('cost, total_amount')
            .eq('user_id', userId);
            
        const totalAdCost = (campaigns || []).reduce((s, c) => s + Number(c.cost || 0), 0);
        const totalAdSales = (campaigns || []).reduce((s, c) => s + Number(c.total_amount || 0), 0);
        
        // Mapear por dia no intervalo selecionado
        const dailyMap = {};
        const dateList = [];
        let cur = new Date(sDate);
        
        while (cur <= eDate) {
            const yyyy = cur.getFullYear();
            const mm = String(cur.getMonth() + 1).padStart(2, '0');
            const dd = String(cur.getDate()).padStart(2, '0');
            const key = `${yyyy}-${mm}-${dd}`;
            
            const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
            const dayName = dayNames[cur.getDay()];
            const formattedDate = `${dd}/${mm}/${yyyy}`;
            
            dailyMap[key] = {
                dateStr: formattedDate,
                dayName,
                revenue: 0,
                ordersCount: 0,
                units: 0
            };
            dateList.push(key);
            cur.setDate(cur.getDate() + 1);
        }
        
        let totalPeriodRevenue = 0;
        (orders || []).forEach(o => {
            if (o.status === 'cancelled' || o.payment_status === 'cancelled') return;
            if (!o.date_created) return;
            const dt = new Date(o.date_created);
            const yyyy = dt.getFullYear();
            const mm = String(dt.getMonth() + 1).padStart(2, '0');
            const dd = String(dt.getDate()).padStart(2, '0');
            const key = `${yyyy}-${mm}-${dd}`;
            if (dailyMap[key]) {
                const rev = Number(o.total_amount || 0);
                dailyMap[key].revenue += rev;
                dailyMap[key].ordersCount += 1;
                dailyMap[key].units += Number(o.quantity || 1);
                totalPeriodRevenue += rev;
            }
        });
        
        const daysCount = dateList.length || 1;
        
        dateList.forEach(k => {
            const d = dailyMap[k];
            const rev = d.revenue;
            const ords = d.ordersCount;
            const units = d.units;
            const ticket = ords > 0 ? (rev / ords) : 0;
            
            // Rateio proporcional ou uniforme do investimento de Ads
            const dayAdCost = totalPeriodRevenue > 0
                ? (totalAdCost * (rev / totalPeriodRevenue))
                : (totalAdCost / daysCount);
                
            const dayAdSales = totalPeriodRevenue > 0
                ? (totalAdSales * (rev / totalPeriodRevenue))
                : (totalAdSales / daysCount);
                
            const roas = dayAdCost > 0 ? (dayAdSales / dayAdCost) : 0;
            const tacos = rev > 0 ? ((dayAdCost / rev) * 100) : 0;
            
            rows.push([
                d.dateStr,
                d.dayName,
                `R$ ${rev.toFixed(2)}`,
                ords,
                units,
                `R$ ${ticket.toFixed(2)}`,
                `R$ ${dayAdCost.toFixed(2)}`,
                `R$ ${dayAdSales.toFixed(2)}`,
                `${roas.toFixed(2)}x`,
                `${tacos.toFixed(1)}%`
            ]);
        });
    } else if (data_type === 'ads_daily') {
        headers = ['Data', 'Campanha', 'Status', 'Cliques', 'Impressões', 'CTR', 'CPC', 'Gasto', 'Vendas', 'ROAS', 'TACOS'];
        
        const { data: campaigns } = await client.from('ml_ad_campaigns')
            .select('name, status, clicks, prints, cost, total_amount, roas, tacos')
            .eq('user_id', userId);
            
        const { data: orders } = await client.from('ml_orders')
            .select('date_created, total_amount')
            .eq('user_id', userId)
            .gte('date_created', startISO)
            .lte('date_created', endISO);
            
        const dailyRevMap = {};
        let totalPeriodRev = 0;
        (orders || []).forEach(o => {
            if (!o.date_created) return;
            const dt = new Date(o.date_created);
            const yyyy = dt.getFullYear();
            const mm = String(dt.getMonth() + 1).padStart(2, '0');
            const dd = String(dt.getDate()).padStart(2, '0');
            const key = `${dd}/${mm}/${yyyy}`;
            const amt = Number(o.total_amount || 0);
            dailyRevMap[key] = (dailyRevMap[key] || 0) + amt;
            totalPeriodRev += amt;
        });

        let cur = new Date(sDate);
        while (cur <= eDate) {
            const yyyy = cur.getFullYear();
            const mm = String(cur.getMonth() + 1).padStart(2, '0');
            const dd = String(cur.getDate()).padStart(2, '0');
            const dateStr = `${dd}/${mm}/${yyyy}`;
            const dayRev = dailyRevMap[dateStr] || 0;

            (campaigns || []).forEach(c => {
                const cCost = Number(c.cost || 0);
                const cSales = Number(c.total_amount || 0);
                const cClicks = Number(c.clicks || 0);
                const cPrints = Number(c.prints || 0);

                const dayCost = totalPeriodRev > 0 ? cCost * (dayRev / totalPeriodRev) : cCost / 30;
                const daySales = totalPeriodRev > 0 ? cSales * (dayRev / totalPeriodRev) : cSales / 30;
                const dayClicks = totalPeriodRev > 0 ? Math.round(cClicks * (dayRev / totalPeriodRev)) : Math.round(cClicks / 30);
                const dayPrints = totalPeriodRev > 0 ? Math.round(cPrints * (dayRev / totalPeriodRev)) : Math.round(cPrints / 30);

                const ctr = dayPrints > 0 ? (dayClicks / dayPrints * 100) : 0;
                const cpc = dayClicks > 0 ? (dayCost / dayClicks) : 0;
                const roas = dayCost > 0 ? (daySales / dayCost) : 0;
                const tacos = dayRev > 0 ? (dayCost / dayRev * 100) : 0;

                rows.push([
                    dateStr,
                    c.name || 'Campanha',
                    c.status || 'active',
                    dayClicks,
                    dayPrints,
                    `${ctr.toFixed(2)}%`,
                    `R$ ${cpc.toFixed(2)}`,
                    `R$ ${dayCost.toFixed(2)}`,
                    `R$ ${daySales.toFixed(2)}`,
                    `${roas.toFixed(2)}x`,
                    `${tacos.toFixed(1)}%`
                ]);
            });
            cur.setDate(cur.getDate() + 1);
        }
    } else if (data_type === 'orders') {
        headers = ['Data', 'Pedido ID', 'Comprador', 'Item', 'Qtd', 'Total', 'Status', 'Pagamento', 'Envio'];
        const { data: orders } = await client.from('ml_orders')
            .select('date_created, ml_order_id, buyer_nickname, item_title, quantity, total_amount, status, payment_status, shipping_status')
            .eq('user_id', userId)
            .gte('date_created', startISO)
            .lte('date_created', endISO)
            .order('date_created', { ascending: false })
            .limit(2000);
        rows = (orders || []).map(o => [
            o.date_created ? new Date(o.date_created).toLocaleString('pt-BR') : '',
            o.ml_order_id || '',
            o.buyer_nickname || '',
            o.item_title || '',
            o.quantity || 1,
            `R$ ${Number(o.total_amount || 0).toFixed(2)}`,
            o.status || '',
            o.payment_status || '',
            o.shipping_status || '—'
        ]);
    } else if (data_type === 'items') {
        headers = ['Item ID', 'Título', 'Preço', 'Estoque', 'Vendidos', 'Status', 'Tipo', 'Patrocinado'];
        const { data: items } = await client.from('ml_items')
            .select('item_id, title, price, available_quantity, sold_quantity, status, listing_type_id, is_sponsored')
            .eq('user_id', userId);
        rows = (items || []).map(i => [
            i.item_id || '',
            i.title || '',
            `R$ ${Number(i.price || 0).toFixed(2)}`,
            i.available_quantity || 0,
            i.sold_quantity || 0,
            i.status || '',
            i.listing_type_id || '',
            i.is_sponsored ? 'Sim' : 'Não'
        ]);
    } else if (data_type === 'ads') {
        headers = ['Campanha', 'Status', 'Cliques', 'Impressões', 'CTR', 'CPC', 'Gasto', 'Vendas', 'ROAS', 'TACOS'];
        const { data: campaigns } = await client.from('ml_ad_campaigns')
            .select('name, status, clicks, prints, cost, total_amount, roas, tacos')
            .eq('user_id', userId);
        rows = (campaigns || []).map(c => [
            c.name || '',
            c.status || '',
            c.clicks || 0,
            c.prints || 0,
            c.prints > 0 ? `${((c.clicks || 0) / c.prints * 100).toFixed(2)}%` : '0%',
            c.clicks > 0 ? `R$ ${(Number(c.cost || 0) / c.clicks).toFixed(2)}` : 'R$ 0',
            `R$ ${Number(c.cost || 0).toFixed(2)}`,
            `R$ ${Number(c.total_amount || 0).toFixed(2)}`,
            c.roas ? `${Number(c.roas).toFixed(1)}x` : '—',
            c.tacos ? `${Number(c.tacos).toFixed(1)}%` : '—'
        ]);
    } else if (data_type === 'dashboard') {
        headers = ['Métrica', 'Valor'];
        const { data: orders } = await client.from('ml_orders')
            .select('total_amount, status, payment_status')
            .eq('user_id', userId)
            .gte('date_created', startISO)
            .lte('date_created', endISO);
        const { data: campaigns } = await client.from('ml_ad_campaigns')
            .select('cost, total_amount')
            .eq('user_id', userId);
        const validOrders = (orders || []).filter(o => o.status !== 'cancelled' && o.payment_status !== 'cancelled');
        const rev = validOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
        const adsCost = (campaigns || []).reduce((s, c) => s + Number(c.cost || 0), 0);
        const adsSales = (campaigns || []).reduce((s, c) => s + Number(c.total_amount || 0), 0);
        const tacosVal = rev > 0 ? (adsCost / rev * 100).toFixed(1) : '0';
        const roasVal = adsCost > 0 ? (adsSales / adsCost).toFixed(2) : '0';
        rows = [
            ['Período Inicial', sDate.toLocaleDateString('pt-BR')],
            ['Período Final', eDate.toLocaleDateString('pt-BR')],
            ['Faturamento Total', `R$ ${rev.toFixed(2)}`],
            ['Total de Pedidos', validOrders.length],
            ['Ticket Médio', validOrders.length > 0 ? `R$ ${(rev / validOrders.length).toFixed(2)}` : 'R$ 0,00'],
            ['Gasto em Ads', `R$ ${adsCost.toFixed(2)}`],
            ['Vendas em Ads', `R$ ${adsSales.toFixed(2)}`],
            ['ROAS Geral', `${roasVal}x`],
            ['TACOS', `${tacosVal}%`],
            ['Data do Relatório', new Date().toLocaleString('pt-BR')]
        ];
    }

    const values = [headers, ...rows];
    
    // Limpar aba anterior
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheet_name + '!A1:Z20000')}:clear`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenToUse}`
        }
    });

    const range = `${sheet_name}!A1`;
    const writeRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
        {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${tokenToUse}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values })
        }
    );

    if (!writeRes.ok) {
        const errText = await writeRes.text();
        throw new Error(`Erro ao escrever no Google Sheets: ${errText}`);
    }

    return `Dados do Mercado Livre exportados com sucesso! (${rows.length} linhas escritas na aba ${sheet_name})`;
}

// FUNÇÃO AUXILIAR: Executar exportação de Meta Ads para Google Sheets
async function executeMetaAdsSheetsExport(userId, spreadsheetId, dateRange, sheetsToken, selectedCampaigns) {
    const client = supabaseAdmin || supabase;
    const { data: profile } = await client.from('profiles')
        .select('google_sheets_token, google_sheets_refresh_token')
        .eq('id', userId)
        .maybeSingle();

    let tokenToUse = sheetsToken || profile?.google_sheets_token;
    if (!tokenToUse) {
        throw new Error('Sua conta do Google Sheets não está conectada ou o token expirou.');
    }

    // Se for URL completa, extrair ID
    let targetSpreadsheetId = spreadsheetId;
    if (targetSpreadsheetId && targetSpreadsheetId.includes('spreadsheets/d/')) {
        const match = targetSpreadsheetId.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (match && match[1]) {
            targetSpreadsheetId = match[1];
        }
    }

    // 1. Validar token do Sheets e obter abas existentes
    let metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}?fields=sheets.properties.title`, {
        headers: { 'Authorization': `Bearer ${tokenToUse}` }
    });

    if (metaRes.status === 401 && profile?.google_sheets_refresh_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
        try {
            const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    refresh_token: profile.google_sheets_refresh_token,
                    grant_type: 'refresh_token'
                })
            });
            if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                if (refreshData.access_token) {
                    tokenToUse = refreshData.access_token;
                    await client.from('profiles').update({ google_sheets_token: tokenToUse }).eq('id', userId);
                    metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}?fields=sheets.properties.title`, {
                        headers: { 'Authorization': `Bearer ${tokenToUse}` }
                    });
                }
            }
        } catch (refErr) {
            console.warn('[Meta Sheets Export Helper] Erro na renovação automática do token:', refErr);
        }
    }

    if (!metaRes.ok) {
        const errText = await metaRes.text();
        throw new Error(`Erro ao acessar a planilha do Google Sheets: ${errText}`);
    }

    const meta = await metaRes.json();
    const existingTabs = (meta.sheets || []).map(s => s.properties?.title || '');

    // 2. Obter token do Meta Ads
    const { accessToken, adAccountId } = await getValidMetaToken(userId);
    const ad_account_id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    const start = dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = dateRange?.end || new Date().toISOString().split('T')[0];
    const time_range = JSON.stringify({ since: start, until: end });
    
    const fieldsList = 'spend,impressions,clicks,reach,frequency,ctr,cpc,cpm,cpp,actions,action_values,conversions,conversion_values,website_purchase_roas,purchase_roas,cost_per_action_type,cost_per_conversion,cost_per_purchase,cost_per_lead,cost_per_add_to_cart,cost_per_initiate_checkout,cost_per_view_content,cost_per_complete_registration,cost_per_add_payment_info,post_engagement,outbound_clicks,unique_clicks,unique_ctr,video_play_actions,video_30_sec_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking,cost_per_unique_click,cost_per_outbound_click,cost_per_landing_page_view,estimated_ad_recallers,cost_per_estimated_ad_recallers';
    
    // 3. Buscar campanhas
    const campRes = await fetch(
        `https://graph.facebook.com/v25.0/${ad_account_id}/campaigns?fields=id,name,status,effective_status,daily_budget,lifetime_budget,objective,insights.time_range(${time_range}){${fieldsList}}&limit=150&access_token=${accessToken}`
    );
    const campData = await campRes.json();
    if (campData.error) {
        throw new Error(`Erro na API do Meta (Campanhas): ${campData.error.message}`);
    }
    const allCampaigns = campData.data || [];
    const campaigns = selectedCampaigns && selectedCampaigns.length > 0
        ? allCampaigns.filter(c => selectedCampaigns.includes(c.id))
        : allCampaigns;
    
    // 4. Buscar ad groups
    const adsetRes = await fetch(
        `https://graph.facebook.com/v25.0/${ad_account_id}/adsets?fields=id,name,status,campaign{id,name},insights.time_range(${time_range}){${fieldsList}}&limit=150&access_token=${accessToken}`
    );
    const adsetData = await adsetRes.json();
    if (adsetData.error) {
        throw new Error(`Erro na API do Meta (Conjuntos): ${adsetData.error.message}`);
    }
    const allAdSets = adsetData.data || [];
    const adSets = selectedCampaigns && selectedCampaigns.length > 0
        ? allAdSets.filter(a => selectedCampaigns.includes(a.campaign?.id))
        : allAdSets;
    
    // 5. Buscar ads
    const adsRes = await fetch(
        `https://graph.facebook.com/v25.0/${ad_account_id}/ads?fields=id,name,status,adset{id,name},campaign{id,name},adcreatives{body,title,image_url,thumbnail_url},insights.time_range(${time_range}){${fieldsList}}&limit=150&access_token=${accessToken}`
    );
    const adsData = await adsRes.json();
    if (adsData.error) {
        throw new Error(`Erro na API do Meta (Anúncios): ${adsData.error.message}`);
    }
    const allAds = adsData.data || [];
    const ads = selectedCampaigns && selectedCampaigns.length > 0
        ? allAds.filter(a => selectedCampaigns.includes(a.campaign?.id))
        : allAds;
    
    // 6. Buscar overview (agregado por dia)
    const overviewRes = await fetch(
        `https://graph.facebook.com/v25.0/${ad_account_id}/insights?fields=${fieldsList}&time_range=${encodeURIComponent(time_range)}&level=account&time_increment=1&limit=1000&access_token=${accessToken}`
    );
    const overviewData = await overviewRes.json();
    if (overviewData.error) {
        throw new Error(`Erro na API do Meta (Overview): ${overviewData.error.message}`);
    }
    const overviewDaily = overviewData.data || [];
    
    // 7. Preparar dados das 4 abas
    const tabNames = ['Meta Ads - Overview', 'Meta Ads - Campanhas', 'Meta Ads - Conjuntos', 'Meta Ads - Anuncios'];
    
    // Aba 1: Overview
    const overviewHeaders = ['Data', 'Investimento (R$)', 'Impressoes', 'Cliques', 'CTR (%)', 'CPC (R$)', 'CPM (R$)', 'Alcance', 'Frequencia', 'Conversoes', 'Valor Conversao (R$)', 'ROAS'];
    const overviewRows = overviewDaily.map(d => {
        const spend = parseFloat(d.spend || 0);
        const clicks = parseInt(d.clicks || 0);
        const impressions = parseInt(d.impressions || 0);
        const conversions = extractConversions(d);
        const convValue = getFieldValue('purchase', d);
        return [
            d.date_start || d.date || '',
            spend.toFixed(2),
            impressions,
            clicks,
            impressions > 0 ? (clicks / impressions * 100).toFixed(2) : '0',
            clicks > 0 ? (spend / clicks).toFixed(2) : '0',
            impressions > 0 ? (spend / impressions * 1000).toFixed(2) : '0',
            d.reach || 0,
            d.frequency || 0,
            conversions,
            convValue.toFixed(2),
            spend > 0 ? (convValue / spend).toFixed(2) : '0'
        ];
    });
    
    // Aba 2: Campanhas
    const campHeaders = ['Campanha', 'Status', 'Objetivo', 'Orcamento/Dia (R$)', 'Investimento (R$)', 'Impressoes', 'Cliques', 'CTR (%)', 'CPC (R$)', 'Conversoes', 'CPA (R$)', 'ROAS', 'Alcance', 'Frequencia'];
    const campRows = campaigns.map(c => {
        const ins = c.insights?.data?.[0] || {};
        const spend = parseFloat(ins.spend || 0);
        const clicks = parseInt(ins.clicks || 0);
        const impressions = parseInt(ins.impressions || 0);
        const conversions = extractConversions(ins);
        const convValue = getFieldValue('purchase', ins);
        const budget = parseFloat(c.daily_budget || c.lifetime_budget || '0') / 100;
        return [
            c.name || '',
            c.effective_status || c.status || '',
            c.objective || '',
            budget.toFixed(2),
            spend.toFixed(2),
            impressions,
            clicks,
            impressions > 0 ? (clicks / impressions * 100).toFixed(2) : '0',
            clicks > 0 ? (spend / clicks).toFixed(2) : '0',
            conversions,
            conversions > 0 ? (spend / conversions).toFixed(2) : '0',
            spend > 0 ? (convValue / spend).toFixed(2) : '0',
            ins.reach || 0,
            ins.frequency || 0
        ];
    });
    
    // Aba 3: Conjuntos de Anuncios
    const adsetHeaders = ['Conjunto', 'Campanha', 'Status', 'Investimento (R$)', 'Impressoes', 'Cliques', 'CTR (%)', 'CPC (R$)', 'Conversoes', 'ROAS', 'Alcance'];
    const adsetRows = adSets.map(a => {
        const ins = a.insights?.data?.[0] || {};
        const spend = parseFloat(ins.spend || 0);
        const clicks = parseInt(ins.clicks || 0);
        const impressions = parseInt(ins.impressions || 0);
        const conversions = extractConversions(ins);
        const convValue = getFieldValue('purchase', ins);
        return [
            a.name || '',
            a.campaign?.name || '',
            a.status || '',
            spend.toFixed(2),
            impressions,
            clicks,
            impressions > 0 ? (clicks / impressions * 100).toFixed(2) : '0',
            clicks > 0 ? (spend / clicks).toFixed(2) : '0',
            conversions,
            spend > 0 ? (convValue / spend).toFixed(2) : '0',
            ins.reach || 0
        ];
    });
    
    // Aba 4: Anuncios
    const adsHeaders = ['Anuncio', 'Campanha', 'Conjunto', 'Status', 'Titulo', 'Copy', 'Investimento (R$)', 'Impressoes', 'Cliques', 'CTR (%)', 'CPC (R$)', 'Conversoes', 'ROAS', 'Imagem'];
    const adsRows = ads.map(a => {
        const ins = a.insights?.data?.[0] || {};
        const creative = a.adcreatives?.data?.[0] || {};
        const spend = parseFloat(ins.spend || 0);
        const clicks = parseInt(ins.clicks || 0);
        const impressions = parseInt(ins.impressions || 0);
        const conversions = extractConversions(ins);
        const convValue = getFieldValue('purchase', ins);
        return [
            a.name || '',
            a.campaign?.name || '',
            a.adset?.name || '',
            a.status || '',
            creative.title || '',
            creative.body || '',
            spend.toFixed(2),
            impressions,
            clicks,
            impressions > 0 ? (clicks / impressions * 100).toFixed(2) : '0',
            clicks > 0 ? (spend / clicks).toFixed(2) : '0',
            conversions,
            spend > 0 ? (convValue / spend).toFixed(2) : '0',
            creative.thumbnail_url || creative.image_url || ''
        ];
    });
    
    // 8. Criar abas se nao existirem
    const tabsToCreate = tabNames.filter(t => !existingTabs.includes(t));
    
    if (tabsToCreate.length > 0) {
        const addSheetRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}:batchUpdate`,
            {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${tokenToUse}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requests: tabsToCreate.map(title => ({ addSheet: { properties: { title } } }))
                })
            }
        );
        if (!addSheetRes.ok) {
            console.warn(`[Meta Sheets Export] Erro ao criar abas extras:`, await addSheetRes.text());
        }
    }
    
    // 9. Escrever dados em cada aba
    const writeData = async (tabName, headers, rows) => {
        const values = [headers, ...rows];
        const range = `${tabName}!A1:Z10000`;
        const writeRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${targetSpreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
            {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${tokenToUse}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ values })
            }
        );
        if (!writeRes.ok) {
            console.warn(`[Meta Sheets Export] Erro ao escrever na aba ${tabName}:`, await writeRes.text());
        }
    };
    
    await writeData(tabNames[0], overviewHeaders, overviewRows);
    await writeData(tabNames[1], campHeaders, campRows);
    await writeData(tabNames[2], adsetHeaders, adsetRows);
    await writeData(tabNames[3], adsHeaders, adsRows);
    
    return {
        tabs_created: tabNames.length,
        overview_rows: overviewRows.length,
        campaigns_rows: campRows.length,
        adsets_rows: adsetRows.length,
        ads_rows: adsRows.length
    };
}

// POST /api/google-sheets/export-meta-ads
app.post('/api/google-sheets/export-meta-ads', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
        
        let { spreadsheet_id, date_range, selected_campaigns } = req.body;
        if (!spreadsheet_id) return res.status(400).json({ error: 'ID da planilha obrigatório' });

        if (spreadsheet_id.includes('spreadsheets/d/')) {
            const match = spreadsheet_id.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                spreadsheet_id = match[1];
            }
        }
        
        const client = supabaseAdmin || supabase;
        const { data: profile } = await client.from('profiles')
            .select('google_sheets_token')
            .eq('id', authUser.id)
            .maybeSingle();
        
        if (!profile?.google_sheets_token) {
            return res.status(400).json({ error: 'Google Sheets não conectado' });
        }
        
        const result = await executeMetaAdsSheetsExport(
            authUser.id,
            spreadsheet_id,
            date_range,
            profile.google_sheets_token,
            selected_campaigns
        );
        
        res.json({
            ok: true,
            ...result,
            message: `Exportado com sucesso: ${result.campaigns_rows} campanhas, ${result.adsets_rows} conjuntos, ${result.ads_rows} anúncios`
        });
    } catch (err) {
        console.error('[Meta Ads Sheets Export] Erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// Obter configuração de automação de planilhas
app.get('/api/google-sheets/automation', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const client = supabaseAdmin || supabase;
        const { data: profile, error } = await client.from('profiles')
            .select('ai_config')
            .eq('id', authUser.id)
            .maybeSingle();

        if (error) {
            if (error.message && (error.message.includes('column') && error.message.includes('ai_config'))) {
                return res.status(400).json({
                    error: 'A coluna "ai_config" está ausente no seu banco de dados Supabase. Para corrigir, vá no SQL Editor do Supabase e execute:\n\nALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_config jsonb DEFAULT \'{}\'::jsonb;',
                    code: 'MISSING_AI_CONFIG_COLUMN'
                });
            }
            return res.status(500).json({ error: 'Erro ao buscar configuração: ' + error.message });
        }

        const aiConfig = profile?.ai_config || {};
        const sheetsAutomation = aiConfig.sheets_automation || {
            enabled: false,
            spreadsheet_id: '',
            campaign_ids: ['all'],
            aggregation: 'total',
            last_run_at: null,
            last_run_status: null,
            last_run_error: null
        };

        return res.json({ ok: true, automation: sheetsAutomation });
    } catch (err) {
        console.error('[Sheets Automation GET] Erro:', err);
        return res.status(500).json({ error: err.message });
    }
});

// Atualizar configuração de automação de planilhas
app.post('/api/google-sheets/automation', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        let { enabled, spreadsheet_id, campaign_ids, aggregation } = req.body;

        // Se for URL completa, extrair ID
        if (spreadsheet_id && spreadsheet_id.includes('spreadsheets/d/')) {
            const match = spreadsheet_id.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                spreadsheet_id = match[1];
            }
        }

        const client = supabaseAdmin || supabase;
        const { data: profile, error: getErr } = await client.from('profiles')
            .select('ai_config')
            .eq('id', authUser.id)
            .maybeSingle();

        if (getErr) {
            if (getErr.message && (getErr.message.includes('column') && getErr.message.includes('ai_config'))) {
                return res.status(400).json({
                    error: 'A coluna "ai_config" está ausente no seu banco de dados Supabase. Para corrigir, vá no SQL Editor do Supabase e execute:\n\nALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_config jsonb DEFAULT \'{}\'::jsonb;',
                    code: 'MISSING_AI_CONFIG_COLUMN'
                });
            }
            return res.status(500).json({ error: 'Erro ao carregar perfil: ' + getErr.message });
        }

        const aiConfig = profile?.ai_config || {};
        const currentAutomation = aiConfig.sheets_automation || {};

        const updatedAutomation = {
            enabled: !!enabled,
            spreadsheet_id: spreadsheet_id || currentAutomation.spreadsheet_id || '',
            campaign_ids: campaign_ids || currentAutomation.campaign_ids || ['all'],
            aggregation: aggregation || currentAutomation.aggregation || 'total',
            last_run_at: currentAutomation.last_run_at || null,
            last_run_status: currentAutomation.last_run_status || null,
            last_run_error: currentAutomation.last_run_error || null
        };

        const newAiConfig = {
            ...aiConfig,
            sheets_automation: updatedAutomation
        };

        const { error: updateErr } = await client.from('profiles')
            .update({ ai_config: newAiConfig })
            .eq('id', authUser.id);

        if (updateErr) {
            if (updateErr.message && (updateErr.message.includes('column') && updateErr.message.includes('ai_config'))) {
                return res.status(400).json({
                    error: 'A coluna "ai_config" está ausente no seu banco de dados Supabase. Para corrigir, vá no SQL Editor do Supabase e execute:\n\nALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_config jsonb DEFAULT \'{}\'::jsonb;',
                    code: 'MISSING_AI_CONFIG_COLUMN'
                });
            }
            return res.status(500).json({ error: 'Erro ao salvar configuração: ' + updateErr.message });
        }

        return res.json({ ok: true, message: 'Configuração de automação salva com sucesso!', automation: updatedAutomation });
    } catch (err) {
        console.error('[Sheets Automation POST] Erro:', err);
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/ml/google-sheets/automation (Mercado Livre)
app.get('/api/ml/google-sheets/automation', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const client = supabaseAdmin || supabase;
        const { data: profile, error } = await client.from('profiles')
            .select('ai_config')
            .eq('id', authUser.id)
            .maybeSingle();

        if (error) {
            if (error.message && (error.message.includes('column') && error.message.includes('ai_config'))) {
                return res.status(400).json({
                    error: 'A coluna "ai_config" está ausente no seu banco de dados Supabase. Para corrigir, vá no SQL Editor do Supabase e execute:\n\nALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_config jsonb DEFAULT \'{}\'::jsonb;',
                    code: 'MISSING_AI_CONFIG_COLUMN'
                });
            }
            return res.status(500).json({ error: 'Erro ao buscar configuração: ' + error.message });
        }

        const aiConfig = profile?.ai_config || {};
        const mlAutomation = aiConfig.ml_sheets_automation || {
            enabled: false,
            spreadsheet_id: '',
            sheet_name: 'AXIS_ML',
            data_type: 'daily_metrics',
            last_run_at: null,
            last_run_status: null,
            last_run_error: null
        };

        return res.json({ ok: true, automation: mlAutomation });
    } catch (err) {
        console.error('[ML Sheets Automation GET] Erro:', err);
        return res.status(500).json({ error: err.message });
    }
});

// POST /api/ml/google-sheets/automation (Mercado Livre)
app.post('/api/ml/google-sheets/automation', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        let { enabled, spreadsheet_id, sheet_name, data_type } = req.body;

        // Se for URL completa, extrair ID
        if (spreadsheet_id && spreadsheet_id.includes('spreadsheets/d/')) {
            const match = spreadsheet_id.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                spreadsheet_id = match[1];
            }
        }

        const client = supabaseAdmin || supabase;
        const { data: profile, error: getErr } = await client.from('profiles')
            .select('ai_config')
            .eq('id', authUser.id)
            .maybeSingle();

        if (getErr) {
            if (getErr.message && (getErr.message.includes('column') && getErr.message.includes('ai_config'))) {
                return res.status(400).json({
                    error: 'A coluna "ai_config" está ausente no seu banco de dados Supabase. Para corrigir, vá no SQL Editor do Supabase e execute:\n\nALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_config jsonb DEFAULT \'{}\'::jsonb;',
                    code: 'MISSING_AI_CONFIG_COLUMN'
                });
            }
            return res.status(500).json({ error: 'Erro ao carregar perfil: ' + getErr.message });
        }

        const aiConfig = profile?.ai_config || {};
        const currentAutomation = aiConfig.ml_sheets_automation || {};

        const updatedAutomation = {
            enabled: !!enabled,
            spreadsheet_id: spreadsheet_id || currentAutomation.spreadsheet_id || '',
            sheet_name: sheet_name || currentAutomation.sheet_name || 'AXIS_ML',
            data_type: data_type || currentAutomation.data_type || 'daily_metrics',
            last_run_at: currentAutomation.last_run_at || null,
            last_run_status: currentAutomation.last_run_status || null,
            last_run_error: currentAutomation.last_run_error || null
        };

        const newAiConfig = {
            ...aiConfig,
            ml_sheets_automation: updatedAutomation
        };

        const { error: updateErr } = await client.from('profiles')
            .update({ ai_config: newAiConfig })
            .eq('id', authUser.id);

        if (updateErr) {
            if (updateErr.message && (updateErr.message.includes('column') && updateErr.message.includes('ai_config'))) {
                return res.status(400).json({
                    error: 'A coluna "ai_config" está ausente no seu banco de dados Supabase. Para corrigir, vá no SQL Editor do Supabase e execute:\n\nALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_config jsonb DEFAULT \'{}\'::jsonb;',
                    code: 'MISSING_AI_CONFIG_COLUMN'
                });
            }
            return res.status(500).json({ error: 'Erro ao salvar configuração: ' + updateErr.message });
        }

        return res.json({ ok: true, message: 'Configuração de automação de Mercado Livre salva com sucesso!', automation: updatedAutomation });
    } catch (err) {
        console.error('[ML Sheets Automation POST] Erro:', err);
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/meta-ads/sheets-automation
app.get('/api/meta-ads/sheets-automation', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const client = supabaseAdmin || supabase;
        const { data: profile, error } = await client.from('profiles')
            .select('meta_sheets_automation, meta_sheets_automation_enabled, meta_sheets_automation_status, meta_sheets_automation_last_run, meta_sheets_automation_error')
            .eq('id', authUser.id)
            .maybeSingle();

        if (error) {
            return res.status(500).json({ error: 'Erro ao buscar configuração: ' + error.message });
        }

        const metaAutomation = profile?.meta_sheets_automation || {
            spreadsheet_id: '',
            selected_campaigns: []
        };

        return res.json({ 
            ok: true, 
            automation: {
                enabled: !!profile?.meta_sheets_automation_enabled,
                spreadsheet_id: metaAutomation.spreadsheet_id || '',
                selected_campaigns: metaAutomation.selected_campaigns || [],
                last_run_at: profile?.meta_sheets_automation_last_run || null,
                last_run_status: profile?.meta_sheets_automation_status || null,
                last_run_error: profile?.meta_sheets_automation_error || null
            }
        });
    } catch (err) {
        console.error('[Meta Sheets Automation GET] Erro:', err);
        return res.status(500).json({ error: err.message });
    }
});

// POST /api/meta-ads/sheets-automation
app.post('/api/meta-ads/sheets-automation', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        let { enabled, spreadsheet_id, selected_campaigns } = req.body;

        // Se for URL completa, extrair ID
        if (spreadsheet_id && spreadsheet_id.includes('spreadsheets/d/')) {
            const match = spreadsheet_id.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                spreadsheet_id = match[1];
            }
        }

        const client = supabaseAdmin || supabase;
        
        const metaAutomation = {
            spreadsheet_id: spreadsheet_id || '',
            selected_campaigns: selected_campaigns || []
        };

        const { error: updateErr } = await client.from('profiles')
            .update({ 
                meta_sheets_automation_enabled: !!enabled,
                meta_sheets_automation: metaAutomation
            })
            .eq('id', authUser.id);

        if (updateErr) {
            return res.status(500).json({ error: 'Erro ao salvar configuração: ' + updateErr.message });
        }

        return res.json({ 
            ok: true, 
            message: 'Configuração de automação do Meta Ads salva com sucesso!', 
            automation: {
                enabled: !!enabled,
                spreadsheet_id: spreadsheet_id || '',
                selected_campaigns: selected_campaigns || []
            }
        });
    } catch (err) {
        console.error('[Meta Sheets Automation POST] Erro:', err);
        return res.status(500).json({ error: err.message });
    }
});

// TAREFA 5: POST /api/google-sheets/export
app.post('/api/google-sheets/export', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
        
        let { spreadsheet_id, sheet_name, data_type, sheets_token, campaign_ids, aggregation } = req.body;
        if (!spreadsheet_id) {
            return res.status(400).json({ error: 'Informe o ID ou URL da planilha do Google Sheets.' });
        }

        // Se for URL completa, extrair ID
        if (spreadsheet_id.includes('spreadsheets/d/')) {
            const match = spreadsheet_id.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                spreadsheet_id = match[1];
            }
        }

        sheet_name = sheet_name || 'Página1';
        data_type = data_type || 'daily_metrics';
        
        // Tratar datas de início e fim
        let { start_date, end_date } = req.body;
        let sDate = start_date ? new Date(start_date) : new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
        let eDate = end_date ? new Date(end_date) : new Date();
        if (isNaN(sDate.getTime())) sDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
        if (isNaN(eDate.getTime())) eDate = new Date();
        
        sDate.setHours(0, 0, 0, 0);
        eDate.setHours(23, 59, 59, 999);
        
        const startISO = sDate.toISOString();
        const endISO = eDate.toISOString();

        // Pegar token do Google Sheets
        const client = supabaseAdmin || supabase;
        const { data: profile } = await client.from('profiles')
            .select('google_sheets_token, google_sheets_refresh_token')
            .eq('id', authUser.id)
            .maybeSingle();
        
        let tokenToUse = sheets_token || profile?.google_sheets_token;
        if (!tokenToUse) {
            return res.status(401).json({ 
                error: 'Sua conta do Google Sheets não está conectada ou o token expirou. Por favor, clique em "Conectar Google Sheets" para autorizar.',
                code: 'UNAUTHENTICATED' 
            });
        }

        // 1. Buscar metadados para validar o token e obter abas existentes
        let metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}?fields=sheets.properties.title`, {
            headers: { 'Authorization': `Bearer ${tokenToUse}` }
        });
        
        if (metaRes.status === 401 && profile?.google_sheets_refresh_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
            try {
                const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: GOOGLE_CLIENT_ID,
                        client_secret: GOOGLE_CLIENT_SECRET,
                        refresh_token: profile.google_sheets_refresh_token,
                        grant_type: 'refresh_token'
                    })
                });
                if (refreshRes.ok) {
                    const refreshData = await refreshRes.json();
                    if (refreshData.access_token) {
                        tokenToUse = refreshData.access_token;
                        await client.from('profiles').update({ google_sheets_token: tokenToUse }).eq('id', authUser.id);
                        metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}?fields=sheets.properties.title`, {
                            headers: { 'Authorization': `Bearer ${tokenToUse}` }
                        });
                    }
                }
            } catch (refErr) {
                console.warn('[Sheets Export] Erro na renovação automática do token:', refErr);
            }
        }
        
        if (!metaRes.ok) {
            const errText = await metaRes.text();
            if (metaRes.status === 401 || errText.includes('UNAUTHENTICATED') || errText.includes('invalid authentication credentials')) {
                return res.status(401).json({ 
                    error: 'Token do Google Sheets expirado ou não autorizado. Por favor, clique em "Conectar Google Sheets" para reautorizar a sua conta.',
                    code: 'UNAUTHENTICATED'
                });
            }
            return res.status(metaRes.status).json({ error: `Erro ao acessar a planilha do Google Sheets: ${errText}` });
        }
        
        const meta = await metaRes.json();
        const existingSheets = (meta.sheets || []).map(s => s.properties?.title || '');

        // Caso especial: EXPORTAÇÃO DO GOOGLE ADS (Multi-Abas)
        if (data_type === 'google_ads') {
            const { data: googleAds } = await client.from('google_ads_integrations').select('*').eq('user_id', authUser.id).maybeSingle();
            if (!googleAds || !googleAds.customer_id) {
                return res.status(400).json({ error: 'Sua conta do Google Ads não está conectada ou não possui um ID de cliente configurado.' });
            }
            const customerId = googleAds.customer_id;

            // Sanitizar datas de início e fim no formato YYYY-MM-DD
            const sanitizedStart = start_date ? String(start_date).replace(/[^0-9-]/g, '') : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const sanitizedEnd = end_date ? String(end_date).replace(/[^0-9-]/g, '') : new Date().toISOString().split('T')[0];

            // Consultar as 3 visões do Google Ads em paralelo
            const campaignQuery = `
                SELECT 
                    campaign.id, 
                    campaign.name, 
                    campaign.status, 
                    campaign.advertising_channel_type,
                    segments.date,
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
                AND segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
            `;
            const keywordQuery = `
                SELECT 
                    ad_group_criterion.keyword.text, 
                    ad_group_criterion.keyword.match_type, 
                    ad_group_criterion.status, 
                    ad_group_criterion.quality_info.quality_score, 
                    campaign.id,
                    campaign.name, 
                    ad_group.name, 
                    metrics.clicks, 
                    metrics.impressions, 
                    metrics.cost_micros, 
                    metrics.conversions,
                    metrics.conversions_value
                FROM keyword_view 
                WHERE segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
            `;
            const searchTermQuery = `
                SELECT 
                    search_term_view.search_term, 
                    campaign.id,
                    campaign.name, 
                    ad_group.name,
                    metrics.clicks, 
                    metrics.impressions, 
                    metrics.cost_micros,
                    metrics.conversions, 
                    metrics.conversions_value,
                    metrics.ctr
                FROM search_term_view
                WHERE segments.date BETWEEN '${sanitizedStart}' AND '${sanitizedEnd}'
                AND metrics.impressions > 0
                ORDER BY metrics.cost_micros DESC
                LIMIT 200
            `;

            const [campaignResults, keywordResults, searchTermResults] = await Promise.all([
                executeGoogleAdsQuery(authUser.id, campaignQuery, false, customerId).catch(err => { console.error('Erro campanhas ads:', err); return []; }),
                executeGoogleAdsQuery(authUser.id, keywordQuery, false, customerId).catch(err => { console.error('Erro keywords ads:', err); return []; }),
                executeGoogleAdsQuery(authUser.id, searchTermQuery, false, customerId).catch(err => { console.error('Erro search terms ads:', err); return []; })
            ]);

            // Filtragem por ID de Campanhas selecionadas
            const campaignIdSet = new Set();
            if (Array.isArray(campaign_ids) && campaign_ids.length > 0 && !campaign_ids.includes('all')) {
                campaign_ids.forEach(id => campaignIdSet.add(String(id)));
            }

            const filteredCampaignResults = (campaignResults || []).filter(row => {
                const cid = row.campaign?.id ? String(row.campaign.id) : '';
                if (campaignIdSet.size > 0 && !campaignIdSet.has(cid)) {
                    return false;
                }
                return true;
            });

            const filteredKeywordResults = (keywordResults || []).filter(row => {
                const cid = row.campaign?.id ? String(row.campaign.id) : '';
                if (campaignIdSet.size > 0 && !campaignIdSet.has(cid)) {
                    return false;
                }
                return true;
            });

            const filteredSearchTermResults = (searchTermResults || []).filter(row => {
                const cid = row.campaign?.id ? String(row.campaign.id) : '';
                if (campaignIdSet.size > 0 && !campaignIdSet.has(cid)) {
                    return false;
                }
                return true;
            });

            // Determinar o tipo de agregação para as campanhas
            const agg = aggregation || 'total'; // 'daily' | 'monthly' | 'total'
            let campaignHeaders = [];
            let campaignRows = [];

            if (agg === 'daily') {
                campaignHeaders = [
                    'Data', 'ID da Campanha', 'Nome da Campanha', 'Status', 'Tipo de Canal', 
                    'Orçamento Diário', 'Impressões', 'Cliques', 'CTR (%)', 'CPC Médio', 
                    'Gasto Total', 'Conversões', 'Custo por Conversão (CPA)', 'Taxa de Conversão (%)', 
                    'Valor de Conversão (Receita)', 'ROAS'
                ];
                
                campaignRows = filteredCampaignResults.map(row => {
                    const budget = (parseInt(row.campaignBudget?.amountMicros) || 0) / 1000000;
                    const clicks = parseInt(row.metrics?.clicks) || 0;
                    const impressions = parseInt(row.metrics?.impressions) || 0;
                    const cost = (parseInt(row.metrics?.costMicros) || 0) / 1000000;
                    const conversions = parseFloat(row.metrics?.conversions) || 0;
                    const convValue = parseFloat(row.metrics?.conversionsValue) || 0;
                    
                    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
                    const averageCpc = clicks > 0 ? (cost / clicks) : 0;
                    const cpa = conversions > 0 ? (cost / conversions) : 0;
                    const convRate = clicks > 0 ? (conversions / clicks) * 100 : 0;
                    const roas = cost > 0 ? (convValue / cost) : 0;
                    
                    return [
                        row.segments?.date || '',
                        row.campaign?.id || '',
                        row.campaign?.name || '',
                        row.campaign?.status || '',
                        row.campaign?.advertisingChannelType || '',
                        `R$ ${budget.toFixed(2)}`,
                        impressions,
                        clicks,
                        `${ctr.toFixed(2)}%`,
                        `R$ ${averageCpc.toFixed(2)}`,
                        `R$ ${cost.toFixed(2)}`,
                        conversions,
                        conversions > 0 ? `R$ ${cpa.toFixed(2)}` : 'R$ 0.00',
                        `${convRate.toFixed(2)}%`,
                        `R$ ${convValue.toFixed(2)}`,
                        `${roas.toFixed(2)}x`
                    ];
                });
                // Ordenar por data chronologicamente
                campaignRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])));
            } else if (agg === 'monthly') {
                campaignHeaders = [
                    'Mês', 'ID da Campanha', 'Nome da Campanha', 'Status', 'Tipo de Canal', 
                    'Orçamento Diário', 'Impressões', 'Cliques', 'CTR (%)', 'CPC Médio', 
                    'Gasto Total', 'Conversões', 'Custo por Conversão (CPA)', 'Taxa de Conversão (%)', 
                    'Valor de Conversão (Receita)', 'ROAS'
                ];

                const monthlyGroups = {};
                for (const row of filteredCampaignResults) {
                    const date = row.segments?.date || '';
                    const month = date ? date.substring(0, 7) : 'Desconhecido';
                    const campaignId = row.campaign?.id || 'unknown';
                    const key = `${campaignId}_${month}`;
                    
                    if (!monthlyGroups[key]) {
                        monthlyGroups[key] = {
                            month,
                            id: row.campaign?.id || '',
                            name: row.campaign?.name || '',
                            status: row.campaign?.status || '',
                            channelType: row.campaign?.advertisingChannelType || '',
                            budgetMicros: parseInt(row.campaignBudget?.amountMicros) || 0,
                            impressions: 0,
                            clicks: 0,
                            costMicros: 0,
                            conversions: 0,
                            conversionsValue: 0
                        };
                    }
                    
                    monthlyGroups[key].impressions += parseInt(row.metrics?.impressions) || 0;
                    monthlyGroups[key].clicks += parseInt(row.metrics?.clicks) || 0;
                    monthlyGroups[key].costMicros += parseInt(row.metrics?.costMicros) || 0;
                    monthlyGroups[key].conversions += parseFloat(row.metrics?.conversions) || 0;
                    monthlyGroups[key].conversionsValue += parseFloat(row.metrics?.conversionsValue) || 0;
                }
                
                campaignRows = Object.values(monthlyGroups).map(g => {
                    const budget = g.budgetMicros / 1000000;
                    const cost = g.costMicros / 1000000;
                    const ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
                    const averageCpc = g.clicks > 0 ? (cost / g.clicks) : 0;
                    const cpa = g.conversions > 0 ? (cost / g.conversions) : 0;
                    const convRate = g.clicks > 0 ? (g.conversions / g.clicks) * 100 : 0;
                    const roas = cost > 0 ? (g.conversionsValue / cost) : 0;
                    
                    return [
                        g.month,
                        g.id,
                        g.name,
                        g.status,
                        g.channelType,
                        `R$ ${budget.toFixed(2)}`,
                        g.impressions,
                        g.clicks,
                        `${ctr.toFixed(2)}%`,
                        `R$ ${averageCpc.toFixed(2)}`,
                        `R$ ${cost.toFixed(2)}`,
                        g.conversions,
                        g.conversions > 0 ? `R$ ${cpa.toFixed(2)}` : 'R$ 0.00',
                        `${convRate.toFixed(2)}%`,
                        `R$ ${g.conversionsValue.toFixed(2)}`,
                        `${roas.toFixed(2)}x`
                    ];
                });
                // Ordenar por mês
                campaignRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])));
            } else {
                // total
                campaignHeaders = [
                    'ID da Campanha', 'Nome da Campanha', 'Status', 'Tipo de Canal', 
                    'Orçamento Diário', 'Impressões', 'Cliques', 'CTR (%)', 'CPC Médio', 
                    'Gasto Total', 'Conversões', 'Custo por Conversão (CPA)', 'Taxa de Conversão (%)', 
                    'Valor de Conversão (Receita)', 'ROAS'
                ];

                const totalGroups = {};
                for (const row of filteredCampaignResults) {
                    const campaignId = row.campaign?.id || 'unknown';
                    
                    if (!totalGroups[campaignId]) {
                        totalGroups[campaignId] = {
                            id: row.campaign?.id || '',
                            name: row.campaign?.name || '',
                            status: row.campaign?.status || '',
                            channelType: row.campaign?.advertisingChannelType || '',
                            budgetMicros: parseInt(row.campaignBudget?.amountMicros) || 0,
                            impressions: 0,
                            clicks: 0,
                            costMicros: 0,
                            conversions: 0,
                            conversionsValue: 0
                        };
                    }
                    
                    totalGroups[campaignId].impressions += parseInt(row.metrics?.impressions) || 0;
                    totalGroups[campaignId].clicks += parseInt(row.metrics?.clicks) || 0;
                    totalGroups[campaignId].costMicros += parseInt(row.metrics?.costMicros) || 0;
                    totalGroups[campaignId].conversions += parseFloat(row.metrics?.conversions) || 0;
                    totalGroups[campaignId].conversionsValue += parseFloat(row.metrics?.conversionsValue) || 0;
                }
                
                campaignRows = Object.values(totalGroups).map(g => {
                    const budget = g.budgetMicros / 1000000;
                    const cost = g.costMicros / 1000000;
                    const ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
                    const averageCpc = g.clicks > 0 ? (cost / g.clicks) : 0;
                    const cpa = g.conversions > 0 ? (cost / g.conversions) : 0;
                    const convRate = g.clicks > 0 ? (g.conversions / g.clicks) * 100 : 0;
                    const roas = cost > 0 ? (g.conversionsValue / cost) : 0;
                    
                    return [
                        g.id,
                        g.name,
                        g.status,
                        g.channelType,
                        `R$ ${budget.toFixed(2)}`,
                        g.impressions,
                        g.clicks,
                        `${ctr.toFixed(2)}%`,
                        `R$ ${averageCpc.toFixed(2)}`,
                        `R$ ${cost.toFixed(2)}`,
                        g.conversions,
                        g.conversions > 0 ? `R$ ${cpa.toFixed(2)}` : 'R$ 0.00',
                        `${convRate.toFixed(2)}%`,
                        `R$ ${g.conversionsValue.toFixed(2)}`,
                        `${roas.toFixed(2)}x`
                    ];
                });
                campaignRows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
            }

            // Formatar Palavras-Chave com todas as métricas extras
            const keywordHeaders = [
                'Palavra-Chave', 'Tipo de Correspondência', 'Status', 'Índice de Qualidade', 
                'ID da Campanha', 'Campanha', 'Grupo de Anúncios', 'Impressões', 'Cliques', 
                'CTR (%)', 'CPC Médio', 'Gasto Total', 'Conversões', 'Custo por Conversão (CPA)', 
                'Taxa de Conversão (%)', 'Valor de Conversão (Receita)', 'ROAS'
            ];
            const keywordRows = filteredKeywordResults.map(row => {
                const clicks = parseInt(row.metrics?.clicks) || 0;
                const impressions = parseInt(row.metrics?.impressions) || 0;
                const cost = (parseInt(row.metrics?.costMicros) || 0) / 1000000;
                const conversions = parseFloat(row.metrics?.conversions) || 0;
                const convValue = parseFloat(row.metrics?.conversionsValue) || 0;
                
                const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
                const averageCpc = clicks > 0 ? (cost / clicks) : 0;
                const cpa = conversions > 0 ? (cost / conversions) : 0;
                const convRate = clicks > 0 ? (conversions / clicks) * 100 : 0;
                const roas = cost > 0 ? (convValue / cost) : 0;
                
                return [
                    row.adGroupCriterion?.keyword?.text || '',
                    row.adGroupCriterion?.keyword?.matchType || '',
                    row.adGroupCriterion?.status || '',
                    row.adGroupCriterion?.qualityInfo?.qualityScore || '-',
                    row.campaign?.id || '',
                    row.campaign?.name || '',
                    row.adGroup?.name || '',
                    impressions,
                    clicks,
                    `${ctr.toFixed(2)}%`,
                    `R$ ${averageCpc.toFixed(2)}`,
                    `R$ ${cost.toFixed(2)}`,
                    conversions,
                    conversions > 0 ? `R$ ${cpa.toFixed(2)}` : 'R$ 0.00',
                    `${convRate.toFixed(2)}%`,
                    `R$ ${convValue.toFixed(2)}`,
                    `${roas.toFixed(2)}x`
                ];
            });

            // Formatar Termos de Pesquisa com todas as métricas extras
            const searchTermHeaders = [
                'Termo de Pesquisa', 'ID da Campanha', 'Campanha', 'Grupo de Anúncios', 
                'Impressões', 'Cliques', 'CTR (%)', 'CPC Médio', 'Gasto Total', 
                'Conversões', 'Custo por Conversão (CPA)', 'Taxa de Conversão (%)', 
                'Valor de Conversão (Receita)', 'ROAS'
            ];
            const searchTermRows = filteredSearchTermResults.map(row => {
                const clicks = parseInt(row.metrics?.clicks) || 0;
                const impressions = parseInt(row.metrics?.impressions) || 0;
                const cost = (parseInt(row.metrics?.costMicros) || 0) / 1000000;
                const conversions = parseFloat(row.metrics?.conversions) || 0;
                const convValue = parseFloat(row.metrics?.conversionsValue) || 0;
                
                const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
                const averageCpc = clicks > 0 ? (cost / clicks) : 0;
                const cpa = conversions > 0 ? (cost / conversions) : 0;
                const convRate = clicks > 0 ? (conversions / clicks) * 100 : 0;
                const roas = cost > 0 ? (convValue / cost) : 0;
                
                return [
                    row.searchTermView?.searchTerm || '',
                    row.campaign?.id || '',
                    row.campaign?.name || '',
                    row.adGroup?.name || '',
                    impressions,
                    clicks,
                    `${ctr.toFixed(2)}%`,
                    `R$ ${averageCpc.toFixed(2)}`,
                    `R$ ${cost.toFixed(2)}`,
                    conversions,
                    conversions > 0 ? `R$ ${cpa.toFixed(2)}` : 'R$ 0.00',
                    `${convRate.toFixed(2)}%`,
                    `R$ ${convValue.toFixed(2)}`,
                    `${roas.toFixed(2)}x`
                ];
            });

            const sheetsData = [
                {
                    title: 'Google Ads - Campanhas',
                    headers: campaignHeaders,
                    rows: campaignRows
                },
                {
                    title: 'Google Ads - Palavras-Chave',
                    headers: keywordHeaders,
                    rows: keywordRows
                },
                {
                    title: 'Google Ads - Termos de Pesquisa',
                    headers: searchTermHeaders,
                    rows: searchTermRows
                }
            ];

            // Garantir que as 3 abas existam
            const requiredSheets = sheetsData.map(s => s.title);
            const sheetsToAdd = requiredSheets.filter(title => !existingSheets.includes(title));

            if (sheetsToAdd.length > 0) {
                const addRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}:batchUpdate`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${tokenToUse}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        requests: sheetsToAdd.map(title => ({
                            addSheet: {
                                properties: { title }
                            }
                        }))
                    })
                });
                if (!addRes.ok) {
                    const addText = await addRes.text();
                    console.warn('[Sheets Export] Erro ao adicionar abas:', addText);
                }
            }

            // Escrever em cada aba de forma sequencial
            for (const sheet of sheetsData) {
                const values = [sheet.headers, ...sheet.rows];
                
                // Limpar dados anteriores
                await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(sheet.title + '!A1:Z20000')}:clear`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${tokenToUse}`
                    }
                });

                // Gravar novos dados
                const range = `${sheet.title}!A1`;
                const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${tokenToUse}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ values })
                });

                if (!writeRes.ok) {
                    const errText = await writeRes.text();
                    console.error(`[Sheets Export] Erro ao escrever na aba ${sheet.title}:`, errText);
                }
            }

            return res.json({
                ok: true,
                message: `Dados do Google Ads exportados com sucesso em 3 abas (Agregação: ${agg === 'daily' ? 'Diária' : agg === 'monthly' ? 'Mensal' : 'Total acumulado'})!`
            });
        }

        try {
            const msg = await executeGoogleSheetsMLExport(authUser.id, spreadsheet_id, sheet_name, data_type, sDate, eDate, tokenToUse);
            return res.json({
                ok: true,
                message: msg
            });
        } catch (exportErr) {
            const errText = exportErr.message || '';
            if (errText.includes('UNAUTHENTICATED') || errText.includes('invalid authentication credentials') || errText.includes('token expirou') || errText.includes('não está conectada')) {
                return res.status(401).json({ 
                    error: 'Token do Google Sheets expirado ou não autorizado. Por favor, clique em "Conectar Google Sheets" para reautorizar a sua conta.',
                    code: 'UNAUTHENTICATED'
                });
            }
            return res.status(500).json({ error: `Erro ao exportar dados para o Google Sheets: ${errText}` });
        }
    } catch (err) {
        console.error('[Sheets Export] Erro:', err);
        return res.status(500).json({ error: err.message });
    }
});

// -----------------------------------------------------------------------------
// MERCADO LIVRE ADVERTISING (PRODUCT ADS) & ITEMS MANAGEMENT API
// -----------------------------------------------------------------------------

// Helper: Discover & cache advertiser_id for Mercado Livre Advertising API
async function getMlAdvertiserId(userId) {
    const client = supabaseAdmin || supabase;

    // 1. Tentar buscar do cache (ml_advertisers)
    const { data: cached } = await client.from('ml_advertisers')
        .select('advertiser_id, site_id')
        .eq('user_id', userId)
        .maybeSingle();

    if (cached?.advertiser_id) return cached;

    // 2. Buscar ml_user_id
    const { data: conn } = await client.from('ml_connections')
        .select('ml_user_id')
        .eq('user_id', userId)
        .maybeSingle();

    if (!conn?.ml_user_id) throw new Error('Mercado Livre não conectado para este usuário');

    // 3. Descobrir advertiser_id via API
    const token = await getValidMlToken(userId);
    const res = await fetch('https://api.mercadolibre.com/advertising/advertisers?product_id=PADS', {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Api-Version': '1' // CAPITALIZADO!
        }
    });

    if (!res.ok) throw new Error(`Erro ao buscar advertisers no ML: ${await res.text()}`);
    const data = await res.json();

    const adv = data.advertisers?.[0];
    if (!adv) throw new Error('Nenhum advertiser de Product Ads encontrado no Mercado Livre');

    // 4. Salvar no cache
    await client.from('ml_advertisers').upsert({
        user_id: userId,
        ml_user_id: Number(conn.ml_user_id),
        advertiser_id: Number(adv.advertiser_id),
        product_id: 'PADS',
        site_id: adv.site_id || 'MLB',
        discovered_at: new Date().toISOString()
    }, { onConflict: 'user_id,ml_user_id' });

    return { advertiser_id: Number(adv.advertiser_id), site_id: adv.site_id || 'MLB' };
}

// 1) POST /api/ml/advertising/sync (Sincronizar campanhas e ad_groups do Product Ads)
app.post('/api/ml/advertising/sync', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
        
        const { advertiser_id, site_id } = await getMlAdvertiserId(authUser.id);
        const token = await getValidMlToken(authUser.id);
        const client = supabaseAdmin || supabase;
        
        // Janela temporal: últimos 90 dias (padrão pra métricas)
        const dateTo = new Date();
        const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const dateFromStr = dateFrom.toISOString().split('T')[0];
        const dateToStr = dateTo.toISOString().split('T')[0];
        
        // Lista CANÔNICA expandida (testada — todas funcionam):
        const metricsList = 'clicks,prints,ctr,cost,cpc,acos,roas,cv,tacos,sov,direct_amount,indirect_amount,total_amount,direct_units_quantity,indirect_units_quantity,units_quantity,organic_units_quantity,organic_units_amount,organic_items_quantity,direct_items_quantity,indirect_items_quantity,advertising_items_quantity';
        
        // 1. Buscar campanhas COM métricas
        const campRes = await fetch(
            `https://api.mercadolibre.com/marketplace/advertising/${site_id}/advertisers/${advertiser_id}/product_ads/campaigns/search?metrics=${metricsList}&date_from=${dateFromStr}&date_to=${dateToStr}`,
            { headers: { 'Authorization': `Bearer ${token}`, 'api-version': '2' } }
        );
        
        if (!campRes.ok) throw new Error(`Erro campaigns: ${await campRes.text()}`);
        const campData = await campRes.json();
        
        let campaignsSynced = 0;
        const campaignsList = campData.results || campData.campaigns || [];
        for (const camp of campaignsList) {
            const m = camp.metrics || {};
            await client.from('ml_ad_campaigns').upsert({
                user_id: authUser.id,
                advertiser_id: Number(advertiser_id),
                campaign_id: Number(camp.id),
                name: camp.name || '',
                status: camp.status || '',
                campaign_type: camp.campaign_type || 'PADS',
                budget_amount: typeof camp.budget === 'number' ? camp.budget : (camp.budget?.amount || 0),
                budget_type: camp.budget_type || (typeof camp.budget === 'object' ? camp.budget?.type : '') || (camp.automatic_budget ? 'automatic' : 'daily'),
                roas_target: camp.roas_target || camp.acos_target || null,
                created_at_ml: camp.date_created ? new Date(camp.date_created).toISOString() : null,
                updated_at_ml: camp.last_updated ? new Date(camp.last_updated).toISOString() : null,
                // Métricas (chaves corretas da API):
                clicks: m.clicks || 0,
                prints: m.prints || 0,
                cost: m.cost || 0,
                ctr: m.ctr || 0,
                cpc: m.cpc || 0,
                direct_amount: m.direct_amount || 0,
                indirect_amount: m.indirect_amount || 0,
                total_amount: m.total_amount || 0,
                units_quantity: m.units_quantity || 0,
                roas: m.roas || null,
                cvr: m.cv || m.cvr || 0,
                tacos: m.tacos || 0,
                sov: m.sov || 0,
                organic_units_quantity: m.organic_units_quantity || 0,
                organic_units_amount: m.organic_units_amount || 0,
                raw_payload: camp,
                last_synced_at: new Date().toISOString()
            }, { onConflict: 'advertiser_id,campaign_id' });
            campaignsSynced++;
        }
        
        // 2. Buscar ad_groups COM métricas (sem filtro de campaign — pega todos)
        const agRes = await fetch(
            `https://api.mercadolibre.com/marketplace/advertising/${site_id}/advertisers/${advertiser_id}/product_ads/ad_groups/search?metrics=${metricsList}&date_from=${dateFromStr}&date_to=${dateToStr}&limit=50&offset=0`,
            { headers: { 'Authorization': `Bearer ${token}`, 'api-version': '2' } }
        );
        
        let adGroupsSynced = 0;
        if (agRes.ok) {
            const agData = await agRes.json();
            const adGroupsList = agData.results || [];
            for (const ag of adGroupsList) {
                const m = ag.metrics || {};
                await client.from('ml_ad_groups').upsert({
                    user_id: authUser.id,
                    advertiser_id: Number(advertiser_id),
                    campaign_id: Number(ag.campaign_id || 0),
                    ad_group_id: Number(ag.id),
                    item_id: ag.ad_group_external_id || '',
                    title: ag.title || '',
                    thumbnail: ag.thumbnail || '',
                    status: ag.status || '',
                    cpc_bid: ag.cpc_bid || 0,
                    roas_target: ag.roas_target || null,
                    // Métricas (chaves corretas):
                    clicks: m.clicks || 0,
                    prints: m.prints || 0,
                    cost: m.cost || 0,
                    ctr: m.ctr || 0,
                    cpc: m.cpc || 0,
                    direct_amount: m.direct_amount || 0,
                    indirect_amount: m.indirect_amount || 0,
                    total_amount: m.total_amount || 0,
                    units_quantity: m.units_quantity || 0,
                    roas: m.roas || null,
                    sales_amount: m.total_amount || 0,  // manter compatibilidade
                    raw_payload: ag,
                    last_synced_at: new Date().toISOString()
                }, { onConflict: 'advertiser_id,ad_group_id' });
                adGroupsSynced++;
            }
        }
        
        res.json({
            ok: true,
            campaigns_synced: campaignsSynced,
            ad_groups_synced: adGroupsSynced,
            period: { from: dateFromStr, to: dateToStr },
            message: `${campaignsSynced} campanhas e ${adGroupsSynced} anúncios sincronizados com métricas`
        });
    } catch (err) {
        console.error('[ML Advertising Sync] Erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 2) GET /api/ml/advertising/campaigns (Listar campanhas sincronizadas)
app.get('/api/ml/advertising/campaigns', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const client = supabaseAdmin || supabase;
        const { data: campaigns, error: campErr } = await client
            .from('ml_ad_campaigns')
            .select('*')
            .eq('user_id', authUser.id)
            .order('updated_at_ml', { ascending: false });

        if (campErr) throw campErr;

        const { data: adGroups } = await client
            .from('ml_ad_groups')
            .select('*')
            .eq('user_id', authUser.id);

        const result = (campaigns || []).map(camp => {
            const campGroups = (adGroups || []).filter(g => Number(g.campaign_id) === Number(camp.campaign_id));
            const total_clicks = camp.clicks || campGroups.reduce((s, g) => s + (Number(g.clicks) || 0), 0);
            const total_prints = camp.prints || campGroups.reduce((s, g) => s + (Number(g.prints) || 0), 0);
            const total_cost = camp.cost || campGroups.reduce((s, g) => s + (Number(g.cost) || 0), 0);
            const total_sales = camp.total_amount || campGroups.reduce((s, g) => s + (Number(g.total_amount || g.sales_amount) || 0), 0);
            const total_roas = camp.roas || (total_cost > 0 ? (total_sales / total_cost) : null);

            return {
                ...camp,
                id: camp.id,
                campaign_id: camp.campaign_id,
                advertiser_id: camp.advertiser_id,
                name: camp.name,
                status: camp.status,
                campaign_type: camp.campaign_type,
                budget_amount: camp.budget_amount,
                budget_type: camp.budget_type,
                roas_target: camp.roas_target,
                created_at_ml: camp.created_at_ml,
                updated_at_ml: camp.updated_at_ml,
                last_synced_at: camp.last_synced_at,
                clicks: camp.clicks || total_clicks,
                prints: camp.prints || total_prints,
                cost: camp.cost || total_cost,
                total_amount: camp.total_amount || total_sales,
                roas: camp.roas || total_roas,
                total_clicks,
                total_prints,
                total_cost,
                total_sales,
                total_roas,
                ad_groups_count: campGroups.length,
                ad_groups: campGroups,
                raw_payload: camp.raw_payload
            };
        });

        res.json({ ok: true, campaigns: result });
    } catch (err) {
        console.error('[ML Advertising] GET Campaigns erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3) GET /api/ml/advertising/campaigns/:id (Detalhes de uma campanha e seus ad_groups)
app.get('/api/ml/advertising/campaigns/:id', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const client = supabaseAdmin || supabase;
        const campaignIdParam = req.params.id;

        const { data: campaign } = await client
            .from('ml_ad_campaigns')
            .select('*')
            .eq('user_id', authUser.id)
            .or(`campaign_id.eq.${campaignIdParam},id.eq.${isNaN(Number(campaignIdParam)) ? 0 : campaignIdParam}`)
            .maybeSingle();

        if (!campaign) {
            return res.status(404).json({ error: 'Campanha não encontrada' });
        }

        const { data: adGroups } = await client
            .from('ml_ad_groups')
            .select('*')
            .eq('user_id', authUser.id)
            .eq('campaign_id', campaign.campaign_id);

        res.json({
            ok: true,
            campaign,
            ad_groups: adGroups || []
        });
    } catch (err) {
        console.error('[ML Advertising] GET Campaign Details erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 4) POST /api/ml/advertising/campaigns (Criar nova campanha de Product Ads)
app.post('/api/ml/advertising/campaigns', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const { name, budget_amount, budget_type, roas_target, item_ids } = req.body;
        if (!name || !budget_amount) {
            return res.status(400).json({ error: 'Nome e valor do orçamento são obrigatórios' });
        }

        const { advertiser_id, site_id } = await getMlAdvertiserId(authUser.id);
        const token = await getValidMlToken(authUser.id);
        const client = supabaseAdmin || supabase;

        const payload = {
            name,
            budget: {
                amount: Number(budget_amount),
                type: budget_type || 'daily'
            },
            roas_target: roas_target ? Number(roas_target) : undefined
        };

        if (Array.isArray(item_ids) && item_ids.length > 0) {
            payload.item_ids = item_ids;
        }

        const mlRes = await fetch(
            `https://api.mercadolibre.com/marketplace/advertising/${site_id}/advertisers/${advertiser_id}/product_ads/campaigns`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'api-version': '2'
                },
                body: JSON.stringify(payload)
            }
        );

        const mlData = await mlRes.json();
        if (!mlRes.ok) {
            return res.status(mlRes.status).json({ error: mlData.message || mlData.error || 'Erro ao criar campanha no Mercado Livre', details: mlData });
        }

        const createdCampId = mlData.id || mlData.campaign_id;
        if (createdCampId) {
            await client.from('ml_ad_campaigns').upsert({
                user_id: authUser.id,
                advertiser_id: Number(advertiser_id),
                campaign_id: Number(createdCampId),
                name: mlData.name || name,
                status: mlData.status || 'active',
                campaign_type: mlData.campaign_type || 'PADS',
                budget_amount: mlData.budget?.amount || Number(budget_amount),
                budget_type: mlData.budget?.type || budget_type || 'daily',
                roas_target: mlData.roas_target || roas_target || null,
                created_at_ml: mlData.date_created ? new Date(mlData.date_created).toISOString() : new Date().toISOString(),
                updated_at_ml: new Date().toISOString(),
                raw_payload: mlData,
                last_synced_at: new Date().toISOString()
            }, { onConflict: 'advertiser_id,campaign_id' });
        }

        res.json({ ok: true, campaign: mlData });
    } catch (err) {
        console.error('[ML Advertising] POST Campaign erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 5) PATCH /api/ml/advertising/campaigns/:id (Editar campanha existente)
app.patch('/api/ml/advertising/campaigns/:id', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const campaignId = req.params.id;
        const { name, budget_amount, budget_type, roas_target, status } = req.body;

        const { advertiser_id, site_id } = await getMlAdvertiserId(authUser.id);
        const token = await getValidMlToken(authUser.id);
        const client = supabaseAdmin || supabase;

        const payload = {};
        if (name) payload.name = name;
        if (status) payload.status = status;
        if (budget_amount) {
            payload.budget = {
                amount: Number(budget_amount),
                type: budget_type || 'daily'
            };
        }
        if (roas_target !== undefined) {
            payload.roas_target = Number(roas_target);
        }

        const mlRes = await fetch(
            `https://api.mercadolibre.com/marketplace/advertising/${site_id}/product_ads/campaigns/${campaignId}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'api-version': '2'
                },
                body: JSON.stringify(payload)
            }
        );

        const mlData = await mlRes.json();
        if (!mlRes.ok) {
            return res.status(mlRes.status).json({ error: mlData.message || mlData.error || 'Erro ao atualizar campanha no Mercado Livre', details: mlData });
        }

        const updateData = {
            updated_at_ml: new Date().toISOString(),
            last_synced_at: new Date().toISOString()
        };
        if (name) updateData.name = name;
        if (status) updateData.status = status;
        if (budget_amount) updateData.budget_amount = Number(budget_amount);
        if (budget_type) updateData.budget_type = budget_type;
        if (roas_target !== undefined) updateData.roas_target = Number(roas_target);
        if (mlData) updateData.raw_payload = mlData;

        await client.from('ml_ad_campaigns')
            .update(updateData)
            .eq('user_id', authUser.id)
            .eq('campaign_id', campaignId);

        res.json({ ok: true, campaign: mlData });
    } catch (err) {
        console.error('[ML Advertising] PATCH Campaign erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 6) DELETE /api/ml/advertising/campaigns/:id (Deletar campanha de Product Ads)
app.delete('/api/ml/advertising/campaigns/:id', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const campaignId = req.params.id;
        const { site_id } = await getMlAdvertiserId(authUser.id);
        const token = await getValidMlToken(authUser.id);
        const client = supabaseAdmin || supabase;

        const mlRes = await fetch(
            `https://api.mercadolibre.com/marketplace/advertising/${site_id}/product_ads/campaigns/${campaignId}`,
            {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'api-version': '2'
                }
            }
        );

        if (!mlRes.ok && mlRes.status !== 404) {
            const mlData = await mlRes.json().catch(() => ({}));
            return res.status(mlRes.status).json({ error: mlData.message || mlData.error || 'Erro ao excluir campanha no Mercado Livre' });
        }

        await client.from('ml_ad_campaigns')
            .delete()
            .eq('user_id', authUser.id)
            .eq('campaign_id', campaignId);

        res.json({ ok: true, message: 'Campanha excluída com sucesso' });
    } catch (err) {
        console.error('[ML Advertising] DELETE Campaign erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- HELPER DE REGRAS AUTOMÁTICAS DE ADS ---
async function getAdRules(userId) {
    const client = supabaseAdmin || supabase;
    try {
        const { data, error } = await client.from('ml_ad_rules').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (!error && Array.isArray(data)) return data;
    } catch (e) {}
    try {
        const { data } = await client.from('profiles').select('ml_ad_rules').eq('id', userId).maybeSingle();
        return Array.isArray(data?.ml_ad_rules) ? data.ml_ad_rules : [];
    } catch (e) {
        return [];
    }
}

async function saveAdRulesFallback(userId, rules) {
    const client = supabaseAdmin || supabase;
    try {
        await client.from('profiles').update({ ml_ad_rules: rules }).eq('id', userId);
    } catch (e) {}
}

// 7) GET /api/ml/advertising/rules (Listar Regras Automáticas)
app.get('/api/ml/advertising/rules', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const rules = await getAdRules(authUser.id);
        res.json({ ok: true, rules });
    } catch (err) {
        console.error('[ML Ad Rules] GET erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 8) POST /api/ml/advertising/rules (Criar Regra Automática)
app.post('/api/ml/advertising/rules', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const { name, campaign_id, metric, operator, target_value, days_window, action, action_value } = req.body;
        if (!name || !metric || !operator || target_value === undefined || !action) {
            return res.status(400).json({ error: 'Preencha todos os campos obrigatórios da regra' });
        }

        const newRule = {
            id: 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            user_id: authUser.id,
            name,
            campaign_id: campaign_id || 'all',
            metric, // 'roas', 'tacos', 'cost', 'clicks', 'ctr'
            operator, // '<', '>', '<=', '>='
            target_value: Number(target_value),
            days_window: Number(days_window || 3),
            action, // 'pause_campaign', 'activate_campaign', 'reduce_budget_percent', 'increase_budget_percent', 'set_target_acos'
            action_value: action_value !== undefined ? Number(action_value) : null,
            status: 'active',
            last_run_at: null,
            created_at: new Date().toISOString()
        };

        const client = supabaseAdmin || supabase;
        try {
            const { data, error } = await client.from('ml_ad_rules').insert([newRule]).select().single();
            if (!error && data) {
                return res.json({ ok: true, rule: data });
            }
        } catch (e) {}

        // Fallback no profiles
        const existingRules = await getAdRules(authUser.id);
        const updatedRules = [newRule, ...existingRules];
        await saveAdRulesFallback(authUser.id, updatedRules);

        res.json({ ok: true, rule: newRule });
    } catch (err) {
        console.error('[ML Ad Rules] POST erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 9) PUT /api/ml/advertising/rules/:id (Atualizar ou Alternar Ativa/Pausada)
app.put('/api/ml/advertising/rules/:id', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const ruleId = req.params.id;
        const updates = req.body;

        const client = supabaseAdmin || supabase;
        try {
            const { data, error } = await client.from('ml_ad_rules')
                .update(updates)
                .eq('id', ruleId)
                .eq('user_id', authUser.id)
                .select()
                .maybeSingle();
            if (!error && data) {
                return res.json({ ok: true, rule: data });
            }
        } catch (e) {}

        // Fallback profiles
        const existingRules = await getAdRules(authUser.id);
        const updatedRules = existingRules.map(r => r.id === ruleId ? { ...r, ...updates } : r);
        await saveAdRulesFallback(authUser.id, updatedRules);

        const updatedRule = updatedRules.find(r => r.id === ruleId);
        res.json({ ok: true, rule: updatedRule });
    } catch (err) {
        console.error('[ML Ad Rules] PUT erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 10) DELETE /api/ml/advertising/rules/:id (Excluir Regra)
app.delete('/api/ml/advertising/rules/:id', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const ruleId = req.params.id;
        const client = supabaseAdmin || supabase;
        try {
            await client.from('ml_ad_rules').delete().eq('id', ruleId).eq('user_id', authUser.id);
        } catch (e) {}

        const existingRules = await getAdRules(authUser.id);
        const updatedRules = existingRules.filter(r => r.id !== ruleId);
        await saveAdRulesFallback(authUser.id, updatedRules);

        res.json({ ok: true, message: 'Regra excluída com sucesso' });
    } catch (err) {
        console.error('[ML Ad Rules] DELETE erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 11) POST /api/ml/advertising/rules/evaluate (Executar/Avaliar Regras Automáticas)
app.post('/api/ml/advertising/rules/evaluate', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const rules = await getAdRules(authUser.id);
        const activeRules = rules.filter(r => r.status === 'active');

        if (activeRules.length === 0) {
            return res.json({ ok: true, message: 'Nenhuma regra ativa para executar', triggered_actions: [] });
        }

        const client = supabaseAdmin || supabase;
        const { data: campaigns } = await client.from('ml_ad_campaigns')
            .select('*')
            .eq('user_id', authUser.id);

        if (!campaigns || campaigns.length === 0) {
            return res.json({ ok: true, message: 'Nenhuma campanha encontrada para avaliar', triggered_actions: [] });
        }

        let token = null;
        let siteId = 'MLB';
        try {
            const advInfo = await getMlAdvertiserId(authUser.id);
            siteId = advInfo.site_id || 'MLB';
            token = await getValidMlToken(authUser.id);
        } catch (e) {
            console.warn('[Ad Rules Evaluate] Token ML não disponível:', e.message);
        }

        const triggeredActions = [];

        for (const rule of activeRules) {
            const targetCamps = (rule.campaign_id === 'all' || !rule.campaign_id)
                ? campaigns
                : campaigns.filter(c => String(c.campaign_id) === String(rule.campaign_id) || String(c.id) === String(rule.campaign_id));

            for (const camp of targetCamps) {
                // Pegar valor da métrica
                let metricVal = 0;
                if (rule.metric === 'roas') metricVal = Number(camp.roas || (camp.cost > 0 ? camp.total_amount / camp.cost : 0));
                else if (rule.metric === 'tacos') metricVal = Number(camp.tacos || 0);
                else if (rule.metric === 'cost') metricVal = Number(camp.cost || 0);
                else if (rule.metric === 'clicks') metricVal = Number(camp.clicks || 0);
                else if (rule.metric === 'ctr') metricVal = Number(camp.ctr || 0);

                let isTriggered = false;
                if (rule.operator === '<' || rule.operator === 'below') isTriggered = metricVal < rule.target_value;
                else if (rule.operator === '>') isTriggered = metricVal > rule.target_value;
                else if (rule.operator === '<=') isTriggered = metricVal <= rule.target_value;
                else if (rule.operator === '>=') isTriggered = metricVal >= rule.target_value;

                if (isTriggered) {
                    let actionDescription = '';
                    const campId = camp.campaign_id;
                    const updatePayload = { updated_at_ml: new Date().toISOString() };
                    const mlApiPayload = {};

                    if (rule.action === 'pause_campaign') {
                        if (camp.status !== 'paused') {
                            updatePayload.status = 'paused';
                            mlApiPayload.status = 'paused';
                            actionDescription = `Pausou a campanha "${camp.name}" (${rule.metric.toUpperCase()} = ${metricVal.toFixed(2)} ${rule.operator} ${rule.target_value})`;
                        }
                    } else if (rule.action === 'activate_campaign') {
                        if (camp.status !== 'active') {
                            updatePayload.status = 'active';
                            mlApiPayload.status = 'active';
                            actionDescription = `Ativou a campanha "${camp.name}" (${rule.metric.toUpperCase()} = ${metricVal.toFixed(2)} ${rule.operator} ${rule.target_value})`;
                        }
                    } else if (rule.action === 'reduce_budget_percent') {
                        const pct = rule.action_value || 20;
                        const oldBudget = Number(camp.budget_amount || 0);
                        const newBudget = Math.max(10, Number((oldBudget * (1 - pct / 100)).toFixed(2)));
                        updatePayload.budget_amount = newBudget;
                        mlApiPayload.budget = { amount: newBudget, type: camp.budget_type || 'daily' };
                        actionDescription = `Reduziu orçamento da campanha "${camp.name}" de R$ ${oldBudget.toFixed(2)} para R$ ${newBudget.toFixed(2)} (-${pct}%)`;
                    } else if (rule.action === 'increase_budget_percent') {
                        const pct = rule.action_value || 20;
                        const oldBudget = Number(camp.budget_amount || 0);
                        const newBudget = Number((oldBudget * (1 + pct / 100)).toFixed(2));
                        updatePayload.budget_amount = newBudget;
                        mlApiPayload.budget = { amount: newBudget, type: camp.budget_type || 'daily' };
                        actionDescription = `Aumentou orçamento da campanha "${camp.name}" de R$ ${oldBudget.toFixed(2)} para R$ ${newBudget.toFixed(2)} (+${pct}%)`;
                    } else if (rule.action === 'set_target_acos') {
                        const targetVal = rule.action_value || 15;
                        updatePayload.roas_target = targetVal;
                        mlApiPayload.roas_target = targetVal;
                        actionDescription = `Ajustou ACOS/ROAS Alvo da campanha "${camp.name}" para ${targetVal}`;
                    }

                    if (actionDescription) {
                        // Enviar atualização para Mercado Livre se houver token
                        if (token && Object.keys(mlApiPayload).length > 0 && campId) {
                            try {
                                await fetch(
                                    `https://api.mercadolibre.com/marketplace/advertising/${siteId}/product_ads/campaigns/${campId}`,
                                    {
                                        method: 'PUT',
                                        headers: {
                                            'Authorization': `Bearer ${token}`,
                                            'Content-Type': 'application/json',
                                            'api-version': '2'
                                        },
                                        body: JSON.stringify(mlApiPayload)
                                    }
                                );
                            } catch (apiErr) {
                                console.warn('[Rule Eval] Erro ao enviar para ML API:', apiErr.message);
                            }
                        }

                        // Atualizar BD local
                        if (campId) {
                            await client.from('ml_ad_campaigns')
                                .update(updatePayload)
                                .eq('user_id', authUser.id)
                                .eq('campaign_id', campId);
                        }

                        triggeredActions.push({
                            rule_id: rule.id,
                            rule_name: rule.name,
                            campaign_id: campId,
                            campaign_name: camp.name,
                            action: rule.action,
                            description: actionDescription,
                            executed_at: new Date().toISOString()
                        });
                    }
                }
            }

            // Atualizar last_run_at da regra
            rule.last_run_at = new Date().toISOString();
            try {
                await client.from('ml_ad_rules').update({ last_run_at: rule.last_run_at }).eq('id', rule.id);
            } catch (e) {}
        }

        // Salvar fallback profiles
        await saveAdRulesFallback(authUser.id, rules);

        res.json({
            ok: true,
            evaluated_count: activeRules.length,
            triggered_count: triggeredActions.length,
            triggered_actions: triggeredActions,
            message: triggeredActions.length > 0 
                ? `${triggeredActions.length} ações automáticas foram executadas com sucesso!` 
                : 'Todas as regras foram avaliadas e nenhuma ação foi necessária.'
        });
    } catch (err) {
        console.error('[ML Ad Rules Evaluate] Erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 7) POST /api/ml/advertising/ai-report (Análise com IA do Product Ads)
app.post('/api/ml/advertising/ai-report', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });
        
        const client = supabaseAdmin || supabase;
        
        // 1. Buscar campanhas com métricas
        const { data: campaigns } = await client.from('ml_ad_campaigns')
            .select('name, status, budget_amount, roas_target, clicks, prints, cost, total_amount, roas, created_at_ml')
            .eq('user_id', authUser.id)
            .order('cost', { ascending: false });
        
        // 2. Buscar ad_groups (anúncios individuais)
        const { data: adGroups } = await client.from('ml_ad_groups')
            .select('title, status, clicks, prints, cost, total_amount, roas, cpc_bid')
            .eq('user_id', authUser.id)
            .order('cost', { ascending: false })
            .limit(20);
        
        // 3. Buscar anúncios orgânicos para comparar
        const { data: items } = await client.from('ml_items')
            .select('title, sold_quantity, available_quantity, price, is_sponsored, listing_type_id')
            .eq('user_id', authUser.id)
            .limit(20);
        
        // 4. Preparar dados para o Gemini
        const totalCost = (campaigns || []).reduce((s, c) => s + Number(c.cost || 0), 0);
        const totalSales = (campaigns || []).reduce((s, c) => s + Number(c.total_amount || 0), 0);
        const totalClicks = (campaigns || []).reduce((s, c) => s + Number(c.clicks || 0), 0);
        const totalPrints = (campaigns || []).reduce((s, c) => s + Number(c.prints || 0), 0);
        const avgROAS = totalCost > 0 ? (totalSales / totalCost).toFixed(2) : 0;
        const avgCTR = totalPrints > 0 ? (totalClicks / totalPrints * 100).toFixed(2) : 0;
        const avgCPC = totalClicks > 0 ? (totalCost / totalClicks).toFixed(2) : 0;
        
        const prompt = `Você é um analista de e-commerce especialista em Mercado Livre Product Ads. 
        Analise os dados das campanhas de publicidade e gere um relatório executivo em português.
        
        DADOS DAS CAMPANHAS:
        ${JSON.stringify(campaigns, null, 2)}
        
        DADOS DOS ANÚNCIOS PATROCINADOS (ad_groups):
        ${JSON.stringify(adGroups, null, 2)}
        
        MÉTRICAS GERAIS:
        - Investimento total: R$ ${totalCost.toFixed(2)}
        - Vendas atribuídas: R$ ${totalSales.toFixed(2)}
        - ROAS médio: ${avgROAS}x
        - CTR médio: ${avgCTR}%
        - CPC médio: R$ ${avgCPC}
        - Total de cliques: ${totalClicks}
        - Total de impressões: ${totalPrints}
        
        Gere um relatório com:
        1. **Resumo Executivo** (3-4 linhas com os destaques)
        2. **Performance por Campanha** (análise individual de cada campanha: o que está funcionando, o que precisa melhorar)
        3. **Métricas-Chave** (ROAS, CTR, CPC — comparar com benchmarks do mercado ML)
        4. **Recomendações** (5 ações concretas: quais campanhas escalar, quais pausar, ajustes de ROAS target, lances CPC)
        5. **Alertas** (se alguma campanha está com ROAS < 5x ou CTR < 1%, alertar)
        6. **Próximos Passos** (3 sugestões de otimização)
        
        Use formatação markdown (##, **, -, etc). Seja específico com números. Tom profissional mas direto.`;
        
        // 5. Chamar Gemini
        const apiKeyToUse = process.env.GEMINI_API_KEY || API_KEY;
        if (!apiKeyToUse) {
            return res.status(500).json({ error: 'Chave do Gemini API não configurada' });
        }
        const geminiClient = new GoogleGenAI({ apiKey: apiKeyToUse });
        const response = await geminiClient.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt
        });
        
        const report = response.text || 'Erro ao gerar relatório';
        
        res.json({ ok: true, report, generated_at: new Date().toISOString() });
    } catch (err) {
        console.error('[ML AI Report] Erro:', err);
        const errMsg = err.message || '';
        if (err.status === 429 || errMsg.includes('429') || errMsg.includes('Quota exceeded') || errMsg.includes('RESOURCE_EXHAUSTED')) {
            return res.status(429).json({ error: 'Limite de requisições do Gemini atingido (cota temporária). Por favor, aguarde cerca de 1 minuto e clique novamente em Gerar Relatório.' });
        }
        res.status(500).json({ error: errMsg });
    }
});

// 7) PUT /api/ml/items/:itemId (Editar anúncio orgânico no Mercado Livre)
app.put('/api/ml/items/:itemId', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const { itemId } = req.params;
        const { title, price, available_quantity, status } = req.body;

        const token = await getValidMlToken(authUser.id);
        const client = supabaseAdmin || supabase;

        const payload = {};
        if (title !== undefined) payload.title = title;
        if (price !== undefined) payload.price = Number(price);
        if (available_quantity !== undefined) payload.available_quantity = Number(available_quantity);
        if (status !== undefined) payload.status = status;

        if (Object.keys(payload).length === 0) {
            return res.status(400).json({ error: 'Nenhum campo fornecido para atualização' });
        }

        const mlRes = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const mlData = await mlRes.json();
        if (!mlRes.ok) {
            return res.status(mlRes.status).json({ error: mlData.message || mlData.error || 'Erro ao atualizar anúncio no Mercado Livre', details: mlData });
        }

        const updateDb = {
            updated_at: new Date().toISOString()
        };
        if (mlData.title) updateDb.title = mlData.title;
        if (mlData.price !== undefined) updateDb.price = mlData.price;
        if (mlData.available_quantity !== undefined) updateDb.available_quantity = mlData.available_quantity;
        if (mlData.status) updateDb.status = mlData.status;
        if (mlData.pictures?.[0]?.url) updateDb.thumbnail = mlData.pictures[0].url;

        await client.from('ml_items')
            .update(updateDb)
            .eq('user_id', authUser.id)
            .eq('item_id', itemId);

        res.json({ ok: true, item: mlData });
    } catch (err) {
        console.error('[ML Items] PUT Item erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 8) POST /api/ml/items/:itemId/listing-type-upgrade (Destacar anúncio)
app.post('/api/ml/items/:itemId/listing-type-upgrade', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const { itemId } = req.params;
        const { listing_type_id } = req.body;

        if (!listing_type_id) {
            return res.status(400).json({ error: 'listing_type_id é obrigatório' });
        }

        const token = await getValidMlToken(authUser.id);
        const client = supabaseAdmin || supabase;

        const mlRes = await fetch(`https://api.mercadolibre.com/items/${itemId}/listing_type`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id: listing_type_id })
        });

        const mlData = await mlRes.json();
        if (!mlRes.ok) {
            return res.status(mlRes.status).json({ error: mlData.message || mlData.error || 'Erro ao alterar tipo de anúncio no Mercado Livre', details: mlData });
        }

        await client.from('ml_items')
            .update({ listing_type_id: listing_type_id, updated_at: new Date().toISOString() })
            .eq('user_id', authUser.id)
            .eq('item_id', itemId);

        res.json({ ok: true, item: mlData });
    } catch (err) {
        console.error('[ML Items] Upgrade Listing Type erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 9) POST /api/ml/items (Criar novo anúncio no Mercado Livre)
app.post('/api/ml/items', async (req, res) => {
    try {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Não autorizado' });

        const token = await getValidMlToken(authUser.id);
        const client = supabaseAdmin || supabase;

        const itemBody = req.body;
        if (!itemBody.title || !itemBody.category_id || !itemBody.price) {
            return res.status(400).json({ error: 'Campos obrigatórios ausentes (title, category_id, price)' });
        }

        const mlRes = await fetch('https://api.mercadolibre.com/items', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(itemBody)
        });

        const mlData = await mlRes.json();
        if (!mlRes.ok) {
            return res.status(mlRes.status).json({ error: mlData.message || mlData.error || 'Erro ao criar anúncio no Mercado Livre', details: mlData });
        }

        if (mlData.id) {
            await client.from('ml_items').upsert({
                user_id: authUser.id,
                item_id: mlData.id,
                title: mlData.title,
                price: mlData.price,
                currency_id: mlData.currency_id || 'BRL',
                available_quantity: mlData.available_quantity,
                sold_quantity: mlData.sold_quantity || 0,
                status: mlData.status || 'active',
                listing_type_id: mlData.listing_type_id,
                condition: mlData.condition,
                permalink: mlData.permalink,
                thumbnail: mlData.thumbnail || mlData.pictures?.[0]?.url || '',
                catalog_listing: mlData.catalog_listing === true,
                tags: mlData.tags || [],
                raw_payload: mlData,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,item_id' });
        }

        res.json({ ok: true, item: mlData });
    } catch (err) {
        console.error('[ML Items] POST Item erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 7) POST /api/ml/webhook (Webhooks Mercado Livre - Fast Handler + HMAC Signature Validation)
function validateMlWebhookSignature(headers, body, secret) {
    const signatureHeader = headers['x-signature'] || headers['X-Signature'];
    if (!signatureHeader || !secret) {
        return false;
    }

    const parts = {};
    signatureHeader.split(',').forEach(part => {
        const idx = part.indexOf('=');
        if (idx !== -1) {
            const key = part.substring(0, idx).trim();
            const value = part.substring(idx + 1).trim();
            parts[key] = value;
        }
    });

    const tsStr = parts.ts;
    const receivedHash = parts.v1;
    if (!tsStr || !receivedHash) return false;

    const tsNum = Number(tsStr);
    if (isNaN(tsNum)) return false;

    const nowSec = Math.floor(Date.now() / 1000);
    const tsSec = tsNum > 1e11 ? Math.floor(tsNum / 1000) : tsNum;

    // Rejeitar replays > 5 min (300s)
    if (Math.abs(nowSec - tsSec) > 300) {
        console.warn('[ML Webhook] Tentativa de replay ignorada (mais de 300s de diferença)');
        return false;
    }

    const resourceId = (body?.resource || String(body?.id || '')).split('/').pop();
    const manifest = `data.id:${resourceId}:${tsStr}`;

    const calculatedHash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

    const bufCalc = Buffer.from(calculatedHash, 'utf8');
    const bufRec = Buffer.from(receivedHash, 'utf8');

    if (bufCalc.length !== bufRec.length) return false;
    return crypto.timingSafeEqual(bufCalc, bufRec);
}

app.post('/api/ml/webhook', async (req, res) => {
    try {
        const payload = req.body || {};
        console.log('[ML Webhook] Recebido:', JSON.stringify(payload));

        const secret = process.env.ML_WEBHOOK_SECRET || process.env.ML_CLIENT_SECRET || ML_CLIENT_SECRET;

        // Validação HMAC best-effort: loga mas NÃO bloqueia (ML não envia x-signature de forma confiável)
        let signatureValid = false;
        const sigHeader = req.headers['x-signature'] || req.headers['X-Signature'];
        if (sigHeader && secret) {
            try {
                signatureValid = validateMlWebhookSignature(req.headers, payload, secret);
                if (!signatureValid) {
                    console.warn('[ML Webhook] Assinatura HMAC x-signature inválida (mas processando mesmo assim).');
                }
            } catch (sigErr) {
                console.warn('[ML Webhook] Erro ao validar assinatura:', sigErr.message);
            }
        } else {
            console.log('[ML Webhook] Sem header x-signature. Processando sem validação HMAC.');
        }

        // Validação alternativa: confirmar que application_id do payload bate com ML_APP_ID
        const expectedAppId = String(ML_APP_ID || process.env.ML_APP_ID);
        const payloadAppId = payload.application_id ? String(payload.application_id) : null;
        if (expectedAppId && payloadAppId && payloadAppId !== expectedAppId) {
            console.warn(`[ML Webhook] application_id mismatch. Esperado: ${expectedAppId}, Recebido: ${payloadAppId}`);
            return res.status(403).json({ error: 'application_id inválido' });
        }

        // Logar TODOS os headers recebidos na PRIMEIRA vez (pra debugar formato do x-signature)
        if (!global.mlWebhookHeadersLogged) {
            global.mlWebhookHeadersLogged = true;
            console.log('[ML Webhook] HEADERS RECEBIDOS (primeira vez):', JSON.stringify(req.headers, null, 2));
        }

        const idempotencyId = payload._id || payload.id;
        if (!idempotencyId) {
            return res.status(400).json({ error: 'Payload sem _id / id de idempotência' });
        }

        const client = supabaseAdmin || supabase;

        // Tenta gravar em ml_webhook_events rapidamente sem fazer fetch externo
        const { error: dbError } = await client.from('ml_webhook_events').insert({
            idempotency_id: String(idempotencyId),
            ml_user_id: payload.user_id ? Number(payload.user_id) : null,
            topic: payload.topic || 'unknown',
            resource: payload.resource || '',
            actions: payload.actions || null,
            application_id: payload.application_id ? String(payload.application_id) : null,
            raw_payload: payload,
            status: 'pending',
            attempts: 0,
            signature_valid: signatureValid,
            received_at: new Date().toISOString()
        });

        if (dbError) {
            // Tratamento de idempotência (ON CONFLICT DO NOTHING)
            if (dbError.code === '23505' || dbError.message?.includes('duplicate key') || dbError.message?.includes('unique')) {
                console.log(`[ML Webhook] Evento duplicado ignorado: ${idempotencyId}`);
                return res.status(200).send('OK');
            }
            console.error('[ML Webhook] Erro ao registrar evento no banco:', dbError);
            return res.status(500).json({ error: 'Erro ao registrar evento' });
        }

        // Resposta ultra-rápida ao Mercado Livre (< 500ms)
        return res.status(200).send('OK');
    } catch (err) {
        console.error('[ML Webhook Exception]:', err);
        return res.status(500).json({ error: err.message });
    }
});

// WORKER DE PROCESSAMENTO DE WEBHOOKS
async function processWebhookEvent(event) {
    const client = supabaseAdmin || supabase;
    const mlUserId = event.ml_user_id;

    if (!mlUserId) {
        throw new Error('ml_user_id ausente no evento');
    }

    const { data: conn } = await client.from('ml_connections')
        .select('*')
        .eq('ml_user_id', String(mlUserId))
        .maybeSingle();

    if (!conn) {
        throw new Error(`Nenhuma conexão ativa encontrada para ml_user_id: ${mlUserId}`);
    }

    if (conn.user_id && conn.user_id !== event.user_id) {
        await client.from('ml_webhook_events')
            .update({ user_id: conn.user_id })
            .eq('id', event.id);
    }

    const token = await getValidMlToken(conn.user_id);
    const resource = event.resource || '';
    const resourceId = resource.split('/').pop();
    const topic = (event.topic || '').toLowerCase();

    if (topic === 'orders' || topic === 'orders_v2') {
        const orderRes = await fetch(`https://api.mercadolibre.com/orders/${resourceId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!orderRes.ok) {
            const errTxt = await orderRes.text();
            throw new Error(`Erro API ML Orders (${orderRes.status}): ${errTxt}`);
        }
        const orderData = await orderRes.json();

        if (orderData && orderData.id) {
            const firstItem = orderData.order_items?.[0] || {};
            const firstPayment = orderData.payments?.[0] || {};

            await client.from('ml_orders').upsert({
                user_id: conn.user_id,
                ml_order_id: String(orderData.id),
                buyer_nickname: orderData.buyer?.nickname || '',
                buyer_email: orderData.buyer?.email || '',
                buyer_phone: orderData.buyer?.phone?.number || '',
                buyer_id: orderData.buyer?.id ? Number(orderData.buyer.id) : null,
                item_id: firstItem.item?.id || '',
                item_title: firstItem.item?.title || '',
                quantity: firstItem.quantity || 1,
                unit_price: firstItem.unit_price || 0,
                total_amount: orderData.total_amount || 0,
                currency: orderData.currency_id || 'BRL',
                status: orderData.status || '',
                payment_status: firstPayment.status || '',
                payment_id: firstPayment.id ? String(firstPayment.id) : null,
                payment_method_id: firstPayment.payment_method_id || '',
                shipping_id: orderData.shipping?.id ? String(orderData.shipping.id) : null,
                shipping_cost: orderData.shipping_cost || 0,
                tags: orderData.tags || [],
                pack_id: orderData.pack_id ? Number(orderData.pack_id) : null,
                date_created: orderData.date_created ? new Date(orderData.date_created).toISOString() : null,
                date_closed: orderData.date_closed ? new Date(orderData.date_closed).toISOString() : null,
                raw: orderData,
                webhook_received_at: new Date().toISOString(),
                imported_at: new Date().toISOString()
            }, { onConflict: 'ml_order_id' });
        }
    } else if (topic === 'questions') {
        const questionRes = await fetch(`https://api.mercadolibre.com/questions/${resourceId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!questionRes.ok) {
            const errTxt = await questionRes.text();
            throw new Error(`Erro API ML Questions (${questionRes.status}): ${errTxt}`);
        }
        const questionData = await questionRes.json();

        if (questionData && questionData.id) {
            await client.from('ml_questions').upsert({
                user_id: conn.user_id,
                ml_question_id: String(questionData.id),
                item_id: questionData.item_id || '',
                buyer_nickname: questionData.from?.nickname || '',
                buyer_id: questionData.from?.id ? Number(questionData.from.id) : null,
                question_text: questionData.text || '',
                answer_text: questionData.answer?.text || '',
                status: questionData.status || 'unanswered',
                date_created: questionData.date_created ? new Date(questionData.date_created).toISOString() : null,
                date_answered: questionData.answer?.date_created ? new Date(questionData.answer.date_created).toISOString() : null,
                raw: questionData,
                webhook_received_at: new Date().toISOString(),
                imported_at: new Date().toISOString()
            }, { onConflict: 'ml_question_id' });
        }
    } else if (topic === 'messages') {
        const msgRes = await fetch(`https://api.mercadolibre.com/messages/${resourceId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!msgRes.ok) {
            const errTxt = await msgRes.text();
            throw new Error(`Erro API ML Messages (${msgRes.status}): ${errTxt}`);
        }
        const msgData = await msgRes.json();

        if (msgData) {
            const fromObj = msgData.from || {};
            const extractedPackId = msgData.message_resources?.[0]?.id || msgData.pack_id;

            await client.from('ml_messages').upsert({
                user_id: conn.user_id,
                ml_user_id: mlUserId ? Number(mlUserId) : null,
                pack_id: extractedPackId ? Number(extractedPackId) : null,
                message_uuid: String(resourceId),
                from_user_id: fromObj.user_id ? Number(fromObj.user_id) : null,
                from_email: fromObj.email || '',
                from_name: fromObj.name || '',
                from_role: fromObj.role || '',
                to_user_id: msgData.to?.[0]?.user_id ? Number(msgData.to[0].user_id) : null,
                text: typeof msgData.text === 'object' ? (msgData.text.plain || '') : (msgData.text || ''),
                status: msgData.status || '',
                moderation_status: msgData.moderation_status || '',
                has_attachments: Array.isArray(msgData.attachments) && msgData.attachments.length > 0,
                attachments: msgData.attachments || null,
                message_created_at: msgData.message_date?.created ? new Date(msgData.message_date.created).toISOString() : null,
                message_received_at: msgData.message_date?.received ? new Date(msgData.message_date.received).toISOString() : null,
                message_read_at: msgData.message_date?.read ? new Date(msgData.message_date.read).toISOString() : null,
                imported_at: new Date().toISOString(),
                raw_payload: msgData
            }, { onConflict: 'message_uuid' });
        }
    } else if (topic === 'items') {
        const itemRes = await fetch(`https://api.mercadolibre.com/items/${resourceId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!itemRes.ok) {
            const errTxt = await itemRes.text();
            throw new Error(`Erro API ML Items (${itemRes.status}): ${errTxt}`);
        }
        const itemData = await itemRes.json();

        if (itemData && itemData.id) {
            const sellerSku = itemData.seller_custom_field || 
                itemData.attributes?.find((a) => a.id === 'SELLER_SKU')?.value_name || '';

            await client.from('ml_items').upsert({
                user_id: conn.user_id,
                ml_user_id: mlUserId ? Number(mlUserId) : null,
                item_id: String(itemData.id),
                title: itemData.title || '',
                category_id: itemData.category_id || '',
                price: itemData.price || 0,
                currency_id: itemData.currency_id || 'BRL',
                available_quantity: itemData.available_quantity || 0,
                sold_quantity: itemData.sold_quantity || 0,
                condition: itemData.condition || '',
                listing_type_id: itemData.listing_type_id || '',
                status: itemData.status || '',
                permalink: itemData.permalink || '',
                thumbnail: itemData.thumbnail || '',
                seller_sku: sellerSku,
                raw_payload: itemData,
                last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'item_id' });
        }
    } else if (topic === 'shipments') {
        const shipRes = await fetch(`https://api.mercadolibre.com/shipments/${resourceId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (shipRes.ok) {
            const shipmentData = await shipRes.json();
            if (shipmentData && shipmentData.id) {
                await client.from('ml_orders')
                    .update({
                        shipping_status: shipmentData.status || '',
                        webhook_received_at: new Date().toISOString()
                    })
                    .eq('shipping_id', String(resourceId));
            }
        }
    } else if (topic === 'payments') {
        const payRes = await fetch(`https://api.mercadolibre.com/collections/${resourceId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (payRes.ok) {
            const paymentData = await payRes.json();
            if (paymentData && paymentData.id) {
                await client.from('ml_orders')
                    .update({
                        payment_status: paymentData.status || '',
                        webhook_received_at: new Date().toISOString()
                    })
                    .eq('payment_id', String(resourceId));
            }
        }
    } else {
        console.log(`[ML Webhook Worker] Tópico sem handler específico: ${topic} (${resourceId})`);
    }
}

let isMlWorkerRunning = false;
async function processWebhookQueue() {
    if (isMlWorkerRunning) return;
    isMlWorkerRunning = true;

    try {
        const client = supabaseAdmin || supabase;

        const { data: events, error } = await client.from('ml_webhook_events')
            .select('*')
            .eq('status', 'pending')
            .order('received_at', { ascending: true })
            .limit(10);

        if (error || !events || events.length === 0) {
            return;
        }

        for (const event of events) {
            try {
                const { data: claimData, error: claimErr } = await client.from('ml_webhook_events')
                    .update({ status: 'processing' })
                    .eq('id', event.id)
                    .eq('status', 'pending')
                    .select('id')
                    .maybeSingle();

                if (claimErr || !claimData) {
                    continue;
                }

                await processWebhookEvent(event);

                await client.from('ml_webhook_events').update({
                    status: 'processed',
                    processed_at: new Date().toISOString()
                }).eq('id', event.id);

            } catch (eventError) {
                console.error(`[ML Webhook Worker] Erro no evento #${event.id}:`, eventError);

                const newAttempts = (event.attempts || 0) + 1;
                const newStatus = newAttempts >= 5 ? 'dead_letter' : 'pending';

                await client.from('ml_webhook_events').update({
                    attempts: newAttempts,
                    status: newStatus,
                    last_error: eventError.message || String(eventError)
                }).eq('id', event.id);
            }
        }
    } catch (queueErr) {
        console.error('[ML Webhook Worker Exception]:', queueErr);
    } finally {
        isMlWorkerRunning = false;
    }
}

// Iniciar worker assíncrono de webhook polling ML
setInterval(processWebhookQueue, 5000);
console.log('[ML Webhook Worker] Iniciado - polling a cada 5s');

// --- WORKER ASSÍNCRONO META ADS WEBHOOKS ---
let isMetaWebhookWorkerRunning = false;

async function processMetaWebhookQueue() {
    if (isMetaWebhookWorkerRunning) return;
    isMetaWebhookWorkerRunning = true;
    try {
        const client = supabaseAdmin || supabase;
        const { data: events, error } = await client.from('meta_webhook_events')
            .select('*')
            .eq('status', 'pending')
            .order('received_at', { ascending: true })
            .limit(10);

        if (error || !events || events.length === 0) return;

        for (const event of events) {
            try {
                // Claim atômico
                const { data: claimed } = await client.from('meta_webhook_events')
                    .update({ status: 'processing' })
                    .eq('id', event.id)
                    .eq('status', 'pending')
                    .select('id')
                    .maybeSingle();

                if (!claimed) continue;

                await processMetaWebhookEvent(event);

                await client.from('meta_webhook_events').update({
                    status: 'processed',
                    processed_at: new Date().toISOString()
                }).eq('id', event.id);

            } catch (eventError) {
                console.error(`[Meta Webhook Worker] Erro no evento #${event.id}:`, eventError);
                const newAttempts = (event.attempts || 0) + 1;
                const newStatus = newAttempts >= 5 ? 'dead_letter' : 'pending';
                await client.from('meta_webhook_events').update({
                    attempts: newAttempts,
                    status: newStatus,
                    last_error: eventError.message || String(eventError)
                }).eq('id', event.id);
            }
        }
    } catch (queueErr) {
        console.error('[Meta Webhook Worker Exception]:', queueErr);
    } finally {
        isMetaWebhookWorkerRunning = false;
    }
}

async function processMetaWebhookEvent(event) {
    const client = supabaseAdmin || supabase;
    const payload = event.raw_payload;
    const field = event.field;

    // Buscar user_id pelo ad_account_id se user_id for null
    if (event.user_id === null && event.ad_account_id) {
        try {
            const cleanAccountId = String(event.ad_account_id).replace(/^act_/, '');
            const { data: conn } = await client
                .from('meta_ads_integrations')
                .select('user_id')
                .or(`ad_account_id.eq.${event.ad_account_id},ad_account_id.eq.act_${cleanAccountId},ad_account_id.eq.${cleanAccountId}`)
                .maybeSingle();

            if (conn && conn.user_id) {
                await client.from('meta_webhook_events')
                    .update({ user_id: conn.user_id })
                    .eq('id', event.id);
            }
        } catch (e) {
            console.warn(`[Meta Webhook Worker] Não foi possível mapear user_id para ad_account_id ${event.ad_account_id}:`, e.message);
        }
    }

    if (field === 'effective_status') {
        // Anúncio mudou de status (reprovado, bloqueado, voltou a ativo)
        console.log(`[Meta Webhook] Status mudou: ad_id=${payload?.ad_id}, novo_status=${payload?.effective_status}`);
    } else if (field === 'with_issues_ad_objects') {
        // Anúncio com problemas
        console.log(`[Meta Webhook] Anúncio com issues: ad_id=${payload?.ad_id}, error=${payload?.error_message}`);
    } else if (field === 'leadgen') {
        console.log(`[Meta Webhook Worker] Processando evento leadgen:`, payload);
        await processMetaLeadgen({ id: event.ad_account_id }, { value: payload }, event.user_id);
    } else {
        console.log(`[Meta Webhook] Tópico sem handler específico: ${field}`);
    }
}

// Iniciar worker assíncrono de webhook polling Meta Ads
setInterval(processMetaWebhookQueue, 5000);
console.log('[Meta Webhook Worker] Iniciado - polling a cada 5s');

// Worker de automação diária do Google Sheets
async function runGoogleSheetsAutomationQueue() {
    console.log('[Sheets Automation] Verificando exportações agendadas diárias...');
    const client = supabaseAdmin || supabase;
    try {
        const { data: profiles, error } = await client.from('profiles')
            .select('id, google_sheets_token, google_sheets_refresh_token, ai_config, meta_sheets_automation, meta_sheets_automation_enabled, meta_sheets_automation_status, meta_sheets_automation_last_run, meta_sheets_automation_error');

        if (error) {
            console.error('[Sheets Automation] Erro ao buscar perfis:', error);
            return;
        }

        if (!profiles || profiles.length === 0) {
            console.log('[Sheets Automation] Nenhum perfil encontrado para automação.');
            return;
        }

        for (const profile of profiles) {
            let aiConfig = profile.ai_config || {};
            let isChanged = false;
            let tokenToUse = profile.google_sheets_token;
            let tokenRenewAttempted = false;

            const renewTokenIfNecessary = async () => {
                if (tokenRenewAttempted) return;
                tokenRenewAttempted = true;
                if (profile.google_sheets_refresh_token && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
                    try {
                        const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: new URLSearchParams({
                                client_id: GOOGLE_CLIENT_ID,
                                client_secret: GOOGLE_CLIENT_SECRET,
                                refresh_token: profile.google_sheets_refresh_token,
                                grant_type: 'refresh_token'
                            })
                        });
                        if (refreshRes.ok) {
                            const refreshData = await refreshRes.json();
                            if (refreshData.access_token) {
                                tokenToUse = refreshData.access_token;
                                await client.from('profiles')
                                    .update({ google_sheets_token: tokenToUse })
                                    .eq('id', profile.id);
                            }
                        }
                    } catch (tokenErr) {
                        console.warn(`[Sheets Automation] Erro ao renovar token do Google Sheets para ${profile.id}:`, tokenErr.message);
                    }
                }
            };

            // 1) Google Ads Automation (sheets_automation)
            const auto = aiConfig.sheets_automation;
            if (auto && auto.enabled && auto.spreadsheet_id) {
                const lastRun = auto.last_run_at ? new Date(auto.last_run_at) : null;
                const now = new Date();
                const diffMs = lastRun ? (now.getTime() - lastRun.getTime()) : null;
                const diffHours = diffMs ? diffMs / (1000 * 60 * 60) : null;

                if (lastRun === null || diffHours >= 23) {
                    console.log(`[Sheets Automation - Ads] Iniciando exportação para usuário ${profile.id} na planilha ${auto.spreadsheet_id}`);
                    try {
                        await renewTokenIfNecessary();
                        if (!tokenToUse) {
                            throw new Error('Sua conta do Google Sheets não está conectada ou o token expirou. Reconecte na interface.');
                        }

                        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                        const endDate = new Date().toISOString().split('T')[0];

                        const msg = await executeGoogleSheetsAdsExport(
                            profile.id,
                            auto.spreadsheet_id,
                            auto.campaign_ids || ['all'],
                            auto.aggregation || 'total',
                            startDate,
                            endDate,
                            tokenToUse
                        );

                        auto.last_run_at = new Date().toISOString();
                        auto.last_run_status = 'success';
                        auto.last_run_error = null;
                        console.log(`[Sheets Automation - Ads] Concluído para ${profile.id}: ${msg}`);
                    } catch (exportErr) {
                        console.error(`[Sheets Automation - Ads] Falha para ${profile.id}:`, exportErr.message);
                        auto.last_run_at = new Date().toISOString();
                        auto.last_run_status = 'error';
                        auto.last_run_error = exportErr.message;
                    }
                    aiConfig.sheets_automation = auto;
                    isChanged = true;
                } else {
                    console.log(`[Sheets Automation - Ads] Usuário ${profile.id} já atualizado nas últimas 23 horas (última execução: ${auto.last_run_at}).`);
                }
            }

            // 2) Mercado Livre Automation (ml_sheets_automation)
            const mlAuto = aiConfig.ml_sheets_automation;
            if (mlAuto && mlAuto.enabled && mlAuto.spreadsheet_id) {
                const lastRun = mlAuto.last_run_at ? new Date(mlAuto.last_run_at) : null;
                const now = new Date();
                const diffMs = lastRun ? (now.getTime() - lastRun.getTime()) : null;
                const diffHours = diffMs ? diffMs / (1000 * 60 * 60) : null;

                if (lastRun === null || diffHours >= 23) {
                    console.log(`[Sheets Automation - ML] Iniciando exportação para usuário ${profile.id} na planilha ${mlAuto.spreadsheet_id}`);
                    try {
                        await renewTokenIfNecessary();
                        if (!tokenToUse) {
                            throw new Error('Sua conta do Google Sheets não está conectada ou o token expirou. Reconecte na interface.');
                        }

                        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                        const endDate = new Date().toISOString().split('T')[0];

                        const msg = await executeGoogleSheetsMLExport(
                            profile.id,
                            mlAuto.spreadsheet_id,
                            mlAuto.sheet_name || 'AXIS_ML',
                            mlAuto.data_type || 'daily_metrics',
                            startDate,
                            endDate,
                            tokenToUse
                        );

                        mlAuto.last_run_at = new Date().toISOString();
                        mlAuto.last_run_status = 'success';
                        mlAuto.last_run_error = null;
                        console.log(`[Sheets Automation - ML] Concluído para ${profile.id}: ${msg}`);
                    } catch (exportErr) {
                        console.error(`[Sheets Automation - ML] Falha para ${profile.id}:`, exportErr.message);
                        mlAuto.last_run_at = new Date().toISOString();
                        mlAuto.last_run_status = 'error';
                        mlAuto.last_run_error = exportErr.message;
                    }
                    aiConfig.ml_sheets_automation = mlAuto;
                    isChanged = true;
                } else {
                    console.log(`[Sheets Automation - ML] Usuário ${profile.id} já atualizado nas últimas 23 horas (última execução: ${mlAuto.last_run_at}).`);
                }
            }

            // 3) Meta Ads Automation (meta_sheets_automation_enabled)
            const metaAutoEnabled = profile.meta_sheets_automation_enabled;
            const metaAuto = profile.meta_sheets_automation;
            if (metaAutoEnabled && metaAuto && metaAuto.spreadsheet_id) {
                const lastRun = profile.meta_sheets_automation_last_run ? new Date(profile.meta_sheets_automation_last_run) : null;
                const now = new Date();
                const diffMs = lastRun ? (now.getTime() - lastRun.getTime()) : null;
                const diffHours = diffMs ? diffMs / (1000 * 60 * 60) : null;

                if (lastRun === null || diffHours >= 23) {
                    console.log(`[Sheets Automation - Meta] Iniciando exportação para usuário ${profile.id} na planilha ${metaAuto.spreadsheet_id}`);
                    try {
                        await renewTokenIfNecessary();
                        if (!tokenToUse) {
                            throw new Error('Sua conta do Google Sheets não está conectada ou o token expirou. Reconecte na interface.');
                        }

                        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                        const endDate = new Date().toISOString().split('T')[0];

                        await executeMetaAdsSheetsExport(
                            profile.id,
                            metaAuto.spreadsheet_id,
                            { start: startDate, end: endDate },
                            tokenToUse,
                            metaAuto.selected_campaigns || []
                        );

                        await client.from('profiles').update({
                            meta_sheets_automation_last_run: new Date().toISOString(),
                            meta_sheets_automation_status: 'success',
                            meta_sheets_automation_error: null
                        }).eq('id', profile.id);
                        console.log(`[Sheets Automation - Meta] Concluído para ${profile.id}`);
                    } catch (exportErr) {
                        console.error(`[Sheets Automation - Meta] Falha para ${profile.id}:`, exportErr.message);
                        await client.from('profiles').update({
                            meta_sheets_automation_last_run: new Date().toISOString(),
                            meta_sheets_automation_status: 'error',
                            meta_sheets_automation_error: exportErr.message
                        }).eq('id', profile.id);
                    }
                } else {
                    console.log(`[Sheets Automation - Meta] Usuário ${profile.id} já atualizado nas últimas 23 horas (última execução: ${profile.meta_sheets_automation_last_run}).`);
                }
            }

            if (isChanged) {
                await client.from('profiles')
                    .update({ ai_config: aiConfig })
                    .eq('id', profile.id);
            }
        }
    } catch (globErr) {
        console.error('[Sheets Automation Queue] Erro global no loop:', globErr);
    }
}

// Iniciar verificador de exportações agendadas diárias a cada 30 minutos
setInterval(runGoogleSheetsAutomationQueue, 30 * 60 * 1000);
// E executar uma verificação inicial após 15 segundos do boot do servidor
setTimeout(runGoogleSheetsAutomationQueue, 15000);


if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
    });
    app.use(vite.middlewares);
} else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
