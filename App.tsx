
import React, { useState, createContext, useContext, useEffect, useMemo, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Marketing from './components/Marketing';
import Sales from './components/Sales';
import Agenda from './components/Agenda';
import Automation from './components/Automation';
import Financial from './components/Financial';
import Integration from './components/Integration';
import Profile from './components/Profile';
import Recorder from './components/Recorder';
import AxisModule from './components/AxisModule'; // Importado
import { ErrorBoundary } from './components/ErrorBoundary';
import LoadingScreen from './components/LoadingScreen';
import { AppSection, DateRange, ConsolidatedMetrics, FinancialEntry, Lead, Appointment, TeamMember, UserRole, AIConfig, ConsultationRecording } from './types';
import { Menu, X, Bot, Loader2, AlertCircle, ArrowRight, ShieldCheck, CheckCircle2, Lock, Eye, EyeOff } from 'lucide-react';
import { supabase } from './lib/supabase';
// import { checkStatus, configureInstance } from './services/whatsappService'; // REMOVIDO

// Logo AXIS para tela de login
const AxisLogo = ({ size = 32, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M12 2L2 21H7L12 11L17 21H22L12 2Z" />
  </svg>
);

interface User {
  id: string;
  name: string;
  clinic: string;
  email: string;
  plan: 'free' | 'pro' | 'enterprise';
  ticketValue: number;
  
  // Novos campos detalhados
  phone?: string;
  specialty?: string;
  procedures?: string;
  city?: string;
  role?: UserRole;
  avatar_url?: string;
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
  metaAdsStatus: string | null;
  
  setGoogleCalendarToken: (token: string | null) => void;
  setGoogleAdsToken: (token: string | null) => void;
  setGoogleSheetsToken: (token: string | null) => void;
  setMetaAdsStatus: (status: string | null) => void;
  // whatsappConfig: WhatsappConfig | null; // REMOVIDO
  toggleIntegration: (id: string) => void;
  
  refreshGoogleCredentials: () => Promise<void>;

  adsData: {
    googleAccount: { customer_id: string; customer_name: string; status: string; last_sync_at: string } | null;
    metaAccount: { ad_account_id: string; ad_account_name: string; status: string; last_sync_at: string; currency: string } | null;
    dashboard: {
      googleOverview: any[] | null;
      metaOverview: any[] | null;
      isLoading: boolean;
      lastFetch: number;
    };
    marketing: {
      googleOverview: any[] | null;
      metaOverview: any[] | null;
      isLoading: boolean;
      lastFetch: number;
    };
    isPreloadingAds: boolean;
  };
  preloadAdsData: (section?: 'dashboard' | 'marketing' | 'all', forceRefresh?: boolean, explicitUserId?: string) => Promise<void>;

  dashboardDateFilter: DateRange;
  setDashboardDateFilterByLabel: (label: string) => void;
  setDashboardCustomDateRange: (start: string, end: string) => void;
  marketingDateFilter: DateRange;
  setMarketingDateFilterByLabel: (label: string) => void;
  setMarketingCustomDateRange: (start: string, end: string) => void;
  metrics: ConsolidatedMetrics;
  
  financialEntries: FinancialEntry[];
  addFinancialEntry: (entry: FinancialEntry) => Promise<boolean>;
  updateFinancialEntry: (entry: FinancialEntry) => Promise<boolean>;
  deleteFinancialEntry: (id: string) => Promise<boolean>;

  leads: Lead[];
  addLead: (lead: Lead) => Promise<void>;
  updateLead: (lead: Lead) => Promise<void>;
  appointments: Appointment[];
  addAppointment: (apt: Appointment) => Promise<void>;
  updateAppointment: (apt: Appointment) => Promise<void>;

  // Team Management
  teamMembers: TeamMember[];
  addTeamMember: (member: Omit<TeamMember, 'id' | 'addedAt' | 'status'>) => void;
  removeTeamMember: (id: string) => void;

  // AI Configuration
  aiConfig: AIConfig;
  updateAiConfig: (config: Partial<AIConfig>) => Promise<void>;

  // Recorder (SOAP)
  recordings: ConsultationRecording[];
  addRecording: (recording: ConsultationRecording) => void;
  updateRecording: (recording: ConsultationRecording) => void;
  deleteRecording: (id: string) => void;

  // Navigation
  navigateToSection: (section: AppSection) => void;
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

const calcularScore = (lead: Lead): { score: number; reasons: { action: string; points: number; reason: string }[] } => {
  let score = 50; // base
  const reasons: { action: string; points: number; reason: string }[] = [];
  
  // 1. RECENCY — dias desde última interação
  const lastInteraction = lead.lastInteraction;
  if (lastInteraction) {
    const diasSemInteracao = Math.floor((Date.now() - new Date(lastInteraction).getTime()) / (1000 * 60 * 60 * 24));
    if (diasSemInteracao < 1) {
      score += 20;
      reasons.push({ action: 'recency', points: 20, reason: `Interagiu hoje (${diasSemInteracao} dia)` });
    } else if (diasSemInteracao < 7) {
      score += 10;
      reasons.push({ action: 'recency', points: 10, reason: `Interagiu esta semana (${diasSemInteracao} dias)` });
    } else if (diasSemInteracao > 30) {
      score -= 20;
      reasons.push({ action: 'recency', points: -20, reason: `Sumiu há ${diasSemInteracao} dias` });
    } else if (diasSemInteracao > 14) {
      score -= 10;
      reasons.push({ action: 'recency', points: -10, reason: `Sem interação há ${diasSemInteracao} dias` });
    }
  } else {
    score -= 20;
    reasons.push({ action: 'recency', points: -20, reason: 'Nunca interagiu' });
  }
  
  // 2. TEMPERATURE
  if (lead.temperature === 'Hot') {
    score += 15;
    reasons.push({ action: 'temperature', points: 15, reason: 'Lead quente' });
  } else if (lead.temperature === 'Warm') {
    score += 5;
    reasons.push({ action: 'temperature', points: 5, reason: 'Lead morno' });
  } else if (lead.temperature === 'Cold') {
    score -= 5;
    reasons.push({ action: 'temperature', points: -5, reason: 'Lead frio' });
  }
  
  // 3. POTENTIAL VALUE
  const valor = Number(lead.potentialValue || 0);
  if (valor >= 1000) {
    score += 15;
    reasons.push({ action: 'value', points: 15, reason: `Alto valor (R$ ${valor})` });
  } else if (valor >= 500) {
    score += 10;
    reasons.push({ action: 'value', points: 10, reason: `Valor médio (R$ ${valor})` });
  } else if (valor >= 100) {
    score += 5;
    reasons.push({ action: 'value', points: 5, reason: `Baixo valor (R$ ${valor})` });
  }
  
  // 4. DADOS COMPLETOS
  if (lead.email) {
    score += 5;
    reasons.push({ action: 'data', points: 5, reason: 'Tem email' });
  }
  if (lead.objective) {
    score += 5;
    reasons.push({ action: 'data', points: 5, reason: 'Tem objetivo definido' });
  }
  
  return { score: Math.max(0, Math.min(100, score)), reasons };
};

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<AppSection>(AppSection.DASHBOARD);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [dashboardDateFilter, setDashboardDateFilter] = useState<DateRange>(calculateRange('7 dias'));
  const [marketingDateFilter, setMarketingDateFilter] = useState<DateRange>(calculateRange('7 dias'));
  
  // Pending Accounts state
  const [pendingMetaAccounts, setPendingMetaAccounts] = useState<any[]>(() => JSON.parse(localStorage.getItem('pending_meta_accounts') || '[]'));
  const [pendingGoogleAccounts, setPendingGoogleAccounts] = useState<any[]>(() => JSON.parse(localStorage.getItem('pending_google_accounts') || '[]'));
  const [showPendingMetaModal, setShowPendingMetaModal] = useState<boolean>(() => localStorage.getItem('show_meta_modal') === 'true');
  const [showPendingGoogleModal, setShowPendingGoogleModal] = useState<boolean>(() => localStorage.getItem('show_google_modal') === 'true');
  const [pendingOAuth, setPendingOAuth] = useState<{provider: string, code: string, state: string, errorParam: string} | null>(null);

  // Listen for updates from Integration.tsx
  useEffect(() => {
      const handleStorageChange = () => {
          setPendingMetaAccounts(JSON.parse(localStorage.getItem('pending_meta_accounts') || '[]'));
          setPendingGoogleAccounts(JSON.parse(localStorage.getItem('pending_google_accounts') || '[]'));
          setShowPendingMetaModal(localStorage.getItem('show_meta_modal') === 'true');
          setShowPendingGoogleModal(localStorage.getItem('show_google_modal') === 'true');
      };
      window.addEventListener('pending-accounts-updated', handleStorageChange);
      return () => window.removeEventListener('pending-accounts-updated', handleStorageChange);
  }, []);

  // OAuth Callback Detection
  useEffect(() => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state') || '';
      const errorParam = params.get('error');

      if ((code || errorParam) && (state.startsWith('meta-ads-oauth') || state.startsWith('google-ads'))) {
          const provider = state.startsWith('meta-ads-oauth') ? 'meta' : 'google';
          
          setActiveSection(AppSection.INTEGRACAO);
          setPendingOAuth({ provider, code: code || '', state, errorParam: errorParam || '' });
      }
  }, []);

  // Quando o Integration.tsx montar, disparar evento com os dados do state
  useEffect(() => {
      if (pendingOAuth) {
          window.dispatchEvent(new CustomEvent('oauth-callback-received', { 
              detail: pendingOAuth 
          }));
      }
  }, [pendingOAuth]);

  // Data State
  const [financialEntries, setFinancialEntries] = useState<FinancialEntry[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [recordings, setRecordings] = useState<ConsultationRecording[]>([]);
  
  // AI Config State (Default Values)
  const [aiConfig, setAiConfig] = useState<AIConfig>({
    active: false,
    name: 'Assistente Virtual',
    role: 'SDR (Pré-vendas)',
    objective: 'Agendamento de Consulta',
    prompt: 'Você é a assistente virtual da clínica. Seu tom deve ser acolhedor, profissional e direto. Seu objetivo é entender a queixa do paciente e agendar uma avaliação.',
    negativePrompt: 'Não dê diagnósticos médicos. Não prometa cura. Não seja rude. Não invente preços não tabelados.',
    useProfile: true,
    useCRM: true,
    useHistory: true,
    triggerType: 'off_hours',
    delaySeconds: 10,
    workingHours: { start: '08:00', end: '18:00', weekends: false }
  });

  const updateAiConfig = async (config: Partial<AIConfig>) => {
    const newConfig = { ...aiConfig, ...config };
    setAiConfig(newConfig);
    
    // Persist to Supabase
    if (user && supabase) {
        try {
            await supabase.from('profiles').update({ ai_config: newConfig }).eq('id', user.id);
        } catch (e) {
            console.error("Erro ao salvar config IA:", e);
        }
    }
  };

  // Recorder Actions
  const addRecording = (recording: ConsultationRecording) => {
    setRecordings(prev => [recording, ...prev]);
  };
  const updateRecording = (recording: ConsultationRecording) => {
    setRecordings(prev => prev.map(r => r.id === recording.id ? recording : r));
  };
  const deleteRecording = (id: string) => {
    setRecordings(prev => prev.filter(r => r.id !== id));
  };

  const cacheRef = useRef<{
    dashboard: { lastFetch: number; start: string; end: string };
    marketing: { lastFetch: number; start: string; end: string };
  }>({
    dashboard: { lastFetch: 0, start: '', end: '' },
    marketing: { lastFetch: 0, start: '', end: '' }
  });

  const hasInitialPreloadedRef = useRef(false);
  const pendingScoreUpdates = useRef<Record<string, NodeJS.Timeout>>({});

  const [adsData, setAdsData] = useState<{
    googleAccount: { customer_id: string; customer_name: string; status: string; last_sync_at: string } | null;
    metaAccount: { ad_account_id: string; ad_account_name: string; status: string; last_sync_at: string; currency: string } | null;
    dashboard: {
      googleOverview: any[] | null;
      metaOverview: any[] | null;
      isLoading: boolean;
      lastFetch: number;
    };
    marketing: {
      googleOverview: any[] | null;
      metaOverview: any[] | null;
      isLoading: boolean;
      lastFetch: number;
    };
    isPreloadingAds: boolean;
  }>({
    googleAccount: null,
    metaAccount: null,
    dashboard: {
      googleOverview: null,
      metaOverview: null,
      isLoading: false,
      lastFetch: 0
    },
    marketing: {
      googleOverview: null,
      metaOverview: null,
      isLoading: false,
      lastFetch: 0
    },
    isPreloadingAds: false
  });
  
  // Tokens & Configs
  const [googleCalendarToken, setGoogleCalendarToken] = useState<string | null>(null);
  const [googleAdsToken, setGoogleAdsToken] = useState<string | null>(localStorage.getItem('google_ads_token'));
  const [googleSheetsToken, setGoogleSheetsToken] = useState<string | null>(localStorage.getItem('google_sheets_token'));
  const [metaAdsStatus, setMetaAdsStatusState] = useState<string | null>(localStorage.getItem('meta_ads_connected'));

  const setMetaAdsStatus = (status: string | null) => {
    setMetaAdsStatusState(status);
    if (status) {
      localStorage.setItem('meta_ads_connected', 'backend-connected');
    } else {
      localStorage.removeItem('meta_ads_connected');
    }
  };

  const [integrations, setIntegrations] = useState<Record<string, boolean>>({
    'google-ads': !!googleAdsToken, 
    'wpp': false, 
    'sheets': !!googleSheetsToken, 
    'calendar': !!googleCalendarToken, 
    'crm': false,
    'meta-ads': !!metaAdsStatus
  });

  useEffect(() => {
    setIntegrations(prev => ({
      ...prev,
      'google-ads': !!googleAdsToken,
      'calendar': !!googleCalendarToken,
      'sheets': !!googleSheetsToken,
      'wpp': false,
      'meta-ads': !!metaAdsStatus
    }));
  }, [googleAdsToken, googleCalendarToken, googleSheetsToken, metaAdsStatus]);

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
      if (data) setLeads(data.map((d: any) => ({ 
          ...d, 
          potentialValue: Number(d.potential_value), 
          lastMessage: d.last_message, 
          lastInteraction: d.last_interaction, 
          lastSender: d.last_sender, // MAPEAMENTO CRÍTICO
          email: d.email, 
          procedure: d.procedure, 
          notes: d.notes, 
          source: d.source,
          score: d.score,
          score_updated_at: d.score_updated_at,
          score_reasons: d.score_reasons
      })));
    } catch (err) { console.error(err); }
  }, [user]);

  const fetchAppointments = useCallback(async () => {
    if (!supabase || !user) return;
    try {
      const { data } = await supabase.from('appointments').select('*').order('date', { ascending: true });
      if (data) setAppointments(data.map((d: any) => ({ ...d, patientName: d.patient_name })));
    } catch (err) { console.error(err); }
  }, [user]);


  const refreshGoogleCredentials = async () => {
      if (!user) return;
      const { data } = await supabase.from('profiles').select('google_calendar_token').eq('id', user.id).single();
      setGoogleCalendarToken(data?.google_calendar_token || null);
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
         if (newProfile && 'google_calendar_token' in newProfile && newProfile.google_calendar_token !== googleCalendarToken) {
             setGoogleCalendarToken(newProfile.google_calendar_token);
         }
         // Se houver update na config de IA pelo servidor ou outro lugar, atualizamos o state
         if (newProfile.ai_config) {
             setAiConfig(prev => ({...prev, ...newProfile.ai_config}));
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
                setUser({ 
                    id: profile.id, 
                    name: profile.name || 'Admin', 
                    email: session.user.email || '', 
                    clinic: profile.clinic_name || 'Minha Clínica', 
                    plan: 'pro', 
                    ticketValue: Number(profile.ticket_value) || 450,
                    role: 'owner',
                    specialty: 'Dermatologia',
                    city: 'São Paulo',
                    procedures: 'Botox, Preenchimento, Laser',
                    phone: '11999999999',
                    avatar_url: profile.avatar_url || undefined
                });
                if (profile.google_calendar_token) setGoogleCalendarToken(profile.google_calendar_token);
                
                // Carregar Configurações da IA
                if (profile.ai_config) {
                    setAiConfig(prev => ({ ...prev, ...profile.ai_config }));
                }
              } else {
                setUser({ 
                    id: userId, 
                    name: 'Doutor(a)', 
                    email: session.user.email || '', 
                    clinic: 'Minha Clínica', 
                    plan: 'pro', 
                    ticketValue: 450, 
                    role: 'owner' 
                });
              }
          } catch(err) { console.error(err); }
          // await restoreWhatsappConnection(userId, 'Minha Clínica'); // REMOVIDO
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
          preloadAdsData('all', false, userId);
       } else {
          setUser(null); setFinancialEntries([]); setLeads([]); setAppointments([]); /* setWhatsappConfig(null); */ setGoogleCalendarToken(null);
       }
       setAuthLoading(false);
    };
    supabase.auth.getSession().then(({ data: { session } }) => handleSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Só re-executa handleSession completo (com preloadAdsData) no login inicial
      // TOKEN_REFRESHED (a cada ~1h) e USER_UPDATED só atualizam a sessão, sem LoadingScreen
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        handleSession(session);
      } else if (event === 'SIGNED_OUT') {
        handleSession(session); // session será null, faz logout
      } else if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // Só atualizar o estado da sessão, SEM chamar preloadAdsData
        setSession(session);
        setIsAuthenticated(!!session);
        // Se tem usuário logado, atualizar profile em background (sem LoadingScreen)
        if (session && user) {
          supabase.from('profiles').select('*').eq('id', session.user.id).single().then(
            ({ data: profile }) => {
              if (profile) {
                setUser(prev => prev ? { ...prev, name: profile.name || prev.name, ticketValue: Number(profile.ticket_value) || prev.ticketValue } : prev);
              }
            },
            () => {}
          );
        }
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Preload dashboard data on date change
  useEffect(() => {
    if (user?.id && isAuthenticated) {
      preloadAdsData('dashboard', false);
    }
  }, [dashboardDateFilter.start, dashboardDateFilter.end, user?.id, isAuthenticated]);

  // Preload marketing data on date change
  useEffect(() => {
    if (user?.id && isAuthenticated) {
      preloadAdsData('marketing', false);
    }
  }, [marketingDateFilter.start, marketingDateFilter.end, user?.id, isAuthenticated]);

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
    finally { 
      localStorage.removeItem('google_ads_token');
      localStorage.removeItem('google_sheets_token');
      localStorage.removeItem('auth_intent');
      localStorage.removeItem('whatsapp_config');
      setGoogleAdsToken(null); 
      setGoogleCalendarToken(null); 
      setGoogleSheetsToken(null); 
      /* setWhatsappConfig(null); */ 
      setUser(null); 
      setIsAuthenticated(false); 
    }
  };

  // CRUD Implementations
  const addFinancialEntry = async (entry: FinancialEntry): Promise<boolean> => {
    if (!user) return false;
    const tempId = crypto.randomUUID();
    const newEntry = { ...entry, id: tempId };
    setFinancialEntries(prev => [newEntry, ...prev]);
    const { error } = await supabase!.from('transactions').insert([{ 
      id: tempId,
      user_id: user.id, 
      type: entry.type, 
      category: entry.category, 
      name: entry.name, 
      unit_value: entry.unitValue, 
      discount: entry.discount, 
      addition: entry.addition, 
      total: entry.total, 
      status: entry.status, 
      date: entry.date, 
      payment_method: entry.paymentMethod || null, 
      installments: entry.installments || null 
    }]);
    if (error) { 
      setFinancialEntries(prev => prev.filter(e => e.id !== tempId)); 
      return false; 
    }
    return true;
  };
  const updateFinancialEntry = async (entry: FinancialEntry): Promise<boolean> => {
    setFinancialEntries(prev => prev.map(e => e.id === entry.id ? entry : e));
    const { error } = await supabase!.from('transactions').update({ type: entry.type, category: entry.category, name: entry.name, unit_value: entry.unitValue, discount: entry.discount, addition: entry.addition, total: entry.total, status: entry.status, date: entry.date, payment_method: entry.paymentMethod || null, installments: entry.installments || null }).eq('id', entry.id);
    if (error) {
      fetchFinancials();
      return false;
    }
    return true;
  };
  const deleteFinancialEntry = async (id: string): Promise<boolean> => {
    const backup = [...financialEntries];
    setFinancialEntries(prev => prev.filter(e => e.id !== id));
    const { error } = await supabase!.from('transactions').delete().eq('id', id);
    if (error) {
      setFinancialEntries(backup);
      return false;
    }
    return true;
  };
  
  const addLead = async (lead: Lead) => {
    if (!user) return;
    const tempId = crypto.randomUUID();
    setLeads(prev => [{ ...lead, id: tempId }, ...prev]);
    const payload = { 
        user_id: user.id, 
        name: lead.name, 
        phone: lead.phone, 
        email: lead.email || null,
        status: lead.status, 
        temperature: lead.temperature, 
        last_message: lead.lastMessage, 
        potential_value: lead.potentialValue,
        source: lead.source,
        procedure: lead.procedure || null,
        objective: lead.objective || null,
        ad_name: lead.adName || null,
        notes: lead.notes || null,
        created_at: lead.created_at || new Date().toISOString(),
        last_sender: 'me'
    };
    const { error } = await supabase!.from('leads').insert([payload]);
    if (error) { console.error("Erro ao salvar lead:", error); setLeads(prev => prev.filter(l => l.id !== tempId)); }
  };

  const updateLead = async (lead: Lead) => {
    setLeads(prev => prev.map(l => l.id === lead.id ? lead : l));
    const { error } = await supabase!.from('leads').update({ 
        name: lead.name, 
        phone: lead.phone, 
        status: lead.status, 
        temperature: lead.temperature, 
        last_message: lead.lastMessage, 
        potential_value: lead.potentialValue,
        email: lead.email || null,
        notes: lead.notes || null,
        source: lead.source || 'Manual',
        procedure: lead.procedure || null,
        objective: lead.objective || null,
        ad_name: lead.adName || null
    }).eq('id', lead.id);
    if (error) fetchLeads();
  };

  const updateLeadScore = useCallback(async (leadId: string, score: number, reasons: any[]) => {
    if (!user?.id) return;
    
    if (pendingScoreUpdates.current[leadId]) {
      clearTimeout(pendingScoreUpdates.current[leadId]);
    }
    
    pendingScoreUpdates.current[leadId] = setTimeout(async () => {
      try {
        const { supabase } = await import('./lib/supabase');
        await supabase.from('leads').update({
          score,
          score_reasons: reasons,
          score_updated_at: new Date().toISOString()
        }).eq('id', leadId);
        delete pendingScoreUpdates.current[leadId];
      } catch (err) {
        console.error('Erro ao atualizar score:', err);
      }
    }, 1000);
  }, [user?.id]);

  useEffect(() => {
    if (leads.length === 0) return;
    const updatedLeads = leads.map(lead => {
      const { score, reasons } = calcularScore(lead);
      return { ...lead, score, score_reasons: Array.isArray(reasons) ? reasons : [] };
    });
    const hasChanges = updatedLeads.some((l, i) => l.score !== leads[i]?.score);
    if (hasChanges) {
      setLeads(updatedLeads);
      updatedLeads.forEach((l, i) => {
        const oldLead = leads[i];
        if (!oldLead || l.score !== oldLead.score) {
          updateLeadScore(l.id, l.score || 50, l.score_reasons || []);
        }
      });
    }
  }, [leads, updateLeadScore]);

  useEffect(() => {
    return () => {
      Object.values(pendingScoreUpdates.current).forEach(clearTimeout);
    };
  }, []);
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
    if (user.id !== 'demo-user' && supabase) {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.clinic !== undefined) dbUpdates.clinic_name = updates.clinic;
      if (updates.ticketValue !== undefined) dbUpdates.ticket_value = updates.ticketValue;
      if (updates.avatar_url !== undefined) dbUpdates.avatar_url = updates.avatar_url;
      
      if (Object.keys(dbUpdates).length > 0) {
        await supabase.from('profiles').update(dbUpdates).eq('id', user.id);
      }
    }
  };

  const addTeamMember = (member: Omit<TeamMember, 'id' | 'addedAt' | 'status'>) => {
      const newMember: TeamMember = { ...member, id: crypto.randomUUID(), status: 'active', addedAt: new Date().toISOString() };
      setTeamMembers(prev => [...prev, newMember]);
  };
  const removeTeamMember = (id: string) => { setTeamMembers(prev => prev.filter(m => m.id !== id)); };

  const consolidatedMetrics = useMemo((): ConsolidatedMetrics => {
    const filteredEntries = financialEntries.filter(e => e.date >= dashboardDateFilter.start && e.date <= dashboardDateFilter.end && e.status !== 'cancelada');
    const filteredLeads = leads.filter(l => l.created_at && l.created_at.split('T')[0] >= dashboardDateFilter.start && l.created_at.split('T')[0] <= dashboardDateFilter.end);
    const filteredAppointments = appointments.filter(a => a.date >= dashboardDateFilter.start && a.date <= dashboardDateFilter.end);
    
    const receitaBruta = filteredEntries.filter(e => e.type === 'receivable' && e.status === 'efetuada').reduce((acc, curr) => acc + curr.total, 0);
    const gastosOperacionais = filteredEntries.filter(e => e.type === 'payable' && e.category !== 'Marketing').reduce((acc, curr) => acc + curr.total, 0);
    const finalMarketingSpend = filteredEntries.filter(e => e.type === 'payable' && e.category === 'Marketing').reduce((acc, curr) => acc + curr.total, 0);
    const gastosTotais = gastosOperacionais + finalMarketingSpend;
    
    const leadsCount = filteredLeads.length || 0;
    const conversas = filteredLeads.filter(l => l.status !== 'Novo').length;
    const vendas = filteredLeads.filter(l => l.status === 'Venda').length;
    const noShowsCRM = filteredLeads.filter(l => l.status === 'No Show' || l.status === 'Falta').length; // Conta No Shows do CRM
    
    // CÁLCULO DE LEADS SEM RESPOSTA (> 2 horas)
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const leadsSemResposta = leads.filter(l => {
       if (l.lastSender === 'contact' && l.lastInteraction) {
           const lastInteractionDate = new Date(l.lastInteraction);
           return lastInteractionDate < twoHoursAgo;
       }
       return false;
    }).length;

    const agendamentos = filteredAppointments.length;
    const comparecimento = filteredAppointments.filter(a => a.status === 'Realizado').length;
    
    return {
      marketing: { 
        investimento: finalMarketingSpend, leads: leadsCount, clicks: leadsCount * 12, impressions: leadsCount * 480, cpl: (leadsCount > 0 && finalMarketingSpend > 0) ? finalMarketingSpend / leadsCount : 0, ctr: leadsCount > 0 ? 2.1 : 0 
      },
      vendas: { 
        conversas, agendamentos, comparecimento, comparecimentoTaxa: agendamentos > 0 ? (comparecimento / agendamentos) * 100 : 0, noShows: noShowsCRM, leadsSemResposta, vendas, taxaConversao: leadsCount > 0 ? (agendamentos / leadsCount) * 100 : 0, cac: agendamentos > 0 ? finalMarketingSpend / agendamentos : 0, cpv: vendas > 0 ? finalMarketingSpend / vendas : 0 
      },
      financeiro: { 
        receitaBruta, gastosTotais, lucroLiquido: receitaBruta - gastosTotais, roi: gastosTotais > 0 ? ((receitaBruta - gastosTotais) / gastosTotais) * 100 : 0, ticketMedio: vendas > 0 ? receitaBruta / vendas : 0 
      }
    };
  }, [dashboardDateFilter, financialEntries, leads, appointments, user?.ticketValue]);

  const setDashboardDateFilterByLabel = useCallback((label: string) => {
    setDashboardDateFilter(calculateRange(label));
  }, []);

  const setDashboardCustomDateRange = useCallback((start: string, end: string) => {
    setDashboardDateFilter({ start, end, label: 'Custom' });
  }, []);

  const setMarketingDateFilterByLabel = useCallback((label: string) => {
    setMarketingDateFilter(calculateRange(label));
  }, []);

  const setMarketingCustomDateRange = useCallback((start: string, end: string) => {
    setMarketingDateFilter({ start, end, label: 'Custom' });
  }, []);

  const toggleIntegration = useCallback((id: string) => {
    setIntegrations(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const preloadAdsData = useCallback(async (
    section: 'dashboard' | 'marketing' | 'all' = 'all',
    forceRefresh = false,
    explicitUserId?: string
  ) => {
    const activeUserId = explicitUserId || user?.id;
    if (!activeUserId) return;

    const now = Date.now();
    const needDashboard = section === 'dashboard' || section === 'all';
    const needMarketing = section === 'marketing' || section === 'all';

    let fetchDashboard = false;
    if (needDashboard) {
      const cached = cacheRef.current.dashboard;
      const dateRangeMatch = cached.start === dashboardDateFilter.start && cached.end === dashboardDateFilter.end;
      const isExpired = (now - cached.lastFetch) >= 300000;
      if (forceRefresh || !dateRangeMatch || isExpired) {
        fetchDashboard = true;
      }
    }

    let fetchMarketing = false;
    if (needMarketing) {
      const cached = cacheRef.current.marketing;
      const dateRangeMatch = cached.start === marketingDateFilter.start && cached.end === marketingDateFilter.end;
      const isExpired = (now - cached.lastFetch) >= 300000;
      if (forceRefresh || !dateRangeMatch || isExpired) {
        fetchMarketing = true;
      }
    }

    // Se for carregamento inicial completo ('all'), mostramos isPreloadingAds
    const isInitialPreload = section === 'all' && (fetchDashboard || fetchMarketing) && !hasInitialPreloadedRef.current;

    setAdsData(prev => ({
      ...prev,
      isPreloadingAds: isInitialPreload ? true : prev.isPreloadingAds,
      dashboard: fetchDashboard ? { ...prev.dashboard, isLoading: true } : prev.dashboard,
      marketing: fetchMarketing ? { ...prev.marketing, isLoading: true } : prev.marketing
    }));

    try {
      const { supabase } = await import('./lib/supabase');

      // 1. Buscar contas conectadas (rápido)
      const [googleRes, metaRes] = await Promise.allSettled([
        supabase.from('google_ads_integrations').select('customer_id, customer_name, status, last_sync_at').eq('user_id', activeUserId).maybeSingle(),
        supabase.from('meta_ads_integrations').select('ad_account_id, ad_account_name, status, last_sync_at, currency').eq('user_id', activeUserId).maybeSingle()
      ]);

      const googleAccount = googleRes.status === 'fulfilled' && googleRes.value.data ? googleRes.value.data : null;
      const metaAccount = metaRes.status === 'fulfilled' && metaRes.value.data ? metaRes.value.data : null;

      // Atualizar estados de token/status globais
      if (googleAccount && googleAccount.status === 'active') {
        setGoogleAdsToken('backend-connected');
      } else {
        setGoogleAdsToken(null);
      }
      if (metaAccount && (metaAccount.status === 'active' || metaAccount.status === 'connected')) {
        setMetaAdsStatus('backend-connected');
      } else {
        setMetaAdsStatus(null);
      }

      // 2. Preparar as chamadas de API
      let dashboardGoogleResults: any[] | null = null;
      let dashboardMetaResults: any[] | null = null;
      let marketingGoogleResults: any[] | null = null;
      let marketingMetaResults: any[] | null = null;

      const promises: Promise<any>[] = [];

      if (fetchDashboard) {
        const fetchDashGoogle = async () => {
          if (!googleAccount || googleAccount.status !== 'active') return null;
          try {
            const response = await fetch('/api/google-ads/overview', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user_id: activeUserId, date_range: { start: dashboardDateFilter.start, end: dashboardDateFilter.end } })
            });
            if (!response.ok) return null;
            const data = await response.json();
            return data.results || [];
          } catch { return null; }
        };

        const fetchDashMeta = async () => {
          if (!metaAccount || (metaAccount.status !== 'active' && metaAccount.status !== 'connected')) return null;
          try {
            const response = await fetch('/api/meta-ads/overview', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user_id: activeUserId, date_range: { start: dashboardDateFilter.start, end: dashboardDateFilter.end } })
            });
            if (!response.ok) return null;
            const data = await response.json();
            return data.results || [];
          } catch { return null; }
        };

        promises.push(
          fetchDashGoogle().then(res => { dashboardGoogleResults = res; }),
          fetchDashMeta().then(res => { dashboardMetaResults = res; })
        );
      }

      if (fetchMarketing) {
        const fetchMarkGoogle = async () => {
          if (!googleAccount || googleAccount.status !== 'active') return null;
          try {
            const response = await fetch('/api/google-ads/overview', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user_id: activeUserId, date_range: { start: marketingDateFilter.start, end: marketingDateFilter.end } })
            });
            if (!response.ok) return null;
            const data = await response.json();
            return data.results || [];
          } catch { return null; }
        };

        const fetchMarkMeta = async () => {
          if (!metaAccount || (metaAccount.status !== 'active' && metaAccount.status !== 'connected')) return null;
          try {
            const response = await fetch('/api/meta-ads/overview', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user_id: activeUserId, date_range: { start: marketingDateFilter.start, end: marketingDateFilter.end } })
            });
            if (!response.ok) return null;
            const data = await response.json();
            return data.results || [];
          } catch { return null; }
        };

        promises.push(
          fetchMarkGoogle().then(res => { marketingGoogleResults = res; }),
          fetchMarkMeta().then(res => { marketingMetaResults = res; })
        );
      }

      if (promises.length > 0) {
        await Promise.allSettled(promises);
      }

      const updateNow = Date.now();
      if (fetchDashboard) {
        cacheRef.current.dashboard = {
          lastFetch: updateNow,
          start: dashboardDateFilter.start,
          end: dashboardDateFilter.end
        };
      }
      if (fetchMarketing) {
        cacheRef.current.marketing = {
          lastFetch: updateNow,
          start: marketingDateFilter.start,
          end: marketingDateFilter.end
        };
      }

      setAdsData(prev => {
        const nextDashboard = fetchDashboard ? {
          googleOverview: dashboardGoogleResults,
          metaOverview: dashboardMetaResults,
          isLoading: false,
          lastFetch: updateNow
        } : prev.dashboard;

        const nextMarketing = fetchMarketing ? {
          googleOverview: marketingGoogleResults,
          metaOverview: marketingMetaResults,
          isLoading: false,
          lastFetch: updateNow
        } : prev.marketing;

        return {
          ...prev,
          googleAccount,
          metaAccount,
          dashboard: nextDashboard,
          marketing: nextMarketing,
          isPreloadingAds: false
        };
      });

      if (isInitialPreload) {
        hasInitialPreloadedRef.current = true;
      }

    } catch (err) {
      console.error('Erro ao pré-carregar dados de Ads:', err);
      setAdsData(prev => ({
        ...prev,
        isPreloadingAds: false,
        dashboard: { ...prev.dashboard, isLoading: false },
        marketing: { ...prev.marketing, isLoading: false }
      }));
    }
  }, [user?.id, dashboardDateFilter.start, dashboardDateFilter.end, marketingDateFilter.start, marketingDateFilter.end]);

  // Render Optimized
  const renderContent = () => {
    return (
      <ErrorBoundary>
        {(() => {
          switch(activeSection) {
            case AppSection.DASHBOARD: return <Dashboard />;
            case AppSection.AXIS: return <AxisModule />;
            case AppSection.MARKETING: return <Marketing />;
            case AppSection.VENDAS: return <Sales />;
            case AppSection.AGENDA: return <Agenda />;
            case AppSection.AUTOMACAO: return <Automation />;
            case AppSection.FINANCEIRO: return <Financial />;
            case AppSection.INTEGRACAO: return <Integration />;
            case AppSection.GRAVADOR: return <Recorder />;
            case AppSection.PERFIL: return <Profile />;
            default: return <Dashboard />;
          }
        })()}
      </ErrorBoundary>
    );
  };

  if (authLoading) return <LoadingScreen />;
  if (adsData.isPreloadingAds) return <LoadingScreen message="Sincronizando contas e pré-carregando dados de marketing e anúncios..." />;
  if (!isAuthenticated) return <AuthScreen onLogin={login} onSignUp={signUp} />;

  return (
    <AppContext.Provider value={{ 
        user, updateUser, isAuthenticated, login, signUp, logout, integrations, 
        googleCalendarToken, setGoogleCalendarToken, googleAdsToken, setGoogleAdsToken, googleSheetsToken, setGoogleSheetsToken, 
        metaAdsStatus, setMetaAdsStatus,
        /* whatsappConfig, setWhatsappConfig, */ toggleIntegration, refreshGoogleCredentials, 
        adsData, preloadAdsData,
        dashboardDateFilter, setDashboardDateFilterByLabel, setDashboardCustomDateRange,
        marketingDateFilter, setMarketingDateFilterByLabel, setMarketingCustomDateRange,
        metrics: consolidatedMetrics, 
        financialEntries, addFinancialEntry, updateFinancialEntry, deleteFinancialEntry, 
        leads, addLead, updateLead, appointments, addAppointment, updateAppointment,
        teamMembers, addTeamMember, removeTeamMember,
        aiConfig, updateAiConfig,
        recordings, addRecording, updateRecording, deleteRecording,
        navigateToSection: setActiveSection // Expondo navegação
    }}>
      <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-[#f1f5f9]">
        <div className="md:hidden flex items-center justify-between p-4 bg-navy text-white z-[60] shadow-md">
          <h1 className="font-bold text-lg tracking-tight">AXIS AI</h1>
          <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-white/10 rounded-lg">{isSidebarOpen ? <X size={24} /> : <Menu size={24} />}</button>
        </div>
        {isSidebarOpen && (
          <div 
            onClick={() => setSidebarOpen(false)} 
            className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-all duration-300 animate-in fade-in"
          />
        )}
        <div className={`fixed inset-y-0 left-0 z-50 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 md:visible transition-all duration-300 ease-in-out shadow-2xl md:shadow-none`}>
          <Sidebar activeSection={activeSection} onNavigate={(s) => { setActiveSection(s); setSidebarOpen(false); }} />
        </div>
        <main className="flex-1 overflow-y-auto p-4 md:p-8 relative custom-scrollbar fade-enter">
          <div className="max-w-[1600px] mx-auto pb-20">{renderContent()}</div>
        </main>
      </div>

      {pendingMetaAccounts.length > 0 && !showPendingMetaModal && (
        <div className="fixed bottom-4 right-4 z-50 bg-amber-500 text-white p-4 rounded-xl shadow-lg animate-pulse cursor-pointer" onClick={() => { setActiveSection(AppSection.INTEGRACAO); setTimeout(() => window.dispatchEvent(new CustomEvent('open-meta-selector')), 300); }}>
            <p className="font-bold">Seleção pendente!</p>
            <p className="text-sm">Meta Ads: escolha uma conta</p>
            <button className="mt-2 bg-white text-amber-700 px-3 py-1 rounded font-bold text-xs">
                Selecionar agora
            </button>
        </div>
      )}

      {pendingGoogleAccounts.length > 0 && !showPendingGoogleModal && (
        <div className="fixed bottom-24 right-4 z-50 bg-amber-500 text-white p-4 rounded-xl shadow-lg animate-pulse cursor-pointer" onClick={() => { setActiveSection(AppSection.INTEGRACAO); setTimeout(() => window.dispatchEvent(new CustomEvent('open-google-selector')), 300); }}>
            <p className="font-bold">Seleção pendente!</p>
            <p className="text-sm">Google Ads: escolha uma conta</p>
            <button className="mt-2 bg-white text-amber-700 px-3 py-1 rounded font-bold text-xs">
                Selecionar agora
            </button>
        </div>
      )}

    </AppContext.Provider>
  );
};

