export interface WhatsappConfig {
  instanceName: string;
  isConnected: boolean;
}

// 
// PASSO FINAL: Cole sua URL de PRODUÇÃO do n8n aqui!
// 
const N8N_WEBHOOK_URL = 'https://task-dev-01-n8n.8ypyjm.easypanel.host/webhook/criar-instancia';

// Helper para ler JSON de forma segura
const safeFetch = async (url: string, options: any) => {
    let response;
    try {
        response = await fetch(url, options);
    } catch (error) {
        console.error("Network/Connection Error:", error);
        throw new Error("Falha de conexão com o serviço de automação. Verifique o n8n.");
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
        throw new Error(data.error || `Erro ${response.status} do serviço de automação.`);
    }
    
    return data;
};

/**
 * 1. Iniciar conexão (chama o n8n para criar a instância e retornar o QR Code)
 * A resposta esperada do n8n é: { qrCodeBase64: "...", instanceName: "..." }
 */
export const initInstance = async (userId: string, clinicName: string, phoneNumber?: string) => {
    if (N8N_WEBHOOK_URL.includes('COLE_SUA_URL')) {
        throw new Error('A URL do webhook n8n não foi configurada no arquivo whatsappService.ts');
    }

    return safeFetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, clinicName, phoneNumber }) // O n8n vai receber estes dados
    });
};


// 2. Verificar Status (requer um SEGUNDO webhook no n8n)
export const checkStatus = async (instanceName: string) => {
    // TODO: Implementar um segundo workflow no n8n para checar o status.
    // Por enquanto, esta função pode ser um placeholder.
    console.warn("A função checkStatus precisa de um novo webhook n8n para ser implementada.");
    return { status: 'DISCONNECTED' }; // Retorno de exemplo
};

// 3. Enviar Mensagem (Direto via Evolution Proxy - SEU SERVIDOR AINDA PODE FAZER ISSO)
// MANTEMOS A CHAMADA PARA A API INTERNA, POIS O SERVER.JS JÁ TEM ESSA LÓGICA
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

// 4. Logout (Também via API interna que chama a Evolution)
export const logoutInstance = async (userId: string) => {
    const instanceName = `copilot_${userId.replace(/-/g, '')}`;
    
    return safeFetch(`/api/whatsapp/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, instanceName })
    });
};