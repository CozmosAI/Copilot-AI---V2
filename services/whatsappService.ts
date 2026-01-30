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
        throw new Error(data.error || `Erro ${response.status} do servidor.`);
    }
    
    return data;
};

/**
 * 1. Iniciar conexão (Chama nosso backend local /api/whatsapp/init)
 */
export const initInstance = async (userId: string, clinicName: string, phoneNumber?: string) => {
    return safeFetch(`/api/whatsapp/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, clinicName, phoneNumber })
    });
};


// 2. Verificar Status
// O status real vem via Webhook para o Supabase, mas mantemos o placeholder
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
    const instanceName = `copilot_${userId.split('-')[0]}`; // Tentativa de adivinhar ou passar explicitamente
    
    return safeFetch(`/api/whatsapp/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, instanceName })
    });
};