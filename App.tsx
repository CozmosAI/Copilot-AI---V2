
import React, { useState, createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Marketing from './components/Marketing';
import Sales from './components/Sales';
import Agenda from './components/Agenda';
import Automation from './components/Automation';
import Financial from './components/Financial';
import Integration from './components/Integration';
import Profile from './components/Profile';
import LoadingScreen from './components/LoadingScreen';
import { AppSection, DateRange, ConsolidatedMetrics, FinancialEntry, Lead, Appointment, WhatsappConfig } from './types';
import { Menu, X, Bot, Loader2, AlertCircle, ArrowRight, ShieldCheck, CheckCircle2, Lock } from 'lucide-react';
import { supabase } from './lib/supabase';
import { initInstance } from './services/whatsappService';

interface User {
  id: string;
  name: string;
  clinic: string;
  email: string;
  plan: 'free' | 'pro' | 'enterprise';
  ticketValue: number;
}

interface AppContextType {
  user: User | null;
  updateUser: (updates: Partial<User>) => void;
  isAuthenticated: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signUp: (email: string, pass: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  integrations: Record<string, boolean>;
  
  googleCalendarToken: string | null;
  googleAdsToken: string | null;
  googleSheetsToken: string | null;
  whatsappConfig: WhatsappConfig | null;
  
  setGoogleCalendarToken: (token: string | null) => void;
  setGoogleAdsToken: (token: string | null) => void;
  setGoogleSheetsToken: (token: string | null) => void;
  setWhatsappConfig: (config: WhatsappConfig | null) => void;
  toggleIntegration: (id: string) => void;
  
  refreshGoogleCredentials: () => Promise<void>;

  dateFilter: DateRange;
  setDateFilter: (label: string) => void;
  metrics: ConsolidatedMetrics;
  
  financialEntries: FinancialEntry[];
  addFinancialEntry: (entry: FinancialEntry) => Promise<void>;
  updateFinancialEntry: (entry: FinancialEntry) => Promise<void>;
  deleteFinancialEntry: (id: string) => Promise<void>;

  leads: Lead[];
  addLead: (lead: Lead) => Promise<void>;
  updateLead: (lead: Lead) => Promise<void>;
  appointments: Appointment[];
  addAppointment: (apt: Appointment) => Promise<void>;
  updateAppointment: (apt: Appointment) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};

const calculateRange = (label: string): DateRange => {
  const now = new Date();
  const end = now.toISOString().split('T')[0];
  let start = new Date();

  switch (label) {
    case 'Hoje': start = now; break;
    case '7 dias': start.setDate(now.getDate() - 7); break;
    case '30 dias': start.setDate(now.getDate() - 30); break;
    case 'Este Ano': start = new Date(now.getFullYear(), 0, 1); break;
    default: start.setDate(now.getDate() - 30);
  }

  return { start: start.toISOString().split('T')[0], end: end, label: label };
};

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<AppSection>(AppSection.DASHBOARD);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [dateFilter, setInternalDateFilter] = useState<DateRange>(calculateRange('7 dias'));
  
  // Data State
  const [financialEntries, setFinancialEntries] = useState<FinancialEntry[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  
  // Tokens & Configs
  const [googleCalendarToken, setGoogleCalendarToken] = useState<string | null>(null);
  const [googleAdsToken, setGoogleAdsToken] = useState<string | null>(localStorage.getItem('google_ads_token'));
  const [googleSheetsToken, setGoogleSheetsToken] = useState<string | null>(localStorage.getItem('google_sheets_token'));
  const [whatsappConfig, setWhatsappConfigState] = useState<WhatsappConfig | null>(null);

  const setWhatsappConfig = (config: WhatsappConfig | null) => {
    setWhatsappConfigState(config);
    if (config) {
      localStorage.setItem('whatsapp_config', JSON.stringify(config));
    } else {
      localStorage.removeItem('whatsapp_config');
    }
  };

  const [integrations, setIntegrations] = useState<Record<string, boolean>>({
    'google-ads': !!googleAdsToken, 
    'wpp': !!whatsappConfig?.isConnected, 
    'sheets': !!googleSheetsToken, 
    'calendar': !!googleCalendarToken, 
    'crm': false
  });

  useEffect(() => {
    setIntegrations(prev => ({
      ...prev,
      'google-ads': !!googleAdsToken,
      'calendar': !!googleCalendarToken,
      'sheets': !!googleSheetsToken,
      'wpp': !!whatsappConfig?.isConnected
    }));
  }, [googleAdsToken, googleCalendarToken, googleSheetsToken, whatsappConfig]);

  // Data Fetching
  const fetchFinancials = useCallback(async () => {
    if (!supabase || !user) return;
    try {
      const { data } = await supabase.from('transactions').select('*').order('date', { ascending: false });
      if (data) setFinancialEntries(data.map((d: any) => ({ ...d, unitValue: Number(d.unit_value), total: Number(d.total) })));
    } catch (err) { console.error(err); }
  }, [user]);

  const fetchLeads = useCallback(async () => {
    if (!supabase || !user) return;
    try {
      const { data } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
      if (data) setLeads(data.map((d: any) => ({ ...d, potentialValue: Number(d.potential_value), lastMessage: d.last_message, lastInteraction: '1d', email: d.email, procedure: d.procedure, notes: d.notes, source: d.source })));
    } catch (err) { console.error(err); }
  }, [user]);

  const fetchAppointments = useCallback(async () => {
    if (!supabase || !user) return;
    try {
      const { data } = await supabase.from('appointments').select('*').order('date', { ascending: true });
      if (data) setAppointments(data.map((d: any) => ({ ...d, patientName: d.patient_name })));
    } catch (err) { console.error(err); }
  }, [user]);

  const restoreWhatsappConnection = async (userId: string, clinic: string) => {
      try {
          const { data } = await supabase.from('whatsapp_instances').select('*').eq('user_id', userId).maybeSingle();
          if (data && data.status === 'connected') {
              setWhatsappConfigState({ instanceName: data.instance_name, isConnected: true, apiKey: '', baseUrl: '' });
              initInstance(userId, clinic).catch(console.error);
          } else {
              setWhatsappConfigState(null);
          }
      } catch (err) { console.error(err); }
  };

  const refreshGoogleCredentials = async () => {
      if (!user) return;
      const { data } = await supabase.from('profiles').select('google_calendar_token').eq('id', user.id).single();
      if (data?.google_calendar_token) setGoogleCalendarToken(data.google_calendar_token);
  };

  useEffect(() => {
    if (!isAuthenticated || !user || !supabase) return;
    fetchFinancials(); fetchLeads(); fetchAppointments();

    const channel = supabase.channel('main-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => fetchFinancials())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => fetchLeads())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => fetchAppointments())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` }, (payload) => {
         const newProfile = payload.new as any;
         if (newProfile.google_calendar_token && newProfile.google_calendar_token !== googleCalendarToken) {
             setGoogleCalendarToken(newProfile.google_calendar_token);
         }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_instances', filter: `user_id=eq.${user.id}` }, (payload) => {
          const newData = payload.new as any;
          if (newData && newData.status === 'connected') {
              setWhatsappConfigState({ instanceName: newData.instance_name, isConnected: true, apiKey: '', baseUrl: '' });
          } else if (newData && newData.status === 'disconnected') {
              setWhatsappConfigState(null);
          }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isAuthenticated, user, fetchFinancials, fetchLeads, fetchAppointments, googleCalendarToken]);

  useEffect(() => {
    if (!supabase) return;
    const handleSession = async (session: any) => {
       setSession(session);
       setIsAuthenticated(!!session);
       if (session) {
          const userId = session.user.id;
          try {
              const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
              if (profile) {
                setUser({ id: profile.id, name: profile.name || 'Admin', email: session.user.email || '', clinic: profile.clinic_name || 'Clínica', plan: 'pro', ticketValue: Number(profile.ticket_value) || 450 });
                if (profile.google_calendar_token) setGoogleCalendarToken(profile.google_calendar_token);
              } else {
                setUser({ id: userId, name: 'Doutor(a)', email: session.user.email || '', clinic: 'Minha Clínica', plan: 'pro', ticketValue: 450 });
              }
          } catch(err) { console.error(err); }
          await restoreWhatsappConnection(userId, 'Minha Clínica');
          const authIntent = localStorage.getItem('auth_intent');
          if (session.provider_token) {
             if (authIntent === 'google_ads') {
                setGoogleAdsToken(session.provider_token);
                localStorage.setItem('google_ads_token', session.provider_token);
                localStorage.removeItem('auth_intent');
             } else if (authIntent === 'google_calendar') {
                setGoogleCalendarToken(session.provider_token);
                const updates: any = { google_calendar_token: session.provider_token };
                if (session.provider_refresh_token) updates.google_calendar_refresh_token = session.provider_refresh_token;
                await supabase.from('profiles').update(updates).eq('id', userId);
                localStorage.removeItem('auth_intent');
             } else if (authIntent === 'google_sheets') {
                setGoogleSheetsToken(session.provider_token);
                localStorage.setItem('google_sheets_token', session.provider_token);
                localStorage.removeItem('auth_intent');
             }
          }
       } else {
          setUser(null); setFinancialEntries([]); setLeads([]); setAppointments([]); setWhatsappConfig(null); setGoogleCalendarToken(null);
       }
       setAuthLoading(false);
    };
    supabase.auth.getSession().then(({ data: { session } }) => handleSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => { handleSession(session); });
    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, pass: string) => {
    try {
      const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password: pass });
      if (error) throw error;
    } catch (err: any) {
      if (err.message.includes("Invalid login")) throw new Error("E-mail ou senha incorretos.");
      throw err;
    }
  };

  const signUp = async (email: string, pass: string, name: string) => {
    const { data, error } = await supabase!.auth.signUp({ email: email.trim(), password: pass, options: { data: { name } } });
    if (error) throw error;
    if (data.user && !data.session) throw new Error("Conta criada! Verifique seu e-mail.");
  };

  const logout = async () => { 
    try { await supabase!.auth.signOut(); } catch (e) { } 
    finally { localStorage.clear(); setGoogleAdsToken(null); setGoogleCalendarToken(null); setGoogleSheetsToken(null); setWhatsappConfig(null); setUser(null); setIsAuthenticated(false); }
  };

  // CRUD Implementations
  const addFinancialEntry = async (entry: FinancialEntry) => {
    if (!user) return;
    const tempId = crypto.randomUUID();
    const newEntry = { ...entry, id: tempId };
    setFinancialEntries(prev => [newEntry, ...prev]);
    const { error } = await supabase!.from('transactions').insert([{ user_id: user.id, type: entry.type, category: entry.category, name: entry.name, unit_value: entry.unitValue, total: entry.total, status: entry.status, date: entry.date }]);
    if (error) { setFinancialEntries(prev => prev.filter(e => e.id !== tempId)); alert("Erro ao salvar."); }
  };
  const updateFinancialEntry = async (entry: FinancialEntry) => {
    setFinancialEntries(prev => prev.map(e => e.id === entry.id ? entry : e));
    const { error } = await supabase!.from('transactions').update({ type: entry.type, category: entry.category, name: entry.name, unit_value: entry.unitValue, total: entry.total, status: entry.status, date: entry.date }).eq('id', entry.id);
    if (error) fetchFinancials();
  };
  const deleteFinancialEntry = async (id: string) => {
    const backup = [...financialEntries];
    setFinancialEntries(prev => prev.filter(e => e.id !== id));
    const { error } = await supabase!.from('transactions').delete().eq('id', id);
    if (error) setFinancialEntries(backup);
  };
  const addLead = async (lead: Lead) => {
    if (!user) return;
    const tempId = crypto.randomUUID();
    setLeads(prev => [{ ...lead, id: tempId }, ...prev]);
    const { error } = await supabase!.from('leads').insert([{ user_id: user.id, name: lead.name, phone: lead.phone, status: lead.status, temperature: lead.temperature, last_message: lead.lastMessage, potential_value: lead.potentialValue }]);
    if (error) setLeads(prev => prev.filter(l => l.id !== tempId));
  };
  const updateLead = async (lead: Lead) => {
    setLeads(prev => prev.map(l => l.id === lead.id ? lead : l));
    const { error } = await supabase!.from('leads').update({ name: lead.name, phone: lead.phone, status: lead.status, temperature: lead.temperature, last_message: lead.lastMessage, potential_value: lead.potentialValue }).eq('id', lead.id);
    if (error) fetchLeads();
  };
  const addAppointment = async (apt: Appointment) => {
    if (!user) return;
    const tempId = crypto.randomUUID();
    setAppointments(prev => [...prev, { ...apt, id: tempId }]);
    const { error } = await supabase!.from('appointments').insert([{ user_id: user.id, date: apt.date, time: apt.time, patient_name: apt.patientName, status: apt.status, type: apt.type }]);
    if (error) setAppointments(prev => prev.filter(a => a.id !== tempId));
  };
  const updateAppointment = async (apt: Appointment) => {
    setAppointments(prev => prev.map(a => a.id === apt.id ? apt : a));
    const { error } = await supabase!.from('appointments').update({ date: apt.date, time: apt.time, patient_name: apt.patientName, status: apt.status, type: apt.type }).eq('id', apt.id);
    if (error) fetchAppointments();
  };
  const updateUser = async (updates: Partial<User>) => {
    if (!user) return;
    setUser({ ...user, ...updates });
    if (user.id !== 'demo-user' && supabase) await supabase.from('profiles').update({ name: updates.name, clinic_name: updates.clinic, ticket_value: updates.ticketValue }).eq('id', user.id);
  };

  const consolidatedMetrics = useMemo((): ConsolidatedMetrics => {
    const filteredEntries = financialEntries.filter(e => e.date >= dateFilter.start && e.date <= dateFilter.end && e.status === 'efetuada');
    const filteredLeads = leads.filter(l => l.created_at && l.created_at.split('T')[0] >= dateFilter.start && l.created_at.split('T')[0] <= dateFilter.end);
    const filteredAppointments = appointments.filter(a => a.date >= dateFilter.start && a.date <= dateFilter.end);
    const receitaBruta = filteredEntries.filter(e => e.type === 'receivable').reduce((acc, curr) => acc + curr.total, 0);
    const gastosOperacionais = filteredEntries.filter(e => e.type === 'payable' && e.category !== 'Marketing').reduce((acc, curr) => acc + curr.total, 0);
    const finalMarketingSpend = filteredEntries.filter(e => e.type === 'payable' && e.category === 'Marketing').reduce((acc, curr) => acc + curr.total, 0);
    const gastosTotais = gastosOperacionais + finalMarketingSpend;
    const leadsCount = filteredLeads.length || 0;
    const conversas = filteredLeads.filter(l => l.status !== 'Novo').length;
    const vendas = filteredLeads.filter(l => l.status === 'Venda').length;
    const agendamentos = filteredAppointments.length;
    const comparecimento = filteredAppointments.filter(a => a.status === 'Realizado').length;

    return {
      marketing: { investimento: finalMarketingSpend, leads: leadsCount, clicks: leadsCount * 12, impressions: leadsCount * 480, cpl: (leadsCount > 0 && finalMarketingSpend > 0) ? finalMarketingSpend / leadsCount : 0, ctr: leadsCount > 0 ? 2.1 : 0 },
      vendas: { conversas, agendamentos, comparecimento, vendas, taxaConversao: leadsCount > 0 ? (agendamentos / leadsCount) * 100 : 0, cac: agendamentos > 0 ? finalMarketingSpend / agendamentos : 0, cpv: vendas > 0 ? finalMarketingSpend / vendas : 0 },
      financeiro: { receitaBruta, gastosTotais, lucroLiquido: receitaBruta - gastosTotais, roi: gastosTotais > 0 ? ((receitaBruta - gastosTotais) / gastosTotais) * 100 : 0, ticketMedio: vendas > 0 ? receitaBruta / vendas : 0 }
    };
  }, [dateFilter, financialEntries, leads, appointments, user?.ticketValue]);

  const setDateFilter = (label: string) => setInternalDateFilter(calculateRange(label));
  const toggleIntegration = (id: string) => setIntegrations(prev => ({ ...prev, [id]: !prev[id] }));

  // Render Optimized - Removed fade-in wrapper to prevent layout thrashing on every tab switch
  const renderContent = () => {
    switch(activeSection) {
      case AppSection.DASHBOARD: return <Dashboard />;
      case AppSection.MARKETING: return <Marketing />;
      case AppSection.VENDAS: return <Sales />;
      case AppSection.AGENDA: return <Agenda />;
      case AppSection.AUTOMACAO: return <Automation />;
      case AppSection.FINANCEIRO: return <Financial />;
      case AppSection.INTEGRACAO: return <Integration />;
      case AppSection.PERFIL: return <Profile />;
      default: return <Dashboard />;
    }
  };

  if (authLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <AuthScreen onLogin={login} onSignUp={signUp} />;

  return (
    <AppContext.Provider value={{ user, updateUser, isAuthenticated, login, signUp, logout, integrations, googleCalendarToken, setGoogleCalendarToken, googleAdsToken, setGoogleAdsToken, googleSheetsToken, setGoogleSheetsToken, whatsappConfig, setWhatsappConfig, toggleIntegration, refreshGoogleCredentials, dateFilter, setDateFilter, metrics: consolidatedMetrics, financialEntries, addFinancialEntry, updateFinancialEntry, deleteFinancialEntry, leads, addLead, updateLead, appointments, addAppointment, updateAppointment }}>
      <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-[#f1f5f9]">
        <div className="md:hidden flex items-center justify-between p-4 bg-navy text-white z-[60] shadow-md">
          <h1 className="font-bold text-lg tracking-tight">COPILOT AI</h1>
          <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-white/10 rounded-lg">{isSidebarOpen ? <X size={24} /> : <Menu size={24} />}</button>
        </div>
        <div className={`fixed inset-y-0 left-0 z-50 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 md:visible transition-all duration-300 ease-in-out shadow-2xl md:shadow-none`}>
          <Sidebar activeSection={activeSection} onNavigate={(s) => { setActiveSection(s); setSidebarOpen(false); }} />
        </div>
        <main className="flex-1 overflow-y-auto p-4 md:p-8 relative custom-scrollbar fade-enter">
          <div className="max-w-[1600px] mx-auto pb-20">{renderContent()}</div>
        </main>
      </div>
    </AppContext.Provider>
  );
};

// --- NOVA TELA DE LOGIN (SPLIT SCREEN) ---
const AuthScreen = ({ onLogin, onSignUp }: { onLogin: any, onSignUp: any }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(''); setSuccessMsg('');
    try {
      if (isLogin) await onLogin(email, pass);
      else await onSignUp(email, pass, name);
    } catch (err: any) {
      if (err.message && err.message.includes("Conta criada com sucesso")) { setSuccessMsg(err.message); setIsLogin(true); } 
      else setError(err.message || 'Erro ao processar autenticação.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex font-sans bg-white overflow-hidden">
       {/* Left Side - Brand & Institutional */}
       <div className="hidden lg:flex flex-1 bg-[#0f172a] relative flex-col justify-between p-12 text-white overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none"></div>
          
          <div className="relative z-10 flex items-center gap-3">
             <div className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/10">
                <Bot size={24} className="text-blue-400" />
             </div>
             <span className="text-xl font-bold tracking-tight">COPILOT AI</span>
          </div>

          <div className="relative z-10 max-w-lg space-y-6">
             <h1 className="text-5xl font-extrabold leading-tight tracking-tight">
                Transforme dados em <span className="text-blue-400">decisões clínicas</span>.
             </h1>
             <p className="text-lg text-slate-400 leading-relaxed font-light">
                A plataforma completa para gestão, marketing e vendas de clínicas médicas. Centralize sua operação e deixe a IA cuidar do crescimento.
             </p>
             <div className="flex gap-4 pt-4">
                <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/5 backdrop-blur-sm">
                   <CheckCircle2 size={16} className="text-emerald-400" /> <span className="text-sm font-medium">CRM Integrado</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/5 backdrop-blur-sm">
                   <CheckCircle2 size={16} className="text-emerald-400" /> <span className="text-sm font-medium">IA para WhatsApp</span>
                </div>
             </div>
          </div>

          <div className="relative z-10 text-xs text-slate-500 font-medium">
             © 2024 Copilot AI Inc. Todos os direitos reservados.
          </div>
       </div>

       {/* Right Side - Form */}
       <div className="flex-1 flex flex-col justify-center items-center p-8 lg:p-12 bg-white relative">
          <div className="w-full max-w-sm space-y-8 animate-in slide-in-from-bottom-4 duration-500">
             <div className="text-center lg:text-left">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
                   {isLogin ? 'Acesse sua conta' : 'Comece gratuitamente'}
                </h2>
                <p className="text-sm text-slate-500">
                   {isLogin ? 'Bem-vindo de volta ao painel.' : 'Crie sua clínica em menos de 1 minuto.'}
                </p>
             </div>

             {error && (
                <div className="p-4 bg-rose-50 border border-rose-100 text-rose-600 text-xs rounded-lg font-medium flex items-center gap-2">
                   <AlertCircle size={16} /> {error}
                </div>
             )}
             
             {successMsg && (
                <div className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-600 text-xs rounded-lg font-medium flex items-center gap-2">
                   <ShieldCheck size={16} /> {successMsg}
                </div>
             )}

             <form onSubmit={handleSubmit} className="space-y-5">
                {!isLogin && (
                   <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700">Nome da Clínica</label>
                      <input 
                         type="text" 
                         value={name} 
                         onChange={e => setName(e.target.value)} 
                         required 
                         className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#0f172a] focus:border-[#0f172a] outline-none transition-all text-sm"
                         placeholder="Ex: Clínica Cozmos"
                      />
                   </div>
                )}
                
                <div className="space-y-1.5">
                   <label className="text-xs font-semibold text-slate-700">E-mail Profissional</label>
                   <input 
                      type="email" 
                      value={email} 
                      onChange={e => setEmail(e.target.value)} 
                      required 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#0f172a] focus:border-[#0f172a] outline-none transition-all text-sm"
                      placeholder="doutor@clinica.com"
                   />
                </div>

                <div className="space-y-1.5">
                   <div className="flex justify-between items-center">
                      <label className="text-xs font-semibold text-slate-700">Senha</label>
                      {isLogin && <a href="#" className="text-xs text-blue-600 hover:underline">Esqueceu?</a>}
                   </div>
                   <input 
                      type="password" 
                      value={pass} 
                      onChange={e => setPass(e.target.value)} 
                      required 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#0f172a] focus:border-[#0f172a] outline-none transition-all text-sm"
                      placeholder="••••••••"
                   />
                </div>

                <button 
                   type="submit" 
                   disabled={loading} 
                   className="w-full bg-[#0f172a] text-white py-3 rounded-lg font-semibold text-sm shadow-lg shadow-slate-900/10 hover:bg-slate-800 transition-all flex items-center justify-center gap-2 disabled:opacity-70 mt-2"
                >
                   {loading ? <Loader2 className="animate-spin" size={18}/> : (isLogin ? 'Entrar' : 'Criar Conta')}
                   {!loading && <ArrowRight size={16} />}
                </button>
             </form>

             <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                <div className="relative flex justify-center text-xs"><span className="px-2 bg-white text-slate-400">ou</span></div>
             </div>

             <div className="text-center">
                <button 
                   onClick={() => { setIsLogin(!isLogin); setError(''); setSuccessMsg(''); }} 
                   className="text-sm font-medium text-slate-600 hover:text-[#0f172a] transition-colors"
                >
                   {isLogin ? 'Não tem uma conta? ' : 'Já possui conta? '}
                   <span className="font-bold underline decoration-2 decoration-blue-500/30 hover:decoration-blue-500">{isLogin ? 'Criar agora' : 'Fazer login'}</span>
                </button>
             </div>
          </div>
          
          <div className="absolute bottom-8 flex items-center gap-2 text-[10px] text-slate-400">
             <Lock size={12} /> Seus dados estão protegidos com criptografia de ponta a ponta.
          </div>
       </div>
    </div>
  );
};

export default App;
