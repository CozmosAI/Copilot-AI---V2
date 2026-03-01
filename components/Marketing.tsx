
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Instagram, DollarSign, TrendingUp, Bot, Users, Target, MousePointer2, Eye,
  Filter, Loader2, Zap, AlertCircle
} from 'lucide-react';
import { 
  BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Cell
} from 'recharts';
import { useApp } from '../App';
import { getGoogleCampaigns } from '../services/googleAdsService';

const Marketing: React.FC = () => {
  const { dateFilter, setCustomDateRange, googleAdsToken, metrics, user } = useApp();
  const [loading, setLoading] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<'all' | 'google' | 'offline'>('all');
  const [realGoogleCampaigns, setRealGoogleCampaigns] = useState<any[]>([]);
  const lastFetchRef = React.useRef<{start: string, end: string} | null>(null);

  // Verificamos se há token (agora o token é um flag 'backend-connected' no frontend)
  const isConnected = !!googleAdsToken;

  useEffect(() => {
    const fetchGoogleData = async () => {
        if (isConnected && user && dateFilter.start && dateFilter.end) {
             // Prevent duplicate fetch for same dates
            if (lastFetchRef.current?.start === dateFilter.start && lastFetchRef.current?.end === dateFilter.end) {
                return;
            }
            
            lastFetchRef.current = { start: dateFilter.start, end: dateFilter.end };

            setLoading(true);
            try {
                // Chama a API passando o ID do usuário (o backend resolve o token)
                const campaigns = await getGoogleCampaigns(user.id, { start: dateFilter.start, end: dateFilter.end });
                setRealGoogleCampaigns(campaigns);
            } catch (error) {
                console.error("Erro ao buscar campanhas Google:", error);
                setRealGoogleCampaigns([]);
            } finally {
                setLoading(false);
            }
        } else {
            setRealGoogleCampaigns([]);
        }
    };
    
    const timeoutId = setTimeout(fetchGoogleData, 500);
    return () => clearTimeout(timeoutId);

  }, [isConnected, user, dateFilter.start, dateFilter.end]); // Dependência explícita nas datas

  // --- CONSOLIDAÇÃO DE DADOS (API + FINANCEIRO) ---
  const campaigns = useMemo(() => {
      const apiCampaigns = [...realGoogleCampaigns];
      const apiSpend = apiCampaigns.reduce((sum, c) => sum + (c.spend || 0), 0);
      const totalMarketingFinance = metrics.marketing.investimento;
      const manualSpend = Math.max(0, totalMarketingFinance - apiSpend);

      // Adiciona uma linha de "Outros" se o gasto financeiro for maior que o reportado pela API
      if (manualSpend > 0) {
          apiCampaigns.push({
              name: 'Outros / Manual (Financeiro)',
              platform: 'offline',
              spend: manualSpend,
              clicks: 0,
              impressions: 0,
              conversions: 0,
              cpc: 0,
              ctr: 0
          });
      }
      return apiCampaigns;
  }, [realGoogleCampaigns, metrics.marketing.investimento]);

  const totalImpressions = campaigns.reduce((acc, c) => acc + c.impressions, 0);
  const conversions = Math.round(campaigns.reduce((acc, c) => acc + (c.conversions || 0), 0));
  const activeCampaigns = platformFilter === 'all' ? campaigns : campaigns.filter(c => c.platform === platformFilter);

  return (
    <div className="space-y-12 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-navy tracking-tight">Performance de Tráfego Pago</h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-slate-500 font-light italic">Monitoramento unificado (Google Ads & Financeiro).</p>
            {isConnected ? (
               <span className="bg-emerald-50 text-emerald-700 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-emerald-100 flex items-center gap-1"><Zap size={8} fill="currentColor"/> Conectado</span>
            ) : (
                <span className="bg-amber-50 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-amber-100 flex items-center gap-1"><AlertCircle size={8} /> Conecte sua conta em Integrações</span>
            )}
          </div>
        </div>
        
        {/* SELETOR DE DATA (CALENDÁRIO) */}
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

      {loading ? (
        <div className="h-96 flex flex-col items-center justify-center gap-4 bg-white rounded-[40px] border border-slate-200">
          <Loader2 size={32} className="text-navy animate-spin" />
          <p className="text-[10px] font-bold text-navy uppercase tracking-widest">Sincronizando Google Ads...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md group">
              <div className="flex justify-between items-start mb-4"><span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Investimento Total</span><div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><DollarSign size={16} /></div></div>
              <p className="text-2xl font-bold text-navy tracking-tight">R$ {metrics.marketing.investimento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md group">
              <div className="flex justify-between items-start mb-4"><span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Leads Capturados</span><div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Users size={16} /></div></div>
              <p className="text-2xl font-bold text-navy tracking-tight">{metrics.marketing.leads}</p>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md group">
              <div className="flex justify-between items-start mb-4"><span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Custo por Lead (CPL)</span><div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><Target size={16} /></div></div>
              <p className="text-2xl font-bold text-navy tracking-tight">R$ {metrics.marketing.cpl.toFixed(2)}</p>
            </div>
            <div className="bg-navy p-6 rounded-2xl text-white shadow-xl relative overflow-hidden group border border-white/5">
              <div className="absolute top-0 right-0 p-4 opacity-5"><Zap size={50} /></div>
              <div className="flex justify-between items-start mb-4 relative z-10"><span className="text-[10px] font-medium text-blue-400 uppercase tracking-widest">Conversões Totais</span><Zap size={14} className="text-blue-400" /></div>
              <p className="text-2xl font-bold relative z-10 tracking-tight">{conversions}</p>
            </div>
          </div>

          {campaigns.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm">
                <div className="flex justify-between items-center mb-10">
                  <div>
                    <h3 className="text-[10px] font-bold text-navy uppercase tracking-widest">Investimento por Campanha</h3>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-1">Análise de Performance Individual</p>
                  </div>
                </div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={activeCampaigns}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 400, fill: '#94a3b8' }} dy={10} hide={window.innerWidth < 768} />
                      <YAxis hide />
                      <Tooltip cursor={{ fill: '#f8fafc', radius: 8 }} contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }} />
                      <Bar dataKey="spend" radius={[6, 6, 0, 0]} barSize={40}>
                        {activeCampaigns.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.platform === 'google' ? '#4285F4' : '#0f172a'} />
                        ))}
                      </Bar>
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <div className="space-y-6">
               <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">MÉTRICAS GERAIS</h3>
                  <div className="space-y-6">
                     <div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="p-2 bg-slate-50 rounded-xl text-slate-400"><MousePointer2 size={16} /></div><span className="text-xs font-semibold text-navy">Cliques Totais</span></div><span className="text-xs font-bold text-navy">{campaigns.reduce((a,b)=>a+b.clicks, 0)}</span></div>
                     <div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="p-2 bg-slate-50 rounded-xl text-slate-400"><Eye size={16} /></div><span className="text-xs font-semibold text-navy">Impressões</span></div><span className="text-xs font-bold text-navy">{Math.round(totalImpressions).toLocaleString()}</span></div>
                  </div>
               </div>
            </div>
          </div>
          ) : (
            <div className="text-center py-24 text-slate-300">
               <Filter size={48} className="mx-auto mb-4 opacity-50" />
               <p className="text-sm font-bold uppercase tracking-widest">Nenhuma campanha encontrada</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Marketing;
