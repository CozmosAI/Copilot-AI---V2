
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
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
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
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware de Log
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
});

app.get(['/politica', '/politica.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'politica.html'));
});

app.get(['/termo', '/termo.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'termo.html'));
});

app.use(express.static(path.join(__dirname, 'dist')));

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
            scope: 'ads_read',
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
    if (!insights?.actions) return 0;
    
    let total = 0;
    for (const action of insights.actions) {
        // Verifica se o action_type é um tipo de conversão relevante
        // (começa com offsite_conversion, ou é um dos tipos específicos)
        const isConversion = CONVERSION_TYPES.some(type => 
            action.action_type === type || 
            action.action_type.startsWith('offsite_conversion.')
        );
        
        if (isConversion) {
            total += parseInt(action.value || '0');
        }
    }
    return total;
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
            fields: 'spend,impressions,clicks,actions',
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

        // console.log(`[Meta Ads Dashboard] Resposta da Graph API:`, JSON.stringify(overviewData, null, 2).substring(0, 500));

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

            // console.log(`[Meta Ads Dashboard] [DEBUG Overview Mapping] item spend: ${item.spend} -> parsed: ${parsedSpend}, impressions: ${item.impressions} -> parsed: ${parsedImpressions}, clicks: ${item.clicks} -> parsed: ${parsedClicks}, conversions: ${parsedConversions}`);

            return {
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
            fields: `id,name,status,objective,daily_budget,lifetime_budget,insights.time_range(${time_range_str}){spend,impressions,clicks,actions}`,
            limit: '150',
            access_token: accessToken
        }).toString();

        console.log(`[Meta Ads Dashboard] user_id: ${user_id}, ad_account_id: ${ad_account_id}, date_range:`, date_range);
        console.log(`[Meta Ads Dashboard] URL Graph API: ${campaignsUrl}`);

        const campsResponse = await fetch(campaignsUrl);
        const campaignsData = await campsResponse.json();

        // console.log(`[Meta Ads Dashboard] Resposta da Graph API:`, JSON.stringify(campaignsData, null, 2).substring(0, 500));

        if (campaignsData.error) {
            console.error('[Meta Ads API Error - Campaigns List]:', campaignsData.error);
            return res.status(400).json({ error: campaignsData.error.message || 'Erro ao buscar campanhas' });
        }

        const campaigns = campaignsData.data || [];
        const results = campaigns.map(c => {
            const insights = c.insights?.data?.[0] || {};
            
            if (insights?.actions && insights.actions.length > 0) {
                // console.log(`[Meta Ads Debug] Actions encontradas:`, insights.actions.map(a => `${a.action_type}=${a.value}`).join(', '));
            }
            
            const parsedConversions = extractConversions(insights);

            const parsedBudget = parseFloat(c.daily_budget || c.lifetime_budget || '0') / 100;
            const parsedSpend = parseFloat(insights.spend || '0');
            const parsedImpressions = parseInt(insights.impressions || '0');
            const parsedClicks = parseInt(insights.clicks || '0');

            // console.log(`[Meta Ads Dashboard] [DEBUG Campaigns Mapping] Campaign: ${c.name} (${c.id}), budget raw: ${c.daily_budget || c.lifetime_budget} -> parsed: ${parsedBudget}, spend raw: ${insights.spend} -> parsed: ${parsedSpend}, impressions raw: ${insights.impressions} -> parsed: ${parsedImpressions}, clicks raw: ${insights.clicks} -> parsed: ${parsedClicks}, conversions: ${parsedConversions}`);

            return {
                id: c.id,
                name: c.name,
                status: c.status,
                objective: c.objective,
                budget: parsedBudget,
                spend: parsedSpend,
                impressions: parsedImpressions,
                clicks: parsedClicks,
                conversions: parsedConversions
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
            fields: `id,name,status,campaign{id,name},insights.time_range(${time_range_str}){spend,impressions,clicks,actions}`,
            limit: '150',
            access_token: accessToken
        }).toString();

        console.log(`[Meta Ads Dashboard] user_id: ${user_id}, ad_account_id: ${ad_account_id}, date_range:`, date_range);
        console.log(`[Meta Ads Dashboard] URL Graph API: ${adsetsUrl}`);

        const adsetsResponse = await fetch(adsetsUrl);
        const adsetsData = await adsetsResponse.json();

        // console.log(`[Meta Ads Dashboard] Resposta da Graph API:`, JSON.stringify(adsetsData, null, 2).substring(0, 500));

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

            // console.log(`[Meta Ads Dashboard] [DEBUG Ad-Groups Mapping] AdSet: ${adset.name} (${adset.id}), spend raw: ${insights.spend} -> parsed: ${parsedSpend}, impressions raw: ${insights.impressions} -> parsed: ${parsedImpressions}, clicks raw: ${insights.clicks} -> parsed: ${parsedClicks}, conversions: ${parsedConversions}`);

            return {
                id: adset.id,
                name: adset.name,
                status: adset.status,
                budget: adset.daily_budget ? (parseFloat(adset.daily_budget) / 100) : 0,
                campaignName: adset.campaign?.name || 'Campanha desconhecida',
                spend: parsedSpend,
                impressions: parsedImpressions,
                clicks: parsedClicks,
                conversions: parsedConversions
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
            fields: `id,name,status,adset{id,name},campaign{id,name},adcreatives{image_url,thumbnail_url,video_id,body,title},insights.time_range(${time_range_str}){spend,impressions,clicks,actions}`,
            limit: '150',
            access_token: accessToken
        }).toString();

        console.log(`[Meta Ads Dashboard] user_id: ${user_id}, ad_account_id: ${ad_account_id}, date_range:`, date_range);
        console.log(`[Meta Ads Dashboard] URL Graph API: ${adsUrl}`);

        const adsResponse = await fetch(adsUrl);
        const adsData = await adsResponse.json();

        // console.log(`[Meta Ads Dashboard] Resposta da Graph API:`, JSON.stringify(adsData, null, 2).substring(0, 500));

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

            // console.log(`[Meta Ads Dashboard] [DEBUG Ads Mapping] Ad: ${ad.name} (${ad.id}), spend raw: ${insights.spend} -> parsed: ${parsedSpend}, impressions raw: ${insights.impressions} -> parsed: ${parsedImpressions}, clicks raw: ${insights.clicks} -> parsed: ${parsedClicks}, conversions: ${parsedConversions}`);

            const adCreative = ad.adcreatives?.data?.[0] || {};

            return {
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
                title: adCreative.title || null
            };
        });

        res.json({ results });
    } catch (err) {
        console.error('[Meta Ads Ads Endpoint Error]:', err);
        res.status(err.message === 'Meta Ads não conectado' ? 400 : 500).json({ error: err.message });
    }
});

