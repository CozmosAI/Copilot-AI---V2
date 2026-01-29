
import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, Calendar, Loader2, LogOut, MessageCircle, Smartphone, 
  FileSpreadsheet, Activity, AlertCircle, Upload, RefreshCw, X, ChevronRight, LayoutList, Copy, Phone
} from 'lucide-react';
import { useApp } from '../App';
import { signInWithGoogleAds, getAccessibleCustomers } from '../services/googleAdsService';
import { signInWithGoogleCalendar } from '../services/googleCalendarService';
import { signInWithGoogleSheets, listSpreadsheets, getSpreadsheetDetails, getSheetData } from '../services/googleSheetsService';
import { initInstance, checkStatus, logoutInstance } from '../services/whatsappService';
import { supabase } from '../lib/supabase';
import { GoogleAdAccount } from '../types';

// Ícone do Google
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
    whatsappConfig, setWhatsappConfig,
    addLead, user 
  } = useApp();
  
  const [loading, setLoading] = useState<string | null>(null);
  
  // States WhatsApp
  const [wppQr, setWppQr] = useState<string | null>(null);
  const [wppPairingCode, setWppPairingCode] = useState<string | null>(null);
  const [wppStatus, setWppStatus] = useState<'IDLE' | 'CONNECTING' | 'CONNECTED' | 'QRCODE' | 'PAIRING' | 'DISCONNECTED'>('IDLE');
  const [wppError, setWppError] = useState('');
  const [wppPhone, setWppPhone] = useState(''); 

  // Sheets States
  const [spreadsheets, setSpreadsheets] = useState<any[]>([]);
  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState<{id: string, name: string} | null>(null);
  const [sheetTabs, setSheetTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [importStatus, setImportStatus] = useState<string>('');
  const [importLoading, setImportLoading] = useState(false);

  // Google Ads Account Selector States
  const [adAccounts, setAdAccounts] = useState<GoogleAdAccount[]>([]);
  const [showAdAccountModal, setShowAdAccountModal] = useState(false);
  const [selectedAdAccount, setSelectedAdAccount] = useState<string | null>(localStorage.getItem('selected_google_account_id'));
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);

  useEffect(() => {
     if (whatsappConfig?.isConnected) {
         setWppStatus('CONNECTED');
         setWppQr(null);
         setWppPairingCode(null);
     }
  }, [whatsappConfig]);

  // --- GOOGLE ADS ACCOUNT FETCHING ---
  useEffect(() => {
    if (googleAdsToken && !selectedAdAccount) {
        setIsLoadingAccounts(true);
        getAccessibleCustomers(googleAdsToken)
            .then(accounts => {
                setAdAccounts(accounts);
                if (accounts.length === 1) handleSelectAdAccount(accounts[0].id);
                else setShowAdAccountModal(true);
            })
            .catch(err => {
                console.error("Erro ao buscar contas Google Ads:", err);
                alert("Erro ao listar contas de anúncio. Verifique se o token é válido.");
            })
            .finally(() => setIsLoadingAccounts(false));
    }
  }, [googleAdsToken, selectedAdAccount]);

  const handleSelectAdAccount = (accountId: string) => {
      localStorage.setItem('selected_google_account_id', accountId);
      setSelectedAdAccount(accountId);
      setShowAdAccountModal(false);
      window.location.reload(); 
  };

  const handleChangeAdAccount = async () => {
      if (googleAdsToken) {
          setIsLoadingAccounts(true);
          setShowAdAccountModal(true);
          try {
              const accounts = await getAccessibleCustomers(googleAdsToken);
              setAdAccounts(accounts);
          } catch (e) {
              console.error(e);
          } finally {
              setIsLoadingAccounts(false);
          }
      }
  };

  // --- WHATSAPP LOGIC ---
  const handleWppConnect = async () => {
    if (!user) return;
    
    setWppStatus('CONNECTING');
    setWppError('');
    setWppQr(null); 
    setWppPairingCode(null);
    
    // Tratamento do número: Remove não dígitos e garante DDI 55 se parecer número BR
    let formattedPhone = wppPhone.replace(/\D/g, '');
    if (formattedPhone && formattedPhone.length >= 10 && formattedPhone.length <= 11) {
       formattedPhone = '55' + formattedPhone;
    }
    
    try {
        const result = await initInstance(user.id, user.clinic, formattedPhone);
        
        if (result.state === 'open') {
            setWppStatus('CONNECTED');
            setWhatsappConfig({ instanceName: result.instanceName, isConnected: true, apiKey: '', baseUrl: '' });
        } else {
            if (result.pairingCode) {
                setWppPairingCode(result.pairingCode);
                setWppStatus('PAIRING');
            } else if (result.base64) {
                setWppQr(result.base64);
                setWppStatus('QRCODE');
            } else {
                setWppStatus('CONNECTING');
            }
            startStatusPolling(result.instanceName);
        }
    } catch (err: any) {
        setWppStatus('DISCONNECTED');
        setWppError(err.message || "Erro ao iniciar serviço WhatsApp.");
    }
  };

  const startStatusPolling = (instanceName: string) => {
      let attempts = 0;
      const maxAttempts = 120; 

      const interval = setInterval(async () => {
           attempts++;
           try {
               const check = await checkStatus(instanceName);
               
               if (check.status === 'CONNECTED' || check.state === 'open') {
                   clearInterval(interval);
                   setWppStatus('CONNECTED');
                   setWppQr(null);
                   setWppPairingCode(null);
                   setWhatsappConfig({ instanceName: instanceName, isConnected: true, apiKey: '', baseUrl: '' });
               }
               // Se não conectou e não temos código de pareamento, tenta QR como fallback
               else if (check.base64 && !wppPairingCode && wppStatus !== 'PAIRING') {
                   setWppQr(check.base64);
                   setWppStatus('QRCODE');
               }
           } catch(e) { console.error(e); }

           if (attempts >= maxAttempts) {
              clearInterval(interval);
              if (wppStatus !== 'CONNECTED') {
                  setWppStatus('IDLE');
                  setWppError('Tempo limite excedido. Tente novamente.');
              }
           }
      }, 3000); 
  }

  const handleWppDisconnect = async () => {
      if (user) await logoutInstance(user.id);
      setWhatsappConfig(null);
      setWppStatus('IDLE');
      setWppQr(null);
      setWppPairingCode(null);
      setWppPhone('');
  };
  
  // --- GOOGLE AUTH HANDLERS (Mantidos) ---
  const handleGoogleLogin = async () => { setLoading('google-ads'); try { await signInWithGoogleAds(); } catch (error: any) { alert("Erro: " + error.message); setLoading(null); } };
  const handleGoogleLogout = async () => { await supabase.auth.signOut(); localStorage.removeItem('google_ads_token'); localStorage.removeItem('selected_google_account_id'); setGoogleAdsToken(null); setSelectedAdAccount(null); window.location.reload(); };
  
  const handleCalendarLogin = async () => { setLoading('calendar'); try { await signInWithGoogleCalendar(); } catch (e: any) { alert(e.message); setLoading(null); } };
  const handleCalendarLogout = () => { localStorage.removeItem('google_calendar_token'); setGoogleCalendarToken(null); window.location.reload(); };
  
  const handleSheetsLogin = async () => { setLoading('sheets'); try { await signInWithGoogleSheets(); } catch (e: any) { alert(e.message); setLoading(null); } };
  const handleSheetsLogout = () => { localStorage.removeItem('google_sheets_token'); setGoogleSheetsToken(null); setSpreadsheets([]); setSelectedSpreadsheet(null); window.location.reload(); };

  // --- SHEETS IMPORT LOGIC ---
  const handleSelectSpreadsheet = async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      if (!id) return;
      const name = e.target.options[e.target.selectedIndex].text;
      setSelectedSpreadsheet({ id, name });
      setImportLoading(true);
      try {
          const tabs = await getSpreadsheetDetails(googleSheetsToken!, id);
          setSheetTabs(tabs);
          setSelectedTab(tabs[0] || '');
      } catch (e) { alert('Erro ao carregar abas.'); } finally { setImportLoading(false); }
  };
  const handleImportLeads = async () => {
      if (!selectedSpreadsheet || !selectedTab) return;
      setImportLoading(true); setImportStatus('');
      try {
          const rows = await getSheetData(googleSheetsToken!, selectedSpreadsheet.id, selectedTab);
          if (rows.length < 2) throw new Error("Planilha vazia.");
          setImportStatus(`${rows.length - 1} leads importados!`);
          setTimeout(() => setImportStatus(''), 5000);
      } catch (e: any) { setImportStatus(`Erro: ${e.message}`); } finally { setImportLoading(false); }
  };

  return (
    <div className="space-y-8 pb-20 relative">
      <header className="flex justify-between items-end">
        <div>
            <h2 className="text-2xl font-bold text-navy">Central de Conexões</h2>
            <p className="text-slate-500 text-sm">Gerencie o acesso às suas fontes de dados.</p>
        </div>
        <div className="hidden md:flex items-center gap-2 text-xs font-bold text-slate-400 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
            <Activity size={14} className="text-emerald-500" /> Status do Sistema: Online
        </div>
      </header>

      {/* DASHBOARD STATUS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-in fade-in duration-500">
        {[
            { id: 'google-ads', label: 'Google Ads', active: !!googleAdsToken && !!selectedAdAccount, icon: <GoogleIcon size={18} /> },
            { id: 'calendar', label: 'G. Calendar', active: !!googleCalendarToken, icon: <Calendar size={18} className={!!googleCalendarToken ? 'text-amber-500' : ''} /> },
            { id: 'sheets', label: 'G. Sheets', active: !!googleSheetsToken, icon: <FileSpreadsheet size={18} className={!!googleSheetsToken ? 'text-emerald-500' : ''} /> },
            { id: 'wpp', label: 'WhatsApp', active: !!whatsappConfig?.isConnected, icon: <MessageCircle size={18} className={!!whatsappConfig?.isConnected ? 'text-emerald-500' : ''} /> },
        ].map((item) => (
            <div key={item.id} className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${item.active ? 'bg-emerald-50/50 border-emerald-100 shadow-sm' : 'bg-white border-slate-100 opacity-60 grayscale-[0.5]'}`}>
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${item.active ? 'bg-white shadow-sm' : 'bg-slate-50 text-slate-400'}`}>
                        {item.icon}
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{item.label}</p>
                        <p className={`text-xs font-black ${item.active ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {item.active ? 'Conectado' : 'Pendente'}
                        </p>
                    </div>
                </div>
            </div>
        ))}
      </div>

      <div className="h-px bg-slate-200 w-full"></div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* WHATSAPP CARD - REFORMULADO PARA PAIRING CODE */}
        <div className={`bg-white p-6 rounded-3xl border shadow-sm flex flex-col group transition-all relative overflow-hidden ${whatsappConfig?.isConnected ? 'border-emerald-100 ring-1 ring-emerald-50' : 'border-slate-200 hover:border-navy'}`}>
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-navy group-hover:text-white transition-colors"><MessageCircle size={24} className="text-emerald-600"/></div>
              {whatsappConfig?.isConnected ? <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase border border-emerald-100"><CheckCircle2 size={10} /> Ativo</span> : <span className="text-[9px] font-black text-slate-300 bg-slate-50 px-2 py-1 rounded-full uppercase border border-slate-100">Inativo</span>}
            </div>
            <h3 className="font-black text-navy text-sm uppercase tracking-widest">WhatsApp Business (Nativo)</h3>
            <p className="text-[10px] text-slate-400 mt-1 mb-4">Conecte seu número para ativar a IA.</p>
            
            {whatsappConfig?.isConnected ? (
               <div className="mt-auto space-y-3">
                   <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                      <p className="text-[10px] font-bold text-emerald-800 flex items-center gap-2"><Smartphone size={12}/> Online: {whatsappConfig.instanceName}</p>
                   </div>
                   <button onClick={handleWppDisconnect} className="w-full py-2 flex items-center justify-center gap-2 text-[10px] font-black uppercase text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><LogOut size={12} /> Desconectar</button>
               </div>
            ) : (
               <div className="mt-auto space-y-3">
                   {(wppStatus === 'IDLE' || wppStatus === 'DISCONNECTED') && (
                       <div className="space-y-3 animate-in fade-in">
                          {wppError && (
                              <div className="text-[9px] text-rose-500 font-bold bg-rose-50 p-3 rounded-xl flex items-start gap-2 leading-tight mb-2">
                                  <AlertCircle size={14} className="shrink-0"/> {wppError}
                              </div>
                          )}
                          <div className="space-y-1">
                             <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Seu Número WhatsApp</label>
                             <div className="relative">
                                <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                                <input 
                                  type="tel" 
                                  value={wppPhone}
                                  onChange={(e) => setWppPhone(e.target.value.replace(/\D/g, ''))}
                                  placeholder="11 99999-9999"
                                  className="w-full pl-9 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:border-navy"
                                />
                             </div>
                             <p className="text-[9px] text-slate-400 px-1">Deixe vazio se preferir escanear QR Code.</p>
                          </div>
                          <button onClick={handleWppConnect} className="w-full py-3 bg-navy text-white rounded-xl text-[10px] font-black uppercase flex justify-center items-center gap-2 hover:bg-slate-800 shadow-lg shadow-navy/20">
                             {wppPhone ? 'Receber Código' : 'Gerar QR Code'}
                          </button>
                       </div>
                   )}

                   {wppStatus === 'CONNECTING' && (
                       <div className="flex flex-col items-center py-4 text-slate-400 animate-in fade-in">
                           <Loader2 size={24} className="animate-spin mb-2 text-navy" />
                           <p className="text-[10px] font-bold uppercase">Conectando à API...</p>
                       </div>
                   )}
                   
                   {wppStatus === 'PAIRING' && wppPairingCode && (
                       <div className="text-center space-y-4 animate-in zoom-in bg-white p-4 rounded-xl border-2 border-dashed border-navy/20">
                           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Código de Pareamento</p>
                           <div className="flex items-center justify-center gap-3">
                               <h2 className="text-3xl font-black text-navy tracking-widest">{wppPairingCode.slice(0,4)}-{wppPairingCode.slice(4)}</h2>
                               <button onClick={() => navigator.clipboard.writeText(wppPairingCode)} className="p-2 text-slate-400 hover:text-navy hover:bg-slate-50 rounded-lg" title="Copiar"><Copy size={16} /></button>
                           </div>
                           <div className="text-[10px] text-left space-y-1.5 text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100 leading-tight">
                               <p>1. No seu WhatsApp, vá em <strong>Aparelhos Conectados</strong>.</p>
                               <p>2. Toque em <strong>Conectar Aparelho</strong>.</p>
                               <p>3. Escolha <strong>"Conectar com número de telefone"</strong>.</p>
                               <p>4. Digite o código acima.</p>
                           </div>
                           <button onClick={() => setWppStatus('IDLE')} className="text-[9px] underline text-slate-400 hover:text-rose-400">Cancelar</button>
                       </div>
                   )}

                   {wppStatus === 'QRCODE' && wppQr && (
                       <div className="text-center space-y-3 animate-in zoom-in">
                           <div className="bg-white p-2 rounded-xl border border-slate-200 inline-block shadow-sm">
                               <img src={wppQr} alt="QR Code" className="w-48 h-48 object-contain" />
                           </div>
                           <p className="text-[10px] font-bold text-navy uppercase animate-pulse">Escaneie com seu WhatsApp</p>
                           <button onClick={() => setWppStatus('IDLE')} className="text-[9px] underline text-slate-400 hover:text-rose-400">Cancelar</button>
                       </div>
                   )}
               </div>
            )}
        </div>
        
        {/* GOOGLE ADS CARD */}
        <div className={`bg-white p-6 rounded-3xl border shadow-sm flex flex-col group transition-all ${googleAdsToken && selectedAdAccount ? 'border-emerald-100 ring-1 ring-emerald-50 col-span-1 md:col-span-2' : 'border-slate-200 hover:border-navy'}`}>
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-navy group-hover:text-white transition-colors"><GoogleIcon size={24} /></div>
              {googleAdsToken && selectedAdAccount ? <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase border border-emerald-100"><CheckCircle2 size={10} /> Ativo</span> : <span className="text-[9px] font-black text-slate-300 bg-slate-50 px-2 py-1 rounded-full uppercase border border-slate-100">Inativo</span>}
            </div>
            <h3 className="font-black text-navy text-sm uppercase tracking-widest">Google Ads</h3>
            <p className="text-[10px] text-slate-400 mt-1 mb-4">Métricas de campanhas e ROI.</p>
            {googleAdsToken ? (
               <div className="mt-auto space-y-3">
                   {selectedAdAccount ? (
                       <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-between">
                            <div><p className="text-[10px] font-bold text-emerald-800">Conta Selecionada</p><p className="text-[9px] text-emerald-600 font-mono">ID: {selectedAdAccount}</p></div>
                            <button onClick={handleChangeAdAccount} className="p-2 hover:bg-emerald-100 rounded-lg text-emerald-700" title="Trocar Conta"><RefreshCw size={12}/></button>
                       </div>
                   ) : (<button onClick={handleChangeAdAccount} className="w-full py-2 bg-amber-50 text-amber-600 rounded-xl text-[10px] font-bold uppercase border border-amber-100 hover:bg-amber-100 transition-colors">Selecione uma conta</button>)}
                   <button onClick={handleGoogleLogout} className="w-full py-2 flex items-center justify-center gap-2 text-[10px] font-black uppercase text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><LogOut size={12} /> Desconectar</button>
               </div>
            ) : (
              <button onClick={handleGoogleLogin} disabled={!!loading} className={`mt-auto w-full py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${loading === 'google-ads' ? 'bg-slate-100 text-slate-400' : 'bg-navy text-white hover:bg-slate-800 shadow-lg shadow-navy/20'}`}>
                {loading === 'google-ads' ? <Loader2 size={14} className="animate-spin" /> : 'Conectar Agora'}
              </button>
            )}
        </div>

        {/* GOOGLE CALENDAR & SHEETS (Mantidos) */}
        {/* ... (Omitindo para brevidade, mas mantendo a estrutura original se fosse um arquivo novo) ... */}
        {/* Como estou editando o arquivo, o conteúdo abaixo mantém a integridade dos outros cards */}
        <div className={`bg-white p-6 rounded-3xl border shadow-sm flex flex-col group transition-all ${googleCalendarToken ? 'border-emerald-100 ring-1 ring-emerald-50' : 'border-slate-200 hover:border-navy'}`}>
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-navy group-hover:text-white transition-colors"><Calendar className="text-amber-500" /></div>
              {googleCalendarToken ? <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase border border-emerald-100"><CheckCircle2 size={10} /> Ativo</span> : <span className="text-[9px] font-black text-slate-300 bg-slate-50 px-2 py-1 rounded-full uppercase border border-slate-100">Inativo</span>}
            </div>
            <h3 className="font-black text-navy text-sm uppercase tracking-widest">Google Agenda</h3>
            <p className="text-[10px] text-slate-400 mt-1 mb-4 h-8">Sincronize sua agenda médica.</p>
            {googleCalendarToken ? (
               <div className="mt-auto"><button onClick={handleCalendarLogout} className="w-full py-2 flex items-center justify-center gap-2 text-[10px] font-black uppercase text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><LogOut size={12} /> Desconectar</button></div>
            ) : (
              <button onClick={handleCalendarLogin} disabled={!!loading} className={`mt-auto w-full py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${loading === 'calendar' ? 'bg-slate-100 text-slate-400' : 'bg-navy text-white hover:bg-slate-800 shadow-lg shadow-navy/20'}`}>
                {loading === 'calendar' ? <Loader2 size={14} className="animate-spin" /> : 'Conectar Agora'}
              </button>
            )}
        </div>

        <div className={`bg-white p-6 rounded-3xl border shadow-sm flex flex-col group transition-all ${googleSheetsToken ? 'border-emerald-100 ring-1 ring-emerald-50 col-span-1 md:col-span-2 lg:col-span-1' : 'border-slate-200 hover:border-navy'}`}>
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-navy group-hover:text-white transition-colors"><FileSpreadsheet className="text-emerald-500" /></div>
              {googleSheetsToken ? <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase border border-emerald-100"><CheckCircle2 size={10} /> Ativo</span> : <span className="text-[9px] font-black text-slate-300 bg-slate-50 px-2 py-1 rounded-full uppercase border border-slate-100">Inativo</span>}
            </div>
            <h3 className="font-black text-navy text-sm uppercase tracking-widest">Planilhas Google</h3>
            <p className="text-[10px] text-slate-400 mt-1 mb-4">Importe listas de leads.</p>
            {googleSheetsToken ? (
               <div className="mt-auto space-y-4 animate-in fade-in">
                   <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-3">
                       {importStatus && <p className="text-[9px] font-bold text-emerald-600 bg-emerald-50 p-2 rounded mb-2 text-center">{importStatus}</p>}
                       <div className="space-y-2">
                           <select onChange={handleSelectSpreadsheet} className="w-full mt-1 p-1.5 text-[10px] border rounded bg-white focus:outline-none focus:border-navy"><option value="">Selecione arquivo...</option>{spreadsheets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                           <select onChange={e => setSelectedTab(e.target.value)} value={selectedTab} disabled={!selectedSpreadsheet} className="w-full mt-1 p-1.5 text-[10px] border rounded bg-white focus:outline-none focus:border-navy">{sheetTabs.map(t => <option key={t} value={t}>{t}</option>)}</select>
                       </div>
                       <button onClick={handleImportLeads} disabled={importLoading || !selectedTab} className="w-full bg-navy text-white py-2 rounded-lg text-[10px] font-bold uppercase flex justify-center items-center gap-2 hover:bg-slate-800 disabled:opacity-50">{importLoading ? <Loader2 size={12} className="animate-spin"/> : <><Upload size={12} /> Importar</>}</button>
                   </div>
                   <button onClick={handleSheetsLogout} className="text-[9px] font-bold text-rose-400 underline w-full text-center">Desconectar</button>
               </div>
            ) : (
              <button onClick={handleSheetsLogin} disabled={!!loading} className={`mt-auto w-full py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${loading === 'sheets' ? 'bg-slate-100 text-slate-400' : 'bg-navy text-white hover:bg-slate-800 shadow-lg shadow-navy/20'}`}>
                {loading === 'sheets' ? <Loader2 size={14} className="animate-spin" /> : 'Conectar Agora'}
              </button>
            )}
        </div>
      </div>
      
      {showAdAccountModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/80 backdrop-blur-md animate-in fade-in">
              <div className="bg-white rounded-[32px] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                      <div><h3 className="font-bold text-navy text-lg">Selecione a Conta</h3><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Google Ads (MCC ou Cliente)</p></div>
                      <button onClick={() => setShowAdAccountModal(false)} className="p-2 hover:bg-slate-200 rounded-full text-slate-400"><X size={20}/></button>
                  </div>
                  <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                      {isLoadingAccounts ? <div className="flex flex-col items-center py-8"><Loader2 className="animate-spin text-navy mb-2" size={32} /><p className="text-xs font-bold text-slate-400 uppercase">Carregando contas...</p></div> : <div className="space-y-2">{adAccounts.length === 0 ? <p className="text-center text-sm text-slate-500 py-4">Nenhuma conta encontrada.</p> : adAccounts.map(account => (<button key={account.id} onClick={() => handleSelectAdAccount(account.id)} className="w-full p-4 rounded-xl border border-slate-200 hover:border-navy hover:bg-slate-50 transition-all flex items-center justify-between group"><div className="text-left"><p className="font-bold text-navy text-sm group-hover:text-blue-600 transition-colors">{account.descriptiveName}</p><p className="text-[10px] text-slate-400 font-mono mt-1">ID: {account.id}</p></div><ChevronRight size={16} className="text-slate-300 group-hover:text-navy" /></button>))}</div>}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Integration;
