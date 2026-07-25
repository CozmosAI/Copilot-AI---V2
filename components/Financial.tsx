
import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Edit2, Trash2, 
  ArrowUpCircle, ArrowDownCircle,
  TrendingUp, TrendingDown, PiggyBank,
  Bot, Target, Calendar, Filter, X, Save,
  AlertTriangle, CheckCircle2, AlertCircle, FileText, Settings, Download
} from 'lucide-react';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, Line
} from 'recharts';
import { FinancialSubSection, FinancialEntry, FinancialEntryStatus, FinancialCategory } from '../types';
import { useApp } from '../App';

type HistoryPeriod = 'month' | '3months' | '6months' | 'year' | 'custom';

const DEFAULT_RECEIVABLE_CATEGORIES = [
  { name: 'Consultas', type: 'receivable' as const, color: '#10b981', sort_order: 1 },
  { name: 'Procedimentos', type: 'receivable' as const, color: '#3b82f6', sort_order: 2 },
  { name: 'Produtos', type: 'receivable' as const, color: '#f59e0b', sort_order: 3 },
  { name: 'Outros', type: 'receivable' as const, color: '#6b7280', sort_order: 4 }
];

const DEFAULT_PAYABLE_CATEGORIES = [
  { name: 'Colaboradores', type: 'payable' as const, color: '#ef4444', sort_order: 1 },
  { name: 'Contas Fixas', type: 'payable' as const, color: '#3b82f6', sort_order: 2 },
  { name: 'Impostos', type: 'payable' as const, color: '#8b5cf6', sort_order: 3 },
  { name: 'Insumos', type: 'payable' as const, color: '#10b981', sort_order: 4 },
  { name: 'Marketing', type: 'payable' as const, color: '#ec4899', sort_order: 5 }
];

