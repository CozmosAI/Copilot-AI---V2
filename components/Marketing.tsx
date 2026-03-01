
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Instagram, DollarSign, TrendingUp, Bot, Users, Target, MousePointer2, Eye,
  Filter, Loader2, Zap, AlertCircle, LayoutDashboard, Layers, Grid, Type, MessageSquare,
  ArrowUpRight, ArrowDownRight, Search
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart
} from 'recharts';
import { useApp } from '../App';
import { 
    getGoogleCampaigns, getGoogleOverview, getGoogleAdGroups, getGoogleKeywords, getGoogleAds 
} from '../services/googleAdsService';

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
  
  // Filters
  const [selectedMetric, setSelectedMetric] = useState<'clicks' | 'impressions' | 'spend' | 'conversions'>('clicks');
  const [campaignFilter, setCampaignFilter] = useState<string>('');
  
  const lastFetchRef = useRef<{start: string, end: string} | null>(null);
  const isConnected = !!googleAdsToken;

  // Fetch Data
  useEffect(() => {
    const fetchGoogleData = async () => {
        if (isConnected && user && dateFilter.start && dateFilter.end) {
            if (lastFetchRef.current?.start === dateFilter.start && lastFetchRef.current?.end === dateFilter.end) {
                return;
            }
            lastFetchRef.current = { start: dateFilter.start, end: dateFilter.end };

            setLoading(true);
            try {
                const [ov, cp, ag, kw, ad] = await Promise.all([
                    getGoogleOverview(user.id, dateFilter),
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
  }, [isConnected, user, dateFilter.start, dateFilter.end]);

  // Derived Metrics for Overview
  const totalSpend = overviewData.reduce((acc, curr) => acc + curr.spend, 0);
  const totalClicks = overviewData.reduce((acc, curr) => acc + curr.clicks, 0);
  const totalImpressions = overviewData.reduce((acc, curr) => acc + curr.impressions, 0);
  const totalConversions = overviewData.reduce((acc, curr) => acc + curr.conversions, 0);
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const costPerConv = totalConversions > 0 ? totalSpend / totalConversions : 0;

  // Navigation Handler
  const handleCampaignClick = (campaignName: string) => {
      setCampaignFilter(campaignName);
      setActiveTab('adgroups');
  };

  // Render Helpers
  const formatCurrency = (val: number) => `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const formatNumber = (val: number) => val.toLocaleString('pt-BR');
  const formatPercent = (val: number) => `${val.toFixed(2)}%`;

  const filteredAdGroups = campaignFilter 
      ? adGroups.filter(ag => ag.campaignName === campaignFilter)
      : adGroups;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
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
                  onClick={() => { setActiveTab(tab.id as any); setCampaignFilter(''); }}
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
                            { label: 'Custo', value: formatCurrency(totalSpend), icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50' },
                            { label: 'Cliques', value: formatNumber(totalClicks), icon: MousePointer2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
                            { label: 'Impressões', value: formatNumber(totalImpressions), icon: Eye, color: 'text-purple-600', bg: 'bg-purple-50' },
                            { label: 'CTR', value: formatPercent(avgCtr), icon: Target, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                            { label: 'CPC Médio', value: formatCurrency(avgCpc), icon: TrendingUp, color: 'text-amber-600', bg: 'bg-amber-50' },
                            { label: 'Conversões', value: formatNumber(totalConversions), icon: Zap, color: 'text-rose-600', bg: 'bg-rose-50' },
                            { label: 'Custo/Conv.', value: formatCurrency(costPerConv), icon: DollarSign, color: 'text-cyan-600', bg: 'bg-cyan-50' },
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

                    {/* CHART */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-sm font-bold text-navy uppercase tracking-widest">Desempenho no Período</h3>
                            <div className="flex bg-slate-100 p-1 rounded-lg">
                                {['clicks', 'impressions', 'spend', 'conversions'].map(m => (
                                    <button 
                                        key={m}
                                        onClick={() => setSelectedMetric(m as any)}
                                        className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all ${selectedMetric === m ? 'bg-white text-navy shadow-sm' : 'text-slate-400 hover:text-navy'}`}
                                    >
                                        {m === 'spend' ? 'Custo' : m === 'conversions' ? 'Conversões' : m}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="h-80">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={overviewData}>
                                    <defs>
                                        <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#0f172a" stopOpacity={0.1}/>
                                            <stop offset="95%" stopColor="#0f172a" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis 
                                        dataKey="date" 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fontSize: 10, fill: '#94a3b8' }} 
                                        tickFormatter={(val) => new Date(val).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                    />
                                    <YAxis hide />
                                    <Tooltip 
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
                                        labelStyle={{ color: '#64748b', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}
                                        formatter={(value: number) => [
                                            selectedMetric === 'spend' ? formatCurrency(value) : formatNumber(value), 
                                            selectedMetric.toUpperCase()
                                        ]}
                                    />
                                    <Area 
                                        type="monotone" 
                                        dataKey={selectedMetric} 
                                        stroke="#0f172a" 
                                        strokeWidth={2}
                                        fillOpacity={1} 
                                        fill="url(#colorMetric)" 
                                    />
                                </AreaChart>
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
                                    {['Campanha', 'Status', 'Impr.', 'Cliques', 'CTR', 'CPC Méd.', 'Custo', 'Conv.', 'Custo/Conv.'].map(h => (
                                        <th key={h} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {campaigns.map((c, i) => (
                                    <tr key={i} className="hover:bg-slate-50/50 transition-colors group cursor-pointer" onClick={() => handleCampaignClick(c.name)}>
                                        <td className="px-6 py-4 text-xs font-bold text-navy group-hover:text-blue-600 transition-colors">{c.name}</td>
                                        <td className="px-6 py-4"><span className={`text-[9px] font-bold px-2 py-1 rounded-full uppercase ${c.status === 'ENABLED' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>{c.status === 'ENABLED' ? 'Ativa' : c.status}</span></td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(c.impressions)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(c.clicks)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatPercent((c.clicks / c.impressions) * 100 || 0)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatCurrency(c.spend / c.clicks || 0)}</td>
                                        <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(c.spend)}</td>
                                        <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(c.conversions)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatCurrency(c.conversions > 0 ? c.spend / c.conversions : 0)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-slate-50 border-t border-slate-100">
                                <tr>
                                    <td className="px-6 py-4 text-xs font-black text-navy uppercase" colSpan={2}>Totais</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(totalImpressions)}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(totalClicks)}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{formatPercent(avgCtr)}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(avgCpc)}</td>
                                    <td className="px-6 py-4 text-xs font-black text-navy">{formatCurrency(totalSpend)}</td>
                                    <td className="px-6 py-4 text-xs font-black text-navy">{formatNumber(totalConversions)}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(costPerConv)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* AD GROUPS TAB */}
            {activeTab === 'adgroups' && (
                <div className="space-y-4">
                    {campaignFilter && (
                        <div className="flex items-center gap-2 text-xs text-slate-500 bg-white px-4 py-2 rounded-lg border border-slate-200 w-fit">
                            <span>Filtrado por: <strong>{campaignFilter}</strong></span>
                            <button onClick={() => setCampaignFilter('')} className="hover:text-rose-500"><Search size={12}/></button>
                        </div>
                    )}
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 border-b border-slate-100">
                                    <tr>
                                        {['Grupo de Anúncios', 'Campanha', 'Status', 'Impr.', 'Cliques', 'CTR', 'Custo', 'Conv.'].map(h => (
                                            <th key={h} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {filteredAdGroups.map((ag, i) => (
                                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{ag.name}</td>
                                            <td className="px-6 py-4 text-xs text-slate-500">{ag.campaignName}</td>
                                            <td className="px-6 py-4"><span className={`text-[9px] font-bold px-2 py-1 rounded-full uppercase ${ag.status === 'ENABLED' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>{ag.status === 'ENABLED' ? 'Ativo' : ag.status}</span></td>
                                            <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(ag.impressions)}</td>
                                            <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(ag.clicks)}</td>
                                            <td className="px-6 py-4 text-xs text-slate-600">{formatPercent((ag.clicks / ag.impressions) * 100 || 0)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(ag.spend)}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(ag.conversions)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* KEYWORDS TAB */}
            {activeTab === 'keywords' && (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 border-b border-slate-100">
                                <tr>
                                    {['Palavra-chave', 'Tipo', 'Status', 'Qualidade', 'Impr.', 'Cliques', 'CTR', 'Custo', 'Conv.'].map(h => (
                                        <th key={h} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {keywords.map((kw, i) => (
                                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="px-6 py-4 text-xs font-bold text-navy">{kw.text}</td>
                                        <td className="px-6 py-4 text-[10px] text-slate-500 uppercase">{kw.matchType}</td>
                                        <td className="px-6 py-4"><span className={`text-[9px] font-bold px-2 py-1 rounded-full uppercase ${kw.status === 'ENABLED' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>{kw.status === 'ENABLED' ? 'Ativa' : kw.status}</span></td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{kw.qualityScore}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(kw.impressions)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatNumber(kw.clicks)}</td>
                                        <td className="px-6 py-4 text-xs text-slate-600">{formatPercent((kw.clicks / kw.impressions) * 100 || 0)}</td>
                                        <td className="px-6 py-4 text-xs font-bold text-navy">{formatCurrency(kw.spend)}</td>
                                        <td className="px-6 py-4 text-xs font-bold text-navy">{formatNumber(kw.conversions)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ADS TAB */}
            {activeTab === 'ads' && (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 border-b border-slate-100">
                                <tr>
                                    {['Anúncio (Títulos)', 'Campanha', 'Grupo', 'Status', 'Impr.', 'Cliques', 'CTR'].map(h => (
                                        <th key={h} className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {ads.map((ad, i) => (
                                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="px-6 py-4 text-xs text-navy max-w-xs truncate" title={ad.headlines}>{ad.headlines}</td>
                                        <td className="px-6 py-4 text-xs text-slate-500">{ad.campaignName}</td>
                                        <td className="px-6 py-4 text-xs text-slate-500">{ad.adGroupName}</td>
                                        <td className="px-6 py-4"><span className={`text-[9px] font-bold px-2 py-1 rounded-full uppercase ${ad.status === 'ENABLED' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>{ad.status === 'ENABLED' ? 'Ativo' : ad.status}</span></td>
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
    </div>
  );
};

export default Marketing;
