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
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- EVOLUTION API CONFIG ---
// URL base da Evolution API (sem barra no final)
const EVO_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
// URL pública do seu app para o Webhook (sem barra no final)
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

app.use(cors());
// Aumenta limite para receber base64 de mídias se necessário
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware de Log simples
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
});

// Helper para chamadas na Evolution API
const evoRequest = async (endpoint, method = 'GET', body = null) => {
    try {
        if (!EVO_URL || !EVO_KEY) {
            throw new Error('Evolution API URL ou Key não configuradas no .env');
        }

        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVO_KEY
            }
        };
        if (body) options.body = JSON.stringify(body);
        
        const url = `${EVO_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
        console.log(`[EVO REQ] ${method} ${url}`);
        
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        
        return { ok: response.ok, status: response.status, data };
    } catch (error) {
        console.error(`[EVO FETCH ERROR] ${endpoint}:`, error);
        return { ok: false, error: error.message };
    }
};

// ==============================================================================
// 1. ROTAS DE GERENCIAMENTO (FRONTEND -> BACKEND)
// ==============================================================================

// INICIALIZAR INSTÂNCIA
app.post('/api/whatsapp/init', async (req, res) => {
    try {
        const { userId, clinicName, phoneNumber } = req.body;
        
        if (!userId || !clinicName) {
            return res.status(400).json({ error: 'userId e clinicName são obrigatórios.' });
        }

        // 1. Gerar nome de instância único e amigável
        // Ex: "Clínica Vida" -> "copilot_clinica_vida_a1b2"
        const cleanName = clinicName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15);
        const uniqueSuffix = userId.split('-')[0]; // Pega primeira parte do UUID para garantir unicidade
        const instanceName = `copilot_${cleanName}_${uniqueSuffix}`;

        console.log(`[INIT] Configurando instância: ${instanceName} para usuário: ${userId}`);

        // 2. Verificar se já existe no banco e atualizar/criar registro
        // Usamos upsert para criar ou atualizar se já existir
        const { error: dbError } = await supabase
            .from('whatsapp_instances')
            .upsert({ 
                user_id: userId, 
                instance_name: instanceName,
                updated_at: new Date()
            }, { onConflict: 'user_id' });

        if (dbError) {
            console.error('[DB ERROR] Upsert Instance:', dbError);
            return res.status(500).json({ error: 'Erro ao salvar instância no banco de dados.' });
        }

        // 3. Criar Instância na Evolution
        // Tenta criar. Se já existir, a Evolution retorna erro (geralmente 403 ou 400), 
        // mas prosseguimos para conectar, pois pode ser uma reconexão.
        await evoRequest('/instance/create', 'POST', {
            instanceName: instanceName,
            token: userId, // Usa o userId como token de segurança da instância
            qrcode: true
        });

        // 4. Configurar Comportamento (Settings)
        // Rejeitar chamadas, ignorar grupos, sempre online
        await evoRequest(`/settings/set/${instanceName}`, 'POST', {
            reject_call: true,
            msg_call: "Este número não aceita chamadas de voz/vídeo. Por favor, envie uma mensagem de texto.",
            groups_ignore: true,
            always_online: true,
            read_messages: false, // Deixa como não lida para o usuário ver no app
            sync_full_history: false
        });

        // 5. Configurar Webhook AUTOMATICAMENTE
        // O webhook aponta para ESTE servidor (/api/webhook/whatsapp)
        if (APP_BASE_URL) {
            const webhookUrl = `${APP_BASE_URL}/api/webhook/whatsapp`;
            console.log(`[INIT] Configurando Webhook para: ${webhookUrl}`);
            
            await evoRequest(`/webhook/set/${instanceName}`, 'POST', {
                webhook: {
                    enabled: true,
                    url: webhookUrl,
                    byEvents: false,
                    base64: false, // Mude para true se quiser receber imagens em base64 (cuidado com payload)
                    events: [
                        "MESSAGES_UPSERT",   // Receber mensagens
                        "SEND_MESSAGE",      // Confirmar envio
                        "CONNECTION_UPDATE"  // Mudança de status (conectado/desconectado)
                    ]
                }
            });
        } else {
            console.warn('[INIT] APP_BASE_URL não configurada. Webhook não será definido automaticamente.');
        }

        // 6. Obter QR Code ou Pairing Code
        let connectionData = { instanceName };
        
        if (phoneNumber) {
            // Lógica de Pairing Code (Conectar com número)
            const phoneClean = phoneNumber.replace(/\D/g, '');
            const pairRes = await evoRequest(`/instance/connect/${instanceName}`, 'GET', { number: phoneClean });
            
            if (pairRes.data?.pairingCode) {
                 connectionData = { ...connectionData, pairingCode: pairRes.data.pairingCode };
            }
        } 
        
        // Se não conseguiu pairing code ou não pediu, tenta QR Code
        if (!connectionData.pairingCode) {
            const connectRes = await evoRequest(`/instance/connect/${instanceName}`, 'GET');
            
            if (connectRes.data?.base64) {
                 connectionData = { ...connectionData, qrCodeBase64: connectRes.data.base64 };
            } else if (connectRes.data?.instance?.state === 'open') {
                 // Já está conectado
                 connectionData = { ...connectionData, status: 'CONNECTED' };
                 // Atualiza status no banco
                 await supabase.from('whatsapp_instances').update({ status: 'connected' }).eq('user_id', userId);
            }
        }

        return res.json({ success: true, ...connectionData });

    } catch (error) {
        console.error('[INIT ERROR]', error);
        res.status(500).json({ error: error.message });
    }
});

// ENVIAR MENSAGEM
app.post('/api/whatsapp/send', async (req, res) => {
    const { instanceName, number, text } = req.body;
    
    if (!instanceName || !number || !text) {
        return res.status(400).json({ error: 'Dados incompletos' });
    }

    const response = await evoRequest(`/message/sendText/${instanceName}`, 'POST', {
        number,
        options: { delay: 1200, presence: 'composing' },
        textMessage: { text }
    });
    
    res.json(response.data || {});
});

// LOGOUT
app.post('/api/whatsapp/logout', async (req, res) => {
    const { instanceName, userId } = req.body;
    
    if (instanceName) {
        await evoRequest(`/instance/logout/${instanceName}`, 'DELETE');
    }
    
    if (userId) {
        await supabase.from('whatsapp_instances').update({ status: 'disconnected' }).eq('user_id', userId);
    }
    
    res.json({ success: true });
});


// ==============================================================================
// 2. WEBHOOK (EVOLUTION API -> BACKEND)
// ==============================================================================

app.post('/api/webhook/whatsapp', async (req, res) => {
    try {
        const body = req.body;
        const { instance, data, eventType, sender } = body;

        // 1. Identificar o Dono da Instância (Multi-tenancy)
        if (!instance) return res.status(200).send('OK'); 

        // Busca no banco quem é o dono dessa instância
        const { data: instanceData } = await supabase
            .from('whatsapp_instances')
            .select('user_id')
            .eq('instance_name', instance)
            .single();

        if (!instanceData) {
            // Instância não reconhecida, ignoramos para não processar lixo
            return res.status(200).send('OK'); 
        }

        const userId = instanceData.user_id;

        // 2. Tratar Atualização de Status da Conexão
        if (eventType === 'CONNECTION_UPDATE') {
            const status = data.status || data.state;
            console.log(`[WEBHOOK] Connection Update para ${instance}: ${status}`);
            
            let dbStatus = 'disconnected';
            if (status === 'open' || status === 'connected') dbStatus = 'connected';
            if (status === 'connecting') dbStatus = 'connecting';

            await supabase
                .from('whatsapp_instances')
                .update({ status: dbStatus, updated_at: new Date() })
                .eq('instance_name', instance);
        }

        // 3. Tratar Mensagens Recebidas (MESSAGES_UPSERT)
        if (eventType === 'MESSAGES_UPSERT') {
            const msgData = data;
            
            // Ignora status de visualização ou broadcast
            const remoteJid = msgData.key?.remoteJid || '';
            if (remoteJid.includes('status@broadcast')) return res.status(200).send('OK');

            const isFromMe = msgData.key?.fromMe || false;
            const pushName = msgData.pushName || 'Desconhecido';
            const phone = remoteJid.split('@')[0];
            
            // Extração do texto
            let text = '';
            if (msgData.message?.conversation) text = msgData.message.conversation;
            else if (msgData.message?.extendedTextMessage?.text) text = msgData.message.extendedTextMessage.text;
            else if (msgData.message?.imageMessage?.caption) text = msgData.message.imageMessage.caption;
            
            if (!text && !isFromMe) return res.status(200).send('OK'); // Ignora mensagens sem texto simples por enquanto

            // 3.1 Gestão de Leads (Upsert)
            // Lógica: Se o lead já existe para este usuário, atualiza. Se não, cria.
            
            let leadId = null;

            // Busca Lead Existente
            const { data: existingLead } = await supabase
                .from('leads')
                .select('id')
                .eq('user_id', userId)
                .eq('phone', phone)
                .single();

            if (existingLead) {
                leadId = existingLead.id;
                // Atualiza última interação
                await supabase.from('leads').update({
                    last_message: text,
                    last_interaction: new Date().toISOString(),
                    status: 'Conversa' // Move para status de conversa ativa
                }).eq('id', leadId);
            } else {
                // Cria Novo Lead
                const { data: newLead, error: createError } = await supabase
                    .from('leads')
                    .insert({
                        user_id: userId,
                        name: pushName, 
                        phone: phone,
                        status: 'Novo',
                        temperature: 'Cold',
                        source: 'WhatsApp',
                        last_message: text,
                        last_interaction: new Date().toISOString()
                    })
                    .select()
                    .single();
                
                if (!createError && newLead) {
                    leadId = newLead.id;
                    console.log(`[WEBHOOK] Novo Lead criado: ${pushName} (${phone})`);
                }
            }

            // 3.2 Salvar a Mensagem no Histórico
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

// Proxy para Google Ads (Mantido do código original)
// ... (Código do proxy do Google Ads pode ser mantido aqui ou separado) ...

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Base URL (Webhook): ${APP_BASE_URL}`);
    console.log(`Evolution API URL: ${EVO_URL}`);
});