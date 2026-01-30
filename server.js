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
    // Não damos exit(1) para não derrubar o servidor em dev, mas logamos o erro crítico
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- EVOLUTION API CONFIG ---
// URL base da Evolution API (sem barra no final)
const EVO_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVO_KEY = process.env.EVOLUTION_GLOBAL_KEY;
// URL pública do seu app para o Webhook (sem barra no final) - IMPORTANTE PARA O MULTI-TENANCY
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
        // Tenta parsear JSON, se falhar retorna vazio
        const data = await response.json().catch(() => ({}));
        
        return { ok: response.ok, status: response.status, data };
    } catch (error) {
        console.error(`[EVO FETCH ERROR] ${endpoint}:`, error);
        return { ok: false, error: error.message };
    }
};

// ==============================================================================
// 1. ROTAS DE GERENCIAMENTO (SUBSTITUI O N8N)
// ==============================================================================

// INICIALIZAR INSTÂNCIA
// O Frontend chama isso. O Backend cria na Evolution e configura o Webhook.
app.post('/api/whatsapp/init', async (req, res) => {
    try {
        const { userId, clinicName, phoneNumber } = req.body;
        
        if (!userId || !clinicName) {
            return res.status(400).json({ error: 'userId e clinicName são obrigatórios.' });
        }

        // 1. Gerar nome de instância único e higienizado
        // Ex: "Clínica Vida" + ID "123..." -> "copilot_clinica_vida_1234"
        const cleanName = clinicName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15);
        const uniqueSuffix = userId.split('-')[0]; 
        const instanceName = `copilot_${cleanName}_${uniqueSuffix}`;

        console.log(`[INIT] Configurando instância: ${instanceName} para usuário: ${userId}`);

        // 2. Salvar vínculo no Banco (CRUCIAL PARA O ISOLAMENTO)
        // Isso garante que sabemos que a instância X pertence ao Cliente Y
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
        await evoRequest('/instance/create', 'POST', {
            instanceName: instanceName,
            token: userId, // Token de segurança da instância
            qrcode: true,
            integration: "WHATSAPP-BAILEYS",
            reject_call: true,
            msg_call: "Este número não aceita chamadas. Por favor, envie texto."
        });

        // 4. Configurar Webhook AUTOMATICAMENTE
        // Isso substitui a necessidade do N8N ficar ouvindo. A Evolution vai mandar direto pra cá.
        if (APP_BASE_URL) {
            const webhookUrl = `${APP_BASE_URL}/api/webhook/whatsapp`;
            console.log(`[INIT] Configurando Webhook para: ${webhookUrl}`);
            
            await evoRequest(`/webhook/set/${instanceName}`, 'POST', {
                webhook: {
                    enabled: true,
                    url: webhookUrl,
                    byEvents: false,
                    base64: false,
                    events: [
                        "MESSAGES_UPSERT",   // Mensagens chegando
                        "CONNECTION_UPDATE"  // Mudança de status
                    ]
                }
            });
        }

        // 5. Configurar Settings (Ignorar grupos, etc)
        await evoRequest(`/settings/set/${instanceName}`, 'POST', {
            reject_call: true,
            groups_ignore: true,
            always_online: true,
            read_messages: false
        });

        // 6. Retornar QR Code ou Pairing Code
        let connectionData = { instanceName };
        
        if (phoneNumber) {
            // Pairing Code
            const phoneClean = phoneNumber.replace(/\D/g, '');
            const pairRes = await evoRequest(`/instance/connect/${instanceName}`, 'GET', { number: phoneClean });
            
            if (pairRes.data?.pairingCode) {
                 connectionData = { ...connectionData, pairingCode: pairRes.data.pairingCode };
            }
        } 
        
        // Se não for pairing code, tenta QR Code
        if (!connectionData.pairingCode) {
            const connectRes = await evoRequest(`/instance/connect/${instanceName}`, 'GET');
            
            if (connectRes.data?.base64) {
                 connectionData = { ...connectionData, qrCodeBase64: connectRes.data.base64 };
            } else if (connectRes.data?.instance?.state === 'open') {
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
    
    // Validação básica
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
// 2. WEBHOOK (GARANTIA DE ISOLAMENTO DE DADOS)
// ==============================================================================

app.post('/api/webhook/whatsapp', async (req, res) => {
    try {
        const body = req.body;
        const { instance, data, eventType } = body;

        // --- SEGURANÇA MULTI-TENANT ---
        // 1. Recebemos o nome da instância (ex: copilot_clinica_vida_1234)
        // 2. Buscamos no banco QUEM é o dono dessa instância
        if (!instance) return res.status(200).send('OK'); 

        const { data: instanceData } = await supabase
            .from('whatsapp_instances')
            .select('user_id')
            .eq('instance_name', instance)
            .single();

        // Se a instância não existe no nosso banco, ignoramos a mensagem.
        // Isso impede que dados de instâncias fantasmas entrem no sistema.
        if (!instanceData) {
            console.warn(`[WEBHOOK] Instância desconhecida: ${instance}`);
            return res.status(200).send('OK'); 
        }

        const userId = instanceData.user_id; // <--- ESTE É O DONO DOS DADOS

        // Tratar Conexão
        if (eventType === 'CONNECTION_UPDATE') {
            const status = data.status || data.state;
            console.log(`[WEBHOOK] Status ${instance}: ${status}`);
            
            let dbStatus = 'disconnected';
            if (status === 'open' || status === 'connected') dbStatus = 'connected';
            if (status === 'connecting') dbStatus = 'connecting';

            await supabase
                .from('whatsapp_instances')
                .update({ status: dbStatus, updated_at: new Date() })
                .eq('instance_name', instance); // Atualiza apenas para este usuário
        }

        // Tratar Mensagens (Criação de Leads e Histórico)
        if (eventType === 'MESSAGES_UPSERT') {
            const msgData = data;
            const remoteJid = msgData.key?.remoteJid || '';
            
            // Ignora status/stories
            if (remoteJid.includes('status@broadcast')) return res.status(200).send('OK');

            const isFromMe = msgData.key?.fromMe || false;
            const pushName = msgData.pushName || 'Desconhecido';
            const phone = remoteJid.split('@')[0];
            
            let text = '';
            if (msgData.message?.conversation) text = msgData.message.conversation;
            else if (msgData.message?.extendedTextMessage?.text) text = msgData.message.extendedTextMessage.text;
            
            if (!text && !isFromMe) return res.status(200).send('OK');

            // --- FILTRO POR CLIENTE ---
            // Aqui usamos o userId recuperado acima. O lead será criado/buscado
            // APENAS para este usuário.
            
            let leadId = null;

            // Busca Lead DESTE usuário
            const { data: existingLead } = await supabase
                .from('leads')
                .select('id')
                .eq('user_id', userId) // <--- FILTRO CRÍTICO
                .eq('phone', phone)
                .single();

            if (existingLead) {
                leadId = existingLead.id;
                await supabase.from('leads').update({
                    last_message: text,
                    last_interaction: new Date().toISOString(),
                    status: 'Conversa'
                }).eq('id', leadId);
            } else {
                // Cria Lead PARA ESTE usuário
                const { data: newLead } = await supabase
                    .from('leads')
                    .insert({
                        user_id: userId, // <--- VÍNCULO CRÍTICO
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
                
                if (newLead) {
                    leadId = newLead.id;
                    console.log(`[WEBHOOK] Novo Lead para user ${userId}: ${pushName}`);
                }
            }

            // Salva Mensagem vinculada ao Lead (que já está vinculado ao usuário)
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

// Proxy Google Ads (Mantido)
app.post('/api/google-ads', async (req, res) => {
    // ... Código existente do proxy mantido ...
    // Se precisar, posso reenviar, mas o foco agora é o WhatsApp
    res.status(404).json({error: "Endpoint placeholder"}); 
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Webhook URL: ${APP_BASE_URL}/api/webhook/whatsapp`);
});
