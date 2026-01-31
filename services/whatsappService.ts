
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

// Helper para limpar nome de instância (Remove acentos, espaços e caracteres especiais)
const sanitizeInstanceName = (name: string): string => {
    return name
        .normalize("NFD") // Separa acentos das letras
        .replace(/[\u0300-\u036f]/g, "") // Remove acentos
        .replace(/[^a-zA-Z0-9]/g, "") // Mantém apenas letras e números
        .toLowerCase();
};

/**
 * 1. Iniciar conexão (Chama o N8N)
 */
export const initInstance = async (userId: string, clinicName: string, phoneNumber?: string) => {
    // ADICIONADO FALLBACK MANUALMENTE PARA GARANTIR FUNCIONAMENTO
    const n8nUrl = (import.meta as any).env.VITE_N8N_WEBHOOK_URL || 'https://task-dev-01-n8n.8ypyjm.easypanel.host/webhook/criar-instancia';
    
    if (!n8nUrl) {
        console.error("VITE_N8N_WEBHOOK_URL não definida no .env");
        throw new Error("URL de conexão (N8N) não configurada.");
    }

    // CRÍTICO: Sanitiza o nome antes de enviar para garantir que vire um ID válido
    // Ex: "Minha Clínica" -> "minhaclinica"
    // Se o nome ficar vazio após limpar, usa 'copilot' + parte do ID
    let safeName = sanitizeInstanceName(clinicName);
    if (safeName.length < 3) {
        safeName = `copilot${sanitizeInstanceName(userId.split('-')[0])}`;
    }

    console.log(`[WhatsappService] Iniciando instância com ID Técnico: ${safeName}`);

    // Chama o Webhook do N8N enviando o NOME LIMPO
    const result = await safeFetch(n8nUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            userId, 
            clinicName: safeName, // Envia o nome limpo para o N8N criar a instância corretamente
            originalName: clinicName, // Envia o original caso precise para log
            phoneNumber 
        })
    });

    // Retorna o resultado garantindo que o frontend saiba o nome técnico usado
    return {
        ...result,
        instanceName: safeName 
    };
};

// 2. Verificar Status Real (Via Backend -> Evolution)
export const checkStatus = async (instanceName: string) => {
    // Garante que estamos checando o nome limpo
    const safeName = sanitizeInstanceName(instanceName);
    
    try {
        const data = await safeFetch(`/api/whatsapp/status/${safeName}`, {
            method: 'GET'
        });
        return data; // Retorna { status: 'connected' | 'connecting' | ... }
    } catch (error) {
        console.warn(`Erro ao checar status de ${safeName}:`, error);
        return { status: 'UNKNOWN' };
    }
};

// 3. Configurar Webhook da Instância (Crucial para o CRM funcionar)
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
    // Tenta usar o nome atual ou gera o padrão baseado no ID
    const instanceName = currentInstanceName 
        ? sanitizeInstanceName(currentInstanceName)
        : `copilot${sanitizeInstanceName(userId.split('-')[0])}`;
    
    return safeFetch(`/api/whatsapp/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, instanceName })
    });
};
