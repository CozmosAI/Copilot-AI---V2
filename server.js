
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

app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware de Log
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
});

// ==============================================================================
// AXIS AI ENDPOINT (OTIMIZADO - SEM DATABASE)
// ==============================================================================

app.post('/api/axis/chat', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) return res.status(400).json({ error: 'Mensagem vazia' });
        if (!aiClient) return res.status(503).json({ error: 'IA indisponível.' });

        console.log("Axis: Processando mensagem...");

        // Prompt Otimizado para Velocidade e Conversa Natural
        const systemPrompt = `
          Você é o AXIS, um assistente virtual ultra-rápido e eficiente.
          
          DIRETRIZES:
          1. Responda APENAS o necessário. Seja extremamente conciso.
          2. Use linguagem natural falada (pt-BR). Evite listas ou formatação complexa.
          3. Não invente dados. Se não souber, diga que não tem acesso a essa informação agora.
          4. Seu objetivo é manter uma conversa fluida por voz. Respostas curtas são melhores.
        `;

        // Chamada Gemini (Usando Flash para menor latência)
        const response = await aiClient.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: [
                { role: 'user', parts: [{ text: systemPrompt + "\n\nUsuário diz: " + message }] }
            ],
            config: {
                maxOutputTokens: 150, // Limita tamanho da resposta para ser rápido
                temperature: 0.7
            }
        });

        const aiText = response.response.text();
        console.log("Axis Resposta:", aiText);

        return res.json({
            response: aiText,
            dataQueried: false
        });

    } catch (error) {
        console.error('AXIS AI Error:', error);
        return res.status(500).json({ response: "Erro de conexão." });
    }
});

// ==============================================================================
// OUTRAS ROTAS (MANTIDAS)
// ==============================================================================

const evoRequest = async (endpoint, method = 'GET', body = null) => {
    try {
        if (!EVO_URL || !EVO_KEY) throw new Error('Evolution API não configurada.');
        const options = {
            method,
            headers: { 'Content-Type': 'application/json', 'apikey': EVO_KEY }
        };
        if (body) options.body = JSON.stringify(body);
        const url = `${EVO_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
        const response = await fetch(url, options);
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
    const { instanceName } = req.params;
    const response = await evoRequest(`/instance/connectionState/${instanceName}`, 'GET');
    const state = response.data?.instance?.state || response.data?.state || 'disconnected';
    res.json({ status: state === 'open' ? 'connected' : state });
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
    // Webhook simplificado para não quebrar, mas lógica principal está no Axis AI agora
    res.status(200).send('OK');
});

app.post('/api/google-ads', async (req, res) => {
   res.status(501).json({error: "Not Implemented"}); 
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
