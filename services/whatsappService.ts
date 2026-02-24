/*
export interface WhatsappConfig {
  instanceName: string;
  isConnected: boolean;
  apiKey?: string;
  baseUrl?: string;
}

// Helper para ler JSON de forma segura
const safeFetch = async (url: string, options: any) => {
    let response;
    try {
        response = await fetch(url, options);
    } catch (error) {
        console.error("Network/Connection Error:", error);
        // Retorna um objeto de erro "fake" para ser tratado abaixo
        return { ok: false, error: "Falha na conexão" };
    }

    const text = await response.text();
    let data;
    
    try {
        data = text ? JSON.parse(text) : {};
    } catch (error) {
        console.error(`Invalid JSON response from ${url}:`, text);
        // Se a resposta não for JSON (ex: 404 HTML), retorna erro genérico
        return { ok: false, error: `Resposta inválida (${response.status})` };
    }

    if (!response.ok) {
        // Se a API retornou erro mas em JSON
        return { ok: false, ...data };
    }
    
    return data;
};

// Helper para limpar nome de instância
const sanitizeInstanceName = (name: string): string => {
    return name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase();
};


// 1. Iniciar conexão (Chama o N8N)

export const initInstance = async (userId: string, clinicName: string, phoneNumber?: string) => {
    const n8nUrl = (import.meta as any).env.VITE_N8N_WEBHOOK_URL || 'https://task-dev-01-n8n.8ypyjm.easypanel.host/webhook/criar-instancia';
    
    if (!n8nUrl) throw new Error("URL de conexão (N8N) não configurada.");

    let safeName = sanitizeInstanceName(clinicName);
    if (safeName.length < 3) {
        safeName = `copilot${sanitizeInstanceName(userId.split('-')[0])}`;
    }

    console.log(`[WhatsappService] Iniciando instância: ${safeName}`);

    const result = await safeFetch(n8nUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            userId, 
            clinicName: safeName, 
            originalName: clinicName,
            phoneNumber 
        })
    });

    if (result.ok === false) {
        throw new Error(result.error || "Erro ao conectar via N8N");
    }

    return {
        ...result,
        instanceName: safeName 
    };
};

// 2. Verificar Status Real (Via Backend)
export const checkStatus = async (instanceName: string) => {
    const safeName = sanitizeInstanceName(instanceName);
    
    try {
        const data = await safeFetch(`/api/whatsapp/status/${safeName}`, {
            method: 'GET'
        });
        
        // Se houve erro na requisição (ex: 404), assume desconectado para não quebrar a UI
        if (data.ok === false || !data.status) {
            return { status: 'disconnected' };
        }
        
        return data; 
    } catch (error) {
        console.warn(`Erro ao checar status de ${safeName}:`, error);
        return { status: 'disconnected' };
    }
};

// 3. Configurar Webhook
export const configureInstance = async (instanceName: string, userId: string) => {
    const safeName = sanitizeInstanceName(instanceName);
    return safeFetch(`/api/whatsapp/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName: safeName, userId })
    });
};

// 4. Enviar Mensagem
export const sendMessage = async (instanceName: string, phone: string, text: string) => {
    const safeName = sanitizeInstanceName(instanceName);
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length <= 11 && !cleanPhone.startsWith('55')) {
        cleanPhone = '55' + cleanPhone;
    }

    return safeFetch(`/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName: safeName, number: cleanPhone, text })
    });
};

// 5. Logout
export const logoutInstance = async (userId: string, currentInstanceName?: string) => {
    const instanceName = currentInstanceName 
        ? sanitizeInstanceName(currentInstanceName)
        : `copilot${sanitizeInstanceName(userId.split('-')[0])}`;
    
    return safeFetch(`/api/whatsapp/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, instanceName })
    });
};
*/
export {}; // Export vazio para não quebrar imports se houver algum sobrando (mas já removi todos)