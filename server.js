
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

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('ERRO: VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- GEMINI SETUP ---
const API_KEY = process.env.API_KEY;
let aiClient = null;
if (API_KEY) {
    aiClient = new GoogleGenAI({ apiKey: API_KEY });
} else {
    console.warn("API_KEY do Gemini não definida no servidor. A IA não responderá.");
}

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

// --- NOVA ROTA: Verificar Status Real na API ---
app.get('/api/whatsapp/status/:instanceName', async (req, res) => {
    const { instanceName } = req.params;
    // Consulta o estado da conexão na Evolution
    const response = await evoRequest(`/instance/connectionState/${instanceName}`, 'GET');
    
    // Mapeia resposta para simplificar pro front
    // Evolution retorna { instance: ..., state: "open" | "close" | "connecting" }
    const state = response.data?.instance?.state || response.data?.state || 'disconnected';
    
    res.json({ 
        status: state === 'open' ? 'connected' : state,
        original: response.data 
    });
});

// --- NOVA ROTA: Forçar Configuração (Webhook) ---
app.post('/api/whatsapp/configure', async (req, res) => {
    const { instanceName, userId } = req.body;
    
    if (!APP_BASE_URL) {
        return res.status(500).json({ error: 'APP_BASE_URL não configurada no servidor.' });
    }

    const webhookUrl = `${APP_BASE_URL}/api/webhook/whatsapp`;
    console.log(`Configurando Webhook para ${instanceName}: ${webhookUrl}`);

    // 1. Configurar Webhook
    const webhookRes = await evoRequest(`/webhook/set/${instanceName}`, 'POST', {
        webhook: {
            enabled: true,
            url: webhookUrl,
            byEvents: false,
            base64: false,
            events: [
                "MESSAGES_UPSERT",
                "MESSAGES_UPDATE",
                "CONNECTION_UPDATE"
            ]
        }
    });

    // 2. Configurar Settings (Reject Calls, etc - Opcional)
    await evoRequest(`/instance/settings/${instanceName}`, 'POST', {
        reject_call: false,
        groups_ignore: true,
        always_online: true
    });

    // 3. Atualizar Status no Banco para garantir sincronia
    if (userId) {
        await supabase.from('whatsapp_instances').update({ 
            status: 'connected',
            updated_at: new Date()
        }).eq('user_id', userId);
    }

    res.json({ success: true, webhook: webhookRes.data });
});

// ==============================================================================
// 2. WEBHOOK (RECEBIMENTO DE MENSAGENS + CÉREBRO DA IA)
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
            .maybeSingle();

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

        // 3. Processar Mensagens (CRM + IA)
        if (eventType === 'MESSAGES_UPSERT') {
            const msgData = data;
            const remoteJid = msgData.key?.remoteJid || '';
            if (remoteJid.includes('status@broadcast')) return res.status(200).send('OK');

            const isFromMe = msgData.key?.fromMe || false;
            const pushName = msgData.pushName || 'Desconhecido';
            const phone = remoteJid.split('@')[0];
            const senderType = isFromMe ? 'me' : 'contact';
            
            let text = '';
            if (msgData.message?.conversation) text = msgData.message.conversation;
            else if (msgData.message?.extendedTextMessage?.text) text = msgData.message.extendedTextMessage.text;
            
            if (!text && !isFromMe) return res.status(200).send('OK');

            // 3.1 Upsert Lead (Salvar no CRM) e Atualizar Last Sender
            let leadId = null;
            const { data: existingLead } = await supabase
                .from('leads')
                .select('id, status, history, name')
                .eq('user_id', userId)
                .eq('phone', phone)
                .maybeSingle();

            if (existingLead) {
                leadId = existingLead.id;
                await supabase.from('leads').update({ 
                    last_message: text, 
                    last_interaction: new Date().toISOString(), 
                    last_sender: senderType, // Atualiza quem falou por último
                    status: 'Conversa' 
                }).eq('id', leadId);
            } else {
                const { data: newLead } = await supabase
                    .from('leads')
                    .insert({ 
                        user_id: userId, 
                        name: pushName, 
                        phone: phone, 
                        status: 'Novo', 
                        temperature: 'Cold', 
                        source: 'WhatsApp', 
                        last_message: text, 
                        last_interaction: new Date().toISOString(),
                        last_sender: senderType
                    })
                    .select().single();
                if (newLead) leadId = newLead.id;
            }

            // 3.2 Salvar Mensagem no Histórico
            if (leadId) {
                await supabase.from('whatsapp_messages').insert({
                    lead_id: leadId,
                    contact_phone: phone,
                    sender: senderType,
                    body: text,
                    status: 'delivered',
                    created_at: new Date().toISOString()
                });
            }

            // ==============================================================================
            // 4. LÓGICA DA IA (O CÉREBRO)
            // ==============================================================================
            
            // Só responde se: Não for eu, tiver mensagem de texto, e API configurada
            if (!isFromMe && text && aiClient) {
                
                // A. Buscar Configuração do Usuário
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('ai_config, clinic_name')
                    .eq('id', userId)
                    .single();
                
                const aiConfig = profile?.ai_config;

                // B. Verificar se a IA está ativa
                if (aiConfig && aiConfig.active) {
                    
                    // (Opcional) Verificar Horário de Funcionamento
                    let shouldReply = true;
                    if (aiConfig.triggerType === 'off_hours' && aiConfig.workingHours) {
                        // Implementar checagem simples de hora
                        const now = new Date();
                        const currentHour = now.getHours();
                        const startH = parseInt(aiConfig.workingHours.start.split(':')[0]);
                        const endH = parseInt(aiConfig.workingHours.end.split(':')[0]);
                        
                        // Se estiver DENTRO do horário comercial, NÃO responde (apenas fora)
                        if (currentHour >= startH && currentHour < endH) {
                            shouldReply = false;
                            console.log(`IA Pausada: Dentro do horário comercial (${currentHour}h)`);
                        }
                    }

                    if (shouldReply) {
                        try {
                            // C. Construir Contexto (Histórico Recente)
                            const { data: historyData } = await supabase
                                .from('whatsapp_messages')
                                .select('sender, body')
                                .eq('lead_id', leadId)
                                .order('created_at', { ascending: false })
                                .limit(10); // Últimas 10 mensagens
                            
                            // Ordenar para cronológico (Antiga -> Nova)
                            const chatHistory = (historyData || []).reverse().map(m => 
                                `${m.sender === 'me' ? 'Atendente' : 'Paciente'}: ${m.body}`
                            ).join('\n');

                            // D. Construir System Prompt
                            const systemPrompt = `
                                VOCÊ É: ${aiConfig.name}, atuando como ${aiConfig.role} na clínica ${profile.clinic_name || 'Médica'}.
                                SEU OBJETIVO: ${aiConfig.objective}.
                                
                                INSTRUÇÕES DE COMPORTAMENTO:
                                ${aiConfig.prompt}
                                
                                O QUE NÃO FAZER (NEGATIVO):
                                ${aiConfig.negativePrompt}
                                
                                CONTEXTO ATUAL DO LEAD:
                                Nome: ${existingLead?.name || pushName}
                                Status no CRM: ${existingLead?.status || 'Novo'}
                                
                                HISTÓRICO DA CONVERSA:
                                ${chatHistory}
                                
                                Responda à última mensagem do Paciente de forma natural, curta e humana.
                            `;

                            // E. Chamar Gemini
                            console.log("Gerando resposta com Gemini...");
                            const aiResponse = await aiClient.models.generateContent({
                                model: 'gemini-3-flash-preview',
                                contents: [{
                                    role: 'user',
                                    parts: [{ text: systemPrompt }]
                                }]
                            });
                            
                            const replyText = aiResponse.response.text();
                            
                            if (replyText) {
                                // F. Enviar Resposta (Com delay humanizado se configurado)
                                const delay = (aiConfig.delaySeconds || 5) * 1000;
                                console.log(`Enviando resposta em ${delay}ms: ${replyText}`);
                                
                                setTimeout(async () => {
                                    await evoRequest(`/message/sendText/${instance}`, 'POST', {
                                        number: phone,
                                        options: { delay: 1000, presence: 'composing' },
                                        textMessage: { text: replyText }
                                    });

                                    // Salvar a resposta da IA no banco como 'me'
                                    if (leadId) {
                                        await supabase.from('leads').update({ last_sender: 'me', last_interaction: new Date().toISOString(), last_message: replyText }).eq('id', leadId);
                                        await supabase.from('whatsapp_messages').insert({
                                            lead_id: leadId,
                                            contact_phone: phone,
                                            sender: 'me',
                                            body: replyText,
                                            status: 'sent',
                                            created_at: new Date().toISOString()
                                        });
                                    }
                                }, delay);
                            }

                        } catch (aiError) {
                            console.error("Erro na geração da IA:", aiError);
                        }
                    }
                }
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
