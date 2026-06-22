
import React, { useState, useEffect, useRef } from 'react';
import { 
  CheckCircle2, Calendar, Loader2, LogOut, MessageCircle, Smartphone, 
  FileSpreadsheet, Activity, AlertCircle, Upload, RefreshCw, X, ChevronRight, LayoutList, Copy, Phone,
  Building2, ArrowRight, Trash2
} from 'lucide-react';
import { useApp } from '../App';
import { initiateGoogleAdsAuth, exchangeCodeForToken, selectGoogleAdsAccount, checkGoogleAdsStatus, listMccChildren } from '../services/googleAdsService';
import { signInWithGoogleCalendar } from '../services/googleCalendarService';
import { signInWithGoogleSheets, listSpreadsheets, getSpreadsheetDetails, getSheetData } from '../services/googleSheetsService';
// import { initInstance, logoutInstance, checkStatus, configureInstance } from '../services/whatsappService'; // REMOVIDO
import { supabase } from '../lib/supabase';
import { apiFetch, safeJsonResponse } from '../services/apiClient';

const GoogleIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c3.11 0 5.71-1.03 7.61-2.81l-3.57-2.77c-.99.66-2.26 1.06-4.04 1.06-3.41 0-6.3-2.3-7.34-5.41H1.04v2.81C3.12 19.38 7.3 23 12 23z" fill="#34A853"/>
    <path d="M4.66 14.07c-.26-.77-.41-1.6-.41-2.47s.15-1.7.41-2.47V6.32H1.04C.38 7.64 0 9.13 0 10.7c0 1.57.38 3.06 1.04 4.38l3.62-2.81z" fill="#FBBC05"/>
    <path d="M12 4.19c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.71 1.03 15.11 0 12 0 7.3 0 3.12 3.62 1.04 8.07l3.62 2.81c1.04-3.11 3.93-5.41 7.34-5.41z" fill="#EA4335"/>
  </svg>
);

