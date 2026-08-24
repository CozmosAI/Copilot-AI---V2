
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Play, CalendarCheck, UserCheck, UserX, Stethoscope, DollarSign, CreditCard, 
  Briefcase, Megaphone, Users, Target, Activity, Bot, Filter, ChevronDown, ArrowDown, AlertCircle, BarChart3,
  ExternalLink, ZoomIn, X, Calendar, ArrowRight, TrendingUp, RefreshCw, Plus, Check
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { generateAudioReport, playPCM } from '../services/geminiService';
import { useApp } from '../App';
import { AdPerformance, AppSection } from '../types';
import { getGoogleOverview } from '../services/googleAdsService';
import { getMetaOverview, getMetaLeadForms, MetaLeadFormItem } from '../services/metaAdsService';
import { supabase } from '../lib/supabase';
import { GoogleAdsLogo, MetaAdsLogo } from './icons/CustomLogos';
import { DateRangePicker, DateRangeSelection } from './DateRangePicker';

function timeAgo(dateString: string): string {
  if (!dateString) return 'nunca';
  const date = new Date(dateString);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'agora';
  if (seconds < 3600) return `há ${Math.floor(seconds/60)}min`;
  if (seconds < 86400) return `há ${Math.floor(seconds/3600)}h`;
  return `há ${Math.floor(seconds/86400)} dias`;
}

const GoogleIcon = ({ size = 20 }: { size?: number }) => <GoogleAdsLogo size={size} />;
const MetaIcon = ({ size = 20 }: { size?: number }) => <MetaAdsLogo size={size} />;

