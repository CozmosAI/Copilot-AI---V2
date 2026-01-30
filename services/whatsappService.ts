
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
        throw new Error("Falha de conexão com o servidor. Verifique se o backend está rodando.");
    }

    const text = await response.text();
    let data;
    
    try {
        data = text ? JSON.parse(text) : {};
    } catch (error) {
        console.error(`Invalid JSON response from ${url}:`, text);
        throw new Error(`Resposta inválida do servidor (Status ${response.status}).`);
    }

    if (!response.ok) {
        throw new Error(data.error || data.message || `Erro ${response.status} do servidor.`);
    }
    
    return data;
};

/**
 * 1. Iniciar conexão (Chama o N8N)
 */
export const initInstance = async (userId: string, clinicName: string, phoneNumber?: string) => {
    // URL do Webhook do N8N (Usamos diretamente do .env pois o usuário confirmou que ela está completa)
    // ADICIONADO FALLBACK MANUALMENTE PARA GARANTIR FUNCIONAMENTO
    const n8nUrl = (import.meta as any).env.VITE_N8N_WEBHOOK_URL || 'https://task-dev-01-n8n.8ypyjm.easypanel.host/webhook/criar-instancia';
    
    if (!n8nUrl) {
        console.error("VITE_N8N_WEBHOOK_URL não definida no .env");
        throw new Error("URL de conexão (N8N) não configurada.");
    }

    // Chama o Webhook do N8N
    return safeFetch(n8nUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, clinicName, phoneNumber })
    });
};

// 2. Verificar Status (Placeholder)
export const checkStatus = async (instanceName: string) => {
    return { status: 'UNKNOWN' }; 
};

// 3. Enviar Mensagem
export const sendMessage = async (instanceName: string, phone: string, text: string) => {
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length <= 11 && !cleanPhone.startsWith('55')) {
        cleanPhone = '55' + cleanPhone;
    }

    return safeFetch(`/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName, number: cleanPhone, text })
    });
};

// 4. Logout
export const logoutInstance = async (userId: string) => {
    const instanceName = `copilot_${userId.split('-')[0]}`;
    
    return safeFetch(`/api/whatsapp/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, instanceName })
    });
};