const Integration: React.FC = () => {
  const { 
    googleCalendarToken, googleAdsToken, setGoogleAdsToken, setGoogleCalendarToken, 
    googleSheetsToken, setGoogleSheetsToken, 
    // whatsappConfig, setWhatsappConfig, // REMOVIDO
    user 
  } = useApp();
  
  const [loading, setLoading] = useState<string | null>(null);
  
  // Google Ads Selection State
  const [showAccountSelector, setShowAccountSelector] = useState(false);
  const [availableAccounts, setAvailableAccounts] = useState<any[]>([]);
  const [accountName, setAccountName] = useState<string>('');
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null);

  // States WhatsApp (REMOVIDO)
  /*
  const [wppQr, setWppQr] = useState<string | null>(null);
  const [wppPairingCode, setWppPairingCode] = useState<string | null>(null);
  const [wppStatus, setWppStatus] = useState<'IDLE' | 'CONNECTING' | 'CONNECTED' | 'QRCODE' | 'PAIRING' | 'DISCONNECTED'>('IDLE');
  const [wppError, setWppError] = useState('');
  const [wppPhone, setWppPhone] = useState(''); 
  const [tempInstanceName, setTempInstanceName] = useState<string>(''); 

  // Polling Ref
  const pollingIntervalRef = useRef<any>(null);
  */

  // Sheets States
  const [spreadsheets, setSpreadsheets] = useState<any[]>([]);
  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState<{id: string, name: string} | null>(null);
  const [sheetTabs, setSheetTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [importStatus, setImportStatus] = useState<string>('');
  const [importLoading, setImportLoading] = useState(false);

  // Uazapi Connections States
  const [crmConnections, setCrmConnections] = useState<any[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [submittingCrm, setSubmittingCrm] = useState(false);
  const [crmConnectionsError, setCrmConnectionsError] = useState<string | null>(null);
  const [crmHealth, setCrmHealth] = useState<{
    supabaseUrlConfigured: boolean;
    serviceRoleConfigured: boolean;
    appPublicUrlConfigured?: boolean;
    appPublicUrl: string | null;
  } | null>(null);
  
  const [syncingConnectionId, setSyncingConnectionId] = useState<string | null>(null);
  const [configuringWebhookId, setConfiguringWebhookId] = useState<string | null>(null);
  
  // Debug & Webhook Diagnostic States
  const [openEventsConnId, setOpenEventsConnId] = useState<string | null>(null);
  const [eventsList, setEventsList] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  
  // Uazapi Auto-Creation and QR Polling States
  const [uazapiFormMode, setUazapiFormMode] = useState<'manual' | 'create'>('manual');
  const [isCreatingInstance, setIsCreatingInstance] = useState(false);
  const [activeQrModal, setActiveQrModal] = useState(false);
  const [activeQrCode, setActiveQrCode] = useState<string | null>(null);
  const [activeQrConnId, setActiveQrConnId] = useState<string | null>(null);
  const [pollingStatus, setPollingStatus] = useState<string | null>(null);
  const [pollingMsg, setPollingMsg] = useState<string | null>(null);
  const pollingRef = useRef<any>(null);

  // Clean polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);
  
  // Uazapi Form Fields State
  const [crmConnName, setCrmConnName] = useState('');
  const [crmApiUrl, setCrmApiUrl] = useState('https://task-ai.uazapi.com');
  const [crmToken, setCrmToken] = useState('');
  const [crmInstanceName, setCrmInstanceName] = useState('');
  const [crmListenGroups, setCrmListenGroups] = useState(false);
  const [crmRestoreMsgs, setCrmRestoreMsgs] = useState(false);

  // Normalization helper
  const normalizeConnectionsResponse = (data: any): any[] => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.connections)) return data.connections;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  };

  // Fetch CRM Health status
  const fetchCrmHealth = async () => {
    try {
      const response = await apiFetch('/api/crm/health');
      if (response.ok) {
        const data = await safeJsonResponse(response);
        setCrmHealth(data);
      }
    } catch (e) {
      console.error('Erro ao buscar status de healthcheck do CRM:', e);
    }
  };

  // Fetch CRM Connections from API
  const fetchCrmConnections = async () => {
    setLoadingConnections(true);
    setCrmConnectionsError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setCrmConnectionsError('Sessão não encontrada. Faça login novamente.');
        setLoadingConnections(false);
        return;
      }
      
      const response = await apiFetch('/api/crm/connections', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await safeJsonResponse(response);
      
      if (response.ok && data.ok !== false) {
        const connections = normalizeConnectionsResponse(data);
        setCrmConnections(connections);
        
        if (!Array.isArray(data) && !Array.isArray(data?.connections)) {
          alert("Resposta inesperada do backend CRM. Esperado { ok: true, connections: [] }.");
        }
      } else {
        setCrmConnections([]);
        setCrmConnectionsError(data?.error || `Erro de servidor: HTTP ${response.status}`);
      }
    } catch (e: any) {
      console.error('Erro ao buscar conexões CRM:', e);
      setCrmConnections([]);
      setCrmConnectionsError(e.message || 'Erro ao comunicar com o servidor. Verifique VITE_BACKEND_URL e se o server.js está online.');
    } finally {
      setLoadingConnections(false);
    }
  };

  // Check Connection Status with API
  const handleCheckCrmStatus = async (connectionId: string) => {
    setSyncingConnectionId(connectionId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert('Sessão não encontrada. Por favor, recarregue e tente novamente.');
        return;
      }
      
      const response = await apiFetch(`/api/crm/connections/${connectionId}/status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await safeJsonResponse(response);
      
      if (response.ok && data.ok !== false && data.connection) {
        setCrmConnections(prev => {
          const list = Array.isArray(prev) ? prev : [];
          return list.map(c => c.id === connectionId ? data.connection : c);
        });
      } else {
        alert(data?.error || 'Erro ao consultar status ou conexão não retornada.');
        fetchCrmConnections();
      }
    } catch (e: any) {
      alert(`Erro na verificação de status: ${e.message}`);
      fetchCrmConnections();
    } finally {
      setSyncingConnectionId(null);
    }
  };

  // Delete CRM Connection
  const handleDeleteCrmConnection = async (id: string) => {
    if (!confirm("Remover esta conexão da AXIS? Isso não desconecta o número na Uazapi.")) {
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert("Sessão expirada. Faça login novamente.");
        return;
      }
      
      const response = await apiFetch(`/api/crm/connections/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await safeJsonResponse(response);
      if (response.ok && data.ok) {
        alert("Conexão removida com sucesso da AXIS!");
        fetchCrmConnections();
      } else {
        alert(data?.error || "Erro ao excluir conexão.");
      }
    } catch (e: any) {
      alert(`Erro técnico ao remover: ${e.message}`);
    }
  };

  // Poll connection status on Uazapi for live QR verification
  const startQrPolling = (connectionId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    
    let count = 0;
    setPollingStatus('polling');
    setPollingMsg('Buscando QR Code... Conecte seu WhatsApp.');
    
    const tick = async () => {
      count++;
      if (count > 24) { // 2 minutos (24 * 5s)
        if (pollingRef.current) clearInterval(pollingRef.current);
        setPollingStatus('timeout');
        setPollingMsg('Tempo esgotado (2 min). Se o QR Code expirou, feche e clique para Conectar novamente.');
        return;
      }
      
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        
        const response = await apiFetch(`/api/crm/connections/${connectionId}/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const data = await safeJsonResponse(response);
          if (data && data.mappedStatus === 'connected') {
            if (pollingRef.current) clearInterval(pollingRef.current);
            setPollingStatus('connected');
            setPollingMsg('WhatsApp conectado com sucesso!');
            fetchCrmConnections();
            
            // Sucesso! Tenta de forma automática e discreta configurar o webhook AXIS
            alert('Parabéns! WhatsApp conectado com sucesso! Configurando de forma automática o webhook da AXIS...');
            handleConfigureCrmWebhook(connectionId);
            setActiveQrModal(false);
          } else if (data && data.mappedStatus === 'qrcode') {
            const newQr = data.qrCode || (data.statusPayload && (data.statusPayload.qrCode || data.statusPayload.qrcode || data.statusPayload.qr)) || null;
            if (newQr) {
              setActiveQrCode(newQr);
            }
            setPollingMsg(`Escaneie o QR Code no seu WhatsApp (Tentativa ${count}/24)...`);
          } else {
            setPollingMsg(`Aguardando leitura do QR Code... Status: ${data?.mappedStatus || 'conectando'} (${count}/24)`);
          }
        }
      } catch (err) {
        console.error('Erro no polling do status do QR:', err);
      }
    };
    
    tick();
    pollingRef.current = setInterval(tick, 5000);
  };

  // Trigger connect on demand (generate QR Code)
  const handleTriggerConnect = async (connectionId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert("Sessão expirada. Faça login novamente.");
        return;
      }
      
      setActiveQrModal(true);
      setActiveQrConnId(connectionId);
      setActiveQrCode(null);
      setPollingStatus('loading');
      setPollingMsg('Iniciando conexão na Uazapi...');
      
      const response = await apiFetch(`/api/crm/connections/${connectionId}/connect`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const data = await safeJsonResponse(response);
      if (response.ok && data.ok) {
        const qr = data.qrCode || null;
        setActiveQrCode(qr);
        startQrPolling(connectionId);
      } else {
        setPollingStatus('error');
        setPollingMsg(data?.error || 'Erro ao conectar à Uazapi para gerar QR Code.');
        alert(data?.error || 'Não foi possível iniciar a conexão na Uazapi.');
      }
    } catch (err: any) {
      setPollingStatus('error');
      setPollingMsg(err.message || 'Erro de conexão.');
      alert(`Erro ao tentar conectar: ${err.message}`);
    }
  };

  // Create new Uazapi instance clean on-the-fly and then connect (generate QR)
  const handleCreateAndConnectInstance = async (connectionName: string) => {
    if (!connectionName.trim()) {
      alert("Por favor, informe o Nome da Conexão (Ex: WhatsApp Clínica).");
      return;
    }
    
    setIsCreatingInstance(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert("Sessão expirada. Faça login novamente.");
        setIsCreatingInstance(false);
        return;
      }
      
      const response = await apiFetch('/api/crm/connections/uazapi/create-instance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          connectionName: connectionName,
          systemName: "AXIS AI",
          adminField01: "AXIS CRM"
        })
      });
      
      const data = await safeJsonResponse(response);
      if (response.ok && data.ok && data.connection) {
        const newConnId = data.connection.id;
        fetchCrmConnections();
        
        // Dispara connect
        await handleTriggerConnect(newConnId);
      } else {
        alert(data?.error || "Erro ao criar instância na Uazapi. Certifique-se de que a UAZAPI_ADMIN_TOKEN está definida ou use a aba 'Eu já tenho uma Instância'.");
      }
    } catch (err: any) {
      alert(`Erro na criação e conexão: ${err.message}`);
    } finally {
      setIsCreatingInstance(false);
    }
  };

  // Configure CRM Webhook automatically on UazAPI
  const handleConfigureCrmWebhook = async (id: string) => {
    setConfiguringWebhookId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert("Sessão expirada. Faça login novamente.");
        return;
      }
      
      const response = await apiFetch(`/api/crm/connections/${id}/configure-webhook`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await safeJsonResponse(response);
      if (response.ok && data.ok) {
        alert("Webhook AXIS configurado com sucesso na Uazapi para esta instância!");
        fetchCrmConnections();
      } else {
        alert(data?.error || "Não foi possível configurar automaticamente. Copie o webhook da AXIS e configure manualmente.");
      }
    } catch (e: any) {
      alert(`Erro: ${e.message}`);
    } finally {
      setConfiguringWebhookId(null);
    }
  };

  // Buscar eventos de log webhook para diagnóstico
  const handleFetchEvents = async (connectionId: string) => {
    setLoadingEvents(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      
      const response = await apiFetch(`/api/crm/connections/${connectionId}/webhook-events`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await safeJsonResponse(response);
      if (response.ok && data.ok) {
        setEventsList(data.events || []);
      } else {
        console.error("Erro ao buscar eventos:", data?.error);
      }
    } catch (err) {
      console.error("Erro técnico ao buscar eventos:", err);
    } finally {
      setLoadingEvents(false);
    }
  };

  // Enviar payload de teste ao webhook AXIS
  const handleTestWebhook = async (conn: any) => {
    if (!conn.webhook_url) {
      alert('URL do Webhook indisponível para teste.');
      return;
    }
    setTestingWebhookId(conn.id);
    try {
      const payload = {
        event: "messages",
        messages: [
          {
            id: "axis_test_" + Date.now(),
            remoteJid: "5541999999999@s.whatsapp.net",
            pushName: "Teste AXIS",
            fromMe: false,
            messageType: "text",
            message: {
              conversation: "Mensagem de teste webhook AXIS"
            },
            timestamp: Date.now()
          }
        ]
      };
      
      const resp = await fetch(conn.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (resp.ok) {
        alert('Webhook de teste enviado com sucesso!');
        await handleFetchEvents(conn.id);
      } else {
        const text = await resp.text();
        alert(`Falha ao registrar webhook de teste: HTTP ${resp.status} - ${text}`);
      }
    } catch (err: any) {
      alert(`Erro no envio de teste: ${err.message}`);
    } finally {
      setTestingWebhookId(null);
    }
  };

  // Submit Connections manual save
  const handleSaveCrmConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crmConnName || !crmApiUrl || !crmToken) {
      alert('Por favor, preencha todos os campos obrigatórios (Nome, URL e Token).');
      return;
    }
    
    setSubmittingCrm(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert('Sessão não encontrada ou expirada. Faça login novamente.');
        setSubmittingCrm(false);
        return;
      }
      
      const response = await apiFetch('/api/crm/connections/uazapi/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          connectionName: crmConnName,
          apiBaseUrl: crmApiUrl,
          instanceToken: crmToken,
          instanceName: crmInstanceName || undefined,
          connectionSettings: {
            listenGroups: crmListenGroups,
            restoreMessages: crmRestoreMsgs
          }
        })
      });
      
      const data = await safeJsonResponse(response);
      if (!response.ok || data.ok === false) {
        throw new Error(data?.error || 'Erro ao salvar conexão');
      }
      
      if (data.warning) {
        alert(data.warning);
      } else {
        alert('Conexão salva e sincronizada com sucesso!');
      }
      
      // Reset form fields
      setCrmConnName('');
      setCrmToken('');
      setCrmInstanceName('');
      
      fetchCrmConnections();
    } catch (err: any) {
      console.error('Erro na gravação do CRM:', err);
      if (err.message?.includes('Unexpected end of JSON input') || err.message?.includes('fetch') || err.message?.includes('JSON')) {
        alert("Backend CRM não respondeu corretamente. Verifique VITE_BACKEND_URL e se o server.js está online.");
      } else {
        alert(`Falha ao salvar conexão: ${err.message}`);
      }
    } finally {
      setSubmittingCrm(false);
    }
  };

  // Fetch connections and health status on load
  useEffect(() => {
    if (user) {
      fetchCrmConnections();
    }
    fetchCrmHealth();
  }, [user]);

  // --- CHECK CONNECTION STATUS ON MOUNT ---
  // CORREÇÃO: Só checa status se NÃO houver código OAuth na URL (evita race condition)
  useEffect(() => {
      const params = new URLSearchParams(window.location.search);
      const hasCode = params.get('code');

      if (user && !hasCode) {
          checkGoogleAdsStatus(user.id).then(status => {
              if (status.connected) {
                  setGoogleAdsToken('backend-connected');
                  setAccountName(status.accountName || '');
              } else {
                  setGoogleAdsToken(null);
                  localStorage.removeItem('google_ads_token');
              }
          });
      }
  }, [user]);

  // Check for Google OAuth Code on Mount
  useEffect(() => {
      const checkForCode = async () => {
          const params = new URLSearchParams(window.location.search);
          const code = params.get('code');
          
          if (code && user) {
              // Limpa a URL para evitar reprocessamento
              window.history.replaceState({}, document.title, window.location.pathname);
              
              setLoading('google-ads');
              try {
                  const result = await exchangeCodeForToken(code, user.id);
                  
                  if (result.mode === 'selection_required') {
                      setAvailableAccounts(result.accounts);
                      setShowAccountSelector(true);
                  } else {
                      setGoogleAdsToken('backend-connected'); 
                      localStorage.setItem('google_ads_token', 'backend-connected');
                      setAccountName(result.account?.name || '');
                      alert("Google Ads conectado com sucesso!");
                  }
              } catch (error: any) {
                  alert("Erro na conexão: " + error.message);
              } finally {
                  setLoading(null);
              }
          }
      };
      checkForCode();
  }, [user]);

  // Handle Account Selection
  const handleAccountSelect = async (accountId: string, accName: string, isManager: boolean) => {
      if (!user) return;
      setLoading('google-ads-select');

      if (isManager) {
          try {
              const result = await listMccChildren(user.id, accountId);
              if (result.children && result.children.length > 0) {
                  setAvailableAccounts(result.children);
                  setSelectedManagerId(accountId); // Store manager ID
              } else {
                  alert("Nenhuma conta cliente encontrada nesta MCC.");
              }
          } catch (error: any) {
              alert("Erro ao listar contas da MCC: " + error.message);
          } finally {
              setLoading(null);
          }
          return;
      }

      try {
          await selectGoogleAdsAccount(user.id, accountId, accName, selectedManagerId || undefined);
          setGoogleAdsToken('backend-connected');
          localStorage.setItem('google_ads_token', 'backend-connected');
          setAccountName(accName);
          setShowAccountSelector(false);
          setSelectedManagerId(null);
          alert(`Conta "${accName}" vinculada com sucesso!`);
      } catch (error: any) {
          alert("Erro ao selecionar conta: " + error.message);
      } finally {
          setLoading(null);
      }
  };

  // Restante dos useEffects (WhatsApp, etc) - REMOVIDO
  /*
  useEffect(() => {
     if (whatsappConfig?.isConnected) {
         setWppStatus('CONNECTED');
         setWppQr(null);
         setWppPairingCode(null);
         if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
     }
  }, [whatsappConfig]);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, []);

  // Polling WhatsApp
  useEffect(() => {
    if (wppStatus === 'QRCODE' && tempInstanceName) {
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const result = await checkStatus(tempInstanceName);
          if (result.status === 'connected') {
             clearInterval(pollingIntervalRef.current);
             if (user) await configureInstance(tempInstanceName, user.id);
             setWppStatus('CONNECTED');
             setWhatsappConfig({ instanceName: tempInstanceName, isConnected: true, apiKey: '', baseUrl: '' });
             setWppQr(null);
          }
        } catch (e) { console.error("Polling error", e); }
      }, 3000);
    } else {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    }
  }, [wppStatus, tempInstanceName, user, setWhatsappConfig]);
  */

  // Handlers
  /* REMOVIDO
  const handleWppConnect = async () => { 
    if (!user) return;
    setWppStatus('CONNECTING'); setLoading('wpp'); setWppError(''); setWppQr(null); setWppPairingCode(null);
    try {
        const result = await initInstance(user.id, user.clinic, wppPhone || undefined);
        if (result.error) throw new Error(result.error);
        const instanceName = result.instanceName;
        if (!instanceName) throw new Error("Erro: Nome da instância não retornado.");
        setTempInstanceName(instanceName);
        if (result.qrCodeBase64) {
            setWppQr(result.qrCodeBase64.startsWith('data:') ? result.qrCodeBase64 : `data:image/png;base64,${result.qrCodeBase64}`);
            setWppStatus('QRCODE');
        } else if (result.pairingCode) {
            setWppPairingCode(result.pairingCode);
            setWppStatus('PAIRING');
        } else if (result.status === 'CONNECTED' || result.instance?.state === 'open') {
             await configureInstance(instanceName, user.id);
             setWppStatus('CONNECTED');
             setWhatsappConfig({ instanceName: instanceName, isConnected: true, apiKey: '', baseUrl: '' });
        } else {
             throw new Error("Não foi possível obter o código de conexão.");
        }
    } catch (err: any) {
        setWppStatus('DISCONNECTED'); setWppError(err.message || "Erro ao conectar via N8N.");
    } finally { setLoading(null); }
  };

  const handleWppDisconnect = async () => {
      if (user) await logoutInstance(user.id, whatsappConfig?.instanceName);
      setWhatsappConfig(null); setWppStatus('IDLE'); setWppQr(null); setWppPairingCode(null); setWppPhone('');
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
  };
  */
  
  const handleGoogleLogin = async () => { 
      setLoading('google-ads'); 
      try { 
          await initiateGoogleAdsAuth(); 
      } catch (error: any) { 
          alert("Erro: " + error.message); 
          setLoading(null); 
      } 
  };

  const handleGoogleLogout = async () => { 
      if (user) await supabase.from('google_ads_integrations').delete().eq('user_id', user.id);
      localStorage.removeItem('google_ads_token'); 
      setGoogleAdsToken(null); 
      setAccountName('');
  };

  // Handlers legados
  const handleCalendarLogin = async () => { setLoading('calendar'); try { await signInWithGoogleCalendar(); } catch (e: any) { alert(e.message); setLoading(null); } };
  const handleCalendarLogout = () => { localStorage.removeItem('google_calendar_token'); setGoogleCalendarToken(null); window.location.reload(); };
  const handleSheetsLogin = async () => { setLoading('sheets'); try { await signInWithGoogleSheets(); } catch (e: any) { alert(e.message); setLoading(null); } };
  const handleSheetsLogout = () => { localStorage.removeItem('google_sheets_token'); setGoogleSheetsToken(null); setSpreadsheets([]); setSelectedSpreadsheet(null); window.location.reload(); };
  const handleSelectSpreadsheet = async (e: React.ChangeEvent<HTMLSelectElement>) => { const id = e.target.value; if (!id) return; const name = e.target.options[e.target.selectedIndex].text; setSelectedSpreadsheet({ id, name }); setImportLoading(true); try { const tabs = await getSpreadsheetDetails(googleSheetsToken!, id); setSheetTabs(tabs); setSelectedTab(tabs[0] || ''); } catch (e) { alert('Erro ao carregar abas.'); } finally { setImportLoading(false); } };
  const handleImportLeads = async () => { if (!selectedSpreadsheet || !selectedTab) return; setImportLoading(true); setImportStatus(''); try { const rows = await getSheetData(googleSheetsToken!, selectedSpreadsheet.id, selectedTab); if (rows.length < 2) throw new Error("Planilha vazia."); setImportStatus(`${rows.length - 1} leads importados!`); setTimeout(() => setImportStatus(''), 5000); } catch (e: any) { setImportStatus(`Erro: ${e.message}`); } finally { setImportLoading(false); } };

  return (
    <div className="space-y-8 pb-20 relative">
      <header className="flex justify-between items-end">
        <div><h2 className="text-2xl font-bold text-navy">Central de Conexões</h2><p className="text-slate-500 text-sm">Gerencie o acesso às suas fontes de dados.</p></div>
        <div className="hidden md:flex items-center gap-2 text-xs font-bold text-slate-400 bg-white px-3 py-1.5 rounded-lg border border-slate-200"><Activity size={14} className="text-emerald-500" /> Status do Sistema: Online</div>
      </header>

      {/* MODAL DE SELEÇÃO DE CONTA */}
      {showAccountSelector && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/80 backdrop-blur-md animate-in fade-in">
              <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                      <h3 className="text-lg font-bold text-navy">Selecione a Conta de Anúncios</h3>
                      <p className="text-xs text-slate-500 mt-1">Encontramos múltiplas contas vinculadas ao seu e-mail.</p>
                  </div>
                  <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-2">
                      {availableAccounts.map((acc) => (
                          <button 
                            key={acc.id} 
                            onClick={() => handleAccountSelect(acc.id, acc.name, acc.isManager)}
                            disabled={loading === 'google-ads-select'}
                            className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition-all group flex items-center justify-between"
                          >
                              <div className="flex items-center gap-3">
                                  <div className="p-2 bg-white border border-slate-100 rounded-lg text-slate-400 group-hover:text-blue-500"><Building2 size={20}/></div>
                                  <div>
                                      <p className="text-sm font-bold text-navy flex items-center gap-2">
                                          {acc.name}
                                          {acc.isManager && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">MCC</span>}
                                      </p>
                                      <p className="text-[10px] text-slate-400 font-mono">ID: {acc.id}</p>
                                  </div>
                              </div>
                              <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500"/>
                          </button>
                      ))}
                  </div>
                  <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
                      <button onClick={() => setShowAccountSelector(false)} className="text-xs font-bold text-slate-400 hover:text-rose-500">Cancelar Conexão</button>
                  </div>
              </div>
          </div>
      )}

      {/* DASHBOARD STATUS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-in fade-in duration-500">
        {[
            { id: 'google-ads', label: 'Google Ads', active: !!googleAdsToken, icon: <GoogleIcon size={18} /> },
            { id: 'calendar', label: 'G. Calendar', active: !!googleCalendarToken, icon: <Calendar size={18} className={!!googleCalendarToken ? 'text-amber-500' : ''} /> },
            { id: 'sheets', label: 'G. Sheets', active: !!googleSheetsToken, icon: <FileSpreadsheet size={18} className={!!googleSheetsToken ? 'text-emerald-500' : ''} /> },
            // { id: 'wpp', label: 'WhatsApp', active: !!whatsappConfig?.isConnected, icon: <MessageCircle size={18} className={!!whatsappConfig?.isConnected ? 'text-emerald-500' : ''} /> }, // REMOVIDO
        ].map((item) => (
            <div key={item.id} className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${item.active ? 'bg-emerald-50/50 border-emerald-100 shadow-sm' : 'bg-white border-slate-100 opacity-60 grayscale-[0.5]'}`}>
                <div className="flex items-center gap-3"><div className={`p-2 rounded-xl ${item.active ? 'bg-white shadow-sm' : 'bg-slate-50 text-slate-400'}`}>{item.icon}</div><div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{item.label}</p><p className={`text-xs font-black ${item.active ? 'text-emerald-600' : 'text-slate-400'}`}>{item.active ? 'Conectado' : 'Pendente'}</p></div></div>
            </div>
        ))}
      </div>

      <div className="h-px bg-slate-200 w-full"></div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* WHATSAPP CARD (REMOVIDO) */}
        {/*
        <div className={`bg-white p-6 rounded-3xl border shadow-sm flex flex-col group transition-all relative overflow-hidden ${whatsappConfig?.isConnected ? 'border-emerald-100 ring-1 ring-emerald-50' : 'border-slate-200 hover:border-navy'}`}>
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-navy group-hover:text-white transition-colors"><MessageCircle size={24} className="text-emerald-600"/></div>
              {whatsappConfig?.isConnected ? <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase border border-emerald-100"><CheckCircle2 size={10} /> Ativo</span> : <span className="text-[9px] font-black text-slate-300 bg-slate-50 px-2 py-1 rounded-full uppercase border border-slate-100">Inativo</span>}
            </div>
            <h3 className="font-black text-navy text-sm uppercase tracking-widest">WhatsApp Business</h3>
            <p className="text-[10px] text-slate-400 mt-1 mb-4">Conecte seu número para ativar a IA.</p>
            
            {whatsappConfig?.isConnected ? (
               <div className="mt-auto space-y-3">
                   <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl"><p className="text-[10px] font-bold text-emerald-800 flex items-center gap-2"><Smartphone size={12}/> Online: {whatsappConfig.instanceName}</p></div>
                   <button onClick={handleWppDisconnect} className="w-full py-2 flex items-center justify-center gap-2 text-[10px] font-black uppercase text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><LogOut size={12} /> Desconectar</button>
               </div>
            ) : (
               <div className="mt-auto space-y-3">
                   {(wppStatus === 'IDLE' || wppStatus === 'DISCONNECTED') && (
                       <div className="space-y-3 animate-in fade-in">
                          {wppError && <div className="text-[9px] text-rose-500 font-bold bg-rose-50 p-3 rounded-xl flex items-start gap-2 leading-tight mb-2"><AlertCircle size={14} className="shrink-0"/> {wppError}</div>}
                          <div className="space-y-1"><label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Seu Número WhatsApp (Opcional)</label><div className="relative"><Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input type="tel" value={wppPhone} onChange={(e) => setWppPhone(e.target.value.replace(/\D/g, ''))} placeholder="11999999999" className="w-full pl-9 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:border-navy" /></div><p className="text-[9px] text-slate-400 px-1">Deixe vazio para escanear QR Code.</p></div>
                          <button onClick={handleWppConnect} className="w-full py-3 bg-navy text-white rounded-xl text-[10px] font-black uppercase flex justify-center items-center gap-2 hover:bg-slate-800 shadow-lg shadow-navy/20">{loading === 'wpp' ? <Loader2 size={14} className="animate-spin" /> : (wppPhone ? 'Conectar via N8N' : 'Gerar QR via N8N')}</button>
                       </div>
                   )}
                   {wppStatus === 'CONNECTING' && <div className="flex flex-col items-center py-4 text-slate-400 animate-in fade-in"><Loader2 size={24} className="animate-spin mb-2 text-navy" /><p className="text-[10px] font-bold uppercase">Solicitando N8N...</p></div>}
                   {wppStatus === 'PAIRING' && wppPairingCode && <div className="text-center space-y-4 animate-in zoom-in bg-white p-4 rounded-xl border-2 border-dashed border-navy/20"><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Código de Pareamento</p><div className="flex items-center justify-center gap-3"><h2 className="text-3xl font-black text-navy tracking-widest">{wppPairingCode.slice(0,4)}-{wppPairingCode.slice(4)}</h2><button onClick={() => navigator.clipboard.writeText(wppPairingCode)} className="p-2 text-slate-400 hover:text-navy hover:bg-slate-50 rounded-lg" title="Copiar"><Copy size={16} /></button></div><div className="text-[10px] text-left space-y-1.5 text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100 leading-tight"><p>1. No seu WhatsApp, vá em <strong>Aparelhos Conectados</strong>.</p><p>2. Toque em <strong>Conectar Aparelho</strong>.</p><p>3. Escolha <strong>"Conectar com número de telefone"</strong>.</p><p>4. Digite o código acima.</p></div><button onClick={() => setWppStatus('IDLE')} className="text-[9px] underline text-slate-400 hover:text-rose-400">Cancelar</button></div>}
                   {wppStatus === 'QRCODE' && wppQr && <div className="text-center space-y-3 animate-in zoom-in"><div className="bg-white p-2 rounded-xl border border-slate-200 inline-block shadow-sm"><img src={wppQr} alt="QR Code" className="w-48 h-48 object-contain" /></div><div className="flex flex-col items-center gap-1"><p className="text-[10px] font-bold text-navy uppercase animate-pulse">Escaneie com seu WhatsApp</p><p className="text-[9px] text-slate-400">Verificando conexão automaticamente...</p></div><button onClick={() => setWppStatus('IDLE')} className="text-[9px] underline text-slate-400 hover:text-rose-400">Cancelar</button></div>}
               </div>
            )}
        </div>
        */}
        
        {/* GOOGLE ADS CARD */}
        <div className={`bg-white p-6 rounded-3xl border shadow-sm flex flex-col group transition-all ${googleAdsToken ? 'border-emerald-100 ring-1 ring-emerald-50 col-span-1 md:col-span-2' : 'border-slate-200 hover:border-navy'}`}>
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-navy group-hover:text-white transition-colors"><GoogleIcon size={24} /></div>
              {googleAdsToken ? <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase border border-emerald-100"><CheckCircle2 size={10} /> Conectado</span> : <span className="text-[9px] font-black text-slate-300 bg-slate-50 px-2 py-1 rounded-full uppercase border border-slate-100">Inativo</span>}
            </div>
            <h3 className="font-black text-navy text-sm uppercase tracking-widest">Google Ads</h3>
            <p className="text-[10px] text-slate-400 mt-1 mb-4">Conexão segura (OAuth 2.0) com salvamento automático de tokens.</p>
            {googleAdsToken ? (
               <div className="mt-auto space-y-3">
                   <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-between">
                        <div>
                            <p className="text-[10px] font-bold text-emerald-800">Sincronização Ativa</p>
                            {accountName && <p className="text-[9px] text-emerald-600 truncate max-w-[150px]">{accountName}</p>}
                        </div>
                   </div>
                   <button onClick={handleGoogleLogin} className="w-full py-2 flex items-center justify-center gap-2 text-[10px] font-bold uppercase text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-all"><RefreshCw size={12} /> Trocar Conta</button>
                   <button onClick={handleGoogleLogout} className="w-full py-2 flex items-center justify-center gap-2 text-[10px] font-black uppercase text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><LogOut size={12} /> Desconectar</button>
               </div>
            ) : (
              <button onClick={handleGoogleLogin} disabled={!!loading} className={`mt-auto w-full py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${loading === 'google-ads' ? 'bg-slate-100 text-slate-400' : 'bg-navy text-white hover:bg-slate-800 shadow-lg shadow-navy/20'}`}>
                {loading === 'google-ads' ? <Loader2 size={14} className="animate-spin" /> : 'Conectar Google Ads'}
              </button>
            )}
        </div>

        {/* OUTROS CARDS (CALENDAR/SHEETS) MANTIDOS IGUAIS */}
        <div className={`bg-white p-6 rounded-3xl border shadow-sm flex flex-col group transition-all ${googleCalendarToken ? 'border-emerald-100 ring-1 ring-emerald-50' : 'border-slate-200 hover:border-navy'}`}>
            <div className="flex justify-between items-start mb-4"><div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-navy group-hover:text-white transition-colors"><Calendar className="text-amber-500" /></div>{googleCalendarToken ? <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase border border-emerald-100"><CheckCircle2 size={10} /> Ativo</span> : <span className="text-[9px] font-black text-slate-300 bg-slate-50 px-2 py-1 rounded-full uppercase border border-slate-100">Inativo</span>}</div>
            <h3 className="font-black text-navy text-sm uppercase tracking-widest">Google Agenda</h3><p className="text-[10px] text-slate-400 mt-1 mb-4 h-8">Sincronize sua agenda médica.</p>
            {googleCalendarToken ? (<div className="mt-auto"><button onClick={handleCalendarLogout} className="w-full py-2 flex items-center justify-center gap-2 text-[10px] font-black uppercase text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><LogOut size={12} /> Desconectar</button></div>) : (<button onClick={handleCalendarLogin} disabled={!!loading} className={`mt-auto w-full py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${loading === 'calendar' ? 'bg-slate-100 text-slate-400' : 'bg-navy text-white hover:bg-slate-800 shadow-lg shadow-navy/20'}`}>{loading === 'calendar' ? <Loader2 size={14} className="animate-spin" /> : 'Conectar Agora'}</button>)}
        </div>

        <div className={`bg-white p-6 rounded-3xl border shadow-sm flex flex-col group transition-all ${googleSheetsToken ? 'border-emerald-100 ring-1 ring-emerald-50 col-span-1 md:col-span-2 lg:col-span-1' : 'border-slate-200 hover:border-navy'}`}>
            <div className="flex justify-between items-start mb-4"><div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-navy group-hover:text-white transition-colors"><FileSpreadsheet className="text-emerald-500" /></div>{googleSheetsToken ? <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase border border-emerald-100"><CheckCircle2 size={10} /> Ativo</span> : <span className="text-[9px] font-black text-slate-300 bg-slate-50 px-2 py-1 rounded-full uppercase border border-slate-100">Inativo</span>}</div>
            <h3 className="font-black text-navy text-sm uppercase tracking-widest">Planilhas Google</h3><p className="text-[10px] text-slate-400 mt-1 mb-4">Importe listas de leads.</p>
            {googleSheetsToken ? (<div className="mt-auto space-y-4 animate-in fade-in"><div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-3">{importStatus && <p className="text-[9px] font-bold text-emerald-600 bg-emerald-50 p-2 rounded mb-2 text-center">{importStatus}</p>}<div className="space-y-2"><select onChange={handleSelectSpreadsheet} className="w-full mt-1 p-1.5 text-[10px] border rounded bg-white focus:outline-none focus:border-navy"><option value="">Selecione arquivo...</option>{spreadsheets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><select onChange={e => setSelectedTab(e.target.value)} value={selectedTab} disabled={!selectedSpreadsheet} className="w-full mt-1 p-1.5 text-[10px] border rounded bg-white focus:outline-none focus:border-navy">{sheetTabs.map(t => <option key={t} value={t}>{t}</option>)}</select></div><button onClick={handleImportLeads} disabled={importLoading || !selectedTab} className="w-full bg-navy text-white py-2 rounded-lg text-[10px] font-bold uppercase flex justify-center items-center gap-2 hover:bg-slate-800 disabled:opacity-50">{importLoading ? <Loader2 size={12} className="animate-spin"/> : <><Upload size={12} /> Importar</>}</button></div><button onClick={handleSheetsLogout} className="text-[9px] font-bold text-rose-400 underline w-full text-center">Desconectar</button></div>) : (<button onClick={handleSheetsLogin} disabled={!!loading} className={`mt-auto w-full py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${loading === 'sheets' ? 'bg-slate-100 text-slate-400' : 'bg-navy text-white hover:bg-slate-800 shadow-lg shadow-navy/20'}`}>{loading === 'sheets' ? <Loader2 size={14} className="animate-spin" /> : 'Conectar Agora'}</button>)}
        </div>
      </div>

      <div className="h-px bg-slate-200 w-full my-8"></div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-6">
        {/* Header inside the card */}
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-100 gap-4">
          <div>
            <h3 className="text-base font-black text-navy uppercase tracking-wider flex items-center gap-2">
              <MessageCircle size={18} className="text-blue-500" />
              WhatsApp do CRM
            </h3>
            <p className="text-slate-500 text-[11px] mt-1">Conecte e gerencie canais de atendimento para o CRM do AXIS AI.</p>
          </div>
          
          {/* Discrete technical status */}
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 space-y-1">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Status do Servidor:</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-semibold text-slate-600">
              <span className="flex items-center gap-1">
                Supabase URL: {crmHealth?.supabaseUrlConfigured ? <span className="text-emerald-500 font-bold">Sim</span> : <span className="text-rose-455 font-bold">Não</span>}
              </span>
              <span className="flex items-center gap-1">
                Service Role: {crmHealth?.serviceRoleConfigured ? <span className="text-emerald-500 font-bold">Sim</span> : <span className="text-rose-455 font-bold">Não</span>}
              </span>
              <span className="flex items-center gap-1">
                Public URL: {crmHealth?.appPublicUrlConfigured ? <span className="text-emerald-500 font-bold">Sim</span> : <span className="text-rose-455 font-bold">Não</span>}
              </span>
            </div>
            <div className="mt-1 text-[8px] font-mono text-slate-400 bg-slate-100/60 p-1.5 rounded-lg border border-slate-200/50 break-all max-w-[280px]">
              Backend URL: {((import.meta as any).env?.VITE_BACKEND_URL) || "proxy local"}
            </div>
            {crmHealth && !crmHealth.serviceRoleConfigured && (
              <p className="text-[9px] text-rose-500 font-black mt-1 animate-pulse max-w-xs leading-normal">
                ⚠️ SUPABASE_SERVICE_ROLE_KEY ausente no backend. As conexões CRM podem não funcionar por causa do RLS.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* COLUMN 1: "Conectar WhatsApp via Uazapi" */}
          <div className="lg:col-span-5 space-y-4">
            <h4 className="font-bold text-navy text-xs uppercase tracking-wider flex items-center gap-1.5 text-slate-700">
              Conectar WhatsApp via Uazapi
            </h4>

            {/* TAB SELECTOR */}
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setUazapiFormMode('manual')}
                className={`flex-1 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all ${
                  uazapiFormMode === 'manual'
                    ? 'bg-white text-navy shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-navy'
                }`}
              >
                Tenho Instância (Manual)
              </button>
              <button
                type="button"
                onClick={() => setUazapiFormMode('create')}
                className={`flex-1 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all ${
                  uazapiFormMode === 'create'
                    ? 'bg-white text-navy shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-navy'
                }`}
              >
                Não Tenho Instância (Novo)
              </button>
            </div>
            
            {uazapiFormMode === 'manual' ? (
              <form onSubmit={handleSaveCrmConnection} className="space-y-3 bg-slate-50/50 p-4 border border-slate-150 rounded-2xl">
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Nome da Conexão *</label>
                  <input 
                    type="text" 
                    value={crmConnName} 
                    onChange={(e) => setCrmConnName(e.target.value)} 
                    placeholder="Ex: WhatsApp Clínica" 
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-navy focus:outline-none focus:border-blue-500 bg-white font-medium" 
                    required
                  />
                </div>

                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Servidor Uazapi *</label>
                  <input 
                    type="url" 
                    value={crmApiUrl} 
                    onChange={(e) => setCrmApiUrl(e.target.value)} 
                    placeholder="https://task-ai.uazapi.com" 
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-navy focus:outline-none focus:border-blue-500 bg-white font-mono" 
                    required
                  />
                </div>

                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Token da instância *</label>
                  <input 
                    type="password" 
                    value={crmToken} 
                    onChange={(e) => setCrmToken(e.target.value)} 
                    placeholder="Seu token de API da instância" 
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-navy focus:outline-none focus:border-blue-500 bg-white" 
                    required
                  />
                </div>

                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Nome da Instância (Opcional)</label>
                  <input 
                    type="text" 
                    value={crmInstanceName} 
                    onChange={(e) => setCrmInstanceName(e.target.value)} 
                    placeholder="Ex: clinica-whatsapp" 
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-navy focus:outline-none focus:border-blue-500 bg-white font-medium" 
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={crmListenGroups} 
                      onChange={(e) => setCrmListenGroups(e.target.checked)} 
                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                    />
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">Ouvir Grupos</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={crmRestoreMsgs} 
                      onChange={(e) => setCrmRestoreMsgs(e.target.checked)} 
                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                    />
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">Restaurar Msgs</span>
                  </label>
                </div>

                <button 
                  type="submit" 
                  disabled={submittingCrm}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[9px] font-black uppercase flex justify-center items-center gap-2 disabled:opacity-50 transition-all shadow-sm"
                >
                  {submittingCrm ? <Loader2 size={12} className="animate-spin" /> : 'Salvar Conexão Uazapi'}
                </button>
              </form>
            ) : (
              <div className="space-y-3 bg-slate-50/50 p-4 border border-slate-150 rounded-2xl">
                <div className="bg-emerald-50 text-emerald-800 text-[10px] p-3 rounded-xl border border-emerald-100/60 leading-normal font-semibold">
                  Se você não tem uma instância pré-criada, a AXIS AI cria automaticamente um novo slot limpo de WhatsApp na Uazapi privada para você e apresenta o QR Code para conectar direto do seu celular.
                </div>
                
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Nome da Conexão *</label>
                  <input 
                    type="text" 
                    value={crmConnName} 
                    onChange={(e) => setCrmConnName(e.target.value)} 
                    placeholder="Ex: WhatsApp Clínica" 
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-navy focus:outline-none focus:border-blue-500 bg-white font-medium" 
                    required
                  />
                </div>

                <button 
                  type="button" 
                  onClick={() => handleCreateAndConnectInstance(crmConnName)}
                  disabled={isCreatingInstance || !crmConnName.trim()}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[9px] font-black uppercase flex justify-center items-center gap-2 disabled:opacity-50 transition-all shadow-sm"
                >
                  {isCreatingInstance ? <Loader2 size={12} className="animate-spin" /> : 'Criar Instância e Gerar QR Code'}
                </button>
                
                <p className="text-[8px] text-slate-400 leading-normal text-center italic mt-1 font-medium select-none">
                  * Requer que a variável UAZAPI_ADMIN_TOKEN esteja configurada na AXIS.
                </p>
              </div>
            )}
          </div>

          {/* COLUMN 2: "WhatsApps conectados" */}
          <div className="lg:col-span-7 space-y-4 flex flex-col h-full min-h-[380px]">
            <h4 className="font-bold text-navy text-xs uppercase tracking-wider flex items-center justify-between text-slate-700">
              WhatsApps conectados
              <button 
                onClick={fetchCrmConnections} 
                disabled={loadingConnections} 
                className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-navy transition-all" 
                title="Atualizar conexões"
              >
                <RefreshCw size={12} className={loadingConnections ? "animate-spin" : ""} />
              </button>
            </h4>

            {(() => {
              const safeCrmConnections = Array.isArray(crmConnections) ? crmConnections : [];
              
              if (loadingConnections && safeCrmConnections.length === 0) {
                return (
                  <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-400 border border-slate-100 rounded-2xl bg-slate-50/20">
                    <Loader2 size={24} className="animate-spin mb-2 text-blue-500" />
                    <p className="text-[9px] font-bold uppercase tracking-wider">Carregando conexões...</p>
                  </div>
                );
              }
              
              if (crmConnectionsError) {
                return (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 px-4 text-center border border-rose-100 rounded-2xl bg-rose-50/20 text-rose-500">
                    <AlertCircle size={24} className="mb-2 text-rose-500" />
                    <p className="text-[10px] font-black uppercase tracking-wider text-rose-700">Erro ao carregar</p>
                    <p className="text-[10px] text-rose-600 max-w-sm mt-1">{crmConnectionsError}</p>
                    <button 
                      onClick={fetchCrmConnections} 
                      className="mt-3 px-3 py-1 bg-white hover:bg-rose-50 border border-rose-250 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
                    >
                      Tentar novamente
                    </button>
                  </div>
                );
              }
              
              if (safeCrmConnections.length === 0) {
                return (
                  <div className="flex-1 flex flex-col items-center justify-center py-16 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-slate-50/10">
                    <MessageCircle size={30} className="text-slate-300 mb-2" />
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nenhum WhatsApp cadastrado</p>
                    <p className="text-[9px] text-slate-400 mt-1 max-w-xs">Preencha o formulário para conectar o WhatsApp.</p>
                  </div>
                );
              }
              
              return (
                <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                  {safeCrmConnections.map((conn) => {
                    const isConnected = conn.connection_status === 'connected';
                    const isConnecting = conn.connection_status === 'connecting';
                    const isDisconnected = conn.connection_status === 'disconnected';
                    const isError = conn.connection_status === 'error';
                    
                    const isSyncing = syncingConnectionId === conn.id;
                    const isConfiguringWebhook = configuringWebhookId === conn.id;
                    
                    return (
                      <div key={conn.id} className="p-3.5 bg-slate-50/50 border border-slate-200 rounded-2xl flex flex-col gap-3 hover:border-slate-300 transition-colors animate-in fade-in">
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${
                                isConnected ? 'bg-emerald-500' : 
                                isConnecting ? 'bg-blue-400' : 
                                isDisconnected ? 'bg-slate-400' : 'bg-rose-500'
                              }`}></span>
                              <p className="text-xs font-black text-navy truncate">{conn.connection_name}</p>
                              <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                isConnected ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                isConnecting ? 'bg-blue-50 text-blue-500 border-blue-100' :
                                isDisconnected ? 'bg-slate-100 text-slate-500 border-slate-200' :
                                'bg-rose-50 text-rose-500 border-rose-100'
                              }`}>
                                {isConnected ? 'Conectado' :
                                 isConnecting ? 'Conectando' :
                                 isDisconnected ? 'Desconectado' : 'Erro'}
                              </span>
                            </div>
                            
                            <p className="text-[9px] font-mono text-slate-400 truncate">{conn.api_base_url}</p>
                            
                            {conn.instance_name && (
                              <p className="text-[9px] text-slate-500">
                                Instância: <span className="font-semibold text-slate-600">{conn.instance_name}</span>
                              </p>
                            )}

                            {conn.connected_phone && (
                              <p className="text-[9px] text-slate-500">
                                Número conectado: <span className="font-mono font-semibold text-slate-700">{conn.connected_phone}</span>
                              </p>
                            )}

                            {conn.last_error && (
                              <p className="text-[9px] text-rose-500 font-medium">
                                Último erro: <span className="font-mono text-[8px] text-rose-600 font-normal bg-rose-50 px-1 py-0.5 rounded block whitespace-pre-wrap mt-0.5">{conn.last_error}</span>
                              </p>
                            )}

                            {conn.connection_status && (
                              <p className="text-[9px] text-slate-400">
                                Status bruto: <span className="font-mono text-[8px] bg-slate-100 px-1 py-0.5 rounded text-slate-500">{conn.connection_status}</span>
                              </p>
                            )}
                            
                            {conn.webhook_url && (
                              <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-100 mt-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[8px] text-slate-500 uppercase font-black shrink-0">Webhook AXIS:</span>
                                  <span className="text-[8px] font-mono text-slate-500 bg-slate-100/80 px-1 py-0.5 rounded truncate max-w-[200px]" title={conn.webhook_url}>
                                    {conn.webhook_url}
                                  </span>
                                  <button 
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(conn.webhook_url);
                                      alert('URL do Webhook copiada!');
                                    }} 
                                    className="text-slate-400 hover:text-navy p-0.5 rounded hover:bg-slate-200 transition-all shrink-0"
                                    title="Copiar URL"
                                  >
                                    <Copy size={9} />
                                  </button>
                                </div>
                                <p className="text-[8px] text-slate-400 leading-normal italic mt-0.5 max-w-sm">
                                  Na Uazapi, use "Salvar com um novo" para não sobrescrever webhooks existentes. Eventos recomendados: history, connection, messages, messages_update. Excluir: wasSentByApi, isGroupYes.
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col sm:flex-row md:flex-col lg:flex-row items-stretch sm:items-center gap-1.5 shrink-0">
                            {!isConnected && (
                              <button 
                                type="button"
                                onClick={() => handleTriggerConnect(conn.id)}
                                className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 font-bold text-[8px] uppercase tracking-wider rounded-lg border border-emerald-250 flex items-center justify-center gap-1 transition-all"
                                title="Gerar QR Code para conectar WhatsApp"
                              >
                                <Smartphone size={9} />
                                Gerar QR Code
                              </button>
                            )}

                            <button 
                              type="button"
                              onClick={() => handleCheckCrmStatus(conn.id)}
                              disabled={isSyncing}
                              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-600 font-bold text-[8px] uppercase tracking-wider rounded-lg border border-slate-200 flex items-center justify-center gap-1 transition-all disabled:opacity-50"
                            >
                              {isSyncing ? <Loader2 size={9} className="animate-spin text-blue-500" /> : <RefreshCw size={9} />}
                              Sincronizar
                            </button>

                            <button 
                              type="button"
                              onClick={() => handleConfigureCrmWebhook(conn.id)}
                              disabled={isConfiguringWebhook || !conn.webhook_url}
                              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold text-[8px] uppercase tracking-wider rounded-lg border border-blue-200 flex items-center justify-center gap-1 transition-all disabled:opacity-50"
                              title="Configurar webhook automaticamente na Uazapi"
                            >
                              {isConfiguringWebhook ? <Loader2 size={9} className="animate-spin text-blue-500" /> : <Activity size={9} />}
                              Configurar Webhook
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                if (openEventsConnId === conn.id) {
                                  setOpenEventsConnId(null);
                                } else {
                                  setOpenEventsConnId(conn.id);
                                  handleFetchEvents(conn.id);
                                }
                              }}
                              className="px-2.5 py-1 bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-600 font-bold text-[8px] uppercase tracking-wider rounded-lg flex items-center justify-center gap-1 transition-all"
                              title="Ver histórico de recebimentos do Webhook"
                            >
                              <LayoutList size={9} />
                              Ver eventos
                            </button>

                            {conn.webhook_url && (
                              <button
                                type="button"
                                onClick={() => handleTestWebhook(conn)}
                                disabled={testingWebhookId === conn.id}
                                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-600 font-bold text-[8px] uppercase tracking-wider rounded-lg flex items-center justify-center gap-1 transition-all disabled:opacity-50"
                                title="Testar entrega do Webhook AXIS com payload fake"
                              >
                                {testingWebhookId === conn.id ? <Loader2 size={9} className="animate-spin text-amber-500" /> : <Activity size={9} />}
                                Testar Webhook
                              </button>
                            )}

                            <button 
                              type="button"
                              onClick={() => handleDeleteCrmConnection(conn.id)}
                              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-150 border border-rose-200 text-rose-600 font-bold text-[8px] uppercase tracking-wider rounded-lg flex items-center justify-center gap-1 transition-all"
                              title="Remover conexão da AXIS"
                            >
                              <Trash2 size={9} />
                              Excluir
                            </button>
                          </div>
                        </div>

                        {/* PANEL DIAGNOSTIC WEBHOOK */}
                        {openEventsConnId === conn.id && (
                          <div className="mt-2.5 pt-3 border-t border-slate-200/80 space-y-2.5 animate-in slide-in-from-top duration-200">
                            <div className="flex items-center justify-between">
                              <h6 className="text-[10px] font-black uppercase text-navy tracking-wider flex items-center gap-1">
                                <Activity size={10} className="text-blue-500 animate-pulse" />
                                Diagnóstico do Webhook (Últimos 20 Eventos)
                              </h6>
                              <div className="flex items-center gap-1.5">
                                {eventsList.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (eventsList[0]?.raw_payload) {
                                        navigator.clipboard.writeText(JSON.stringify(eventsList[0].raw_payload, null, 2));
                                        alert('Último payload bruto copiado!');
                                      } else {
                                        alert('Nenhum payload disponível.');
                                      }
                                    }}
                                    className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[8px] uppercase tracking-wider rounded border border-slate-200 transition-all flex items-center gap-1"
                                    title="Copiar Payload Bruto do Último Evento"
                                  >
                                    <Copy size={8} />
                                    Copiar Último Payload
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleFetchEvents(conn.id)}
                                  disabled={loadingEvents}
                                  className="p-1 hover:bg-slate-100 text-slate-500 rounded border border-slate-250 hover:text-navy transition-all"
                                  title="Recarregar logs"
                                >
                                  <RefreshCw size={8} className={loadingEvents ? "animate-spin" : ""} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setOpenEventsConnId(null)}
                                  className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-500 rounded border border-slate-250 hover:border-rose-100 transition-all"
                                  title="Fechar logs"
                                >
                                  <X size={8} />
                                </button>
                              </div>
                            </div>

                            {loadingEvents ? (
                              <div className="py-6 flex flex-col items-center justify-center text-slate-400 gap-1.5">
                                <Loader2 size={12} className="animate-spin text-blue-500" />
                                <span className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Buscando histórico...</span>
                              </div>
                            ) : eventsList.length === 0 ? (
                              <div className="p-4 rounded-xl bg-slate-100/40 text-center text-slate-400 border border-slate-100">
                                <p className="text-[9px] font-bold">Nenhum evento registrado ainda.</p>
                                <p className="text-[8px] text-slate-400 mt-0.5">Dispare um teste clicando em "Testar Webhook" ou aguarde envios reais da Uazapi.</p>
                              </div>
                            ) : (
                              <div className="max-h-[220px] overflow-y-auto border border-slate-200 rounded-xl bg-white divide-y divide-slate-100 font-sans">
                                {eventsList.map((evt) => {
                                  const isProcessingError = evt.processing_status === 'error';
                                  const isProcessed = evt.processing_status === 'processed';
                                  const isIgnored = evt.processing_status === 'ignored';
                                  
                                  return (
                                    <div key={evt.id} className="p-2 space-y-1 text-[9px] hover:bg-slate-50/40 transition-all">
                                      <div className="flex items-center justify-between gap-1 flex-wrap">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-mono text-slate-500 font-semibold">
                                            {new Date(evt.created_at).toLocaleString('pt-BR')}
                                          </span>
                                          <span className="px-1.5 py-0.5 font-bold uppercase tracking-wider rounded text-[7px] bg-slate-100 text-slate-600 border border-slate-200">
                                            {evt.event_type}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <span className={`px-1.5 py-0.5 font-black uppercase text-[7px] rounded border ${
                                            isProcessed ? 'bg-emerald-50 text-emerald-600 border-emerald-250' :
                                            isIgnored ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                            isProcessingError ? 'bg-rose-50 text-rose-600 border-rose-250' :
                                            'bg-blue-50 text-blue-600 border-blue-200'
                                          }`}>
                                            {evt.processing_status === 'processed' ? 'PROCESSADO' :
                                             evt.processing_status === 'ignored' ? 'IGNORADO TÉCNICO' :
                                             evt.processing_status === 'error' ? 'ERRO' : 'RECEBIDO'}
                                          </span>
                                          <span className="font-semibold text-slate-500 bg-slate-100 px-1 py-0.5 rounded text-[7px]">
                                            msgs: {evt.processed_messages || 0}
                                          </span>
                                        </div>
                                      </div>
                                      {evt.error_message && (
                                        <div className={`p-1.5 rounded text-[7px] font-mono break-all whitespace-pre-wrap border ${
                                          isProcessed
                                            ? 'bg-emerald-50/50 border-emerald-100 text-emerald-700'
                                            : isIgnored 
                                              ? 'bg-slate-50 border-slate-200 text-slate-500' 
                                              : 'bg-rose-50/50 border-rose-100 text-rose-700'
                                        }`}>
                                          <strong>{isProcessed ? 'Info:' : isIgnored ? 'Mensagem:' : 'Erro:'}</strong> {evt.error_message}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* MODAL SENSOR QR CODE */}
      {activeQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-2xl max-w-sm w-full p-6 relative overflow-hidden animate-in zoom-in-95 duration-200">
            <button
              type="button"
              onClick={() => {
                setActiveQrModal(false);
                if (pollingRef.current) clearInterval(pollingRef.current);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-navy p-1 rounded-full hover:bg-slate-100 transition-all"
            >
              <X size={16} />
            </button>

            <div className="text-center space-y-4">
              <div>
                <h5 className="font-black text-navy text-sm uppercase tracking-wider">Conectar WhatsApp</h5>
                <p className="text-[10px] text-slate-500 mt-1">Siga as instruções abaixo para vincular seu celular:</p>
              </div>

              {/* QR Image Frame */}
              <div className="bg-slate-50 border border-slate-150 rounded-2xl p-4 flex items-center justify-center min-h-[220px] relative">
                {activeQrCode ? (
                  <div className="flex flex-col items-center gap-3">
                    {activeQrCode.startsWith('data:image/') || (!/\s/.test(activeQrCode) && activeQrCode.length > 50) ? (
                      <img
                        src={activeQrCode.startsWith('data:image/') ? activeQrCode : `data:image/png;base64,${activeQrCode}`}
                        alt="Uazapi QR Code"
                        referrerPolicy="no-referrer"
                        className="w-48 h-48 rounded-lg shadow-sm border border-slate-200 bg-white"
                      />
                    ) : (
                      <div className="p-3 bg-white border border-slate-200 rounded-lg text-center">
                        <p className="text-[10px] font-mono select-all text-slate-700 bg-slate-50 p-2 rounded break-all max-w-[180px]">
                          {activeQrCode}
                        </p>
                        <p className="text-[8px] text-slate-400 mt-1">Código de emparelhamento manual</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-400 gap-2">
                    <Loader2 size={32} className="animate-spin text-blue-500" />
                    <p className="text-[9px] font-black uppercase tracking-wider">Solicitando QR Code...</p>
                  </div>
                )}
                
                {pollingStatus === 'connected' && (
                  <div className="absolute inset-0 bg-emerald-500/90 flex flex-col items-center justify-center text-white p-4 text-center rounded-2xl animate-in fade-in duration-300">
                    <CheckCircle2 size={40} className="text-white animate-bounce mb-2" />
                    <p className="font-bold text-xs uppercase tracking-wider">Conectado com Sucesso!</p>
                  </div>
                )}
              </div>

              {/* Polling Message */}
              <div className="space-y-1 bg-slate-50/50 p-3 rounded-xl border border-slate-150">
                <p className="text-[9px] font-semibold text-slate-600 leading-relaxed">
                  {pollingMsg}
                </p>
              </div>

              <div className="text-left text-[9px] text-slate-500 space-y-1.5 pl-1 leading-normal font-medium">
                <p className="flex items-start gap-1">
                  <span className="font-bold text-blue-600">1.</span> Abra o WhatsApp no seu celular.
                </p>
                <p className="flex items-start gap-1">
                  <span className="font-bold text-blue-600">2.</span> Vá em Configurações &gt; Aparelhos Conectados.
                </p>
                <p className="flex items-start gap-1">
                  <span className="font-bold text-blue-600">3.</span> Toque em Conectar um Aparelho e aponte para o QR Code acima.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveQrModal(false);
                  if (pollingRef.current) clearInterval(pollingRef.current);
                }}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all"
              >
                Fechar Painel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Integration;