const Dashboard: React.FC = () => {
  const { dashboardDateFilter, setDashboardDateFilterByLabel, setDashboardCustomDateRange, metrics, financialEntries, leads, googleAdsToken, navigateToSection, user, adsData, preloadAdsData, aiConfig } = useApp();
  const [insight, setInsight] = useState<string>('Analisando sua clínica...');
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [selectedAd, setSelectedAd] = useState<AdPerformance['topAd'] | null>(null);

  // States para Lead Forms do Meta Ads
  const [metaLeadForms, setMetaLeadForms] = useState<MetaLeadFormItem[]>([]);
  const [loadingMetaLeads, setLoadingMetaLeads] = useState(false);
  const [showAllMetaLeadsModal, setShowAllMetaLeadsModal] = useState(false);
  const [selectedLeadDetail, setSelectedLeadDetail] = useState<MetaLeadFormItem | null>(null);
  const [leadSearchQuery, setLeadSearchQuery] = useState('');

  // States para dados reais de Ads
  const [googleStats, setGoogleStats] = useState({ spend: 0, clicks: 0, impressions: 0, conversions: 0 });
  const [metaStats, setMetaStats] = useState({ spend: 0, clicks: 0, impressions: 0, conversions: 0 });
  const [debouncedDate, setDebouncedDate] = useState(dashboardDateFilter);

  // Derivados de adsData do Context
  const googleAccount = adsData.googleAccount;
  const metaAccount = adsData.metaAccount;
  const loadingAccounts = adsData.dashboard.isLoading;
  const isLoading = adsData.dashboard.isLoading;

  // Triggers de atualização
  const [refreshCount, setRefreshCount] = useState(0);

  // Date Range State
  const [dateRange, setDateRange] = useState<DateRangeSelection>({
    preset: '7d',
    from: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
    to: new Date(),
    compareWithPrevious: false
  });

  const handleDateRangeChange = (selection: DateRangeSelection) => {
    setDateRange(selection);
    const startStr = selection.from.toISOString().split('T')[0];
    const endStr = selection.to.toISOString().split('T')[0];
    setDashboardCustomDateRange(startStr, endStr);
  };

  // Filtrar Leads por Origem e Data no Período
  const leadsInPeriod = useMemo(() => {
    return leads.filter(l => {
       const d = l.created_at ? l.created_at.split('T')[0] : '';
       return d >= dashboardDateFilter.start && d <= dashboardDateFilter.end;
    });
  }, [leads, dashboardDateFilter.start, dashboardDateFilter.end]);

  const hotLeadsCount = useMemo(() => leadsInPeriod.filter(l => l.temperature === 'Hot').length, [leadsInPeriod]);
  const warmLeadsCount = useMemo(() => leadsInPeriod.filter(l => l.temperature === 'Warm').length, [leadsInPeriod]);
  const coldLeadsCount = useMemo(() => leadsInPeriod.filter(l => l.temperature === 'Cold').length, [leadsInPeriod]);

  const hotLeadsByScoreCount = useMemo(() => leadsInPeriod.filter(l => (l.score !== undefined ? l.score : 50) >= 70).length, [leadsInPeriod]);
  const warmLeadsByScoreCount = useMemo(() => leadsInPeriod.filter(l => {
    const s = l.score !== undefined ? l.score : 50;
    return s >= 50 && s < 70;
  }).length, [leadsInPeriod]);
  const coldLeadsByScoreCount = useMemo(() => leadsInPeriod.filter(l => (l.score !== undefined ? l.score : 50) < 50).length, [leadsInPeriod]);

  // Efeito para calcular as métricas de Ads baseadas nos dados do Context
  useEffect(() => {
    let gSpend = 0, gClicks = 0, gImpressions = 0, gConversions = 0;
    if (adsData.dashboard.googleOverview && Array.isArray(adsData.dashboard.googleOverview)) {
      adsData.dashboard.googleOverview.forEach((row: any) => {
        gSpend += (parseInt(row.metrics?.costMicros) || 0) / 1000000;
        gClicks += parseInt(row.metrics?.clicks) || 0;
        gImpressions += parseInt(row.metrics?.impressions) || 0;
        gConversions += parseFloat(row.metrics?.conversions) || 0;
      });
    }
    
    let mSpend = 0, mClicks = 0, mImpressions = 0, mConversions = 0;
    if (adsData.dashboard.metaOverview && Array.isArray(adsData.dashboard.metaOverview)) {
      adsData.dashboard.metaOverview.forEach((row: any) => {
        mSpend += parseFloat(row.spend) || 0;
        mClicks += parseInt(row.clicks) || 0;
        mImpressions += parseInt(row.impressions) || 0;
        mConversions += parseInt(row.conversions) || 0;
      });
    }
    
    setGoogleStats({ spend: gSpend, clicks: gClicks, impressions: gImpressions, conversions: gConversions });
    setMetaStats({ spend: mSpend, clicks: mClicks, impressions: mImpressions, conversions: mConversions });
  }, [adsData.dashboard.googleOverview, adsData.dashboard.metaOverview]);

  const hasData = metrics.financeiro.receitaBruta > 0 || metrics.financeiro.gastosTotais > 0;

  // Carregar leads de formulários nativos do Meta Ads
  const fetchMetaLeads = async () => {
    if (metaAccount !== null || metaStats.spend > 0) {
      setLoadingMetaLeads(true);
      try {
        const list = await getMetaLeadForms();
        setMetaLeadForms(list);
      } catch (err) {
        console.error('Erro ao buscar leads de formulário Meta Ads:', err);
      } finally {
        setLoadingMetaLeads(false);
      }
    }
  };

  useEffect(() => {
    fetchMetaLeads();
  }, [metaAccount, refreshCount]);

  useEffect(() => {
    if (hasData) {
        const totalRealSpend = googleStats.spend + metaStats.spend;
        const displaySpend = totalRealSpend > 0 ? totalRealSpend : metrics.marketing.investimento;
        setInsight(`Resumo executivo gerado: Receita líquida de R$ ${metrics.financeiro.lucroLiquido.toLocaleString()} com ROI de ${metrics.financeiro.roi.toFixed(0)}%. Investimento de marketing real de R$ ${displaySpend.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}. Atenção às ${metrics.vendas.noShows} faltas registradas no CRM.`);
    }
  }, [metrics, hasData, googleStats, metaStats]);

  const handlePlayAudio = async () => {
    if (!hasData) return;
    setLoadingAudio(true);
    const audioData = await generateAudioReport(insight);
    if (audioData) await playPCM(audioData);
    setLoadingAudio(false);
  };

  // --- LÓGICA DO GRÁFICO FINANCEIRO ---
  const financialChartData = useMemo(() => {
    const start = new Date(dashboardDateFilter.start);
    const end = new Date(dashboardDateFilter.end);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    const isMonthlyView = diffDays > 35;
    const dataMap = new Map<string, { name: string; sortKey: string; receita: number; despesa: number; lucro: number }>();

    financialEntries.forEach(entry => {
        if (entry.date < dashboardDateFilter.start || entry.date > dashboardDateFilter.end) return;
        if (entry.status !== 'efetuada') return;
        const dateObj = new Date(entry.date + 'T12:00:00'); 
        let key = '', sortKey = '';

        if (isMonthlyView) {
            key = dateObj.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
            sortKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        } else {
            key = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            sortKey = entry.date;
        }

        if (!dataMap.has(key)) dataMap.set(key, { name: key, sortKey, receita: 0, despesa: 0, lucro: 0 });
        const item = dataMap.get(key)!;
        if (entry.type === 'receivable') item.receita += entry.total;
        else if (entry.type === 'payable') item.despesa += entry.total;
        item.lucro = item.receita - item.despesa;
    });

    return Array.from(dataMap.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [financialEntries, dashboardDateFilter]);


  // --- DADOS DE ATRIBUIÇÃO DE ANÚNCIOS (Cruzamento Ads x CRM) ---
  const adPerformanceData = useMemo(() => {
    const hasGoogle = googleAccount !== null;
    const hasMeta = metaAccount !== null;
    const googleSpend = hasGoogle ? googleStats.spend : 0; 
    const metaSpend = hasMeta ? metaStats.spend : 0; 

    // 2. Calcular Métricas Google
    const googleLeads = leadsInPeriod.filter(l => l.source === 'Google Ads');
    const googleAppointments = googleLeads.filter(l => ['Agendado', 'Venda', 'Realizado'].includes(l.status)).length;
    const googleLeadsCount = googleLeads.length;
    const googleCPL = googleLeadsCount > 0 ? googleSpend / googleLeadsCount : 0;
    const googleCPA = googleAppointments > 0 ? googleSpend / googleAppointments : 0;

    // 3. Calcular Métricas Meta/Instagram
    const metaLeads = leadsInPeriod.filter(l => ['Instagram', 'Facebook', 'Meta'].includes(l.source || ''));
    const metaAppointments = metaLeads.filter(l => ['Agendado', 'Venda', 'Realizado'].includes(l.status)).length;
    const metaLeadsCount = metaLeads.length;
    const metaCPL = metaLeadsCount > 0 ? metaSpend / metaLeadsCount : 0;
    const metaCPA = metaAppointments > 0 ? metaSpend / metaAppointments : 0;

    return {
      google: {
        platform: 'google' as const,
        spend: googleSpend,
        leads: googleLeadsCount,
        cpl: googleCPL,
        appointments: googleAppointments,
        cpa: googleCPA,
        topAd: {
          name: 'Campanha Pesquisa - "Melhor Dermatologista"',
          headline: 'Agende Sua Avaliação Hoje | Dermatologia Avançada',
          imageUrl: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
          clicks: 145, // Mantido para compatibilidade
          generatedLeads: Math.round(googleLeadsCount * 0.4) // Simulação: 40% dos leads vieram deste anúncio
        }
      },
      meta: {
        platform: 'meta' as const,
        spend: metaSpend,
        leads: metaLeadsCount,
        cpl: metaCPL,
        appointments: metaAppointments,
        cpa: metaCPA,
        topAd: {
          name: 'Stories - Antes e Depois (Botox)',
          headline: 'Recupere sua autoestima com naturalidade ✨',
          imageUrl: 'https://images.unsplash.com/photo-1526947425960-945c6e72858f?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
          clicks: 312,
          generatedLeads: Math.round(metaLeadsCount * 0.6) // Simulação: 60% dos leads vieram deste anúncio
        }
      }
    };
  }, [metrics, googleAdsToken, leadsInPeriod, googleStats, metaStats, googleAccount, metaAccount]);

  // Cálculos Auxiliares do Funil
  const lostLeads = Math.max(0, metrics.marketing.leads - metrics.vendas.agendamentos);
  const conversionRateStep1 = metrics.marketing.leads > 0 ? ((metrics.vendas.agendamentos / metrics.marketing.leads) * 100).toFixed(1) : '0';
  const noShows = metrics.vendas.noShows;
  const attendanceRateStep2 = metrics.vendas.agendamentos > 0 ? ((metrics.vendas.comparecimento / metrics.vendas.agendamentos) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6 md:space-y-8 pb-12 animate-in fade-in duration-500 relative">
      {/* HEADER LIMPO */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl md:text-2xl font-bold text-navy tracking-tight">Resumo Executivo</h2>
            {isLoading && (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
             <p className="text-xs md:text-sm text-slate-500">Dados consolidados de {dashboardDateFilter.start} até {dashboardDateFilter.end}</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto shrink-0">
          {/* BOTÃO ATUALIZAR */}
          <button 
            onClick={() => {
              preloadAdsData('dashboard', true);
            }}
            disabled={isLoading || loadingAccounts}
            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-600 hover:text-navy border border-slate-200 rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50 shrink-0 w-full sm:w-auto justify-center"
          >
            <RefreshCw size={13} className={`${(isLoading || loadingAccounts) ? 'animate-spin' : ''}`} />
            <span>{(isLoading || loadingAccounts) ? 'Atualizando...' : 'Atualizar'}</span>
          </button>

          {/* FILTRO DE PERÍODO */}
          <DateRangePicker value={dateRange} onChange={handleDateRangeChange} />
        </div>
      </header>

      {/* AI AUDIO PLAYER */}
      <div className="bg-navy rounded-2xl p-4 md:p-6 text-white shadow-lg relative overflow-hidden group">
         <div className="absolute right-0 bottom-0 opacity-10 transform translate-x-1/4 translate-y-1/4 pointer-events-none"><Bot size={180} /></div>
         <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center gap-4 md:gap-6">
             <button onClick={handlePlayAudio} className="w-12 h-12 md:w-14 md:h-14 bg-white rounded-full flex items-center justify-center text-navy shadow-lg hover:scale-105 transition-transform shrink-0">
                {loadingAudio ? <div className="animate-spin w-5 h-5 md:w-6 md:h-6 border-2 border-navy border-t-transparent rounded-full"/> : <Play size={20} className="md:w-6 md:h-6 ml-1" fill="currentColor"/>}
             </button>
             <div>
                  <div className="flex items-center gap-2 mb-1">
                     <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-1"><Bot size={12}/> Relatório do Copilot AI ({dashboardDateFilter.label})</span>
                  </div>
                  <p className="text-sm md:text-lg font-medium italic opacity-90 leading-relaxed">"{insight}"</p>
             </div>
         </div>
      </div>

      {/* STATUS DE CONTAS CONECTADAS */}
      {loadingAccounts ? (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm animate-pulse flex flex-col gap-3">
          <div className="h-5 bg-slate-200 rounded w-1/4 animate-pulse"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-20 bg-slate-100 rounded-xl animate-pulse"></div>
            <div className="h-20 bg-slate-100 rounded-xl animate-pulse"></div>
          </div>
        </div>
      ) : (
        (() => {
          const hasGoogle = googleAccount !== null;
          const hasMeta = metaAccount !== null;

          // CENÁRIO A: Nenhuma conta conectada
          if (!hasGoogle && !hasMeta) {
            return (
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex items-center gap-2 shrink-0">
                  <div className="opacity-40"><GoogleIcon size={20} /></div>
                  <div className="opacity-40"><MetaIcon size={20} /></div>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-slate-600">Conecte suas contas de anúncios</p>
                  <p className="text-[10px] text-slate-400">Google Ads e Meta Ads para ver seus dados de marketing</p>
                </div>
                <button 
                  onClick={() => navigateToSection(AppSection.INTEGRACAO)}
                  className="w-full sm:w-auto px-3 py-1.5 bg-navy text-white text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-slate-800 transition-colors text-center"
                >
                  Conectar
                </button>
              </div>
            );
          }

          // CENÁRIO B: Apenas 1 conta conectada (Google OU Meta)
          if ((hasGoogle && !hasMeta) || (!hasGoogle && hasMeta)) {
            return (
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xs font-bold text-navy uppercase tracking-widest flex items-center gap-2">
                    📊 Status de Contas Conectadas
                  </h3>
                  <button 
                    onClick={() => navigateToSection(AppSection.INTEGRACAO)}
                    className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    Gerenciar conexões
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Google Ads Sub-card */}
                  {hasGoogle ? (
                    <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white rounded-xl shadow-sm border border-emerald-100"><GoogleIcon size={24} /></div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Google Ads</p>
                          <p className="font-bold text-navy text-sm">{googleAccount?.customer_name || 'Desconhecido'}</p>
                          <p className="text-xs text-slate-500 font-mono mt-0.5">ID: {googleAccount?.customer_id}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-100/50 px-2.5 py-1 rounded-full border border-emerald-100">
                          🟢 Conectado
                        </span>
                        <p className="text-[9px] text-slate-400 font-medium mt-1">sincronizado {timeAgo(googleAccount?.last_sync_at || '')}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-dashed border-slate-200 p-4 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white rounded-xl shadow-sm opacity-50"><GoogleIcon size={24} /></div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Google Ads</p>
                          <p className="font-bold text-slate-400 text-sm">Não conectado</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => navigateToSection(AppSection.INTEGRACAO)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-navy text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-all"
                      >
                        <Plus size={12} /> Conectar agora
                      </button>
                    </div>
                  )}

                  {/* Meta Ads Sub-card */}
                  {hasMeta ? (
                    <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white rounded-xl shadow-sm border border-emerald-100"><MetaIcon size={24} /></div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Meta Ads</p>
                          <p className="font-bold text-navy text-sm">{metaAccount?.ad_account_name || 'Desconhecido'}</p>
                          <p className="text-xs text-slate-500 font-mono mt-0.5">ID: {metaAccount?.ad_account_id}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-100/50 px-2.5 py-1 rounded-full border border-emerald-100">
                          🟢 Conectado
                        </span>
                        <p className="text-[9px] text-slate-400 font-medium mt-1">sincronizado {timeAgo(metaAccount?.last_sync_at || '')}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-dashed border-slate-200 p-4 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white rounded-xl shadow-sm opacity-50"><MetaIcon size={24} /></div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Meta Ads</p>
                          <p className="font-bold text-slate-400 text-sm">Não conectado</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => navigateToSection(AppSection.INTEGRACAO)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-navy text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-all"
                      >
                        <Plus size={12} /> Conectar agora
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          }

          // CENÁRIO C: Ambas conectadas
          return (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xs font-bold text-navy uppercase tracking-widest flex items-center gap-2">
                  🟢 Status de Contas Conectadas
                </h3>
                <button 
                  onClick={() => navigateToSection(AppSection.INTEGRACAO)}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-navy text-[10px] font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors shrink-0"
                >
                  Gerenciar
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Google Sub-card */}
                <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-white rounded-xl shadow-sm border border-emerald-100 flex items-center justify-center shrink-0"><GoogleIcon size={30} /></div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Google Ads</p>
                      <p className="font-bold text-navy text-sm">{googleAccount?.customer_name || 'Desconhecido'}</p>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">ID: {googleAccount?.customer_id}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-100/50 px-2.5 py-1 rounded-full border border-emerald-100">
                      🟢 Conectado
                    </span>
                    <p className="text-[9px] text-slate-400 font-medium mt-1">sincronizado {timeAgo(googleAccount?.last_sync_at || '')}</p>
                  </div>
                </div>

                {/* Meta Sub-card */}
                <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-white rounded-xl shadow-sm border border-emerald-100 flex items-center justify-center shrink-0"><MetaIcon size={30} /></div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Meta Ads</p>
                      <p className="font-bold text-navy text-sm">{metaAccount?.ad_account_name || 'Desconhecido'}</p>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">ID: {metaAccount?.ad_account_id}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-100/50 px-2.5 py-1 rounded-full border border-emerald-100">
                      🟢 Conectado
                    </span>
                    <p className="text-[9px] text-slate-400 font-medium mt-1">sincronizado {timeAgo(metaAccount?.last_sync_at || '')}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })()
      )}

      {/* GRID EXECUTIVO (3x3) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-6">
         {/* LINHA 1 */}
         {(googleAccount !== null || metaAccount !== null) && (
           <div className="bg-white p-3.5 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm relative hover:border-blue-300 transition-colors">
              <div className="flex justify-between items-start mb-2 md:mb-4"><span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Investimento (Mkt)</span><div className="p-1.5 md:p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0"><Megaphone size={14} className="md:w-[18px] md:h-[18px]" /></div></div>
              {isLoading && (googleStats.spend === 0 && metaStats.spend === 0 && metrics.marketing.investimento === 0) ? (
                <div className="space-y-3 animate-pulse">
                  <div className="h-6 bg-slate-200 rounded w-2/3"></div>
                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <div className="h-3 bg-slate-100 rounded w-5/6"></div>
                    <div className="h-3 bg-slate-100 rounded w-4/5"></div>
                    <div className="h-3 bg-slate-100 rounded w-2/3"></div>
                  </div>
                </div>
              ) : (
                (() => {
                  const hasGoogle = googleAccount !== null;
                  const hasMeta = metaAccount !== null;
                  const totalSpend = (hasGoogle ? googleStats.spend : 0) + (hasMeta ? metaStats.spend : 0);

                  return (
                    <>
                      <h3 className="text-base md:text-2xl font-black text-navy leading-none">
                        {totalSpend > 0 ? (
                          `R$ ${totalSpend.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                        ) : (
                          "Sem dados no período"
                        )}
                      </h3>
                      
                      <div className="mt-2 pt-2 border-t border-slate-100 space-y-1 text-[8px] md:text-[10px] font-semibold text-slate-500">
                        <p className="flex justify-between">
                          {hasGoogle && (
                            <span>G: R$ {googleStats.spend.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>
                          )}
                          {hasMeta && (
                            <span>M: R$ {metaStats.spend.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>
                          )}
                        </p>
                        
                        {(hasGoogle || hasMeta) && (
                          <>
                            <p className="flex justify-between text-blue-600 border-t border-slate-50 pt-1 mt-1">
                              <span>Cliques Totais:</span>
                              <span className="font-bold">
                                {((hasGoogle ? googleStats.clicks : 0) + (hasMeta ? metaStats.clicks : 0)).toLocaleString('pt-BR')}
                              </span>
                            </p>
                            <p className="flex justify-between text-indigo-600">
                              <span>Impressões Totais:</span>
                              <span className="font-bold">
                                {((hasGoogle ? googleStats.impressions : 0) + (hasMeta ? metaStats.impressions : 0)).toLocaleString('pt-BR')}
                              </span>
                            </p>
                            <p className="flex justify-between text-emerald-600">
                              <span>Conversões Totais:</span>
                              <span className="font-bold">
                                {((hasGoogle ? googleStats.conversions : 0) + (hasMeta ? metaStats.conversions : 0)).toLocaleString('pt-BR')}
                              </span>
                            </p>
                          </>
                        )}
                      </div>
                    </>
                  );
                })()
              )}
           </div>
         )}
         <div className="bg-white p-3.5 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm relative hover:border-indigo-300 transition-colors">
            <div className="flex justify-between items-start mb-2 md:mb-4"><span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Leads no Período</span><div className="p-1.5 md:p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0"><Users size={14} className="md:w-[18px] md:h-[18px]" /></div></div>
            <h3 className="text-base md:text-2xl font-black text-navy leading-none">
              {leadsInPeriod.length > 0 ? leadsInPeriod.length : metrics.marketing.leads}
            </h3>
            {leadsInPeriod.length > 0 ? (
              <p className="text-[8px] md:text-[9px] font-semibold text-slate-500 mt-1.5 md:mt-2 uppercase truncate">
                🔥 {hotLeadsCount} Quentes | ⚡ {warmLeadsCount} Mornos
              </p>
            ) : (
              <p className="text-[8px] md:text-[10px] font-bold text-emerald-500 mt-1.5 md:mt-2 uppercase">+8% vs anterior</p>
             )}
          </div>

          {aiConfig.scoringEnabled && (
            <div className="bg-white p-3.5 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm relative hover:border-blue-300 transition-colors">
               <div className="flex justify-between items-start mb-2 md:mb-4">
                 <span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Leads por Score</span>
                 <div className="p-1.5 md:p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0">
                   <Target size={14} className="md:w-[18px] md:h-[18px]" />
                 </div>
               </div>
               
               <div className="space-y-3">
                 <div>
                   <h3 className="text-base md:text-2xl font-black text-navy leading-none">
                     {leadsInPeriod.length} <span className="text-xs font-semibold text-slate-400 font-sans">Leads</span>
                   </h3>
                 </div>
                 
                 <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                   {leadsInPeriod.length > 0 ? (
                     <>
                       <div 
                         style={{ width: `${(hotLeadsByScoreCount / leadsInPeriod.length) * 100}%` }} 
                         className="h-full bg-emerald-500 transition-all" 
                         title={`Quentes: ${hotLeadsByScoreCount}`}
                       />
                       <div 
                         style={{ width: `${(warmLeadsByScoreCount / leadsInPeriod.length) * 100}%` }} 
                         className="h-full bg-amber-400 transition-all" 
                         title={`Mornos: ${warmLeadsByScoreCount}`}
                       />
                       <div 
                         style={{ width: `${(coldLeadsByScoreCount / leadsInPeriod.length) * 100}%` }} 
                         className="h-full bg-slate-300 transition-all" 
                         title={`Frios: ${coldLeadsByScoreCount}`}
                       />
                     </>
                   ) : (
                     <div className="h-full w-full bg-slate-200" />
                   )}
                 </div>
                 
                 <div className="grid grid-cols-3 gap-1 text-[8px] md:text-[10px] font-bold">
                   <div className="flex flex-col">
                     <span className="text-emerald-600 flex items-center gap-0.5">🔥 {hotLeadsByScoreCount}</span>
                     <span className="text-[7px] md:text-[9px] text-slate-400 uppercase font-medium">Quentes</span>
                   </div>
                   <div className="flex flex-col">
                     <span className="text-amber-600 flex items-center gap-0.5">⚡ {warmLeadsByScoreCount}</span>
                     <span className="text-[7px] md:text-[9px] text-slate-400 uppercase font-medium">Mornos</span>
                   </div>
                   <div className="flex flex-col">
                     <span className="text-slate-500 flex items-center gap-0.5">❄️ {coldLeadsByScoreCount}</span>
                     <span className="text-[7px] md:text-[9px] text-slate-400 uppercase font-medium">Frios</span>
                   </div>
                 </div>
               </div>
            </div>
          )}
         <div className="bg-white p-3.5 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm relative hover:border-sky-300 transition-colors">
            <div className="flex justify-between items-start mb-2 md:mb-4"><span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Consultas Marcadas</span><div className="p-1.5 md:p-2 bg-sky-50 text-sky-600 rounded-lg shrink-0"><CalendarCheck size={14} className="md:w-[18px] md:h-[18px]" /></div></div>
            <h3 className="text-base md:text-2xl font-black text-navy leading-none">{metrics.vendas.agendamentos}</h3>
            <p className="text-[8px] md:text-[10px] font-bold text-emerald-500 mt-1.5 md:mt-2 uppercase">+12% vs anterior</p>
         </div>

         {/* LINHA 2 */}
         <div className="bg-white p-3.5 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm relative hover:border-emerald-300 transition-colors">
            <div className="flex justify-between items-start mb-2 md:mb-4"><span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Comparecimento</span><div className="p-1.5 md:p-2 bg-emerald-50 text-emerald-600 rounded-lg shrink-0"><UserCheck size={14} className="md:w-[18px] md:h-[18px]" /></div></div>
            <h3 className="text-base md:text-2xl font-black text-navy leading-none">{metrics.vendas.comparecimentoTaxa.toFixed(0)}%</h3>
            <p className="text-[8px] md:text-[10px] font-bold text-emerald-500 mt-1.5 md:mt-2 uppercase">+4% vs anterior</p>
         </div>
         <div className="bg-white p-3.5 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm relative hover:border-rose-300 transition-colors">
            <div className="flex justify-between items-start mb-2 md:mb-4"><span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Faltas (No-Show)</span><div className="p-1.5 md:p-2 bg-rose-50 text-rose-600 rounded-lg shrink-0"><UserX size={14} className="md:w-[18px] md:h-[18px]" /></div></div>
            <h3 className="text-base md:text-2xl font-black text-navy leading-none">{Math.round((metrics.vendas.noShows / (metrics.vendas.agendamentos || 1)) * 100)}%</h3>
            <p className="text-[8px] md:text-[10px] font-bold text-rose-500 mt-1.5 md:mt-2 uppercase">-5% vs anterior</p>
         </div>
         <div className="bg-white p-3.5 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm relative hover:border-purple-300 transition-colors">
            <div className="flex justify-between items-start mb-2 md:mb-4"><span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Vendas Tratamento</span><div className="p-1.5 md:p-2 bg-purple-50 text-purple-600 rounded-lg shrink-0"><Stethoscope size={14} className="md:w-[18px] md:h-[18px]" /></div></div>
            <h3 className="text-base md:text-2xl font-black text-navy leading-none">{metrics.vendas.vendas}</h3>
            <p className="text-[8px] md:text-[10px] font-bold text-emerald-500 mt-1.5 md:mt-2 uppercase">+15% vs anterior</p>
         </div>

         {/* LINHA 3 */}
         <div className="bg-white p-3.5 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm relative hover:border-emerald-300 transition-colors">
            <div className="flex justify-between items-start mb-2 md:mb-4"><span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Receita Bruta</span><div className="p-1.5 md:p-2 bg-emerald-50 text-emerald-600 rounded-lg shrink-0"><DollarSign size={14} className="md:w-[18px] md:h-[18px]" /></div></div>
            <h3 className="text-base md:text-2xl font-black text-navy leading-none">R$ {metrics.financeiro.receitaBruta.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</h3>
            <p className="text-[8px] md:text-[10px] font-bold text-emerald-500 mt-1.5 md:mt-2 uppercase">+12% vs anterior</p>
         </div>
         <div className="bg-white p-3.5 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm relative hover:border-rose-300 transition-colors">
            <div className="flex justify-between items-start mb-2 md:mb-4"><span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Gastos Totais</span><div className="p-1.5 md:p-2 bg-rose-50 text-rose-600 rounded-lg shrink-0"><CreditCard size={14} className="md:w-[18px] md:h-[18px]" /></div></div>
            <h3 className="text-base md:text-2xl font-black text-navy leading-none">R$ {metrics.financeiro.gastosTotais.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</h3>
            <p className="text-[8px] md:text-[10px] font-bold text-emerald-500 mt-1.5 md:mt-2 uppercase">+2% vs anterior</p>
         </div>
         <div className="bg-white p-3.5 md:p-6 rounded-xl md:rounded-2xl border-2 border-blue-500 shadow-xl relative overflow-hidden group col-span-2 lg:col-span-1">
            <div className="flex justify-between items-start mb-2 md:mb-4"><span className="text-[8px] md:text-[10px] font-bold text-blue-400 uppercase tracking-widest truncate">Lucro Líquido (Est.)</span><div className="p-1.5 md:p-2 bg-navy text-white rounded-lg shrink-0"><Briefcase size={14} className="md:w-[18px] md:h-[18px]" /></div></div>
            <h3 className="text-base md:text-2xl font-black text-navy leading-none">R$ {metrics.financeiro.lucroLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</h3>
            <p className="text-[8px] md:text-[10px] font-bold text-emerald-600 mt-1.5 md:mt-2 uppercase">+10% vs anterior</p>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
         {/* FUNIL DE ATENDIMENTO */}
         <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
            <h3 className="text-xs font-bold text-navy uppercase tracking-widest mb-8 flex items-center gap-2">
                <Filter size={14} className="text-blue-500" /> Funil de Conversão & Gargalos
            </h3>
            
            <div className="flex-1 flex flex-col justify-center px-4">
                <div className="relative group">
                    <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex justify-between items-center z-10 relative">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-500 text-white rounded-lg shadow-sm"><Users size={16} /></div>
                            <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">1. Entrada (Leads)</p><p className="text-xl font-black text-navy">{metrics.marketing.leads} <span className="text-xs font-medium text-slate-400">leads</span></p></div>
                        </div>
                    </div>
                </div>
                <div className="h-12 border-l-2 border-dashed border-slate-300 ml-8 my-1 flex items-center">
                    <div className="ml-6 flex items-center gap-4 w-full">
                        <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-full border border-slate-200">Conv. {conversionRateStep1}%</span>
                        {lostLeads > 0 && <span className="text-[10px] font-bold text-rose-500 flex items-center gap-1 animate-pulse"><ArrowDown size={12}/> Perda: {lostLeads} leads parados</span>}
                    </div>
                </div>
                <div className="relative group">
                     <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl flex justify-between items-center z-10 relative">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-500 text-white rounded-lg shadow-sm"><CalendarCheck size={16} /></div>
                            <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">2. Agendados</p><p className="text-xl font-black text-navy">{metrics.vendas.agendamentos} <span className="text-xs font-medium text-slate-400">pacientes</span></p></div>
                        </div>
                    </div>
                </div>
                <div className="h-12 border-l-2 border-dashed border-slate-300 ml-8 my-1 flex items-center">
                    <div className="ml-6 flex items-center gap-4 w-full">
                         <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${Number(attendanceRateStep2) < 70 ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>Comparecimento {attendanceRateStep2}%</span>
                        {noShows > 0 && <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-100 flex items-center gap-1"><AlertCircle size={10}/> Falha: {noShows} No-Shows</span>}
                    </div>
                </div>
                <div className="relative group">
                     <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex justify-between items-center z-10 relative">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-emerald-500 text-white rounded-lg shadow-sm"><UserCheck size={16} /></div>
                            <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">3. Realizados</p><p className="text-xl font-black text-navy">{metrics.vendas.comparecimento} <span className="text-xs font-medium text-slate-400">atendimentos</span></p></div>
                        </div>
                        <div className="text-right"><p className="text-[10px] font-bold text-emerald-600 uppercase">Sucesso</p></div>
                    </div>
                </div>
            </div>
         </div>

         {/* AÇÕES URGENTES */}
         <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full">
             <h3 className="text-xs font-bold text-navy uppercase tracking-widest mb-6">Ações Urgentes</h3>
             <div className="space-y-4">
                 {/* CARD: NO-SHOWS */}
                 <div className="flex items-center gap-4 p-4 bg-amber-50 border border-amber-100 rounded-xl">
                    <div className="p-2 bg-white rounded-full text-amber-500 shadow-sm"><Activity size={16}/></div>
                    <div><p className="text-xs font-bold text-amber-800">Recuperar No-Shows</p><p className="text-[10px] text-amber-600/80 mt-0.5">Você teve {metrics.vendas.noShows} faltas/no-shows. Tente reagendar.</p></div>
                    <button 
                        onClick={() => navigateToSection(AppSection.VENDAS)} 
                        className="ml-auto px-3 py-1 bg-white border border-amber-200 text-[10px] font-bold text-amber-700 uppercase rounded-lg hover:bg-amber-100 transition-colors"
                    >
                        Ver Lista
                    </button>
                 </div>
                 
                 {/* CARD: LEADS SEM RESPOSTA */}
                 <div className="flex items-center gap-4 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                    <div className="p-2 bg-white rounded-full text-blue-500 shadow-sm"><Target size={16}/></div>
                    <div><p className="text-xs font-bold text-blue-800">Leads sem Resposta</p><p className="text-[10px] text-blue-600/80 mt-0.5">Existem {metrics.vendas.leadsSemResposta} leads aguardando contato &gt; 2h.</p></div>
                    <button 
                        onClick={() => navigateToSection(AppSection.VENDAS)} 
                        className="ml-auto px-3 py-1 bg-white border border-blue-200 text-[10px] font-bold text-blue-700 uppercase rounded-lg hover:bg-blue-100 transition-colors"
                    >
                        Responder
                    </button>
                 </div>
             </div>
         </div>
      </div>

      {/* GRÁFICO FINANCEIRO AGREGADO */}
      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-center mb-6">
              <div><h3 className="text-sm font-bold text-navy uppercase tracking-widest flex items-center gap-2"><BarChart3 size={16} className="text-emerald-600" /> Fluxo Financeiro Detalhado</h3><p className="text-xs text-slate-500 mt-1">Comparativo de Receita, Despesa e Lucro ({dashboardDateFilter.label})</p></div>
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={financialChartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(val) => `R$ ${val/1000}k`} />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR')}`, '']} labelStyle={{ color: '#0f172a', fontWeight: 'bold', marginBottom: '4px' }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase' }} />
                    <Bar name="Receita" dataKey="receita" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={60} />
                    <Bar name="Despesa" dataKey="despesa" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={60} />
                    <Bar name="Lucro" dataKey="lucro" fill="#0f172a" radius={[4, 4, 0, 0]} maxBarSize={60} />
                    <ReferenceLine y={0} stroke="#cbd5e1" />
                </BarChart>
            </ResponsiveContainer>
          </div>
      </div>

      {/* PAINEL DE ATRIBUIÇÃO DE ROI (ADS -> CRM -> CONSULTAS) */}
      {(googleAccount !== null || metaAccount !== null) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* GOOGLE ADS CARD (FUNIL) */}
            {googleAccount !== null && (
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col hover:border-blue-300 transition-colors">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                      <div className="flex items-center gap-3">
                         <div className="p-2 bg-white rounded-xl shadow-sm"><GoogleIcon size={24} /></div>
                         <div>
                            <span className="font-bold text-navy text-sm block">Google Ads</span>
                            <span className="text-[10px] text-slate-400 font-medium">Funil de Aquisição</span>
                         </div>
                      </div>
                  </div>
                  
                  <div className="p-6 flex-1 flex flex-col gap-6">
                      {/* FUNIL VISUAL */}
                      <div className="space-y-4">
                          {/* TOPO: Investimento */}
                          <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                 <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600"><DollarSign size={16}/></div>
                                 <span className="text-xs font-bold text-slate-600">Investimento</span>
                              </div>
                              <span className="text-sm font-black text-navy">R$ {adPerformanceData.google.spend.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</span>
                          </div>
                          
                          <div className="flex justify-center"><ArrowDown size={14} className="text-slate-300"/></div>
    
                          {/* MEIO: Leads */}
                          <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                 <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600"><Users size={16}/></div>
                                 <div>
                                    <span className="text-xs font-bold text-slate-600 block">Leads (CRM)</span>
                                    <span className="text-[9px] text-slate-400 uppercase font-medium">CPL: R$ {adPerformanceData.google.cpl.toFixed(2)}</span>
                                 </div>
                              </div>
                              <span className="text-xl font-black text-navy">{adPerformanceData.google.leads}</span>
                          </div>
    
                          <div className="flex justify-center"><ArrowDown size={14} className="text-slate-300"/></div>
    
                          {/* FUNDO: Consultas (Objetivo Final) */}
                          <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                              <div className="flex items-center gap-2">
                                 <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600"><Calendar size={16}/></div>
                                 <div>
                                    <span className="text-xs font-bold text-emerald-800 block">Consultas Marcadas</span>
                                    <span className="text-[9px] text-emerald-600 uppercase font-bold">CPA: R$ {adPerformanceData.google.cpa.toFixed(2)}</span>
                                 </div>
                              </div>
                              <span className="text-2xl font-black text-emerald-700">{adPerformanceData.google.appointments}</span>
                          </div>
                      </div>
    
                      <div className="border-t border-slate-100 pt-4 mt-auto">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1"><Target size={12}/> Melhor Criativo</h4>
                        <div className="flex gap-4 items-center group cursor-pointer" onClick={() => setSelectedAd(adPerformanceData.google.topAd)}>
                            <img src={adPerformanceData.google.topAd.imageUrl} alt="Ad" className="w-16 h-16 object-cover rounded-lg shadow-sm" />
                            <div>
                                <p className="text-xs font-bold text-navy line-clamp-1">{adPerformanceData.google.topAd.headline}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">Gerou <span className="font-bold text-blue-600">{adPerformanceData.google.topAd.generatedLeads} leads</span> qualificados</p>
                            </div>
                        </div>
                      </div>
                  </div>
              </div>
            )}
  
            {/* META ADS CARD (FUNIL) */}
            {metaAccount !== null && (
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col hover:border-blue-300 transition-colors">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                      <div className="flex items-center gap-3">
                         <div className="p-2 bg-white rounded-xl shadow-sm"><MetaIcon size={24} /></div>
                         <div>
                            <span className="font-bold text-navy text-sm block">Meta Ads</span>
                            <span className="text-[10px] text-slate-400 font-medium">Instagram & Facebook</span>
                         </div>
                      </div>
                  </div>
                  
                  <div className="p-6 flex-1 flex flex-col gap-6">
                       {/* FUNIL VISUAL */}
                      <div className="space-y-4">
                          {/* TOPO: Investimento */}
                          <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                 <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600"><DollarSign size={16}/></div>
                                 <span className="text-xs font-bold text-slate-600">Investimento</span>
                              </div>
                              <span className="text-sm font-black text-navy">R$ {adPerformanceData.meta.spend.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</span>
                          </div>
                          
                          <div className="flex justify-center"><ArrowDown size={14} className="text-slate-300"/></div>
    
                          {/* MEIO: Leads */}
                          <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                 <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600"><Users size={16}/></div>
                                 <div>
                                    <span className="text-xs font-bold text-slate-600 block">Leads (CRM)</span>
                                    <span className="text-[9px] text-slate-400 uppercase font-medium">CPL: R$ {adPerformanceData.meta.cpl.toFixed(2)}</span>
                                 </div>
                              </div>
                              <span className="text-xl font-black text-navy">{adPerformanceData.meta.leads}</span>
                          </div>
    
                          <div className="flex justify-center"><ArrowDown size={14} className="text-slate-300"/></div>
    
                          {/* FUNDO: Consultas (Objetivo Final) */}
                          <div className="flex justify-between items-center p-3 bg-blue-50 rounded-xl border border-blue-100">
                              <div className="flex items-center gap-2">
                                 <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600"><Calendar size={16}/></div>
                                 <div>
                                    <span className="text-xs font-bold text-blue-800 block">Consultas Marcadas</span>
                                    <span className="text-[9px] text-blue-600 uppercase font-bold">CPA: R$ {adPerformanceData.meta.cpa.toFixed(2)}</span>
                                 </div>
                              </div>
                              <span className="text-2xl font-black text-blue-700">{adPerformanceData.meta.appointments}</span>
                          </div>
                      </div>
    
                      <div className="border-t border-slate-100 pt-4 mt-auto">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1"><Target size={12}/> Melhor Criativo</h4>
                        <div className="flex gap-4 items-center group cursor-pointer" onClick={() => setSelectedAd(adPerformanceData.meta.topAd)}>
                            <img src={adPerformanceData.meta.topAd.imageUrl} alt="Ad" className="w-16 h-16 object-cover rounded-lg shadow-sm" />
                            <div>
                                <p className="text-xs font-bold text-navy line-clamp-1">{adPerformanceData.meta.topAd.headline}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">Gerou <span className="font-bold text-blue-600">{adPerformanceData.meta.topAd.generatedLeads} leads</span> qualificados</p>
                            </div>
                        </div>
                      </div>
                  </div>
              </div>
            )}
        </div>
      )}

      {/* CARD: LEADS DE FORMULÁRIO META ADS (INSTANT FORMS) */}
      {(metaAccount !== null || metaLeadForms.length > 0) && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col hover:border-blue-300 transition-colors">
          <div className="p-6 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white rounded-xl shadow-sm border border-slate-100">
                <MetaIcon size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-navy text-sm">Leads de Formulários Nativos Meta Ads</h3>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-100/50 px-2 py-0.5 rounded-full border border-emerald-100">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Webhook Ativo
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                  Instant Forms capturados em tempo real no Instagram/Facebook e sincronizados com o CRM
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={fetchMetaLeads}
                disabled={loadingMetaLeads}
                className="p-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl transition-all shadow-sm flex items-center gap-1.5 text-xs font-bold"
                title="Atualizar lista de leads"
              >
                <RefreshCw size={14} className={loadingMetaLeads ? 'animate-spin text-blue-600' : ''} />
                <span className="hidden sm:inline">Atualizar</span>
              </button>

              {metaLeadForms.length > 0 && (
                <button
                  onClick={() => setShowAllMetaLeadsModal(true)}
                  className="px-3.5 py-2 bg-navy hover:bg-slate-800 text-white rounded-xl transition-colors text-xs font-bold shadow-sm flex items-center gap-1.5"
                >
                  <span>Ver todos ({metaLeadForms.length})</span>
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="p-6">
            {loadingMetaLeads && metaLeadForms.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center text-center">
                <RefreshCw size={24} className="animate-spin text-blue-600 mb-2" />
                <p className="text-xs text-slate-500 font-medium">Buscando leads de formulários do Meta Ads...</p>
              </div>
            ) : metaLeadForms.length === 0 ? (
              <div className="py-8 px-4 rounded-2xl bg-slate-50/70 border border-dashed border-slate-200 text-center flex flex-col items-center justify-center">
                <div className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center text-slate-400 mb-3">
                  <Megaphone size={22} className="text-blue-500" />
                </div>
                <h4 className="text-sm font-bold text-navy mb-1">Nenhum lead de formulário recebido ainda</h4>
                <p className="text-xs text-slate-500 max-w-md mb-4">
                  Assim que um lead preencher um formulário nativo (Instant Form) no seu anúncio do Facebook ou Instagram, ele será capturado instantaneamente aqui e enviado ao CRM.
                </p>
                <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                  <Check size={14} className="text-emerald-500" />
                  Inscrição Webhook configurada para eventos <code className="text-blue-600 bg-blue-50 px-1 rounded">leadgen</code>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3.5 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Total Capturados</p>
                      <p className="text-xl font-black text-navy">{metaLeadForms.length}</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-blue-500 text-white flex items-center justify-center font-bold text-xs">
                      <Users size={16} />
                    </div>
                  </div>
                  <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3.5 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Sincronizados CRM</p>
                      <p className="text-xl font-black text-navy">
                        {metaLeadForms.filter(f => f.lead_id || f.lead).length}
                      </p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center font-bold text-xs">
                      <Check size={16} />
                    </div>
                  </div>
                  <div className="bg-purple-50/60 border border-purple-100 rounded-xl p-3.5 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-purple-600 uppercase tracking-wider">Última Captura</p>
                      <p className="text-xs font-bold text-navy mt-1">
                        {timeAgo(metaLeadForms[0]?.created_time || metaLeadForms[0]?.created_at || '')}
                      </p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-purple-500 text-white flex items-center justify-center font-bold text-xs">
                      <CalendarCheck size={16} />
                    </div>
                  </div>
                </div>

                {/* Lista dos 5 leads mais recentes */}
                <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden">
                  {metaLeadForms.slice(0, 5).map((item) => {
                    const fields = item.field_data || [];
                    const getVal = (k: string) => {
                      const f = fields.find(x => x.name && x.name.toLowerCase().includes(k.toLowerCase()));
                      return f && Array.isArray(f.values) && f.values.length > 0 ? f.values[0] : '';
                    };
                    const name = item.lead?.name || getVal('full_name') || getVal('nome') || getVal('first_name') || 'Lead Meta Ads';
                    const phone = item.lead?.phone || getVal('phone') || getVal('telefone') || getVal('celular') || getVal('whats') || '';
                    const email = item.lead?.email || getVal('email') || '';
                    const city = getVal('city') || getVal('cidade') || '';

                    return (
                      <div 
                        key={item.id || item.leadgen_id} 
                        className="p-4 bg-white hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold text-sm shrink-0">
                            {name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-navy text-sm">{name}</span>
                              <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                {timeAgo(item.created_time || item.created_at || '')}
                              </span>
                              {city && (
                                <span className="text-[10px] font-medium text-slate-500">
                                  • {city}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                              {phone && (
                                <span className="flex items-center gap-1 font-mono text-[11px] text-slate-600">
                                  📞 {phone}
                                </span>
                              )}
                              {email && (
                                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                                  ✉️ {email}
                                </span>
                              )}
                              {item.form_id && (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  Form ID: {item.form_id}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <button
                            onClick={() => setSelectedLeadDetail(item)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
                          >
                            Respostas
                          </button>
                          <button
                            onClick={() => navigateToSection(AppSection.VENDAS)}
                            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-bold rounded-lg transition-colors flex items-center gap-1"
                          >
                            <span>No CRM</span>
                            <ExternalLink size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: VER TODOS OS LEADS DE FORMULÁRIOS */}
      {showAllMetaLeadsModal && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-navy/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setShowAllMetaLeadsModal(false)}
        >
          <div 
            className="bg-white rounded-3xl overflow-hidden max-w-4xl w-full shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white rounded-xl shadow-sm border border-slate-100">
                  <MetaIcon size={24} />
                </div>
                <div>
                  <h3 className="font-black text-navy text-lg">Leads de Formulários Meta Ads</h3>
                  <p className="text-xs text-slate-500">Histórico completo de leads capturados via Instant Forms</p>
                </div>
              </div>
              <button 
                onClick={() => setShowAllMetaLeadsModal(false)}
                className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Busca */}
            <div className="p-4 border-b border-slate-100 bg-white">
              <input
                type="text"
                placeholder="Buscar por nome, telefone, e-mail ou Form ID..."
                value={leadSearchQuery}
                onChange={e => setLeadSearchQuery(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Tabela de Leads */}
            <div className="p-6 overflow-y-auto flex-1 divide-y divide-slate-100">
              {metaLeadForms
                .filter(item => {
                  if (!leadSearchQuery.trim()) return true;
                  const q = leadSearchQuery.toLowerCase();
                  const fields = item.field_data || [];
                  const anyFieldMatch = fields.some(f => 
                    f.name?.toLowerCase().includes(q) || 
                    (Array.isArray(f.values) && f.values.some(v => String(v).toLowerCase().includes(q)))
                  );
                  return (
                    (item.lead?.name && item.lead.name.toLowerCase().includes(q)) ||
                    (item.lead?.email && item.lead.email.toLowerCase().includes(q)) ||
                    (item.lead?.phone && item.lead.phone.toLowerCase().includes(q)) ||
                    (item.form_id && String(item.form_id).includes(q)) ||
                    (item.leadgen_id && String(item.leadgen_id).includes(q)) ||
                    anyFieldMatch
                  );
                })
                .map(item => {
                  const fields = item.field_data || [];
                  const getVal = (k: string) => {
                    const f = fields.find(x => x.name && x.name.toLowerCase().includes(k.toLowerCase()));
                    return f && Array.isArray(f.values) && f.values.length > 0 ? f.values[0] : '';
                  };
                  const name = item.lead?.name || getVal('full_name') || getVal('nome') || getVal('first_name') || 'Lead Meta Ads';
                  const phone = item.lead?.phone || getVal('phone') || getVal('telefone') || getVal('celular') || getVal('whats') || '';
                  const email = item.lead?.email || getVal('email') || '';

                  return (
                    <div key={item.id || item.leadgen_id} className="py-3.5 flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-navy text-sm">{name}</span>
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                            {timeAgo(item.created_time || item.created_at || '')}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                          {phone && <span className="font-mono text-slate-600">📞 {phone}</span>}
                          {email && <span>✉️ {email}</span>}
                          {item.form_id && <span className="text-slate-400 font-mono text-[10px]">Form: {item.form_id}</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setSelectedLeadDetail(item)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
                        >
                          Ver Respostas
                        </button>
                        <button
                          onClick={() => {
                            setShowAllMetaLeadsModal(false);
                            navigateToSection(AppSection.VENDAS);
                          }}
                          className="px-3 py-1.5 bg-navy hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition-colors"
                        >
                          Abrir CRM
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DETALHES DAS RESPOSTAS DO FORMULÁRIO */}
      {selectedLeadDetail && (
        <div 
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-navy/90 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelectedLeadDetail(null)}
        >
          <div 
            className="bg-white rounded-3xl overflow-hidden max-w-lg w-full shadow-2xl animate-in zoom-in-95"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="font-black text-navy text-base">Campos do Formulário Instantâneo</h3>
                <p className="text-[11px] text-slate-400">Lead ID: {selectedLeadDetail.leadgen_id}</p>
              </div>
              <button 
                onClick={() => setSelectedLeadDetail(null)}
                className="p-1.5 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
              {Array.isArray(selectedLeadDetail.field_data) && selectedLeadDetail.field_data.length > 0 ? (
                selectedLeadDetail.field_data.map((f, idx) => (
                  <div key={idx} className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{f.name}</p>
                    <p className="text-sm font-semibold text-navy mt-0.5">
                      {Array.isArray(f.values) ? f.values.join(', ') : String(f.values || '—')}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">Nenhum campo personalizado registrado.</p>
              )}

              {selectedLeadDetail.created_time && (
                <div className="text-[10px] text-slate-400 pt-2 text-right">
                  Recebido em: {new Date(selectedLeadDetail.created_time).toLocaleString('pt-BR')}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/50">
              <button
                onClick={() => setSelectedLeadDetail(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl transition-colors"
              >
                Fechar
              </button>
              <button
                onClick={() => {
                  setSelectedLeadDetail(null);
                  setShowAllMetaLeadsModal(false);
                  navigateToSection(AppSection.VENDAS);
                }}
                className="px-4 py-2 bg-navy hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors"
              >
                Ir para o CRM
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AD PREVIEW MODAL */}
      {selectedAd && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-navy/90 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setSelectedAd(null)}>
              <div className="bg-white rounded-2xl overflow-hidden max-w-2xl w-full shadow-2xl animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                  <div className="relative">
                      <img src={selectedAd.imageUrl} alt="Full Ad" className="w-full max-h-[60vh] object-contain bg-black" />
                      <button onClick={() => setSelectedAd(null)} className="absolute top-4 right-4 bg-black/50 hover:bg-black text-white p-2 rounded-full transition-colors"><X size={20} /></button>
                  </div>
                  <div className="p-6">
                      <h3 className="text-lg font-bold text-navy mb-2">{selectedAd.headline}</h3>
                      <p className="text-sm text-slate-500 mb-4">Campanha: {selectedAd.name}</p>
                      <div className="flex gap-4 border-t border-slate-100 pt-4">
                          <div className="text-center flex-1">
                              <p className="text-2xl font-black text-navy">{selectedAd.generatedLeads}</p>
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Leads Gerados</p>
                          </div>
                          <div className="text-center flex-1 border-l border-slate-100">
                              <button className="w-full h-full flex items-center justify-center gap-2 text-blue-600 font-bold text-sm hover:bg-blue-50 rounded-lg transition-colors">
                                  Ver na Plataforma <ExternalLink size={16} />
                              </button>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default Dashboard;
