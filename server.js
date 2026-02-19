
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

// --- EVOLUTION API CONFIG ---
const EVO_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

// --- GOOGLE ADS CONFIG ---
const GOOGLE_ADS_DEV_TOKEN = process.env.VITE_GOOGLE_ADS_DEV_TOKEN;

app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware de Log
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
});

// Serve arquivos estáticos do Build do React (Vite)
// Isso é CRUCIAL para produção (Render)
app.use(express.static(path.join(__dirname, 'dist')));

// ==============================================================================
// AXIS AI ENDPOINT
// ==============================================================================

app.post('/api/axis/chat', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) return res.status(400).json({ error: 'Mensagem vazia' });
        if (!aiClient) return res.status(503).json({ error: 'IA indisponível.' });

        console.log("Axis: Processando mensagem...");

        // Prompt Otimizado para Velocidade
        const systemPrompt = `
          Você é o AXIS, um assistente virtual ultra-rápido e eficiente.
          DIRETRIZES:
          1. Responda APENAS o necessário. Seja extremamente conciso.
          2. Use linguagem natural falada (pt-BR).
          3. Não invente dados.
        `;

        const response = await aiClient.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: [
                { role: 'user', parts: [{ text: systemPrompt + "\n\nUsuário diz: " + message }] }
            ],
            config: {
                maxOutputTokens: 150,
                temperature: 0.7
            }
        });

        const aiText = response.response.text();
        return res.json({ response: aiText, dataQueried: false });

    } catch (error) {
        console.error('AXIS AI Error:', error);
        return res.status(500).json({ response: "Erro de conexão." });
    }
});

// ==============================================================================
// GOOGLE ADS PROXY
// ==============================================================================

app.post('/api/google-ads', async (req, res) => {
    try {
        const { action, access_token, customer_id, date_range } = req.body;
        const developer_token = GOOGLE_ADS_DEV_TOKEN;

        if (!access_token) return res.status(400).json({ error: 'Missing access_token' });
        if (!developer_token) return res.status(500).json({ error: 'Server misconfiguration: Missing developer_token' });

        const API_VERSION = 'v17';
        const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

        if (action === 'list_customers') {
            const url = `${BASE_URL}/customers:listAccessibleCustomers`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'developer-token': developer_token,
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                return res.status(response.status).json({ error: `Google API Error: ${response.statusText}`, details: errorText });
            }

            const data = await response.json();
            const customers = (data.resourceNames || []).map((resourceName) => {
                const id = resourceName.replace('customers/', '');
                return {
                    id: id,
                    name: resourceName,
                    descriptiveName: `Conta ${id}`,
                    currencyCode: 'BRL',
                    timeZone: 'America/Sao_Paulo'
                };
            });
            return res.json({ customers });
        }

        if (action === 'get_campaigns') {
            if (!customer_id) return res.status(400).json({ error: 'Missing customer_id' });
            const cleanCustomerId = customer_id.replace(/-/g, '');
            const url = `${BASE_URL}/customers/${cleanCustomerId}/googleAds:search`;

            let query = `
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
            `;

            if (date_range && date_range.start && date_range.end) {
                query += ` AND segments.date BETWEEN '${date_range.start}' AND '${date_range.end}'`;
            } else {
                query += ` AND segments.date DURING LAST_30_DAYS`;
            }
            query += ` LIMIT 50`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'developer-token': developer_token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query })
            });

            if (!response.ok) {
                const errorText = await response.text();
                if (errorText.includes("CUSTOMER_NOT_FOUND") || errorText.includes("NOT_ADS_USER")) {
                   return res.status(403).json({ error: "Conta não encontrada ou sem permissão." });
                }
                return res.status(response.status).json({ error: "Erro ao buscar campanhas.", details: errorText });
            }

            const data = await response.json();
            return res.json({ results: data.results || [] });
        }

        return res.status(400).json({ error: `Unknown action: ${action}` });

    } catch (error) {
        console.error("Internal Server Error (Google Ads):", error);
        return res.status(500).json({ error: error.message });
    }
});

// ==============================================================================
// WHATSAPP ROUTES
// ==============================================================================

const evoRequest = async (endpoint, method = 'GET', body = null) => {
    try {
        if (!EVO_URL || !EVO_KEY) throw new Error('Evolution API não configurada.');
        const options = {
            method,
            headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY }
        };
        if (body) options.body = JSON.stringify(body);
        
        // Remove trailing slashes from URL and leading from endpoint to avoid //
        const cleanUrl = EVO_URL.replace(/\/$/, '');
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        
        const response = await fetch(`${cleanUrl}${cleanEndpoint}`, options);
        
        // Handle 404 from Evolution gracefully (instance not found)
        if (response.status === 404) {
            return { ok: false, status: 404, data: null };
        }

        const data = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, data };
    } catch (error) {
        return { ok: false, error: error.message };
    }
};

app.post('/api/whatsapp/send', async (req, res) => {
    const { instanceName, number, text } = req.body;
    const response = await evoRequest(`/message/sendText/${instanceName}`, 'POST', {
        number,
        options: { delay: 1200, presence: 'composing' },
        textMessage: { text }
    });
    res.json(response.data || {});
});

app.post('/api/whatsapp/logout', async (req, res) => {
    const { instanceName, userId } = req.body;
    if (instanceName) await evoRequest(`/instance/logout/${instanceName}`, 'DELETE');
    if (userId) await supabase.from('whatsapp_instances').update({ status: 'disconnected' }).eq('user_id', userId);
    res.json({ success: true });
});

app.get('/api/whatsapp/status/:instanceName', async (req, res) => {
    try {
        const { instanceName } = req.params;
        const response = await evoRequest(`/instance/connectionState/${instanceName}`, 'GET');
        
        // Se a instância não existe (404 ou erro), retorna disconnected
        if (!response.ok) {
            return res.json({ status: 'disconnected' });
        }

        const state = response.data?.instance?.state || response.data?.state || 'disconnected';
        res.json({ status: state === 'open' ? 'connected' : state });
    } catch (e) {
        console.error("Erro rota status:", e);
        res.status(500).json({ status: 'disconnected', error: e.message });
    }
});

app.post('/api/whatsapp/configure', async (req, res) => {
    const { instanceName, userId } = req.body;
    const webhookUrl = `${APP_BASE_URL}/api/webhook/whatsapp`;
    await evoRequest(`/webhook/set/${instanceName}`, 'POST', {
        webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"] }
    });
    if (userId) await supabase.from('whatsapp_instances').update({ status: 'connected', updated_at: new Date() }).eq('user_id', userId);
    res.json({ success: true });
});

app.post('/api/webhook/whatsapp', async (req, res) => {
    res.status(200).send('OK');
});

// ==============================================================================
// SPA FALLBACK (Catch-All)
// ==============================================================================
// Qualquer rota não-API retorna o index.html do React
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