const Financial: React.FC = () => {
  const { user, dashboardDateFilter, setDashboardDateFilterByLabel, financialEntries, addFinancialEntry, updateFinancialEntry, deleteFinancialEntry, metrics } = useApp();
  const [subSection, setSubSection] = useState<FinancialSubSection>(FinancialSubSection.OVERVIEW);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FinancialEntry | null>(null);

  // Estados para Modal de Confirmação de Exclusão
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Partial<FinancialCategory> | null>(null);

  const [categoryForm, setCategoryForm] = useState({
    name: '',
    type: 'payable' as 'receivable' | 'payable',
    color: '#3B82F6',
    is_active: true
  });

  const loadCategories = async () => {
    if (!user?.id) return;
    try {
      const { supabase } = await import('../lib/supabase');
      const { data, error } = await supabase
        .from('financial_categories')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order');
        
      if (error) throw error;
      
      if (data && data.length > 0) {
        setCategories(data);
      } else {
        // Se não há categorias, vamos inseri-las para o usuário
        const defaults = [
          ...DEFAULT_RECEIVABLE_CATEGORIES,
          ...DEFAULT_PAYABLE_CATEGORIES
        ].map(c => ({ ...c, user_id: user.id, is_active: true }));
        
        const { data: inserted, error: insError } = await supabase
          .from('financial_categories')
          .insert(defaults)
          .select();
          
        if (!insError && inserted) {
          setCategories(inserted);
        } else {
          setCategories(defaults as any);
        }
      }
    } catch (err) { 
      console.error(err);
      const defaults = [
        ...DEFAULT_RECEIVABLE_CATEGORIES,
        ...DEFAULT_PAYABLE_CATEGORIES
      ].map(c => ({ ...c, user_id: user.id, id: c.name, is_active: true }));
      setCategories(defaults as any);
    }
  };

  useEffect(() => {
    loadCategories();
  }, [user?.id]);

  const [formData, setFormData] = useState<Partial<FinancialEntry>>({
    type: 'receivable',
    category: 'Consultas',
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
      return entryDate >= dashboardDateFilter.start && entryDate <= dashboardDateFilter.end;
    });
  }, [financialEntries, dashboardDateFilter]);

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

  // Distribuição de Gastos REAL baseado em categorias customizadas
  const distributionData = useMemo(() => {
     const expenses = filteredEntries.filter(e => e.type === 'payable');
     const userCategories = categories
       .filter(c => c.type === 'payable' && c.is_active)
       .sort((a, b) => a.sort_order - b.sort_order)
       .map(c => c.name);
       
     const data = userCategories.map(cat => ({
         name: cat,
         value: expenses.filter(e => e.category === cat).reduce((acc, curr) => acc + curr.total, 0),
         fill: categories.find(c => c.name === cat)?.color || '#94a3b8'
     })).filter(d => d.value > 0);

     // Adiciona 'Outros' se houver
     const otherValue = expenses.filter(e => !userCategories.includes(e.category)).reduce((acc, curr) => acc + curr.total, 0);
     if (otherValue > 0) data.push({ name: 'Outros', value: otherValue, fill: '#cbd5e1' });
     
     return data;
  }, [filteredEntries, categories]);

  // Comparativo com mês anterior
  const monthlyComparison = useMemo(() => {
    const today = new Date();
    const currentMonthStr = today.toISOString().slice(0, 7); // YYYY-MM
    
    const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevMonthStr = prevMonthDate.toISOString().slice(0, 7); // YYYY-MM
    
    // Filtra transações efetivadas para receita e despesa do mês atual
    const currentEntries = financialEntries.filter(e => e.date.startsWith(currentMonthStr) && e.status === 'efetuada');
    const currentReceitas = currentEntries.filter(e => e.type === 'receivable').reduce((acc, curr) => acc + curr.total, 0);
    const currentDespesas = currentEntries.filter(e => e.type === 'payable').reduce((acc, curr) => acc + curr.total, 0);
    
    // Filtra transações efetivadas para receita e despesa do mês anterior
    const prevEntries = financialEntries.filter(e => e.date.startsWith(prevMonthStr) && e.status === 'efetuada');
    const prevReceitas = prevEntries.filter(e => e.type === 'receivable').reduce((acc, curr) => acc + curr.total, 0);
    const prevDespesas = prevEntries.filter(e => e.type === 'payable').reduce((acc, curr) => acc + curr.total, 0);
    
    // Calcula as variações percentuais
    const receitaVar = prevReceitas > 0 ? ((currentReceitas - prevReceitas) / prevReceitas) * 100 : 0;
    const despesaVar = prevDespesas > 0 ? ((currentDespesas - prevDespesas) / prevDespesas) * 100 : 0;
    
    return {
      receitaVar,
      despesaVar,
      currentReceitas,
      currentDespesas,
      prevReceitas,
      prevDespesas
    };
  }, [financialEntries]);

  const lastMonthEntries = useMemo(() => {
    // Calcular período do mês anterior equivalente
    const startDate = new Date(dashboardDateFilter.start);
    const endDate = new Date(dashboardDateFilter.end);
    const diffDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    const lastMonthStart = new Date(startDate);
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
    
    const lastMonthEnd = new Date(lastMonthStart);
    lastMonthEnd.setDate(lastMonthEnd.getDate() + diffDays);
    
    const startStr = lastMonthStart.toISOString().split('T')[0];
    const endStr = lastMonthEnd.toISOString().split('T')[0];
    
    return financialEntries.filter(e => 
      e.date >= startStr && e.date <= endStr && e.status !== 'cancelada'
    );
  }, [financialEntries, dashboardDateFilter.start, dashboardDateFilter.end]);

  const lastMonthReceita = lastMonthEntries.filter(e => e.type === 'receivable' && e.status === 'efetuada').reduce((acc, curr) => acc + curr.total, 0);
  const lastMonthDespesas = lastMonthEntries.filter(e => e.type === 'payable').reduce((acc, curr) => acc + curr.total, 0);

  const calcVariation = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  const receitaVariation = calcVariation(metrics.financeiro.receitaBruta, lastMonthReceita);
  const despesasVariation = calcVariation(metrics.financeiro.gastosTotais, lastMonthDespesas);

  // DRE Simplificado
  const dreData = useMemo(() => {
    // 1. Receitas por Categoria
    const receivableEntries = filteredEntries.filter(e => e.type === 'receivable' && e.status === 'efetuada');
    const receivableCategories = categories.filter(c => c.type === 'receivable');
    
    const receitasByCat = receivableCategories.map(cat => {
      const total = receivableEntries.filter(e => e.category === cat.name).reduce((acc, curr) => acc + curr.total, 0);
      return { name: cat.name, total };
    });
    
    const knownReceivableCatNames = receivableCategories.map(c => c.name);
    const extraReceivablesTotal = receivableEntries.filter(e => !knownReceivableCatNames.includes(e.category)).reduce((acc, curr) => acc + curr.total, 0);
    if (extraReceivablesTotal > 0) {
      receitasByCat.push({ name: 'Outras Receitas', total: extraReceivablesTotal });
    }
    
    const totalReceitas = receivableEntries.reduce((acc, curr) => acc + curr.total, 0);

    // 2. Despesas por Categoria
    const payableEntries = filteredEntries.filter(e => e.type === 'payable' && e.status === 'efetuada');
    const payableCategories = categories.filter(c => c.type === 'payable');
    
    const despesasByCat = payableCategories.map(cat => {
      const total = payableEntries.filter(e => e.category === cat.name).reduce((acc, curr) => acc + curr.total, 0);
      return { name: cat.name, total };
    });
    
    const knownPayableCatNames = payableCategories.map(c => c.name);
    const extraPayablesTotal = payableEntries.filter(e => !knownPayableCatNames.includes(e.category)).reduce((acc, curr) => acc + curr.total, 0);
    if (extraPayablesTotal > 0) {
      despesasByCat.push({ name: 'Outras Despesas', total: extraPayablesTotal });
    }
    
    const totalDespesas = payableEntries.reduce((acc, curr) => acc + curr.total, 0);

    // 3. Lucro Líquido & Margem
    const lucroLiquido = totalReceitas - totalDespesas;
    const margem = totalReceitas > 0 ? (lucroLiquido / totalReceitas) * 100 : 0;

    return {
      receitasByCat,
      totalReceitas,
      despesasByCat,
      totalDespesas,
      lucroLiquido,
      margem
    };
  }, [filteredEntries, categories]);

  // CRUD de Categorias
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    try {
      const { supabase } = await import('../lib/supabase');
      if (editingCategory?.id) {
        // Edit
        const { error } = await supabase
          .from('financial_categories')
          .update({
            name: categoryForm.name,
            type: categoryForm.type,
            color: categoryForm.color,
            is_active: categoryForm.is_active
          })
          .eq('id', editingCategory.id);
        if (error) throw error;
        showToast('Categoria atualizada!');
      } else {
        // Create
        const maxSortOrder = categories.reduce((max, c) => c.sort_order > max ? c.sort_order : max, 0);
        const { error } = await supabase
          .from('financial_categories')
          .insert({
            user_id: user.id,
            name: categoryForm.name,
            type: categoryForm.type,
            color: categoryForm.color || '#3B82F6',
            sort_order: maxSortOrder + 1,
            is_active: true
          });
        if (error) throw error;
        showToast('Categoria criada com sucesso!');
      }
      loadCategories();
      setEditingCategory(null);
      setCategoryForm({ name: '', type: 'payable', color: '#3B82F6', is_active: true });
    } catch (err: any) {
      console.error(err);
      showToast('Erro ao salvar categoria: ' + err.message, 'error');
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    try {
      const { supabase } = await import('../lib/supabase');
      const { error } = await supabase
        .from('financial_categories')
        .delete()
        .eq('id', catId);
      if (error) throw error;
      showToast('Categoria excluída!');
      loadCategories();
    } catch (err: any) {
      console.error(err);
      showToast('Erro ao excluir categoria: ' + err.message, 'error');
    }
  };

  const handleStartEditCategory = (cat: FinancialCategory) => {
    setEditingCategory(cat);
    setCategoryForm({
      name: cat.name,
      type: cat.type,
      color: cat.color,
      is_active: cat.is_active
    });
  };

  const handleCancelEditCategory = () => {
    setEditingCategory(null);
    setCategoryForm({ name: '', type: 'payable', color: '#3B82F6', is_active: true });
  };

  const openNewForm = (type: 'receivable' | 'payable') => {
    const filteredCats = categories.filter(c => c.type === type && c.is_active);
    const defaultCat = filteredCats.length > 0 ? filteredCats[0].name : '';
    setFormData({
      type,
      category: defaultCat,
      name: '',
      unitValue: 0,
      discount: 0,
      addition: 0,
      status: 'efetuada',
      date: new Date().toISOString().split('T')[0],
    });
    setShowForm(true);
  };

  const handleFormTypeChange = (newType: 'receivable' | 'payable') => {
    const filteredCats = categories.filter(c => c.type === newType && c.is_active);
    const defaultCat = filteredCats.length > 0 ? filteredCats[0].name : '';
    setFormData(prev => ({ ...prev, type: newType, category: defaultCat }));
  };

  const handleEdit = (entry: FinancialEntry) => {
    setEditingEntry(entry);
    setFormData(entry);
    setShowForm(true);
  };

  const handleDeleteClick = (id: string) => {
    setItemToDelete(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (itemToDelete) {
      const success = await deleteFinancialEntry(itemToDelete);
      showToast(success ? 'Transação excluída!' : 'Erro ao excluir', success ? 'success' : 'error');
      setShowDeleteConfirm(false);
      setItemToDelete(null);
    }
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
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
      const success = await updateFinancialEntry(newEntry);
      showToast(success ? 'Transação atualizada!' : 'Erro ao atualizar', success ? 'success' : 'error');
    } else {
      const success = await addFinancialEntry(newEntry);
      showToast(success ? 'Transação cadastrada!' : 'Erro ao cadastrar', success ? 'success' : 'error');
    }
    
    closeForm();
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingEntry(null);
    const filteredCats = categories.filter(c => c.type === 'receivable' && c.is_active);
    const defaultCat = filteredCats.length > 0 ? filteredCats[0].name : 'Consultas';
    setFormData({
      type: 'receivable',
      category: defaultCat,
      name: '',
      unitValue: 0,
      discount: 0,
      addition: 0,
      status: 'efetuada',
      date: new Date().toISOString().split('T')[0],
    });
  };

  const handleExportCSV = () => {
    const headers = ['ID', 'Data', 'Tipo', 'Categoria', 'Nome', 'Status', 'Valor (R$)'];
    const rows = filteredEntries.map(e => [
      e.id,
      e.date,
      e.type === 'receivable' ? 'Entrada' : 'Saída',
      `"${(e.category || '').replace(/"/g, '""')}"`,
      `"${(e.name || '').replace(/"/g, '""')}"`,
      e.status,
      e.total.toFixed(2)
    ]);
    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `financeiro_${dashboardDateFilter.start}_${dashboardDateFilter.end}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-200 overflow-x-auto shrink-0 max-w-full">
          {[
            { id: FinancialSubSection.OVERVIEW, label: 'Visão Geral' },
            { id: FinancialSubSection.PAYABLE, label: 'Contas a Pagar' },
            { id: FinancialSubSection.RECEIVABLE, label: 'Contas a Receber' },
            { id: FinancialSubSection.CASHFLOW, label: 'Caixa + Fluxo' },
            { id: FinancialSubSection.DRE, label: 'DRE' }
          ].map((tab) => (
            <button 
              key={tab.id} 
              onClick={() => setSubSection(tab.id as FinancialSubSection)} 
              className={`px-4 py-2 text-[10px] font-black uppercase tracking-tighter rounded-lg transition-all whitespace-nowrap ${subSection === tab.id ? 'bg-navy text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              {tab.label}
            </button>
          ))}
          <div className="border-l border-slate-200 mx-1 my-1.5"></div>
          <button 
            type="button"
            onClick={() => setShowCategoryManager(true)}
            className="px-3 py-2 text-[10px] font-black uppercase tracking-tighter text-navy hover:bg-slate-50 rounded-lg transition-all flex items-center gap-1 shrink-0"
            title="Gerenciar Categorias Customizadas"
          >
            <Settings size={12} /> Categorias
          </button>
          <button 
            type="button"
            onClick={handleExportCSV}
            className="px-3 py-2 text-[10px] font-black uppercase tracking-tighter text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-all flex items-center gap-1 shrink-0 ml-1 border border-emerald-200"
            title="Exportar dados para CSV com acentuação correta no Excel"
          >
            <Download size={12} /> Exportar CSV
          </button>
        </div>
      </header>

      {/* DASHBOARD CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between gap-1.5 md:gap-2 mb-2 md:mb-4">
            <div className="flex items-center gap-1.5 md:gap-2 text-[8px] md:text-[9px] font-black text-emerald-500 uppercase tracking-widest truncate">
              <div className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                <ArrowUpCircle size={10} className="md:w-3 md:h-3" />
              </div> 
              RECEITA BRUTA
            </div>
          </div>
          <p className="text-base md:text-2xl font-black text-navy leading-none">R$ {metrics.financeiro.receitaBruta.toLocaleString('pt-BR', { notation: 'compact' })}</p>
          <div className="flex items-center gap-1 mt-1">
            <span className={`text-[10px] font-bold flex items-center gap-0.5 ${receitaVariation >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {receitaVariation >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
              {receitaVariation >= 0 ? '+' : ''}{receitaVariation.toFixed(1)}%
            </span>
            <span className="text-[9px] text-slate-400">vs mês anterior</span>
          </div>
          <span className="text-[8px] md:text-[9px] font-bold text-emerald-500 mt-1.5 md:mt-2 block italic uppercase tracking-widest truncate">Saldo Efetivado</span>
        </div>

        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between gap-1.5 md:gap-2 mb-2 md:mb-4">
            <div className="flex items-center gap-1.5 md:gap-2 text-[8px] md:text-[9px] font-black text-rose-500 uppercase tracking-widest truncate">
              <div className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-rose-50 flex items-center justify-center shrink-0">
                <ArrowDownCircle size={10} className="md:w-3 md:h-3" />
              </div> 
              GASTOS TOTAIS
            </div>
          </div>
          <p className="text-base md:text-2xl font-black text-rose-500 leading-none">R$ {metrics.financeiro.gastosTotais.toLocaleString('pt-BR', { notation: 'compact' })}</p>
          <div className="flex items-center gap-1 mt-1">
            <span className={`text-[10px] font-bold flex items-center gap-0.5 ${despesasVariation <= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {despesasVariation <= 0 ? <TrendingDown size={12}/> : <TrendingUp size={12}/>}
              {despesasVariation >= 0 ? '+' : ''}{despesasVariation.toFixed(1)}%
            </span>
            <span className="text-[9px] text-slate-400">vs mês anterior</span>
          </div>
          <span className="text-[8px] md:text-[9px] font-bold text-slate-400 mt-1.5 md:mt-2 block italic uppercase tracking-widest truncate">Saída Efetivada</span>
        </div>

        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center gap-1.5 md:gap-2 mb-2 md:mb-4 text-[8px] md:text-[9px] font-black text-indigo-500 uppercase tracking-widest truncate">
             <div className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-indigo-50 flex items-center justify-center shrink-0"><TrendingUp size={10} className="md:w-3 md:h-3" /></div> ROI GLOBAL
          </div>
          <p className={`text-base md:text-2xl font-black leading-none ${Number(metrics.financeiro.roi) < 0 ? 'text-rose-600' : 'text-indigo-600'}`}>{metrics.financeiro.roi.toFixed(1)}%</p>
          <span className="text-[8px] md:text-[9px] font-bold text-slate-400 mt-1.5 md:mt-2 block italic uppercase tracking-widest truncate">Performance</span>
        </div>

        <div className="bg-navy p-3 md:p-6 rounded-xl md:rounded-2xl text-white shadow-xl relative overflow-hidden ring-1 ring-white/10">
          <div className="flex items-center gap-1.5 md:gap-2 mb-2 md:mb-4 text-[8px] md:text-[9px] font-black text-blue-400 uppercase tracking-widest relative z-10 truncate">
            <PiggyBank size={12} className="shrink-0" /> LUCRO LÍQUIDO
          </div>
          <p className="text-base md:text-2xl font-black leading-none relative z-10">R$ {metrics.financeiro.lucroLiquido.toLocaleString('pt-BR', { notation: 'compact' })}</p>
          <span className="text-[8px] md:text-[9px] font-bold text-emerald-400 mt-1.5 md:mt-2 block italic uppercase tracking-widest relative z-10 truncate">Saldo de Caixa</span>
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
          <div className="px-10 py-8 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50/50">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
              <h3 className="font-black text-navy uppercase text-xs tracking-[0.2em] whitespace-nowrap">
                {subSection === 'payable' ? 'CONTAS A PAGAR' : 'CONTAS A RECEBER'} NO PERÍODO
              </h3>
              
              {/* Filtro por Categoria */}
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm w-full sm:w-auto">
                <Filter size={12} className="text-slate-400 shrink-0" />
                <select 
                  value={filterCategory} 
                  onChange={e => setFilterCategory(e.target.value)}
                  className="bg-transparent border-none text-[10px] font-bold text-slate-600 uppercase tracking-wider focus:outline-none focus:ring-0 cursor-pointer pr-4 w-full sm:w-auto"
                >
                  <option value="">Todas as categorias</option>
                  {categories.filter(c => c.type === subSection).map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <button 
              type="button"
              onClick={() => openNewForm(subSection as any)} 
              className="w-full sm:w-auto bg-navy text-white px-6 py-3 rounded-2xl text-[12px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-xl shadow-navy/20 border-2 border-navy"
            >
              <Plus size={18} strokeWidth={3} /> NOVO
            </button>
          </div>
          <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
            <table className="min-w-[800px] w-full text-left">
              <thead className="bg-slate-50/50 border-b border-slate-100">
                <tr>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">DATA</th>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">CATEGORIA</th>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">NOME</th>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">STATUS</th>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">VALOR</th>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">AÇÕES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries
                  .filter(e => e.type === subSection)
                  .filter(e => !filterCategory || e.category === filterCategory)
                  .map(entry => (
                    <tr key={entry.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-10 py-6 text-xs font-bold text-slate-400">{entry.date}</td>
                      <td className="px-10 py-6 text-xs font-black text-center">
                        <span 
                          className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border"
                          style={{
                            color: categories.find(c => c.name === entry.category)?.color || '#64748b',
                            backgroundColor: (categories.find(c => c.name === entry.category)?.color || '#64748b') + '10',
                            borderColor: (categories.find(c => c.name === entry.category)?.color || '#64748b') + '30'
                          }}
                        >
                          {entry.category}
                        </span>
                      </td>
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
                {filteredEntries.filter(e => e.type === subSection).filter(e => !filterCategory || e.category === filterCategory).length === 0 && (
                  financialEntries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-10 py-20 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                            <FileText size={28} className="text-slate-300" />
                          </div>
                          <p className="text-slate-500 font-bold text-sm">Nenhuma transação cadastrada ainda</p>
                          <p className="text-slate-400 text-xs">Cadastre sua primeira transação para começar a controlar seu fluxo de caixa.</p>
                          <button 
                            type="button"
                            onClick={() => openNewForm(subSection as any)} 
                            className="mt-2 px-4 py-2 bg-navy text-white text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-2 mx-auto"
                          >
                            <Plus size={14} /> Adicionar Transação
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-10 py-24 text-center text-slate-400 text-xs font-medium italic opacity-50">
                        Nenhum lançamento encontrado neste período.
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subSection === FinancialSubSection.DRE && (
        <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-500">
          <div className="px-10 py-8 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="font-black text-navy uppercase text-xs tracking-[0.2em]">DEMONSTRATIVO DE RESULTADO DO EXERCÍCIO (DRE)</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Regime de Caixa • Período Selecionado</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Margem Líquida</span>
              <p className={`text-xl font-black ${dreData.lucroLiquido >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {dreData.margem.toFixed(1)}%
              </p>
            </div>
          </div>
          
          <div className="p-10 space-y-8">
            {/* Tabela Receitas */}
            <div>
              <div className="flex justify-between items-center border-b-2 border-slate-100 pb-2 mb-4">
                <span className="text-xs font-black text-navy uppercase tracking-widest">1. RECEITAS</span>
                <span className="text-sm font-black text-emerald-600">R$ {dreData.totalReceitas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>
              <table className="w-full">
                <tbody>
                  {dreData.receitasByCat.map((item, idx) => (
                    <tr key={`dre-receitas-${item.name}`} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">{item.name}</td>
                      <td className="py-3 text-right text-xs font-extrabold text-navy">R$ {item.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {dreData.receitasByCat.length === 0 && (
                    <tr>
                      <td className="py-3 text-xs text-slate-400 italic">Nenhuma receita efetuada no período.</td>
                      <td className="py-3 text-right text-xs text-slate-400">R$ 0,00</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Tabela Despesas */}
            <div>
              <div className="flex justify-between items-center border-b-2 border-slate-100 pb-2 mb-4">
                <span className="text-xs font-black text-navy uppercase tracking-widest">2. DESPESAS / GASTOS</span>
                <span className="text-sm font-black text-rose-600">R$ {dreData.totalDespesas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>
              <table className="w-full">
                <tbody>
                  {dreData.despesasByCat.map((item, idx) => (
                    <tr key={`dre-despesas-${item.name}`} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">{item.name}</td>
                      <td className="py-3 text-right text-xs font-extrabold text-navy">R$ {item.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {dreData.despesasByCat.length === 0 && (
                    <tr>
                      <td className="py-3 text-xs text-slate-400 italic">Nenhuma despesa efetuada no período.</td>
                      <td className="py-3 text-right text-xs text-slate-400">R$ 0,00</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Resultado Final */}
            <div className="pt-6 border-t-2 border-slate-200">
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">RESULTADO LÍQUIDO DO PERÍODO</span>
                  <h4 className="text-xl font-black text-navy">LUCRO / PREJUÍZO LÍQUIDO</h4>
                </div>
                <div className="text-right">
                  <p className={`text-2xl font-black ${dreData.lucroLiquido >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    R$ {dreData.lucroLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                  <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block mt-1">Margem: {dreData.margem.toFixed(1)}%</span>
                </div>
              </div>
            </div>
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
                      onClick={() => handleFormTypeChange('receivable')}
                      className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${formData.type === 'receivable' ? 'bg-navy text-white shadow-md' : 'text-slate-500'}`}
                    >
                      Entrada
                    </button>
                    <button 
                      type="button"
                      onClick={() => handleFormTypeChange('payable')}
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
                  <select 
                    value={formData.category} 
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })} 
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy appearance-none focus:outline-none focus:ring-2 focus:ring-navy"
                  >
                    {(formData.type === 'receivable' ? categories.filter(c => c.type === 'receivable' && c.is_active) : categories.filter(c => c.type === 'payable' && c.is_active)).map(cat => (
                      <option key={cat.id} value={cat.name}>{cat.name}</option>
                    ))}
                    {categories.filter(c => c.type === formData.type && c.is_active).length === 0 && (
                      <option value="">Nenhuma categoria cadastrada</option>
                    )}
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

      {/* MODAL DE GERENCIAMENTO DE CATEGORIAS */}
      {showCategoryManager && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-navy/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white rounded-[40px] w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="text-xl font-bold text-navy">Gerenciar Categorias Customizadas</h3>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">Crie, edite e organize suas categorias</p>
              </div>
              <button type="button" onClick={() => { setShowCategoryManager(false); handleCancelEditCategory(); }} className="p-2 hover:bg-slate-200 rounded-full transition-all text-slate-400"><X size={24} /></button>
            </div>

            <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8 max-h-[60vh] overflow-y-auto">
              {/* Form de Criação/Edição */}
              <div className="space-y-4 border-r border-slate-100 pr-0 md:pr-8">
                <h4 className="text-xs font-black text-navy uppercase tracking-widest">{editingCategory ? 'Editar Categoria' : 'Adicionar Categoria'}</h4>
                <form onSubmit={handleSaveCategory} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome da Categoria</label>
                    <input 
                      type="text" 
                      required 
                      placeholder="Ex: Consultas" 
                      value={categoryForm.name} 
                      onChange={e => setCategoryForm({ ...categoryForm, name: e.target.value })} 
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:ring-2 focus:ring-navy" 
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo</label>
                    <select 
                      value={categoryForm.type} 
                      onChange={e => setCategoryForm({ ...categoryForm, type: e.target.value as any })} 
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy appearance-none focus:outline-none focus:ring-2 focus:ring-navy"
                    >
                      <option value="receivable">Receita (Entrada)</option>
                      <option value="payable">Despesa (Saída)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cor de Identificação</label>
                    <div className="flex gap-2 items-center">
                      <input 
                        type="color" 
                        value={categoryForm.color} 
                        onChange={e => setCategoryForm({ ...categoryForm, color: e.target.value })} 
                        className="w-10 h-10 p-0 border border-slate-200 rounded-xl cursor-pointer" 
                      />
                      <input 
                        type="text" 
                        value={categoryForm.color} 
                        onChange={e => setCategoryForm({ ...categoryForm, color: e.target.value })} 
                        className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:ring-2 focus:ring-navy" 
                      />
                    </div>
                  </div>

                  {editingCategory && (
                    <div className="flex items-center gap-2 py-2">
                      <input 
                        type="checkbox" 
                        id="cat_active" 
                        checked={categoryForm.is_active} 
                        onChange={e => setCategoryForm({ ...categoryForm, is_active: e.target.checked })} 
                        className="rounded border-slate-300 text-navy focus:ring-navy" 
                      />
                      <label htmlFor="cat_active" className="text-xs font-bold text-slate-600 uppercase tracking-wide cursor-pointer">Categoria Ativa</label>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    {editingCategory && (
                      <button 
                        type="button" 
                        onClick={handleCancelEditCategory} 
                        className="flex-1 py-3 text-[10px] font-black uppercase text-slate-400 hover:bg-slate-100 rounded-xl transition-all border border-slate-200"
                      >
                        Cancelar
                      </button>
                    )}
                    <button 
                      type="submit" 
                      className="flex-1 bg-navy text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center justify-center gap-1.5"
                    >
                      <Save size={14} /> {editingCategory ? 'Salvar' : 'Adicionar'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Lista das categorias cadastradas */}
              <div className="space-y-4">
                <h4 className="text-xs font-black text-navy uppercase tracking-widest">Categorias Ativas</h4>
                <div className="space-y-2.5">
                  {categories.map(cat => (
                    <div key={cat.id} className="flex justify-between items-center p-3.5 bg-slate-50 border border-slate-200/60 rounded-2xl hover:shadow-sm transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-4.5 h-4.5 rounded-full border border-black/10" style={{ backgroundColor: cat.color }}></div>
                        <div>
                          <p className="text-xs font-extrabold text-navy uppercase tracking-wider">{cat.name}</p>
                          <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">
                            {cat.type === 'receivable' ? 'Receita' : 'Despesa'} {!cat.is_active && '• Inativa'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => handleStartEditCategory(cat)} 
                          className="p-1.5 text-slate-400 hover:text-navy hover:bg-slate-200 rounded-lg transition-all" 
                          title="Editar"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button 
                          onClick={() => handleDeleteCategory(cat.id)} 
                          className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all" 
                          title="Excluir"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {categories.length === 0 && (
                    <p className="text-xs italic text-slate-400 text-center py-8">Nenhuma categoria configurada.</p>
                  )}
                </div>
              </div>
            </div>
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

      {/* SYSTEM TOAST */}
      {toast && (
          <div className={`fixed bottom-6 right-6 z-[120] px-5 py-3 rounded-xl shadow-2xl font-bold text-sm flex items-center gap-2 animate-in slide-in-from-bottom-2 duration-300 ${
              toast.type === 'success' ? 'bg-emerald-500 text-white' :
              toast.type === 'error' ? 'bg-rose-500 text-white' :
              'bg-navy text-white'
          }`}>
              {toast.type === 'success' && <CheckCircle2 size={18} />}
              {toast.type === 'error' && <AlertCircle size={18} />}
              <span>{toast.message}</span>
          </div>
      )}
    </div>
  );
};

export default Financial;
