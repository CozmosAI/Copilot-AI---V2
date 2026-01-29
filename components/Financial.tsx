
import React, { useState, useMemo } from 'react';
import { 
  Plus, Edit2, Trash2, 
  ArrowUpCircle, ArrowDownCircle,
  TrendingUp, PiggyBank,
  Bot, Target, Calendar, Filter, X, Save,
  AlertTriangle 
} from 'lucide-react';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, Line
} from 'recharts';
import { FinancialSubSection, FinancialEntry, FinancialEntryStatus } from '../types';
import { useApp } from '../App';

type HistoryPeriod = 'month' | '3months' | '6months' | 'year' | 'custom';

const Financial: React.FC = () => {
  const { dateFilter, setDateFilter, financialEntries, addFinancialEntry, updateFinancialEntry, deleteFinancialEntry, metrics } = useApp();
  const [subSection, setSubSection] = useState<FinancialSubSection>(FinancialSubSection.OVERVIEW);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FinancialEntry | null>(null);

  // Estados para Modal de Confirmação de Exclusão
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<FinancialEntry>>({
    type: 'receivable',
    category: 'Consulta Particular',
    name: '',
    unitValue: 0,
    discount: 0,
    addition: 0,
    status: 'efetuada',
    date: new Date().toISOString().split('T')[0],
  });

  // Filtra as entradas COM BASE NO FILTRO DE DATA GLOBAL DO APP
  const filteredEntries = useMemo(() => {
    return financialEntries.filter(entry => {
      const entryDate = entry.date;
      return entryDate >= dateFilter.start && entryDate <= dateFilter.end;
    });
  }, [financialEntries, dateFilter]);

  // CÁLCULO REAL DO FLUXO DE CAIXA (Últimos 6 meses)
  const cashFlowProjection = useMemo(() => {
    const months = [];
    const today = new Date();
    
    // Gera os últimos 6 meses
    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        months.push(d);
    }

    let accumulatedBalance = 0; // Se quiser saldo acumulado, precisa vir do banco. Aqui assumimos saldo do período.

    return months.map(monthDate => {
        const monthStr = monthDate.toISOString().slice(0, 7); // YYYY-MM
        const monthName = monthDate.toLocaleDateString('pt-BR', { month: 'short' });
        
        // Filtra entradas deste mês
        const monthEntries = financialEntries.filter(e => e.date.startsWith(monthStr) && e.status === 'efetuada');
        
        const entrada = monthEntries.filter(e => e.type === 'receivable').reduce((acc, curr) => acc + curr.total, 0);
        const saida = monthEntries.filter(e => e.type === 'payable').reduce((acc, curr) => acc + curr.total, 0);
        const saldoDoMes = entrada - saida;
        
        // Simulação de projeção para o mês atual/futuro se estiver vazio (apenas para o gráfico não ficar zerado se for novo usuário)
        const isFutureOrCurrent = monthDate >= new Date(today.getFullYear(), today.getMonth(), 1);
        
        return {
            name: monthName,
            entrada,
            saida,
            saldo: saldoDoMes,
            type: isFutureOrCurrent ? 'proj' : 'real'
        };
    });
  }, [financialEntries]);

  // Distribuição de Gastos REAL
  const distributionData = useMemo(() => {
     const expenses = filteredEntries.filter(e => e.type === 'payable');
     const categories = ['Colaboradores', 'Contas Fixas', 'Impostos', 'Insumos', 'Marketing'];
     const data = categories.map(cat => ({
         name: cat,
         value: expenses.filter(e => e.category === cat).reduce((acc, curr) => acc + curr.total, 0),
         fill: cat === 'Marketing' ? '#0f172a' : '#94a3b8' // Exemplo de cores
     })).filter(d => d.value > 0);

     // Adiciona 'Outros' se houver
     const otherValue = expenses.filter(e => !categories.includes(e.category)).reduce((acc, curr) => acc + curr.total, 0);
     if (otherValue > 0) data.push({ name: 'Outros', value: otherValue, fill: '#cbd5e1' });
     
     // Cores dinâmicas para o resto
     const colors = ['#0f172a', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1'];
     return data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }));

  }, [filteredEntries]);

  const handleEdit = (entry: FinancialEntry) => {
    setEditingEntry(entry);
    setFormData(entry);
    setShowForm(true);
  };

  const handleDeleteClick = (id: string) => {
    setItemToDelete(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (itemToDelete) {
      deleteFinancialEntry(itemToDelete);
      setShowDeleteConfirm(false);
      setItemToDelete(null);
    }
  };

  const handleSaveEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const total = Number(formData.unitValue) || 0;
    
    // Usa crypto.randomUUID() para gerar IDs compatíveis com bancos de dados reais
    const newEntry: FinancialEntry = { 
      ...(formData as FinancialEntry), 
      id: editingEntry?.id || crypto.randomUUID(), 
      discount: 0,
      addition: 0,
      total 
    };
    
    if (editingEntry) {
      updateFinancialEntry(newEntry);
    } else {
      addFinancialEntry(newEntry);
    }
    
    closeForm();
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingEntry(null);
    setFormData({
      type: 'receivable',
      category: 'Consulta Particular',
      name: '',
      unitValue: 0,
      discount: 0,
      addition: 0,
      status: 'efetuada',
      date: new Date().toISOString().split('T')[0],
    });
  };

  const StatusBadge = ({ status }: { status: FinancialEntryStatus }) => {
    switch (status) {
      case 'efetuada': return <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase border border-emerald-100">Efetuada</span>;
      case 'atrasada': return <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full uppercase border border-rose-100">Atrasada</span>;
      case 'cancelada': return <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase border border-slate-200">Cancelada</span>;
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-navy">Gestão Financeira</h2>
          <p className="text-slate-500 text-sm italic">Controle total de entradas, saídas e fluxo de caixa.</p>
        </div>
        <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-200">
          {[
            { id: FinancialSubSection.OVERVIEW, label: 'Visão Geral' },
            { id: FinancialSubSection.PAYABLE, label: 'Contas a Pagar' },
            { id: FinancialSubSection.RECEIVABLE, label: 'Contas a Receber' },
            { id: FinancialSubSection.CASHFLOW, label: 'Caixa + Fluxo' }
          ].map((tab) => (
            <button 
              key={tab.id} 
              onClick={() => setSubSection(tab.id as FinancialSubSection)} 
              className={`px-4 py-2 text-[10px] font-black uppercase tracking-tighter rounded-lg transition-all ${subSection === tab.id ? 'bg-navy text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* DASHBOARD CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center gap-2 mb-4 text-[9px] font-black text-emerald-500 uppercase tracking-widest">
            <div className="w-5 h-5 rounded-full bg-emerald-50 flex items-center justify-center"><ArrowUpCircle size={12} /></div> RECEITA BRUTA
          </div>
          <p className="text-2xl font-black text-navy leading-none">R$ {metrics.financeiro.receitaBruta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          <span className="text-[9px] font-bold text-emerald-500 mt-2 block italic uppercase tracking-widest">Saldo Efetivado (+Est)</span>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center gap-2 mb-4 text-[9px] font-black text-rose-500 uppercase tracking-widest">
            <div className="w-5 h-5 rounded-full bg-rose-50 flex items-center justify-center"><ArrowDownCircle size={12} /></div> GASTOS TOTAIS
          </div>
          <p className="text-2xl font-black text-rose-500 leading-none">R$ {metrics.financeiro.gastosTotais.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          <span className="text-[9px] font-bold text-slate-400 mt-2 block italic uppercase tracking-widest">Saída Efetivada (+Mkt)</span>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center gap-2 mb-4 text-[9px] font-black text-indigo-500 uppercase tracking-widest">
             <div className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center"><TrendingUp size={12} /></div> ROI GLOBAL
          </div>
          <p className={`text-2xl font-black leading-none ${Number(metrics.financeiro.roi) < 0 ? 'text-rose-600' : 'text-indigo-600'}`}>{metrics.financeiro.roi.toFixed(1)}%</p>
          <span className="text-[9px] font-bold text-slate-400 mt-2 block italic uppercase tracking-widest">Performance</span>
        </div>

        <div className="bg-navy p-6 rounded-2xl text-white shadow-xl relative overflow-hidden ring-1 ring-white/10">
          <div className="flex items-center gap-2 mb-4 text-[9px] font-black text-blue-400 uppercase tracking-widest relative z-10">
            <PiggyBank size={14} /> LUCRO LÍQUIDO
          </div>
          <p className="text-2xl font-black leading-none relative z-10">R$ {metrics.financeiro.lucroLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          <span className="text-[9px] font-bold text-emerald-400 mt-2 block italic uppercase tracking-widest relative z-10">Saldo de Caixa</span>
        </div>
      </div>

      {subSection === FinancialSubSection.OVERVIEW && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-10 rounded-[40px] border border-slate-200 shadow-sm">
              <h3 className="text-[11px] font-black text-navy uppercase tracking-widest mb-10">DISTRIBUIÇÃO DE GASTOS (PERÍODO)</h3>
              <div className="h-64 relative">
                <ResponsiveContainer width="100%" height="100%">
                  {distributionData.length > 0 ? (
                    <PieChart>
                      <Pie 
                        data={distributionData} 
                        innerRadius={65} 
                        outerRadius={90} 
                        paddingAngle={4} 
                        dataKey="value"
                        stroke="none"
                      >
                        {distributionData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', fontSize: '12px', fontWeight: 'bold' }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', paddingTop: '20px' }} />
                    </PieChart>
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-400 text-xs italic">Sem dados de gastos para este período.</div>
                  )}
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">ANÁLISE DE LUCRATIVIDADE</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100/50">
                    <div>
                      <h4 className="text-xs font-black text-emerald-800">Consulta Particular</h4>
                      <p className="text-[10px] text-emerald-600 font-bold">Ticket Médio: R$ {metrics.financeiro.ticketMedio.toFixed(0)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-emerald-800">ROI: {metrics.financeiro.roi.toFixed(0)}%</p>
                      <p className="text-[9px] text-emerald-600 font-bold uppercase tracking-widest">Margem Saudável</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-navy p-8 rounded-[40px] text-white shadow-2xl relative overflow-hidden group">
                 <div className="absolute top-0 right-0 p-8 opacity-5"><Bot size={80} /></div>
                 <div className="flex gap-4 items-start relative z-10">
                    <div className="p-3 bg-blue-500/20 text-blue-400 rounded-2xl border border-blue-500/20 shadow-xl shadow-blue-500/10">
                       <Bot size={24} />
                    </div>
                    <div className="flex-1">
                       <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-2 flex items-center gap-2">CONSELHO FINANCEIRO</h4>
                       <p className="text-sm font-medium leading-relaxed italic opacity-90 text-slate-300">
                          {metrics.financeiro.lucroLiquido > 0 
                            ? `"Excelente performance! Sugiro reinvestir 20% do lucro em tráfego pago para escalar os agendamentos."`
                            : `"Atenção ao fluxo de caixa. Revise gastos fixos e foque em recuperação de no-shows para aumentar a receita."`}
                       </p>
                    </div>
                 </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {subSection === FinancialSubSection.CASHFLOW && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white p-10 rounded-[40px] border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center mb-10">
                <div>
                  <h3 className="text-xl font-bold text-navy">Fluxo de Caixa (Real)</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Últimos 6 Meses</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-navy"></div><span className="text-[9px] font-bold text-slate-400 uppercase">Saldo</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div><span className="text-[9px] font-bold text-slate-400 uppercase">Entrada</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div><span className="text-[9px] font-bold text-slate-400 uppercase">Saída</span></div>
                </div>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cashFlowProjection}>
                    <defs>
                      <linearGradient id="colorReal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0f172a" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#0f172a" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} dy={10} />
                    <YAxis hide />
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }} />
                    <Area type="monotone" dataKey="saldo" stroke="#0f172a" strokeWidth={3} fillOpacity={1} fill="url(#colorReal)" />
                    <Line type="monotone" dataKey="entrada" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="saida" stroke="#f43f5e" strokeWidth={2} dot={{ r: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-navy p-8 rounded-[40px] text-white shadow-2xl relative overflow-hidden flex flex-col justify-center border border-white/5">
                <div className="absolute -right-4 -bottom-4 opacity-5"><Target size={160} /></div>
                <div className="flex items-center gap-4 mb-6 relative z-10">
                  <div className="p-3 bg-blue-500 text-white rounded-2xl"><Target size={24} /></div>
                  <div>
                    <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Capacidade de Gasto</h4>
                    <p className="text-xl font-black">R$ {((metrics.financeiro.receitaBruta - metrics.financeiro.gastosTotais) * 0.3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                  </div>
                </div>
                <p className="text-xs leading-relaxed font-medium text-slate-300 relative z-10">
                  Margem segura para novos investimentos (30% do lucro atual).
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {(subSection === FinancialSubSection.PAYABLE || subSection === FinancialSubSection.RECEIVABLE) && (
        <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
          <div className="px-10 py-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="font-black text-navy uppercase text-xs tracking-[0.2em]">
              {subSection === 'payable' ? 'CONTAS A PAGAR' : 'CONTAS A RECEBER'} NO PERÍODO
            </h3>
            <button 
              onClick={() => {
                setFormData(prev => ({ ...prev, type: subSection as any }));
                setShowForm(true);
              }} 
              className="bg-navy text-white px-6 py-3 rounded-2xl text-[12px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-slate-800 transition-all shadow-xl shadow-navy/20 border-2 border-navy"
            >
              <Plus size={18} strokeWidth={3} /> NOVO
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50/50 border-b border-slate-100">
                <tr>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">DATA</th>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">NOME</th>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">STATUS</th>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">VALOR</th>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">AÇÕES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries
                  .filter(e => e.type === subSection)
                  .map(entry => (
                    <tr key={entry.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-10 py-6 text-xs font-bold text-slate-400">{entry.date}</td>
                      <td className="px-10 py-6 text-xs font-bold text-navy uppercase text-center">{entry.name}</td>
                      <td className="px-10 py-6 text-center"><StatusBadge status={entry.status} /></td>
                      <td className="px-10 py-6 text-right text-sm font-black text-navy">R$ {entry.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="px-10 py-6 text-right">
                         <div className="flex items-center justify-end gap-2">
                           <button onClick={() => handleEdit(entry)} className="p-2 text-slate-400 hover:text-navy hover:bg-slate-200 rounded-lg transition-all" title="Editar">
                             <Edit2 size={16} />
                           </button>
                           <button onClick={() => handleDeleteClick(entry.id)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all" title="Excluir">
                             <Trash2 size={16} />
                           </button>
                         </div>
                      </td>
                    </tr>
                  ))}
                {filteredEntries.filter(e => e.type === subSection).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-10 py-24 text-center text-slate-400 text-xs font-medium italic opacity-50">
                      Nenhum lançamento encontrado neste período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FORMULÁRIO MODAL FUNCIONAL */}
      {showForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-navy/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white rounded-[40px] w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <form onSubmit={handleSaveEntry}>
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div>
                  <h3 className="text-xl font-bold text-navy">{editingEntry ? 'Editar Lançamento' : 'Novo Lançamento'}</h3>
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">Preencha os dados do fluxo de caixa</p>
                </div>
                <button type="button" onClick={closeForm} className="p-2 hover:bg-slate-200 rounded-full transition-all text-slate-400"><X size={24} /></button>
              </div>
              
              <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo</label>
                  <div className="flex p-1 bg-slate-100 rounded-xl">
                    <button 
                      type="button"
                      onClick={() => setFormData({ ...formData, type: 'receivable' })}
                      className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${formData.type === 'receivable' ? 'bg-navy text-white shadow-md' : 'text-slate-500'}`}
                    >
                      Entrada
                    </button>
                    <button 
                      type="button"
                      onClick={() => setFormData({ ...formData, type: 'payable' })}
                      className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${formData.type === 'payable' ? 'bg-navy text-white shadow-md' : 'text-slate-500'}`}
                    >
                      Saída
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data</label>
                  <input type="date" required value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:ring-2 focus:ring-navy" />
                </div>

                <div className="md:col-span-2 space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Descrição</label>
                  <input type="text" required placeholder="Ex: Consulta Dr. Carlos" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:ring-2 focus:ring-navy" />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Categoria</label>
                  <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy appearance-none">
                    <option>Consulta Particular</option>
                    <option>Procedimento Estético X</option>
                    <option>Marketing</option>
                    <option>Colaboradores</option>
                    <option>Contas Fixas</option>
                    <option>Insumos</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</label>
                  <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value as any })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy appearance-none">
                    <option value="efetuada">Efetuada / Pago</option>
                    <option value="atrasada">Pendente / Atrasado</option>
                    <option value="cancelada">Cancelada</option>
                  </select>
                </div>

                <div className="md:col-span-2 space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Valor do Lançamento (R$)</label>
                  <input type="number" step="0.01" required value={formData.unitValue} onChange={(e) => setFormData({ ...formData, unitValue: Number(e.target.value) })} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xl font-black text-navy focus:outline-none focus:ring-2 focus:ring-navy" />
                </div>
              </div>

              <div className="p-10 bg-slate-50 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6">
                <div className="text-center md:text-left">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1">Total Confirmado</span>
                  <p className="text-3xl font-black text-navy">R$ {Number(formData.unitValue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="flex gap-4 w-full md:w-auto">
                  <button type="button" onClick={closeForm} className="flex-1 md:flex-none px-8 py-4 text-[10px] font-black uppercase text-slate-400 hover:bg-slate-200 rounded-2xl transition-all">Cancelar</button>
                  <button type="submit" className="flex-1 md:flex-none bg-navy text-white px-10 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-navy/30 hover:bg-slate-800 transition-all flex items-center justify-center gap-2">
                    <Save size={16} /> Salvar Lançamento
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-navy/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white p-8 rounded-[32px] w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-300 text-center">
                <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertTriangle size={32} />
                </div>
                <h3 className="text-xl font-bold text-navy mb-2">Excluir Lançamento?</h3>
                <p className="text-sm text-slate-500 mb-8 leading-relaxed">
                    Tem certeza que deseja remover este item? <br/>
                    <span className="font-bold text-rose-500">Essa ação não pode ser desfeita.</span>
                </p>
                <div className="flex gap-4">
                    <button 
                        onClick={() => setShowDeleteConfirm(false)}
                        className="flex-1 py-3 text-[10px] font-black uppercase text-slate-400 hover:bg-slate-50 rounded-xl transition-all"
                    >
                        Cancelar
                    </button>
                    <button 
                        onClick={confirmDelete}
                        className="flex-1 bg-rose-500 text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-rose-200 hover:bg-rose-600 transition-all"
                    >
                        Sim, Excluir
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Financial;
