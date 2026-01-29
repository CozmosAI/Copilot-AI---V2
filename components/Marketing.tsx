
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

const GoogleIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c3.11 0 5.71-1.03 7.61-2.81l-3.57-2.77c-.99.66-2.26 1.06-4.04 1.06-3.41 0-6.3-2.3-7.34-5.41H1.04v2.81C3.12 19.38 7.3 23 12 23z" fill="#34A853"/>
    <path d="M4.66 14.07c-.26-.77-.41-1.6-.41-2.47s.15-1.7.41-2.47V6.32H1.04C.38 7.64 0 9.13 0 10.7c0 1.57.38 3.06 1.04 4.38l3.62-2.81z" fill="#FBBC05"/>
    <path d="M12 4.19c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.71 1.03 15.11 0 12 0 7.3 0 3.12 3.62 1.04 8.07l3.62 2.81c1.04-3.11 3.93-5.41 7.34-5.41z" fill="#EA4335"/>
  </svg>
);

const Marketing: React.FC = () => {
  const { dateFilter, setDateFilter, googleAdsToken, metrics } = useApp();
  const [loading, setLoading] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<'all' | 'google' | 'offline'>('all');
  
  // States para dados reais
  const [realGoogleCampaigns, setRealGoogleCampaigns] = useState<any[]>([]);

  // Recupera o ID da conta selecionada (MCC ou Cliente)
  const selectedAccountId = localStorage.getItem('selected_google_account_id');
  const isConnected = !!googleAdsToken && !!selectedAccountId;
  
  const DEV_TOKEN = (import.meta as any)?.env?.VITE_GOOGLE_ADS_DEV_TOKEN || 'SEU_DEVELOPER_TOKEN_AQUI';

  // --- BUSCA DADOS REAIS GOOGLE ---
  useEffect(() => {
    const fetchGoogleData = async () => {
        if (googleAdsToken && selectedAccountId) {
            setLoading(true);
            try {
                // Passa explicitamente o ID da conta selecionada
                const results = await getGoogleCampaigns(selectedAccountId, googleAdsToken, DEV_TOKEN, { start: dateFilter.start, end: dateFilter.end });
                const mappedCampaigns = results.map((row: any) => ({
                    name: row.campaign.name,
                    platform: 'google',
                    spend: (parseInt(row.metrics.costMicros) || 0) / 1000000,
                    clicks: parseInt(row.metrics.clicks) || 0,
                    impressions: parseInt(row.metrics.impressions) || 0,
                    leads: parseFloat(row.metrics.conversions) || 0, 
                    status: row.campaign.status
                }));
                setRealGoogleCampaigns(mappedCampaigns);
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
    fetchGoogleData();
  }, [googleAdsToken, selectedAccountId, dateFilter]); // Adicionado selectedAccountId como dependência


  // --- CONSOLIDAÇÃO DE DADOS (API + FINANCEIRO) ---
  const campaigns = useMemo(() => {
      // Combina campanhas de API (Agora somente Google)
      const apiCampaigns = [...realGoogleCampaigns];
      
      // Calcula quanto foi gasto em APIs
      const apiSpend = apiCampaigns.reduce((sum, c) => sum + (c.spend || 0), 0);
      
      // Pega o gasto TOTAL de marketing do Financeiro (que inclui APIs se lançadas, ou manual)
      // Se metrics.marketing.investimento for MAIOR que o apiSpend, significa que tem gasto manual (ex: Panfletos, Influencers)
      const totalMarketingFinance = metrics.marketing.investimento;
      const manualSpend = Math.max(0, totalMarketingFinance - apiSpend);

      // Adiciona uma campanha "Offline / Outros" se houver diferença
      if (manualSpend > 0) {
          apiCampaigns.push({
              name: 'Outros / Manual (Financeiro)',
              platform: 'offline',
              spend: manualSpend,
              clicks: 0,
              impressions: 0,
              conversions: 0, // Poderia ser estimado
              cpc: 0,
              ctr: 0
          });
      }

      return apiCampaigns;
  }, [realGoogleCampaigns, metrics.marketing.investimento]);


  // CÁLCULO DE TOTAIS
  const totalSpend = campaigns.reduce((acc, c) => acc + c.spend, 0);
  const totalLeads = campaigns.reduce((acc, c) => acc + (c.leads || c.conversions || 0), 0) + (metrics.marketing.leads - (realGoogleCampaigns.reduce((a,b)=>a+(b.leads||0),0))); // Soma leads manuais do CRM se não vierem da API
  const totalImpressions = campaigns.reduce((acc, c) => acc + c.impressions, 0);
  const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const conversions = Math.round(totalLeads * 0.12);

  const activeCampaigns = platformFilter === 'all' 
    ? campaigns 
    : campaigns.filter(c => c.platform === platformFilter);

  return (
    <div className="space-y-12 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-navy tracking-tight">Performance de Tráfego Pago</h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-slate-500 font-light italic">Monitoramento unificado (Google Ads & Financeiro).</p>
            {isConnected ? (
               <span className="bg-emerald-50 text-emerald-700 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-emerald-100 flex items-center gap-1"><Zap size={8} fill="currentColor"/> Conta Conectada: {selectedAccountId}</span>
            ) : (
                <span className="bg-amber-50 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-amber-100 flex items-center gap-1"><AlertCircle size={8} /> Selecione uma conta em Conexões</span>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-1 bg-white p-1 rounded-xl shadow-sm border border-slate-200">
          {['Hoje', '7 dias', '30 dias', 'Este Ano'].map((t) => (
            <button 
              key={t} 
              onClick={() => setDateFilter(t)}
              className={`px-4 py-1.5 text-[10px] font-bold rounded-lg uppercase transition-all ${t === dateFilter.label ? 'bg-navy text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      {/* AVISO QUANDO CONECTADO MAS SEM DADOS */}
      {isConnected && campaigns.length === 0 && !loading && (
          <div className="bg-blue-50 border border-blue-100 p-6 rounded-2xl flex items-center gap-4">
              <div className="p-3 bg-white rounded-full text-blue-500 shadow-sm"><AlertCircle size={24} /></div>
              <div>
                  <h3 className="text-sm font-bold text-navy">Sem dados de campanha ativos.</h3>
                  <p className="text-xs text-slate-500 mt-1">
                      Não encontramos gastos no Google Ads (Conta {selectedAccountId}) nem lançamentos de "Marketing" no Financeiro para o período ({dateFilter.label}).
                  </p>
              </div>
          </div>
      )}

      {loading ? (
        <div className="h-96 flex flex-col items-center justify-center gap-4 bg-white rounded-[40px] border border-slate-200">
          <Loader2 size={32} className="text-navy animate-spin" />
          <p className="text-[10px] font-bold text-navy uppercase tracking-widest">Sincronizando Google Ads...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md group">
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Investimento Total</span>
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><DollarSign size={16} /></div>
              </div>
              <p className="text-2xl font-bold text-navy tracking-tight">R$ {metrics.marketing.investimento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md group">
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Leads Capturados</span>
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Users size={16} /></div>
              </div>
              <p className="text-2xl font-bold text-navy tracking-tight">{metrics.marketing.leads}</p>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md group">
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Custo por Lead (CPL)</span>
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><Target size={16} /></div>
              </div>
              <p className="text-2xl font-bold text-navy tracking-tight">R$ {metrics.marketing.cpl.toFixed(2)}</p>
            </div>

            <div className="bg-navy p-6 rounded-2xl text-white shadow-xl relative overflow-hidden group border border-white/5">
              <div className="absolute top-0 right-0 p-4 opacity-5"><Zap size={50} /></div>
              <div className="flex justify-between items-start mb-4 relative z-10">
                <span className="text-[10px] font-medium text-blue-400 uppercase tracking-widest">Conversão Est.</span>
                <Zap size={14} className="text-blue-400" />
              </div>
              <p className="text-2xl font-bold relative z-10 tracking-tight">{conversions}</p>
              <p className="text-[10px] font-medium text-slate-400 mt-2 relative z-10 uppercase italic">Estimativa Automática</p>
            </div>
          </div>

          {campaigns.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm">
                <div className="flex justify-between items-center mb-10">
                  <div>
                    <h3 className="text-[10px] font-bold text-navy uppercase tracking-widest">Investimento por Campanha</h3>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-1">Análise de Performance Individual (Google + Manual)</p>
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
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                           <div className="p-2 bg-slate-50 rounded-xl text-slate-400"><MousePointer2 size={16} /></div>
                           <span className="text-xs font-semibold text-navy">Cliques Totais</span>
                        </div>
                        <span className="text-xs font-bold text-navy">{campaigns.reduce((a,b)=>a+b.clicks, 0)}</span>
                     </div>
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                           <div className="p-2 bg-slate-50 rounded-xl text-slate-400"><Eye size={16} /></div>
                           <span className="text-xs font-semibold text-navy">Impressões</span>
                        </div>
                        <span className="text-xs font-bold text-navy">{Math.round(totalImpressions).toLocaleString()}</span>
                     </div>
                  </div>
               </div>
               
               {/* Diagnóstico IA */}
               <div className="bg-navy p-8 rounded-[40px] text-white shadow-2xl relative overflow-hidden group border border-white/5">
                  <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><Bot size={80} /></div>
                  <div className="flex gap-4 items-start relative z-10">
                     <div className="p-3 bg-blue-500/20 text-blue-400 rounded-2xl border border-blue-500/20 shadow-xl shadow-blue-500/10">
                        <Bot size={24} />
                     </div>
                     <div className="flex-1">
                        <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-2 flex items-center gap-2">COPILOT INSIGHT</h4>
                        <p className="text-sm font-medium leading-relaxed italic opacity-90 text-slate-300">
                           {metrics.financeiro.roi > 0 
                             ? `"Seu ROI atual é de ${metrics.financeiro.roi.toFixed(0)}%. O custo por lead de R$ ${metrics.marketing.cpl.toFixed(2)} está saudável."`
                             : `"Ainda não temos dados suficientes de retorno sobre investimento. Continue alimentando o financeiro."`
                           }
                        </p>
                     </div>
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
