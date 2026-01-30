import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Carrega variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- SUPABASE SETUP ---
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('ERRO: VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- EVOLUTION API CONFIG ---
const EVO_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
// URL pública para onde a Evolution deve mandar as mensagens
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware de Log
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
});

// Helper Evolution
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
        console.error(`[EVO ERROR] ${endpoint}:`, error);
        return { ok: false, error: error.message };
    }
};

// ==============================================================================
// 1. ROTAS DE UTILIDADE
// ==============================================================================

// Forçar configuração do Webhook (Chamado após o N8N criar a instância)
app.post('/api/whatsapp/configure-webhook', async (req, res) => {
    const { instanceName } = req.body;
    
    if (!instanceName || !APP_BASE_URL) {
        return res.status(400).json({ error: 'Instance Name ou APP_BASE_URL ausentes.' });
    }

    const webhookUrl = `${APP_BASE_URL}/api/webhook/whatsapp`;
    console.log(`[CONFIG] Configurando webhook para ${instanceName} -> ${webhookUrl}`);

    const response = await evoRequest(`/webhook/set/${instanceName}`, 'POST', {
        webhook: {
            enabled: true,
            url: webhookUrl,
            byEvents: false,
            base64: false,
            events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
        }
    });

    // Também garante as configurações básicas de comportamento
    await evoRequest(`/settings/set/${instanceName}`, 'POST', {
        reject_call: true,
        groups_ignore: true,
        always_online: true,
        read_messages: false
    });

    res.json(response.data || {});
});

app.post('/api/whatsapp/send', async (req, res) => {
    const { instanceName, number, text } = req.body;
    if (!instanceName || !number || !text) return res.status(400).json({ error: 'Dados incompletos' });

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

// ==============================================================================
// 2. WEBHOOK (RECEBIMENTO DE MENSAGENS)
// ==============================================================================

app.post('/api/webhook/whatsapp', async (req, res) => {
    try {
        const body = req.body;
        const { instance, data, eventType } = body;

        // 1. Identificar dono da instância no Supabase
        if (!instance) return res.status(200).send('OK'); 

        const { data: instanceData } = await supabase
            .from('whatsapp_instances')
            .select('user_id')
            .eq('instance_name', instance)
            .single();

        if (!instanceData) {
            // Se não achou no banco, não sabemos de quem é -> Ignora
            return res.status(200).send('OK'); 
        }

        const userId = instanceData.user_id;

        // 2. Atualizar Status
        if (eventType === 'CONNECTION_UPDATE') {
            const status = data.status || data.state;
            let dbStatus = 'disconnected';
            if (status === 'open' || status === 'connected') dbStatus = 'connected';
            if (status === 'connecting') dbStatus = 'connecting';
            
            await supabase.from('whatsapp_instances').update({ status: dbStatus, updated_at: new Date() }).eq('instance_name', instance);
        }

        // 3. Processar Mensagens (CRM)
        if (eventType === 'MESSAGES_UPSERT') {
            const msgData = data;
            const remoteJid = msgData.key?.remoteJid || '';
            if (remoteJid.includes('status@broadcast')) return res.status(200).send('OK');

            const isFromMe = msgData.key?.fromMe || false;
            const pushName = msgData.pushName || 'Desconhecido';
            const phone = remoteJid.split('@')[0];
            
            let text = '';
            if (msgData.message?.conversation) text = msgData.message.conversation;
            else if (msgData.message?.extendedTextMessage?.text) text = msgData.message.extendedTextMessage.text;
            
            if (!text && !isFromMe) return res.status(200).send('OK');

            // Upsert Lead
            let leadId = null;
            const { data: existingLead } = await supabase
                .from('leads')
                .select('id')
                .eq('user_id', userId)
                .eq('phone', phone)
                .single();

            if (existingLead) {
                leadId = existingLead.id;
                await supabase.from('leads').update({ last_message: text, last_interaction: new Date().toISOString(), status: 'Conversa' }).eq('id', leadId);
            } else {
                const { data: newLead } = await supabase
                    .from('leads')
                    .insert({ user_id: userId, name: pushName, phone: phone, status: 'Novo', temperature: 'Cold', source: 'WhatsApp', last_message: text, last_interaction: new Date().toISOString() })
                    .select().single();
                if (newLead) leadId = newLead.id;
            }

            // Salvar Mensagem
            if (leadId) {
                await supabase.from('whatsapp_messages').insert({
                    lead_id: leadId,
                    contact_phone: phone,
                    sender: isFromMe ? 'me' : 'contact',
                    body: text,
                    status: 'delivered',
                    created_at: new Date().toISOString()
                });
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('[WEBHOOK ERROR]', error);
        res.status(500).send('Error');
    }
});

// Proxy Google Ads
app.post('/api/google-ads', async (req, res) => {
   res.status(501).json({error: "Verificar implementação completa se necessário"}); 
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});