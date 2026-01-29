
import React, { useState, useEffect } from 'react';
import { 
  Play, CalendarCheck, UserCheck, UserX, Stethoscope, DollarSign, CreditCard, 
  Briefcase, AlertTriangle, Zap, Megaphone, Target, HandCoins, Calendar, Users, 
  ArrowUpRight, TrendingUp, Activity, BarChart3
} from 'lucide-react';
import { generateAudioReport, playPCM } from '../services/geminiService';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell
} from 'recharts';
import { useApp } from '../App';

const Dashboard: React.FC = () => {
  const { dateFilter, setDateFilter, metrics } = useApp();
  const [insight, setInsight] = useState<string>('Analisando performance...');
  const [loadingAudio, setLoadingAudio] = useState(false);
  
  const hasData = metrics.financeiro.receitaBruta > 0 || metrics.financeiro.gastosTotais > 0;

  useEffect(() => {
    if (hasData) {
        setInsight(`ROI de marketing em ${metrics.financeiro.roi.toFixed(0)}%. Atenção aos ${metrics.vendas.agendamentos - metrics.vendas.comparecimento} no-shows.`);
    }
  }, [metrics, hasData]);

  const handlePlayAudio = async () => {
    if (!hasData) return;
    setLoadingAudio(true);
    const audioData = await generateAudioReport(insight);
    if (audioData) await playPCM(audioData);
    setLoadingAudio(false);
  };

  // Dados para o Gráfico de Área (Simulação de Tendência)
  const trendData = [
    { name: 'Sem 1', receita: metrics.financeiro.receitaBruta * 0.2, gastos: metrics.financeiro.gastosTotais * 0.25 },
    { name: 'Sem 2', receita: metrics.financeiro.receitaBruta * 0.3, gastos: metrics.financeiro.gastosTotais * 0.25 },
    { name: 'Sem 3', receita: metrics.financeiro.receitaBruta * 0.2, gastos: metrics.financeiro.gastosTotais * 0.25 },
    { name: 'Sem 4', receita: metrics.financeiro.receitaBruta * 0.3, gastos: metrics.financeiro.gastosTotais * 0.25 },
  ];

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      {/* HEADER LIMPO */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-2xl font-bold text-navy tracking-tight">Painel de Controle</h2>
          <div className="flex items-center gap-2 mt-1">
             <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase">
                <Activity size={10} /> Sistema Operacional
             </div>
             <p className="text-sm text-slate-500">Visão consolidada da clínica.</p>
          </div>
        </div>
        <div className="bg-white p-1 rounded-lg shadow-sm border border-slate-200 flex gap-1">
          {['Hoje', '7 dias', '30 dias', 'Este Ano'].map((t) => (
            <button 
              key={t} 
              onClick={() => setDateFilter(t)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${t === dateFilter.label ? 'bg-navy text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-navy'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      {/* HERO CARDS - MENOS POLUIÇÃO, MAIS DESTAQUE */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Receita */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:border-emerald-200 transition-colors">
           <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity"><DollarSign size={80} /></div>
           <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Receita Líquida</p>
           <h3 className="text-2xl font-black text-navy">R$ {metrics.financeiro.receitaBruta.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</h3>
           <div className="mt-4 flex items-center gap-2">
              <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                 <TrendingUp size={10} /> +12%
              </span>
              <span className="text-[10px] text-slate-400">vs. período anterior</span>
           </div>
        </div>

        {/* Lucro */}
        <div className="bg-navy p-6 rounded-2xl border border-navy shadow-lg text-white relative overflow-hidden">
           <div className="absolute right-0 top-0 p-4 opacity-10"><Briefcase size={80} /></div>
           <p className="text-xs font-bold text-blue-200 uppercase tracking-widest mb-1">Lucro Real</p>
           <h3 className="text-2xl font-black">R$ {metrics.financeiro.lucroLiquido.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</h3>
           <div className="mt-4 flex items-center gap-2">
              <span className="bg-white/10 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                 Margem: {metrics.financeiro.receitaBruta > 0 ? Math.round((metrics.financeiro.lucroLiquido / metrics.financeiro.receitaBruta) * 100) : 0}%
              </span>
           </div>
        </div>

        {/* Leads */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:border-blue-200 transition-colors">
           <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity"><Users size={80} /></div>
           <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Novos Leads</p>
           <h3 className="text-2xl font-black text-navy">{metrics.marketing.leads}</h3>
           <div className="mt-4 flex items-center gap-2">
              <span className="text-[10px] text-slate-500">
                 Custo por Lead: <strong className="text-navy">R$ {metrics.marketing.cpl.toFixed(2)}</strong>
              </span>
           </div>
        </div>

        {/* Agendamentos */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:border-amber-200 transition-colors">
           <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity"><CalendarCheck size={80} /></div>
           <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Agendamentos</p>
           <h3 className="text-2xl font-black text-navy">{metrics.vendas.agendamentos}</h3>
           <div className="mt-4 flex items-center gap-2">
              <span className="bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                 Taxa Conv: {metrics.vendas.taxaConversao.toFixed(1)}%
              </span>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         {/* MAIN CHART AREA */}
         <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-6">
               <h3 className="text-sm font-bold text-navy uppercase tracking-widest">Fluxo Financeiro (Tendência)</h3>
               <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500"><div className="w-2 h-2 bg-navy rounded-full"></div> Receita</div>
                  <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500"><div className="w-2 h-2 bg-rose-400 rounded-full"></div> Despesas</div>
               </div>
            </div>
            <div className="h-64">
               <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                     <defs>
                        <linearGradient id="colorReceita" x1="0" y1="0" x2="0" y2="1">
                           <stop offset="5%" stopColor="#0f172a" stopOpacity={0.1}/>
                           <stop offset="95%" stopColor="#0f172a" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorGastos" x1="0" y1="0" x2="0" y2="1">
                           <stop offset="5%" stopColor="#fb7185" stopOpacity={0.1}/>
                           <stop offset="95%" stopColor="#fb7185" stopOpacity={0}/>
                        </linearGradient>
                     </defs>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                     <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} />
                     <YAxis hide />
                     <Tooltip contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
                     <Area type="monotone" dataKey="receita" stroke="#0f172a" fillOpacity={1} fill="url(#colorReceita)" strokeWidth={3} />
                     <Area type="monotone" dataKey="gastos" stroke="#fb7185" fillOpacity={1} fill="url(#colorGastos)" strokeWidth={3} />
                  </AreaChart>
               </ResponsiveContainer>
            </div>
         </div>

         {/* AI & ALERTS SIDEBAR */}
         <div className="space-y-4">
            {/* AI Insight Compact */}
            <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-6 rounded-2xl text-white shadow-lg relative overflow-hidden">
               <div className="flex items-start gap-3 relative z-10">
                  <button onClick={handlePlayAudio} className="p-3 bg-white/10 rounded-xl hover:bg-white/20 transition-colors">
                     {loadingAudio ? <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"/> : <Play size={20} fill="currentColor" />}
                  </button>
                  <div>
                     <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200 mb-1">Copilot AI Diz:</p>
                     <p className="text-xs font-medium leading-relaxed opacity-90 italic">"{insight}"</p>
                  </div>
               </div>
            </div>

            {/* Operational Alerts */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
               <h3 className="text-xs font-bold text-navy uppercase tracking-widest mb-4">Atenção Operacional</h3>
               <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-rose-50 rounded-xl border border-rose-100">
                     <div className="flex items-center gap-3">
                        <UserX size={16} className="text-rose-500" />
                        <div>
                           <p className="text-xs font-bold text-rose-700">No-Shows</p>
                           <p className="text-[10px] text-rose-600/80">Recuperar pacientes</p>
                        </div>
                     </div>
                     <span className="text-sm font-black text-rose-700">{Math.round(((metrics.vendas.agendamentos - metrics.vendas.comparecimento) / (metrics.vendas.agendamentos || 1)) * 100)}%</span>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl border border-amber-100">
                     <div className="flex items-center gap-3">
                        <Target size={16} className="text-amber-500" />
                        <div>
                           <p className="text-xs font-bold text-amber-700">Leads Frios</p>
                           <p className="text-[10px] text-amber-600/80">Sem interação > 24h</p>
                        </div>
                     </div>
                     <span className="text-sm font-black text-amber-700">{Math.round(metrics.marketing.leads * 0.3)}</span>
                  </div>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default Dashboard;
