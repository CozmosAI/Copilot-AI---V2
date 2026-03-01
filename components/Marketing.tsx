
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Instagram, DollarSign, TrendingUp, Bot, Users, Target, MousePointer2, Eye,
  Filter, Loader2, Zap, AlertCircle, LayoutDashboard, Layers, Grid, Type, MessageSquare,
  ArrowUpRight, ArrowDownRight, Search, ChevronDown, ChevronUp, X, Plus, Trash2, Calculator, Save
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Brush, ComposedChart, Bar
} from 'recharts';
import { useApp } from '../App';
import { 
    getGoogleCampaigns, getGoogleOverview, getGoogleAdGroups, getGoogleKeywords, getGoogleAds 
} from '../services/googleAdsService';

// --- TYPES ---
type BaseMetricType = 'clicks' | 'impressions' | 'spend' | 'conversions' | 'conversionsValue';
type MetricType = BaseMetricType | string;
type MetricFormat = 'number' | 'currency' | 'percent';
type MetricOperator = '/' | '*' | '+' | '-';

interface CustomMetric {
    id: string;
    name: string;
    numerator: BaseMetricType;
    operator: MetricOperator;
    denominator: BaseMetricType;
    multiplier?: number;
    format: MetricFormat;
    color: string;
}

type SortConfig = { key: string; direction: 'asc' | 'desc' } | null;

const PREBUILT_METRICS: CustomMetric[] = [
    { id: 'roas', name: 'ROAS', numerator: 'conversionsValue', operator: '/', denominator: 'spend', format: 'currency', color: '#10b981' },
    { id: 'convRate', name: 'Taxa de Conv.', numerator: 'conversions', operator: '/', denominator: 'clicks', multiplier: 100, format: 'percent', color: '#f59e0b' },
    { id: 'cpm', name: 'CPM', numerator: 'spend', operator: '/', denominator: 'impressions', multiplier: 1000, format: 'currency', color: '#6366f1' },
    { id: 'valuePerClick', name: 'Valor/Clique', numerator: 'conversionsValue', operator: '/', denominator: 'clicks', format: 'currency', color: '#ec4899' }
];

const DEFAULT_METRIC_STYLES: Record<string, { label: string, color: string, axisId: string, strokeDasharray: string }> = {
    clicks: { label: 'Cliques', color: '#3b82f6', axisId: 'left', strokeDasharray: '0' }, // Blue
    impressions: { label: 'Impressões', color: '#a855f7', axisId: 'right', strokeDasharray: '0' }, // Purple
    spend: { label: 'Custo', color: '#22c55e', axisId: 'left', strokeDasharray: '0' }, // Green
    conversions: { label: 'Conversões', color: '#f97316', axisId: 'right', strokeDasharray: '0' }, // Orange
    conversionsValue: { label: 'Valor Conv.', color: '#ef4444', axisId: 'left', strokeDasharray: '0' } // Red
};

