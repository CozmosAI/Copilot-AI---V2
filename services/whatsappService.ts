
export interface WhatsappConfig {
  instanceName: string;
  isConnected: boolean;
}

const API_BASE = '/api/whatsapp';

// Helper para ler JSON de forma segura
const safeFetch = async (url: string, options: any) => {
    let response;
    try {
        response = await fetch(url, options);
    } catch (error) {
        console.error("Network/Connection Error:", error);
        throw new Error("Falha de conexão. Verifique se o servidor backend está online.");
    }

    const text = await response.text();
    let data;
    
    try {
        // Evita erro "Unexpected end of JSON input" em respostas vazias
        data = text ? JSON.parse(text) : {};
    } catch (error) {
        console.error(`Invalid JSON response from ${url}:`, text);
        throw new Error(`Resposta inválida do servidor (Status ${response.status}). Tente novamente.`);
    }

    if (!response.ok) {
        throw new Error(data.error || `Erro ${response.status}`);
    }
    
    return data;
};

// 1. Iniciar conexão (backend chama Evolution e retorna base64 se tiver)
export const initInstance = async (userId: string, clinicName: string, phoneNumber?: string) => {
    return safeFetch(`${API_BASE}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, clinicName, phoneNumber })
    });
};

// 2. Verificar Status
export const checkStatus = async (instanceName: string) => {
    try {
        const data = await safeFetch(`${API_BASE}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instanceName })
        });
        
        const state = data?.instance?.state || 'close';
        const isConnected = state === 'open';

        return { 
            status: isConnected ? 'CONNECTED' : 'DISCONNECTED',
            state: state,
            base64: data.base64 // Retorna QR se houver, vindo da Evolution
        };
    } catch (error) {
        // Retorna status de erro silencioso para polling não quebrar a UI inteira
        return { status: 'ERROR' };
    }
};

// 3. Enviar Mensagem (Direto via Evolution Proxy)
export const sendMessage = async (instanceName: string, phone: string, text: string) => {
    // Limpeza básica do telefone (Brasil)
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length <= 11 && !cleanPhone.startsWith('55')) {
        cleanPhone = '55' + cleanPhone;
    }

    return safeFetch(`${API_BASE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName, number: cleanPhone, text })
    });
};

// 4. Logout
export const logoutInstance = async (userId: string) => {
    // Precisamos do nome da instância para logout na Evolution
    const instanceName = `copilot_${userId.replace(/-/g, '')}`;
    
    return safeFetch(`${API_BASE}/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, instanceName })
    });
};
