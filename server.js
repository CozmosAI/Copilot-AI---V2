
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from "@google/genai";

// Carrega variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- SUPABASE SETUP ---
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
                const query = `SELECT customer.descriptive_name, customer.id FROM customer LIMIT 1`;
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
                const name = searchData.results?.[0]?.customer?.descriptiveName || `Conta ${customerId}`;
                return { id: customerId, name: name };
            } catch (e) {
                return { id: customerId, name: `Conta ${customerId} (Erro Nome)` };
            }
        };

        // 4. Lógica de Decisão
        if (resourceNames.length === 0) {
            return res.status(400).json({ error: "Nenhuma conta de anúncios encontrada neste e-mail." });
        }

        if (resourceNames.length === 1) {
            // Apenas 1 conta: Vincula Automaticamente
            const accountInfo = await fetchCustomerName(resourceNames[0]);
            
            await supabase.from('google_ads_integrations').update({
                customer_id: accountInfo.id,
                customer_name: accountInfo.name,
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
    const { user_id, customer_id, customer_name } = req.body;

    if (!user_id || !customer_id) return res.status(400).json({ error: 'Dados incompletos.' });

    try {
        const { error } = await supabase.from('google_ads_integrations').update({
            customer_id: customer_id,
            customer_name: customer_name,
            status: 'active'
        }).eq('user_id', user_id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
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
app.post('/api/google-ads/campaigns', async (req, res) => {
    let { user_id, date_range } = req.body;

    // --- CORREÇÃO SOLICITADA: FALLBACK DE DATA ---
    if (!date_range || !date_range.start || !date_range.end) {
        const end = new Date().toISOString().split('T')[0];
        const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        date_range = { start, end };
    }

    try {
        // 1. Buscar credenciais no banco
        const { data: integration, error } = await supabase
            .from('google_ads_integrations')
            .select('*')
            .eq('user_id', user_id)
            .single();

        if (error || !integration) return res.status(404).json({ error: 'Integração não encontrada.' });
        
        if (integration.status === 'pending_selection') {
            return res.status(400).json({ error: 'Seleção de conta pendente.' });
        }

        let accessToken = integration.access_token;
        const refreshToken = integration.refresh_token;
        const customerId = integration.customer_id;

        if (!customerId) return res.status(400).json({ error: 'Nenhuma conta de anúncios vinculada.' });

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
                return res.status(401).json({ error: 'Falha ao renovar token. Reconecte a conta.' });
            }

            accessToken = refreshData.access_token;
            const newExpiry = Date.now() + (refreshData.expires_in * 1000);

            await supabase.from('google_ads_integrations').update({
                access_token: accessToken,
                token_expires_at: newExpiry,
                status: 'active'
            }).eq('user_id', user_id);
        }

        // 3. Fazer a chamada real ao Google Ads
        const cleanId = customerId.replace(/-/g, '');
        const query = `
            SELECT 
                campaign.id, 
                campaign.name, 
                campaign.status, 
                metrics.clicks, 
                metrics.impressions, 
                metrics.cost_micros, 
                metrics.conversions 
            FROM campaign 
            WHERE campaign.status != 'REMOVED' 
            AND segments.date BETWEEN '${date_range.start}' AND '${date_range.end}'
        `;

        const adsResp = await fetch(`https://googleads.googleapis.com/v23/customers/${cleanId}/googleAds:search`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'developer-token': GOOGLE_ADS_DEV_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query })
        });

        const adsData = await adsResp.json();
        
        if (adsData.error) {
            return res.status(400).json(adsData.error);
        }

        const results = adsData.results || [];

        // --- MELHORIA: VERIFICAR SE É CONTA MCC SE NÃO HOUVER CAMPANHAS ---
        if (results.length === 0) {
             try {
                const mccQuery = `SELECT customer.manager, customer.descriptive_name FROM customer LIMIT 1`;
                const mccResp = await fetch(`https://googleads.googleapis.com/v23/customers/${cleanId}/googleAds:search`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'developer-token': GOOGLE_ADS_DEV_TOKEN,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ query: mccQuery })
                });
                const mccData = await mccResp.json();
                const isManager = mccData.results?.[0]?.customer?.manager;

                if (isManager) {
                    return res.status(400).json({ 
                        error: 'Esta é uma conta gerenciadora (MCC). Selecione uma conta cliente para ver campanhas.' 
                    });
                }
             } catch (e) {
                 console.error("Erro ao verificar MCC:", e);
                 // Ignora erro aqui e retorna vazio mesmo
             }
        }

        res.json({ results });

    } catch (error) {
        console.error("Ads Fetch Error:", error);
        res.status(500).json({ error: error.message });
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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