const Marketing: React.FC = () => {
  const { dateFilter, setCustomDateRange, googleAdsToken, metrics, user } = useApp();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'adgroups' | 'keywords' | 'ads'>('overview');
  
  // Data States
  const [overviewData, setOverviewData] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [adGroups, setAdGroups] = useState<any[]>([]);
  const [keywords, setKeywords] = useState<any[]>([]);
  const [ads, setAds] = useState<any[]>([]);
  
  // Filters & UI State
  const [selectedMetrics, setSelectedMetrics] = useState<MetricType[]>(['clicks', 'spend']);
  const [globalCampaignFilter, setGlobalCampaignFilter] = useState<string>(''); // ID da campanha
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  
  // Custom Metrics State
  const [customMetrics, setCustomMetrics] = useState<CustomMetric[]>(() => {
      const saved = localStorage.getItem('googleAds_customMetrics');
      return saved ? JSON.parse(saved) : PREBUILT_METRICS;
  });
  const [isMetricModalOpen, setIsMetricModalOpen] = useState(false);
  const [newMetric, setNewMetric] = useState<Partial<CustomMetric>>({
      name: '',
      numerator: 'clicks',
      operator: '/',
      denominator: 'impressions',
      multiplier: 1,
      format: 'number',
      color: '#000000'
  });

  // Chart Customization State
  const [metricStyles, setMetricStyles] = useState(DEFAULT_METRIC_STYLES);

  // Update metric styles when custom metrics change
  useEffect(() => {
      const newStyles = { ...DEFAULT_METRIC_STYLES };
      customMetrics.forEach(m => {
          newStyles[m.id] = {
              label: m.name,
              color: m.color,
              axisId: m.format === 'percent' || m.numerator === 'impressions' ? 'right' : 'left',
              strokeDasharray: '0'
          };
      });
      setMetricStyles(newStyles);
      localStorage.setItem('googleAds_customMetrics', JSON.stringify(customMetrics));
  }, [customMetrics]);

  const lastFetchRef = useRef<{start: string, end: string, campaignId: string} | null>(null);
  const isConnected = !!googleAdsToken;

  // --- METRIC CALCULATION ---
  const calculateMetricValue = (metric: CustomMetric, dataPoint: any) => {
      const num = dataPoint[metric.numerator] || 0;
      const den = dataPoint[metric.denominator] || 0;
      let result = 0;

      switch (metric.operator) {
          case '/': result = den !== 0 ? num / den : 0; break;
          case '*': result = num * den; break;
          case '+': result = num + den; break;
          case '-': result = num - den; break;
      }

      if (metric.multiplier) result *= metric.multiplier;
      return result;
  };

  const formatMetricValue = (val: number, format: MetricFormat) => {
      if (format === 'currency') return `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      if (format === 'percent') return `${val.toFixed(2)}%`;
      return val.toLocaleString('pt-BR');
  };

  const handleSaveMetric = () => {
      if (!newMetric.name || !newMetric.numerator || !newMetric.denominator) return;
      
      const id = `custom_${Date.now()}`;
      const metric: CustomMetric = {
          id,
          name: newMetric.name!,
          numerator: newMetric.numerator!,
          operator: newMetric.operator as MetricOperator || '/',
          denominator: newMetric.denominator!,
          multiplier: newMetric.multiplier,
          format: newMetric.format as MetricFormat || 'number',
          color: newMetric.color || '#000000'
      };

      setCustomMetrics(prev => [...prev, metric]);
      setIsMetricModalOpen(false);
      setNewMetric({ name: '', numerator: 'clicks', operator: '/', denominator: 'impressions', multiplier: 1, format: 'number', color: '#000000' });
  };

  const handleDeleteMetric = (id: string) => {
      setCustomMetrics(prev => prev.filter(m => m.id !== id));
      setSelectedMetrics(prev => prev.filter(m => m !== id));
  };

  // --- BUDGET CALCULATION ---
  const getDaysDifference = (start: string, end: string) => {
      const startDate = new Date(start);
      const endDate = new Date(end);
      const timeDiff = Math.abs(endDate.getTime() - startDate.getTime());
      return Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1;
  };

  const daysInPeriod = useMemo(() => getDaysDifference(dateFilter.start, dateFilter.end), [dateFilter]);
  
  const budgetMetrics = useMemo(() => {
      // Filter campaigns if global filter is active
      const activeCampaigns = globalCampaignFilter 
          ? campaigns.filter(c => c.id.toString() === globalCampaignFilter)
          : campaigns;

      const totalDailyBudget = activeCampaigns.reduce((acc, c) => acc + (c.budget || 0), 0);
      const totalPeriodBudget = totalDailyBudget * daysInPeriod;
      
      // Calculate total spend from the campaigns data (which is already filtered by date in backend)
      const totalSpend = activeCampaigns.reduce((acc, c) => acc + (c.spend || 0), 0);
      
      const progress = totalPeriodBudget > 0 ? (totalSpend / totalPeriodBudget) * 100 : 0;
      
      return { totalPeriodBudget, totalSpend, progress };
  }, [campaigns, globalCampaignFilter, daysInPeriod]);

  // --- FETCH DATA ---
  useEffect(() => {
    const fetchGoogleData = async () => {
        if (isConnected && user && dateFilter.start && dateFilter.end) {
            // Prevent duplicate fetch
            if (
                lastFetchRef.current?.start === dateFilter.start && 
                lastFetchRef.current?.end === dateFilter.end &&
                lastFetchRef.current?.campaignId === globalCampaignFilter
            ) {
                return;
            }
            lastFetchRef.current = { start: dateFilter.start, end: dateFilter.end, campaignId: globalCampaignFilter };

            setLoading(true);
            try {
                // Se tiver filtro global, passamos o ID para o overview para filtrar no backend
                // Para as outras tabelas, filtramos no frontend pois já temos os dados (ou poderíamos filtrar no backend também se fosse muito dado)
                // Aqui vamos buscar tudo e filtrar no frontend para tabelas, mas overview buscamos específico para ter o gráfico correto diário
                
                const [ov, cp, ag, kw, ad] = await Promise.all([
                    getGoogleOverview(user.id, dateFilter, globalCampaignFilter),
                    getGoogleCampaigns(user.id, dateFilter),
                    getGoogleAdGroups(user.id, dateFilter),
                    getGoogleKeywords(user.id, dateFilter),
                    getGoogleAds(user.id, dateFilter)
                ]);
                
                setOverviewData(ov.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()));
                setCampaigns(cp);
                setAdGroups(ag);
                setKeywords(kw);
                setAds(ad);
            } catch (error) {
                console.error("Erro ao buscar dados:", error);
            } finally {
                setLoading(false);
            }
        }
    };
    
    const timeoutId = setTimeout(fetchGoogleData, 500);
    return () => clearTimeout(timeoutId);
  }, [isConnected, user, dateFilter.start, dateFilter.end, globalCampaignFilter]);

  // --- FILTERED DATA (FRONTEND) ---
  const selectedCampaign = campaigns.find(c => c.id.toString() === globalCampaignFilter);
  const campaignType = selectedCampaign?.type || ''; // PERFORMANCE_MAX, SEARCH, DISPLAY, VIDEO, etc.

  const filteredCampaigns = globalCampaignFilter 
      ? campaigns.filter(c => c.id.toString() === globalCampaignFilter)
      : campaigns;

  const filteredAdGroups = useMemo(() => {
      let data = adGroups;
      if (globalCampaignFilter) {
          const campName = campaigns.find(c => c.id.toString() === globalCampaignFilter)?.name;
          if (campName) data = data.filter(ag => ag.campaignName === campName);
      }
      return data;
  }, [adGroups, globalCampaignFilter, campaigns]);

  const filteredKeywords = useMemo(() => {
      let data = keywords;
      if (globalCampaignFilter) {
          const campName = campaigns.find(c => c.id.toString() === globalCampaignFilter)?.name;
          if (campName) data = data.filter(kw => kw.campaignName === campName);
      }
      return data;
  }, [keywords, globalCampaignFilter, campaigns]);

  const filteredAds = useMemo(() => {
      let data = ads;
      if (globalCampaignFilter) {
          const campName = campaigns.find(c => c.id.toString() === globalCampaignFilter)?.name;
          if (campName) data = data.filter(ad => ad.campaignName === campName);
      }
      return data;
  }, [ads, globalCampaignFilter, campaigns]);

  // --- HELPER FUNCTIONS ---
  const formatCurrency = (val: number) => `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const formatNumber = (val: number) => val.toLocaleString('pt-BR');
  const formatPercent = (val: number) => `${val.toFixed(2)}%`;

  const toggleMetric = (metric: MetricType) => {
      setSelectedMetrics(prev => 
          prev.includes(metric) ? prev.filter(m => m !== metric) : [...prev, metric]
      );
  };

  const handleSort = (key: string) => {
      setSortConfig(current => {
          if (current?.key === key) {
              return current.direction === 'asc' ? { key, direction: 'desc' } : null;
          }
          return { key, direction: 'asc' };
      });
  };

  const updateMetricStyle = (metric: MetricType, field: 'color' | 'strokeDasharray', value: string) => {
      setMetricStyles(prev => ({
          ...prev,
          [metric]: { ...prev[metric], [field]: value }
      }));
  };

  const sortData = (data: any[]) => {
      if (!sortConfig) return data;
      return [...data].sort((a, b) => {
          if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
          if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
      });
  };

  // --- RENDERERS ---
  const renderSortIcon = (key: string) => {
      if (sortConfig?.key !== key) return <div className="w-3 h-3 ml-1 opacity-20"><ChevronDown size={12}/></div>;
      return sortConfig.direction === 'asc' ? <ChevronUp size={12} className="ml-1 text-navy"/> : <ChevronDown size={12} className="ml-1 text-navy"/>;
  };

  const renderStatusBadge = (status: string) => {
      const config: any = {
          'ENABLED': { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Ativo' },
          'PAUSED': { bg: 'bg-amber-50', text: 'text-amber-600', label: 'Pausado' },
          'REMOVED': { bg: 'bg-rose-50', text: 'text-rose-600', label: 'Removido' }
      };
      const style = config[status] || { bg: 'bg-slate-100', text: 'text-slate-500', label: status };
      return <span className={`text-[9px] font-bold px-2 py-1 rounded-full uppercase ${style.bg} ${style.text}`}>{style.label}</span>;
  };

  // --- TOTALS CALCULATION ---
  const calculateTotals = (data: any[]) => {
      const totals = data.reduce((acc, curr) => ({
          impressions: acc.impressions + (curr.impressions || 0),
          clicks: acc.clicks + (curr.clicks || 0),
          spend: acc.spend + (curr.spend || 0),
          conversions: acc.conversions + (curr.conversions || 0),
          conversionsValue: acc.conversionsValue + (curr.conversionsValue || 0),
      }), { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionsValue: 0 });

      return {
          ...totals,
          ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
          cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
          costPerConv: totals.conversions > 0 ? totals.spend / totals.conversions : 0
      };
  };

  const processedOverviewData = useMemo(() => {
      return overviewData.map(day => {
          const enhancedDay = { ...day };
          customMetrics.forEach(metric => {
              enhancedDay[metric.id] = calculateMetricValue(metric, day);
          });
          return enhancedDay;
      });
  }, [overviewData, customMetrics]);

  const periodTotals = useMemo(() => calculateTotals(overviewData), [overviewData]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {/* HEADER */}
      <header className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
            <h2 className="text-2xl font-semibold text-navy tracking-tight">Google Ads</h2>
            <div className="flex items-center gap-2 mt-1">
                {isConnected ? (
                <span className="bg-emerald-50 text-emerald-700 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-emerald-100 flex items-center gap-1"><Zap size={8} fill="currentColor"/> Conectado</span>
                ) : (
                    <span className="bg-amber-50 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-amber-100 flex items-center gap-1"><AlertCircle size={8} /> Desconectado</span>
                )}
            </div>
            </div>
            
            <div className="flex items-center space-x-2 bg-white p-1.5 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-2 px-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:inline">Período:</span>
                    <input 
                        type="date" 
                        value={dateFilter.start} 
                        onChange={(e) => setCustomDateRange(e.target.value, dateFilter.end)}
                        className="text-[10px] font-bold text-navy bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-navy transition-colors cursor-pointer"
                    />
                    <span className="text-[10px] text-slate-300 font-bold">-</span>
                    <input 
                        type="date" 
                        value={dateFilter.end} 
                        onChange={(e) => setCustomDateRange(dateFilter.start, e.target.value)}
                        className="text-[10px] font-bold text-navy bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-navy transition-colors cursor-pointer"
                    />
                </div>
            </div>
        </div>

        {/* GLOBAL CAMPAIGN FILTER */}
        <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200 w-full md:w-fit">
            <div className="p-2 bg-slate-50 rounded-lg text-slate-400"><Filter size={16}/></div>
            <select 
                value={globalCampaignFilter}
                onChange={(e) => setGlobalCampaignFilter(e.target.value)}
                className="bg-transparent text-sm font-medium text-navy focus:outline-none w-full md:min-w-[300px]"
            >
                <option value="">Todas as Campanhas</option>
                {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                ))}
            </select>
            {globalCampaignFilter && (
                <button onClick={() => setGlobalCampaignFilter('')} className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-rose-500">
                    <X size={14}/>
                </button>
            )}
        </div>
      </header>

      {/* TABS */}
      <div className="flex overflow-x-auto pb-2 gap-2 border-b border-slate-200">
          {[
              { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard },
              { id: 'campaigns', label: 'Campanhas', icon: Layers },
              { id: 'adgroups', label: 'Grupos de Anúncios', icon: Grid },
              { id: 'keywords', label: 'Palavras-chave', icon: Type },
              { id: 'ads', label: 'Anúncios', icon: MessageSquare },
          ].map(tab => (
              <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${activeTab === tab.id ? 'bg-white border-x border-t border-slate-200 text-navy -mb-[1px] z-10' : 'text-slate-400 hover:text-navy hover:bg-slate-50'}`}
              >
                  <tab.icon size={14} />
                  {tab.label}
              </button>
          ))}
      </div>

      {loading ? (
        <div className="h-96 flex flex-col items-center justify-center gap-4 bg-white rounded-2xl border border-slate-200">
          <Loader2 size={32} className="text-navy animate-spin" />
          <p className="text-[10px] font-bold text-navy uppercase tracking-widest">Carregando dados do Google Ads...</p>
        </div>
      ) : (
        <div className="space-y-6">
            
            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
                <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                        {[
                            { label: 'Custo', value: formatCurrency(calculateTotals(overviewData).spend), icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50' },
                            { label: 'Cliques', value: formatNumber(calculateTotals(overviewData).clicks), icon: MousePointer2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
                            { label: 'Impressões', value: formatNumber(calculateTotals(overviewData).impressions), icon: Eye, color: 'text-purple-600', bg: 'bg-purple-50' },
                            { label: 'CTR', value: formatPercent(calculateTotals(overviewData).ctr), icon: Target, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                            { label: 'CPC Médio', value: formatCurrency(calculateTotals(overviewData).cpc), icon: TrendingUp, color: 'text-amber-600', bg: 'bg-amber-50' },
                            { label: 'Conversões', value: formatNumber(calculateTotals(overviewData).conversions), icon: Zap, color: 'text-rose-600', bg: 'bg-rose-50' },
                            { label: 'Custo/Conv.', value: formatCurrency(calculateTotals(overviewData).costPerConv), icon: DollarSign, color: 'text-cyan-600', bg: 'bg-cyan-50' },
                        ].map((kpi, idx) => (
                            <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between h-24">
                                <div className="flex justify-between items-start">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{kpi.label}</span>
                                    <div className={`p-1.5 rounded-lg ${kpi.bg} ${kpi.color}`}><kpi.icon size={12} /></div>
                                </div>
                                <p className="text-sm font-black text-navy">{kpi.value}</p>
                            </div>
                        ))}
                    </div>

                    {/* BUDGET PANEL */}
                    <div className={`bg-white p-6 rounded-2xl border shadow-sm mb-6 ${budgetMetrics.progress > 95 ? 'border-rose-200 ring-1 ring-rose-100' : budgetMetrics.progress > 80 ? 'border-amber-200 ring-1 ring-amber-100' : 'border-slate-200'}`}>
                        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-xl ${budgetMetrics.progress > 95 ? 'bg-rose-100 text-rose-600' : budgetMetrics.progress > 80 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                    <DollarSign size={24} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-navy uppercase tracking-widest mb-1">Orçamento do Período</h3>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-2xl font-black text-navy">{formatCurrency(budgetMetrics.totalSpend)}</span>
                                        <span className="text-xs font-bold text-slate-400">de {formatCurrency(budgetMetrics.totalPeriodBudget)} previstos</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex-1 w-full max-w-md">
                                <div className="flex justify-between text-xs font-bold mb-2">
                                    <span className={budgetMetrics.progress > 95 ? 'text-rose-600' : 'text-slate-500'}>
                                        {formatPercent(budgetMetrics.progress)} consumido
                                    </span>
                                    {budgetMetrics.progress > 95 && <span className="text-rose-600 flex items-center gap-1"><AlertCircle size={12}/> Orçamento quase esgotado</span>}
                                </div>
                                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-500 ${budgetMetrics.progress > 95 ? 'bg-rose-500' : budgetMetrics.progress > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                        style={{ width: `${Math.min(budgetMetrics.progress, 100)}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CHART */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
                            <h3 className="text-sm font-bold text-navy uppercase tracking-widest">Desempenho no Período</h3>
                            <div className="flex flex-wrap gap-3 items-center">
                                {Object.entries(metricStyles).map(([key, style]) => (
                                    <div key={key} className={`flex items-center gap-2 p-1.5 rounded-lg border transition-all ${selectedMetrics.includes(key as MetricType) ? 'bg-slate-50 border-slate-200' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                                        <button 
                                            onClick={() => toggleMetric(key as MetricType)}
                                            className={`text-[10px] font-bold uppercase transition-colors ${selectedMetrics.includes(key as MetricType) ? 'text-navy' : 'text-slate-400'}`}
                                        >
                                            {style.label}
                                        </button>
                                        
                                        {selectedMetrics.includes(key as MetricType) && (
                                            <div className="flex items-center gap-1 pl-2 border-l border-slate-200">
                                                <div className="relative w-4 h-4 rounded-full overflow-hidden cursor-pointer shadow-sm ring-1 ring-slate-200">
                                                    <input 
                                                        type="color" 
                                                        value={style.color}
                                                        onChange={(e) => updateMetricStyle(key as MetricType, 'color', e.target.value)}
                                                        className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] p-0 border-0 cursor-pointer"
                                                    />
                                                </div>
                                                <select 
                                                    value={style.strokeDasharray}
                                                    onChange={(e) => updateMetricStyle(key as MetricType, 'strokeDasharray', e.target.value)}
                                                    className="text-[8px] bg-transparent border-none focus:ring-0 text-slate-500 cursor-pointer w-12"
                                                >
                                                    <option value="0">Sólida</option>
                                                    <option value="5 5">Tracej.</option>
                                                    <option value="1 1">Pontilh.</option>
                                                </select>
                                            </div>
                                        )}
                                        {/* Delete button for custom metrics */}
                                        {customMetrics.some(m => m.id === key) && (
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDeleteMetric(key); }}
                                                className="ml-1 p-1 text-slate-300 hover:text-rose-500 rounded-full hover:bg-rose-50 transition-colors"
                                                title="Excluir métrica"
                                            >
                                                <Trash2 size={10} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                
                                <button 
                                    onClick={() => setIsMetricModalOpen(true)}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:text-navy hover:border-navy hover:bg-slate-50 transition-colors text-[10px] font-bold uppercase tracking-widest"
                                >
                                    <Plus size={12} /> Criar Métrica
                                </button>
                            </div>
                        </div>
                        <div className="h-96">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={processedOverviewData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis 
                                        dataKey="date" 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fontSize: 10, fill: '#94a3b8' }} 
                                        tickFormatter={(val) => new Date(val).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                        minTickGap={30}
                                    />
                                    <YAxis yAxisId="left" orientation="left" hide />
                                    <YAxis yAxisId="right" orientation="right" hide />
                                    <Tooltip 
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
                                        labelStyle={{ color: '#64748b', fontSize: '11px', fontWeight: 'bold', marginBottom: '8px' }}
                                        formatter={(value: number, name: string) => {
                                            const key = Object.keys(metricStyles).find(k => metricStyles[k].label === name);
                                            if (!key) return [value, name];
                                            
                                            const customMetric = customMetrics.find(m => m.id === key);
                                            if (customMetric) return [formatMetricValue(value, customMetric.format), name];
                                            
                                            if (key === 'spend' || key === 'conversionsValue') return [formatCurrency(value), name];
                                            return [formatNumber(value), name];
                                        }}
                                    />
                                    {selectedMetrics.map(metric => (
                                        <Line
                                            key={metric}
                                            yAxisId={metricStyles[metric].axisId}
                                            type="monotone"
                                            dataKey={metric}
                                            name={metricStyles[metric].label}
                                            stroke={metricStyles[metric].color}
                                            strokeWidth={2}
                                            strokeDasharray={metricStyles[metric].strokeDasharray}
                                            dot={false}
                                            activeDot={{ r: 6, strokeWidth: 0 }}
                                        />
                                    ))}
                                    <Brush dataKey="date" height={30} stroke="#cbd5e1" fill="#f8fafc" tickFormatter={() => ''} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </>
            )}

            {/* CAMPAIGNS TAB */}
            {activeTab === 'campaigns' && (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 border-b border-slate-100">
                                <tr>
                                    {[
                                        { k: 'name', l: 'Campanha' }, { k: 'status', l: 'Status' }, { k: 'type', l: 'Tipo' },
                                        { k: 'impressions', l: 'Impr.' }, { k: 'clicks', l: 'Cliques' }, { k: 'ctr', l: 'CTR' },
                                        { k: 'cpc', l: 'CPC Méd.' }, { k: 'spend', l: 'Custo' }, { k: 'conversions', l: 'Conv.' },
                                        { k: 'convRate', l: 'Taxa Conv.' }, { k: 'costPerConv', l: 'Custo/Conv.' }
                                    ].map(h => (
                                        <th key={h.k} onClick={() => handleSort(h.k)} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:text-navy transition-colors">
                                            <div className="flex items-center">{h.l} {renderSortIcon(h.k)}</div>
                                        </th>
                                    ))}
                                    {customMetrics.map(m => (
                                        <th key={m.id} onClick={() => handleSort(m.id)} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:text-navy transition-colors border-l border-slate-100">
                                            <div className="flex items-center gap-1">
                                                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                                                {m.name} {renderSortIcon(m.id)}
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {sortData(filteredCampaigns).map((c, i) => (
                                    <tr key={i} className="hover:bg-slate-50/50 transition-colors group cursor-pointer" onClick={() => setGlobalCampaignFilter(c.id.toString())}>
                                        <td className="px-6 py-4 text-xs font-bold text-navy group-hover:text-blue-600 transition-colors">{c.name}</td>
                                        <td className="px-6 py-4">{renderStatusBadge(c.status)}</td>
                                        <td className="px-6 py-4 text-[10px] text-slate-500 uppercase">{c.type?.replace('PERFORMANCE_MAX', 'P-MAX')}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(c.impressions)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(c.clicks)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatPercent((c.clicks / c.impressions) * 100 || 0)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatCurrency(c.spend / c.clicks || 0)}</td>
                                        <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(c.spend)}</td>
                                        <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(c.conversions)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatPercent((c.conversions / c.clicks) * 100 || 0)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatCurrency(c.conversions > 0 ? c.spend / c.conversions : 0)}</td>
                                        {customMetrics.map(m => (
                                            <td key={m.id} className="px-6 py-4 text-xs font-bold text-navy border-l border-slate-50">
                                                {formatMetricValue(calculateMetricValue(m, c), m.format)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-slate-50 border-t border-slate-100">
                                <tr>
                                    <td className="px-6 py-4 text-xs font-black text-navy uppercase" colSpan={3}>Totais</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(calculateTotals(filteredCampaigns).impressions)}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(calculateTotals(filteredCampaigns).clicks)}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{formatPercent(calculateTotals(filteredCampaigns).ctr)}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(calculateTotals(filteredCampaigns).cpc)}</td>
                                    <td className="px-6 py-4 text-xs font-black text-navy">{formatCurrency(calculateTotals(filteredCampaigns).spend)}</td>
                                    <td className="px-6 py-4 text-xs font-black text-navy">{formatNumber(calculateTotals(filteredCampaigns).conversions)}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{formatPercent(calculateTotals(filteredCampaigns).clicks > 0 ? (calculateTotals(filteredCampaigns).conversions / calculateTotals(filteredCampaigns).clicks) * 100 : 0)}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(calculateTotals(filteredCampaigns).costPerConv)}</td>
                                    {customMetrics.map(m => (
                                        <td key={m.id} className="px-6 py-4 text-xs font-black text-navy border-l border-slate-100">
                                            {formatMetricValue(calculateMetricValue(m, calculateTotals(filteredCampaigns)), m.format)}
                                        </td>
                                    ))}
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* AD GROUPS TAB */}
            {activeTab === 'adgroups' && (
                <>
                    {campaignType === 'PERFORMANCE_MAX' ? (
                        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-8 text-center">
                            <InfoMessage title="Campanha Performance Max" message="Campanhas P-MAX utilizam 'Grupos de Recursos' em vez de grupos de anúncios tradicionais. A API atual foca na visão consolidada." />
                        </div>
                    ) : (
                        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 border-b border-slate-100">
                                        <tr>
                                            {[
                                                { k: 'name', l: 'Grupo de Anúncios' }, { k: 'campaignName', l: 'Campanha' }, { k: 'status', l: 'Status' },
                                                { k: 'impressions', l: 'Impr.' }, { k: 'clicks', l: 'Cliques' }, { k: 'ctr', l: 'CTR' },
                                                { k: 'cpc', l: 'CPC Méd.' }, { k: 'spend', l: 'Custo' }, { k: 'conversions', l: 'Conv.' },
                                                { k: 'convRate', l: 'Taxa Conv.' }, { k: 'costPerConv', l: 'Custo/Conv.' }
                                            ].map(h => (
                                                <th key={h.k} onClick={() => handleSort(h.k)} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:text-navy transition-colors">
                                                    <div className="flex items-center">{h.l} {renderSortIcon(h.k)}</div>
                                                </th>
                                            ))}
                                            {customMetrics.map(m => (
                                                <th key={m.id} onClick={() => handleSort(m.id)} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:text-navy transition-colors border-l border-slate-100">
                                                    <div className="flex items-center gap-1">
                                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                                                        {m.name} {renderSortIcon(m.id)}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {sortData(filteredAdGroups).map((ag, i) => (
                                            <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="px-6 py-4 text-xs font-bold text-navy">{ag.name}</td>
                                                <td className="px-6 py-4 text-xs text-slate-500">{ag.campaignName}</td>
                                                <td className="px-6 py-4">{renderStatusBadge(ag.status)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(ag.impressions)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(ag.clicks)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatPercent((ag.clicks / ag.impressions) * 100 || 0)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatCurrency(ag.clicks > 0 ? ag.spend / ag.clicks : 0)}</td>
                                                <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(ag.spend)}</td>
                                                <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(ag.conversions)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatPercent((ag.conversions / ag.clicks) * 100 || 0)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatCurrency(ag.conversions > 0 ? ag.spend / ag.conversions : 0)}</td>
                                                {customMetrics.map(m => (
                                                    <td key={m.id} className="px-6 py-4 text-xs font-bold text-navy border-l border-slate-50">
                                                        {formatMetricValue(calculateMetricValue(m, ag), m.format)}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-slate-50 border-t border-slate-100">
                                        <tr>
                                            <td className="px-6 py-4 text-xs font-black text-navy uppercase" colSpan={3}>Totais</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(calculateTotals(filteredAdGroups).impressions)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(calculateTotals(filteredAdGroups).clicks)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatPercent(calculateTotals(filteredAdGroups).ctr)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(calculateTotals(filteredAdGroups).cpc)}</td>
                                            <td className="px-6 py-4 text-xs font-black text-navy">{formatCurrency(calculateTotals(filteredAdGroups).spend)}</td>
                                            <td className="px-6 py-4 text-xs font-black text-navy">{formatNumber(calculateTotals(filteredAdGroups).conversions)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatPercent(calculateTotals(filteredAdGroups).clicks > 0 ? (calculateTotals(filteredAdGroups).conversions / calculateTotals(filteredAdGroups).clicks) * 100 : 0)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(calculateTotals(filteredAdGroups).costPerConv)}</td>
                                            {customMetrics.map(m => (
                                                <td key={m.id} className="px-6 py-4 text-xs font-black text-navy border-l border-slate-100">
                                                    {formatMetricValue(calculateMetricValue(m, calculateTotals(filteredAdGroups)), m.format)}
                                                </td>
                                            ))}
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* KEYWORDS TAB */}
            {activeTab === 'keywords' && (
                <>
                    {campaignType === 'PERFORMANCE_MAX' ? (
                         <div className="bg-blue-50 border border-blue-100 rounded-2xl p-8 text-center">
                            <InfoMessage title="Sinais de Audiência" message="Campanhas P-MAX utilizam sinais de audiência e aprendizado de máquina, não palavras-chave manuais." />
                        </div>
                    ) : campaignType === 'DISPLAY' || campaignType === 'VIDEO' ? (
                        <div className="bg-purple-50 border border-purple-100 rounded-2xl p-8 text-center">
                            <InfoMessage title="Segmentação por Audiência" message="Campanhas de Display e Vídeo focam em segmentos de público-alvo, tópicos e canais." />
                        </div>
                    ) : (
                        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 border-b border-slate-100">
                                        <tr>
                                            {[
                                                { k: 'text', l: 'Palavra-chave' }, { k: 'matchType', l: 'Tipo' }, { k: 'status', l: 'Status' },
                                                { k: 'qualityScore', l: 'Qualidade' }, { k: 'impressions', l: 'Impr.' }, { k: 'clicks', l: 'Cliques' },
                                                { k: 'ctr', l: 'CTR' }, { k: 'cpc', l: 'CPC Méd.' }, { k: 'spend', l: 'Custo' }, { k: 'conversions', l: 'Conv.' },
                                                { k: 'convRate', l: 'Taxa Conv.' }, { k: 'costPerConv', l: 'Custo/Conv.' }
                                            ].map(h => (
                                                <th key={h.k} onClick={() => handleSort(h.k)} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:text-navy transition-colors">
                                                    <div className="flex items-center">{h.l} {renderSortIcon(h.k)}</div>
                                                </th>
                                            ))}
                                            {customMetrics.map(m => (
                                                <th key={m.id} onClick={() => handleSort(m.id)} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:text-navy transition-colors border-l border-slate-100">
                                                    <div className="flex items-center gap-1">
                                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                                                        {m.name} {renderSortIcon(m.id)}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {sortData(filteredKeywords).map((kw, i) => (
                                            <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="px-6 py-4 text-xs font-bold text-navy">{kw.text}</td>
                                                <td className="px-6 py-4 text-[10px] text-slate-500 uppercase">{kw.matchType}</td>
                                                <td className="px-6 py-4">{renderStatusBadge(kw.status)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{kw.qualityScore}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(kw.impressions)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(kw.clicks)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatPercent((kw.clicks / kw.impressions) * 100 || 0)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatCurrency(kw.clicks > 0 ? kw.spend / kw.clicks : 0)}</td>
                                                <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(kw.spend)}</td>
                                                <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(kw.conversions)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatPercent((kw.conversions / kw.clicks) * 100 || 0)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600">{formatCurrency(kw.conversions > 0 ? kw.spend / kw.conversions : 0)}</td>
                                                {customMetrics.map(m => (
                                                    <td key={m.id} className="px-6 py-4 text-xs font-bold text-navy border-l border-slate-50">
                                                        {formatMetricValue(calculateMetricValue(m, kw), m.format)}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-slate-50 border-t border-slate-100">
                                        <tr>
                                            <td className="px-6 py-4 text-xs font-black text-navy uppercase" colSpan={4}>Totais</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(calculateTotals(filteredKeywords).impressions)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(calculateTotals(filteredKeywords).clicks)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatPercent(calculateTotals(filteredKeywords).ctr)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(calculateTotals(filteredKeywords).cpc)}</td>
                                            <td className="px-6 py-4 text-xs font-black text-navy">{formatCurrency(calculateTotals(filteredKeywords).spend)}</td>
                                            <td className="px-6 py-4 text-xs font-black text-navy">{formatNumber(calculateTotals(filteredKeywords).conversions)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatPercent(calculateTotals(filteredKeywords).clicks > 0 ? (calculateTotals(filteredKeywords).conversions / calculateTotals(filteredKeywords).clicks) * 100 : 0)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(calculateTotals(filteredKeywords).costPerConv)}</td>
                                            {customMetrics.map(m => (
                                                <td key={m.id} className="px-6 py-4 text-xs font-black text-navy border-l border-slate-100">
                                                    {formatMetricValue(calculateMetricValue(m, calculateTotals(filteredKeywords)), m.format)}
                                                </td>
                                            ))}
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ADS TAB */}
            {activeTab === 'ads' && (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 border-b border-slate-100">
                                <tr>
                                    {[
                                        { k: 'headlines', l: 'Anúncio (Títulos)' }, { k: 'campaignName', l: 'Campanha' }, { k: 'adGroupName', l: 'Grupo' },
                                        { k: 'status', l: 'Status' }, { k: 'impressions', l: 'Impr.' }, { k: 'clicks', l: 'Cliques' }, { k: 'ctr', l: 'CTR' }
                                    ].map(h => (
                                        <th key={h.k} onClick={() => handleSort(h.k)} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap cursor-pointer hover:text-navy transition-colors">
                                            <div className="flex items-center">{h.l} {renderSortIcon(h.k)}</div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {sortData(filteredAds).map((ad, i) => (
                                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="px-6 py-4 text-xs text-navy max-w-xs truncate" title={ad.headlines}>{ad.headlines}</td>
                                        <td className="px-6 py-4 text-xs text-slate-500">{ad.campaignName}</td>
                                        <td className="px-6 py-4 text-xs text-slate-500">{ad.adGroupName}</td>
                                        <td className="px-6 py-4">{renderStatusBadge(ad.status)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(ad.impressions)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(ad.clicks)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatPercent((ad.clicks / ad.impressions) * 100 || 0)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

        </div>
      )}
      {/* METRIC CREATOR MODAL */}
      {isMetricModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-300">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><Calculator size={20} /></div>
                          <h3 className="text-lg font-bold text-navy">Criar Métrica Personalizada</h3>
                      </div>
                      <button onClick={() => setIsMetricModalOpen(false)} className="text-slate-400 hover:text-navy transition-colors"><X size={20} /></button>
                  </div>
                  
                  <div className="p-6 space-y-6">
                      {/* Name */}
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Nome da Métrica</label>
                          <input 
                              type="text" 
                              value={newMetric.name}
                              onChange={(e) => setNewMetric({...newMetric, name: e.target.value})}
                              placeholder="Ex: Meu ROAS"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-navy focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                      </div>

                      {/* Formula Builder */}
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Fórmula</label>
                          <div className="flex items-center gap-2">
                              <select 
                                  value={newMetric.numerator}
                                  onChange={(e) => setNewMetric({...newMetric, numerator: e.target.value as BaseMetricType})}
                                  className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-navy focus:outline-none"
                              >
                                  <option value="clicks">Cliques</option>
                                  <option value="impressions">Impressões</option>
                                  <option value="spend">Custo</option>
                                  <option value="conversions">Conversões</option>
                                  <option value="conversionsValue">Valor Conv.</option>
                              </select>

                              <select 
                                  value={newMetric.operator}
                                  onChange={(e) => setNewMetric({...newMetric, operator: e.target.value as MetricOperator})}
                                  className="w-16 bg-white border border-slate-200 rounded-lg px-2 py-2 text-xs font-bold text-center text-navy focus:outline-none"
                              >
                                  <option value="/">÷</option>
                                  <option value="*">×</option>
                                  <option value="+">+</option>
                                  <option value="-">−</option>
                              </select>

                              <select 
                                  value={newMetric.denominator}
                                  onChange={(e) => setNewMetric({...newMetric, denominator: e.target.value as BaseMetricType})}
                                  className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-navy focus:outline-none"
                              >
                                  <option value="clicks">Cliques</option>
                                  <option value="impressions">Impressões</option>
                                  <option value="spend">Custo</option>
                                  <option value="conversions">Conversões</option>
                                  <option value="conversionsValue">Valor Conv.</option>
                              </select>
                          </div>
                          
                          <div className="flex items-center gap-4">
                              <div className="flex-1">
                                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Multiplicador (Opcional)</label>
                                  <input 
                                      type="number" 
                                      value={newMetric.multiplier}
                                      onChange={(e) => setNewMetric({...newMetric, multiplier: parseFloat(e.target.value)})}
                                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-navy focus:outline-none"
                                  />
                              </div>
                              <div className="flex-1">
                                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Formato</label>
                                  <select 
                                      value={newMetric.format}
                                      onChange={(e) => setNewMetric({...newMetric, format: e.target.value as MetricFormat})}
                                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-navy focus:outline-none"
                                  >
                                      <option value="number">Número (1.234)</option>
                                      <option value="currency">Moeda (R$)</option>
                                      <option value="percent">Percentual (%)</option>
                                  </select>
                              </div>
                          </div>
                      </div>

                      {/* Color & Preview */}
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Cor da Linha</label>
                              <div className="flex items-center gap-3">
                                  <input 
                                      type="color" 
                                      value={newMetric.color}
                                      onChange={(e) => setNewMetric({...newMetric, color: e.target.value})}
                                      className="h-10 w-20 rounded cursor-pointer"
                                  />
                                  <span className="text-xs font-mono text-slate-400">{newMetric.color}</span>
                              </div>
                          </div>
                          <div className="bg-slate-900 rounded-xl p-4 text-white">
                              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Preview (Total do Período)</label>
                              <div className="text-2xl font-black">
                                  {formatMetricValue(calculateMetricValue(newMetric as CustomMetric, periodTotals), newMetric.format as MetricFormat)}
                              </div>
                          </div>
                      </div>
                  </div>

                  <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                      <button 
                          onClick={() => setIsMetricModalOpen(false)}
                          className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-navy uppercase tracking-widest transition-colors"
                      >
                          Cancelar
                      </button>
                      <button 
                          onClick={handleSaveMetric}
                          disabled={!newMetric.name}
                          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold uppercase tracking-widest shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                      >
                          <Save size={14} /> Salvar Métrica
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

const InfoMessage = ({ title, message }: { title: string, message: string }) => (
    <div className="flex flex-col items-center gap-2">
        <div className="p-3 bg-white rounded-full shadow-sm text-blue-500 mb-2">
            <Bot size={24} />
        </div>
        <h4 className="text-sm font-bold text-navy uppercase tracking-wide">{title}</h4>
        <p className="text-xs text-slate-500 max-w-md">{message}</p>
    </div>
);

export default Marketing;