// ... (AuthScreen updated)
const AuthScreen = ({ onLogin, onSignUp }: { onLogin: any, onSignUp: any }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  // State para visibilidade da senha
  const [showPassword, setShowPassword] = useState(false);

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
             <div className="w-12 h-12 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/10">
                <AxisLogo size={28} className="text-blue-400" />
             </div>
             <span className="text-xl font-bold tracking-tight">AXIS AI</span>
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
             © 2024 AXIS AI Inc. Todos os direitos reservados.
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
                         className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#0f172a] focus:border-[#0f172a] outline-none transition-all text-sm text-slate-900"
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
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#0f172a] focus:border-[#0f172a] outline-none transition-all text-sm text-slate-900"
                      placeholder="doutor@clinica.com"
                   />
                </div>

                <div className="space-y-1.5">
                   <div className="flex justify-between items-center">
                      <label className="text-xs font-semibold text-slate-700">Senha</label>
                      {isLogin && <a href="#" className="text-xs text-blue-600 hover:underline">Esqueceu?</a>}
                   </div>
                   <div className="relative">
                       <input 
                          type={showPassword ? "text" : "password"} 
                          value={pass} 
                          onChange={e => setPass(e.target.value)} 
                          required 
                          className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#0f172a] focus:border-[#0f172a] outline-none transition-all text-sm text-slate-900"
                          placeholder="••••••••"
                       />
                       <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          tabIndex={-1}
                       >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                       </button>
                   </div>
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