// ==============================================================================

// ==============================================================================
// MUTAÇÕES DO META ADS (Fase 3A)
// ==============================================================================

app.post('/api/meta-ads/campaigns/toggle-status', async (req, res) => {
    const { campaign_id, action } = req.body;
    try {
        const user = await getAuthUser(req);
        const user_id = user.id;
        const { accessToken, adAccountId } = await getValidMetaToken(user_id);
        const url = `https://graph.facebook.com/v25.0/${campaign_id}`;
        const newStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE';
        const body = { status: newStatus };
        
        await executeMetaMutation(url, 'POST', accessToken, body);
        
        // Audit log
        await supabase.from('meta_ads_audit_logs').insert({
            user_id,
            ad_account_id: adAccountId,
            campaign_id,
            action: `toggle_campaign_${action}`,
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
        const user = await getAuthUser(req);
        const user_id = user.id;
        const { accessToken, adAccountId } = await getValidMetaToken(user_id);
        const url = `https://graph.facebook.com/v25.0/${adset_id}`;
        
        const body = { daily_budget: Math.round(new_amount * 100) };
        await executeMetaMutation(url, 'POST', accessToken, body);
        
        // Audit log
        await supabase.from('meta_ads_audit_logs').insert({
            user_id,
            ad_account_id: adAccountId,
            campaign_id: adset_id, // saving adset_id here since that's what was changed
            action: 'update_adset_budget',
            new_value: new_amount.toString()
        });
        
        res.json({ ok: true, message: 'Orçamento atualizado com sucesso' });
    } catch (err) {
        console.error('[Meta Ads Update Budget Error]:', err);
        res.status(err.message === 'Meta Ads não conectado' ? 400 : 500).json({ error: err.message });
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

        const sanitizedStart = String(date_range.start).replace(/[^0-9-]/g, '');
        const sanitizedEnd = String(date_range.end).replace(/[^0-9-]/g, '');

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
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const sanitizedStart = String(date_range.start).replace(/[^0-9-]/g, '');
        const sanitizedEnd = String(date_range.end).replace(/[^0-9-]/g, '');

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
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const sanitizedStart = String(date_range.start).replace(/[^0-9-]/g, '');
        const sanitizedEnd = String(date_range.end).replace(/[^0-9-]/g, '');

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
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const sanitizedStart = String(date_range.start).replace(/[^0-9-]/g, '');
        const sanitizedEnd = String(date_range.end).replace(/[^0-9-]/g, '');

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
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const sanitizedStart = String(date_range.start).replace(/[^0-9-]/g, '');
        const sanitizedEnd = String(date_range.end).replace(/[^0-9-]/g, '');

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
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const sanitizedStart = String(date_range.start).replace(/[^0-9-]/g, '');
        const sanitizedEnd = String(date_range.end).replace(/[^0-9-]/g, '');

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
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const sanitizedStart = String(date_range.start).replace(/[^0-9-]/g, '');
        const sanitizedEnd = String(date_range.end).replace(/[^0-9-]/g, '');

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
    if (!user_id || !date_range) return res.status(400).json({ error: 'Missing params' });

    try {
        const sanitizedStart = String(date_range.start).replace(/[^0-9-]/g, '');
        const sanitizedEnd = String(date_range.end).replace(/[^0-9-]/g, '');

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

            if (!contact) {
                // se não encontrar, buscar por user_id + phone antigo também para recuperar contatos criados antes da correção
                const phoneDigitsRaw = lead.phone.replace(/\D/g, '');
                const { data: legacyContact } = await client
                    .from('crm_contacts')
                    .select('*')
                    .eq('user_id', user.id)
                    .eq('phone', phoneDigitsRaw)
                    .maybeSingle();

                if (legacyContact) {
                    contact = legacyContact;
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
            
            // Garantir que a conversa ligue o lead, caso não esteja ligado ainda
            if (conversation.lead_id !== lead.id) {
                await client
                    .from('crm_conversations')
                    .update({
                        lead_id: lead.id,
                        conversation_status: 'open',
                        updated_at: new Date()
                    })
                    .eq('id', conversation.id);

                const { data: refreshedConversation } = await client
                    .from('crm_conversations')
                    .select('*')
                    .eq('id', conversation.id)
                    .maybeSingle();

                conversation = refreshedConversation || conversation;
            }
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
                
                // --- FLUXO 2: leads (CRM) (DEFENSIVO) ---
                let leadId = null;
                let existingLead = null;
                
                const normalizedWebhookPhone = phone ? (normalizePhoneE164(phone) || phone) : phone;
                
                try {
                    if (normalizedWebhookPhone) {
                        const { data, error } = await client
                            .from('leads')
                            .select('*')
                            .eq('user_id', connection.user_id)
                            .eq('phone', normalizedWebhookPhone)
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
                        const updateLeadData = {
                            name: existingLead.name || pushName || normalizedWebhookPhone || externalChatId || 'Lead WhatsApp',
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
        if (!aiClient) return res.status(500).json({ error: "Gemini não configurado." });
        const { text } = req.body;
        
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
        res.json({ audio: base64Audio || null });
    } catch (error) {
        console.error("Erro /api/gemini/tts:", error);
        res.status(500).json({ error: "Erro ao gerar TTS." });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
