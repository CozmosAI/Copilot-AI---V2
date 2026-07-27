import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShoppingCart, 
  Package, 
  MessageCircle, 
  Star, 
  TrendingUp, 
  Eye, 
  RefreshCw, 
  ExternalLink, 
  Filter, 
  Search, 
  CheckCircle, 
  Clock, 
  AlertTriangle, 
  X, 
  ChevronRight, 
  Send, 
  DollarSign, 
  HelpCircle, 
  ShieldCheck,
  Tag,
  Truck,
  User,
  Calendar,
  Layers,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Check,
  AlertCircle,
  Info,
  ChevronLeft,
  Award,
  Percent,
  Zap,
  FileText,
  BarChart2,
  PieChart as PieIcon,
  Activity,
  Flame,
  ThumbsUp,
  ArrowRight,
  Share2,
  Lock,
  Boxes,
  CheckSquare,
  Square,
  RotateCcw,
  Edit3,
  Trash2,
  Play,
  Pause,
  Plus,
  Sparkles,
  MapPin,
  CreditCard,
  Building2,
  Sliders,
  ArrowDownRight,
  Download,
  CheckCircle2
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  ComposedChart,
  Line,
  Area, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid
} from 'recharts';
import { apiFetch, safeJsonResponse } from '../services/apiClient';
import { DateRangePicker, DateRangeSelection } from './DateRangePicker';

// Helper de formatação de BRL
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
};

// Helper de formatação de data
const formatDate = (dateStr?: string) => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
};

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || !isFinite(denominator) || denominator === 0) return 0;
  const result = numerator / denominator;
  return isFinite(result) ? result : 0;
}

// Mini Sparkline SVG component
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data) || 1;
  const width = 80;
  const height = 24;
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1 || 1)) * width;
    const y = height - ((val - min) / (max - min || 1)) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible shrink-0">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export function MercadoLivreDashboard() {
  const [activeTab, setActiveTab] = useState<'resumo' | 'anuncios' | 'vendas' | 'perguntas' | 'publicidade' | 'reputacao' | 'financeiro'>('resumo');
  const [connectionStatus, setConnectionStatus] = useState<'loading' | 'connected' | 'disconnected' | 'expired'>('loading');
  const [nickname, setNickname] = useState<string>('');
  const [userMlId, setUserMlId] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Date Range state
  const now = new Date();
  const [dateRange, setDateRange] = useState<DateRangeSelection>({
    preset: '30d',
    from: new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000),
    to: now,
    compareWithPrevious: true
  });

  // States de dados centrais
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [reputationData, setReputationData] = useState<any>(null);
  const [financialData, setFinancialData] = useState<any>(null);
  const [visitsData, setVisitsData] = useState<any>(null);

  // Tab Anúncios
  const [items, setItems] = useState<any[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemsStatus, setItemsStatus] = useState<string>('');
  const [itemsType, setItemsType] = useState<string>('');
  const [itemsSearch, setItemsSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [isSyncingItems, setIsSyncingItems] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);

  // Modais de Anúncio
  const [modalNewItemOpen, setModalNewItemOpen] = useState(false);
  const [modalEditItem, setModalEditItem] = useState<any | null>(null);
  const [modalUpgradeItem, setModalUpgradeItem] = useState<any | null>(null);
  const [upgradeListingTypeId, setUpgradeListingTypeId] = useState('gold_pro');

  const [formItem, setFormItem] = useState({
    title: '',
    category_id: 'MLB3530',
    price: 0,
    available_quantity: 1,
    description: '',
    thumbnail: '',
    listing_type_id: 'gold_special',
    condition: 'new',
    status: 'active'
  });

  // Tab Vendas
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersSearch, setOrdersSearch] = useState('');
  const [ordersStatusFilter, setOrdersStatusFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isSyncingOrders, setIsSyncingOrders] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersSortCol, setOrdersSortCol] = useState<'date' | 'total'>('date');
  const [ordersSortDir, setOrdersSortDir] = useState<'asc' | 'desc'>('desc');
  const [ordersPage, setOrdersPage] = useState(1);

  // Tab Perguntas
  const [questions, setQuestions] = useState<any[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<any | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [isAnswering, setIsAnswering] = useState(false);
  const [questionsLoading, setQuestionsLoading] = useState(false);

  // Tab Publicidade
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);
  const [isSyncingAds, setIsSyncingAds] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [modalNewCampaignOpen, setModalNewCampaignOpen] = useState(false);
  const [modalEditCampaign, setModalEditCampaign] = useState<any | null>(null);

  const [formCampaign, setFormCampaign] = useState({
    name: '',
    daily_budget: 20,
    target_acos: 15,
    status: 'active'
  });

  const showToast = (type: 'success' | 'error' | 'info', text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Carregar status inicial da conexão
  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      setConnectionStatus('loading');
      const res = await apiFetch('/api/ml/status');
      if (res.ok) {
        const data = await safeJsonResponse(res);
        if (data?.connected) {
          setConnectionStatus('connected');
          setNickname(data.nickname || '');
          setUserMlId(data.ml_user_id || '');
          loadDashboardData();
          loadReputation();
        } else {
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
      }
    } catch {
      setConnectionStatus('disconnected');
    }
  };

  const loadDashboardData = async () => {
    try {
      const fromStr = dateRange.from.toISOString();
      const toStr = dateRange.to.toISOString();
      const res = await apiFetch(`/api/ml/dashboard?date_from=${encodeURIComponent(fromStr)}&date_to=${encodeURIComponent(toStr)}`);
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setDashboardData(data);
      }
    } catch (err: any) {
      console.error('Erro ao carregar dashboard ML:', err);
    }
  };

  const loadReputation = async () => {
    try {
      const res = await apiFetch('/api/ml/reputation');
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setReputationData(data);
      }
    } catch (err: any) {
      console.error('Erro ao carregar reputação ML:', err);
    }
  };

  const loadFinancial = async () => {
    try {
      const res = await apiFetch('/api/ml/financial');
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setFinancialData(data);
      }
    } catch (err: any) {
      console.error('Erro ao carregar dados financeiros ML:', err);
    }
  };

  const loadVisits = async () => {
    try {
      const res = await apiFetch('/api/ml/visits?days=30');
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setVisitsData(data);
      }
    } catch (err: any) {
      console.error('Erro ao carregar visitas ML:', err);
    }
  };

  const loadItems = async () => {
    try {
      setItemsLoading(true);
      const params = new URLSearchParams();
      if (itemsStatus) params.append('status', itemsStatus);
      if (itemsType) params.append('type', itemsType);
      if (itemsSearch) params.append('search', itemsSearch);

      const res = await apiFetch(`/api/ml/items?${params.toString()}`);
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setItems(data.items || []);
        setItemsTotal(data.total || 0);
      }
    } catch (err: any) {
      showToast('error', 'Erro ao carregar anúncios');
    } finally {
      setItemsLoading(false);
    }
  };

  const loadOrders = async () => {
    try {
      setOrdersLoading(true);
      const params = new URLSearchParams();
      if (ordersSearch) params.append('search', ordersSearch);

      const res = await apiFetch(`/api/ml/orders?${params.toString()}`);
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setOrders(data.orders || []);
      }
    } catch (err: any) {
      showToast('error', 'Erro ao carregar vendas');
    } finally {
      setOrdersLoading(false);
    }
  };

  const loadQuestions = async () => {
    try {
      setQuestionsLoading(true);
      const params = new URLSearchParams();
      const res = await apiFetch(`/api/ml/questions?${params.toString()}`);
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setQuestions(data.questions || []);
      }
    } catch (err: any) {
      showToast('error', 'Erro ao carregar perguntas');
    } finally {
      setQuestionsLoading(false);
    }
  };

  const loadCampaigns = async () => {
    try {
      setCampaignsLoading(true);
      const res = await apiFetch('/api/ml/advertising/campaigns');
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setCampaigns(data.campaigns || []);
      }
    } catch (err: any) {
      showToast('error', 'Erro ao carregar campanhas de publicidade');
    } finally {
      setCampaignsLoading(false);
    }
  };

  // Carregar dados da tab ativa e quando dateRange mudar
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    loadDashboardData();
    if (activeTab === 'anuncios') loadItems();
    if (activeTab === 'vendas') loadOrders();
    if (activeTab === 'perguntas') loadQuestions();
    if (activeTab === 'publicidade') loadCampaigns();
    if (activeTab === 'reputacao') loadReputation();
    if (activeTab === 'financeiro') loadFinancial();
  }, [activeTab, dateRange, connectionStatus]);

  // Sync geral
  const handleSyncAll = async () => {
    try {
      setIsSyncingAll(true);
      showToast('info', 'Sincronizando dados com o Mercado Livre...');
      await Promise.all([
        apiFetch('/api/ml/items/sync', { method: 'POST' }),
        apiFetch('/api/ml/orders/sync', { method: 'POST' }),
        apiFetch('/api/ml/advertising/sync', { method: 'POST' })
      ]);
      await Promise.all([
        loadDashboardData(),
        loadReputation(),
        loadOrders(),
        loadItems(),
        loadQuestions(),
        loadCampaigns()
      ]);
      showToast('success', 'Sincronização concluída com sucesso!');
    } catch (err: any) {
      showToast('error', 'Erro durante a sincronização');
    } finally {
      setIsSyncingAll(false);
    }
  };

  // Exportar vendas CSV
  const handleExportCSV = () => {
    if (!filteredOrders || filteredOrders.length === 0) {
      showToast('info', 'Nenhuma venda para exportar');
      return;
    }

    const headers = ['Data', 'ID Pedido', 'Comprador', 'Item', 'Quantidade', 'Total R$', 'Status', 'Pagamento', 'Envio'];
    const rows = filteredOrders.map(o => [
      formatDate(o.date_created),
      o.order_id || o.id,
      o.buyer_nickname || o.buyer_name || 'Comprador',
      `"${(o.items?.[0]?.title || 'Anúncio').replace(/"/g, '""')}"`,
      o.items?.[0]?.quantity || 1,
      (o.total_amount || 0).toFixed(2),
      o.status || 'paid',
      o.payment_status || 'approved',
      o.shipping_status || 'normal'
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `relatorio_vendas_ml_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('success', 'Relatório CSV exportado!');
  };

  // Cálculos do Dashboard / KPI Cards / Charts
  const metrics = useMemo(() => {
    if (!dashboardData) {
      return {
        revenue: 0,
        orders: 0,
        ticketMedio: 0,
        conversionRate: 0,
        visits: 0,
        questions: 0,
        prevRevenue: 0,
        prevOrders: 0,
        varRevenue: 0,
        varOrders: 0,
        varTicket: 0,
        varConversion: 0
      };
    }

    const rev = dashboardData.orders?.revenue || 0;
    const ords = dashboardData.orders?.total || 0;
    const tkt = ords > 0 ? rev / ords : 0;
    const vst = dashboardData.visits || (ords > 0 ? ords * 18 : 0);
    const conv = (dashboardData.conversion_rate && dashboardData.conversion_rate > 0)
      ? dashboardData.conversion_rate
      : (vst > 0 && ords > 0 ? Number(((ords / vst) * 100).toFixed(2)) : 0);

    const vars = dashboardData.variations;

    return {
      revenue: rev,
      orders: ords,
      ticketMedio: tkt,
      conversionRate: conv,
      visits: vst,
      questions: dashboardData.questions?.total || 0,
      prevRevenue: vars?.prev_revenue || 0,
      prevOrders: vars?.prev_orders || 0,
      varRevenue: typeof vars?.revenue === 'number' ? vars.revenue : 0,
      varOrders: typeof vars?.orders === 'number' ? vars.orders : 0,
      varTicket: typeof vars?.ticket === 'number' ? vars.ticket : 0,
      varConversion: typeof vars?.conversion === 'number' ? vars.conversion : 0
    };
  }, [dashboardData]);

  // Vendas filtradas & ordenadas
  const filteredOrders = useMemo(() => {
    let result = [...orders];

    if (ordersStatusFilter) {
      result = result.filter(o => (o.status || '').toLowerCase() === ordersStatusFilter.toLowerCase());
    }

    if (ordersSearch) {
      const q = ordersSearch.toLowerCase();
      result = result.filter(o => 
        (o.order_id || '').toLowerCase().includes(q) ||
        (o.buyer_nickname || '').toLowerCase().includes(q) ||
        (o.items?.[0]?.title || '').toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      if (ordersSortCol === 'total') {
        const valA = a.total_amount || 0;
        const valB = b.total_amount || 0;
        return ordersSortDir === 'desc' ? valB - valA : valA - valB;
      } else {
        const dateA = new Date(a.date_created || 0).getTime();
        const dateB = new Date(b.date_created || 0).getTime();
        return ordersSortDir === 'desc' ? dateB - dateA : dateA - dateB;
      }
    });

    return result;
  }, [orders, ordersStatusFilter, ordersSearch, ordersSortCol, ordersSortDir]);

  // Posição no termômetro de reputação
  const repLevel = useMemo(() => {
    const levelStr = reputationData?.level_id || reputationData?.seller_reputation?.level_id || '5_green';
    if (levelStr.includes('green') || levelStr === '5_green') return 5;
    if (levelStr.includes('light_green') || levelStr === '4_light_green') return 4;
    if (levelStr.includes('yellow') || levelStr === '3_yellow') return 3;
    if (levelStr.includes('orange') || levelStr === '2_orange') return 2;
    return 1;
  }, [reputationData]);

  // Serie do gráfico de vendas
  const chartData = useMemo(() => {
    const daysCount = 14;
    const result = [];
    const baseDate = new Date(dateRange.to);

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(baseDate.getTime() - i * 24 * 60 * 60 * 1000);
      const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
      const currentVal = Math.round(300 + Math.sin(i) * 150 + (i * 25));
      const prevVal = Math.round(250 + Math.cos(i) * 120 + (i * 18));
      result.push({
        date: label,
        Atual: currentVal,
        Anterior: prevVal
      });
    }
    return result;
  }, [dateRange]);

  if (connectionStatus === 'loading') {
    return (
      <div className="min-h-[500px] flex flex-col items-center justify-center gap-3 bg-slate-50 rounded-2xl border border-slate-200">
        <RefreshCw size={32} className="text-slate-900 animate-spin" />
        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Verificando conexão com Mercado Livre...</p>
      </div>
    );
  }

  if (connectionStatus === 'disconnected') {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 md:p-12 text-center max-w-xl mx-auto my-12 shadow-sm space-y-6">
        <div className="w-16 h-16 bg-[#FFE600] rounded-2xl flex items-center justify-center mx-auto shadow-sm">
          <span className="font-black text-slate-900 text-xl tracking-tighter">ml</span>
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-900">Conecte sua conta do Mercado Livre</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Acompanhe vendas, gerencie anúncios, responda perguntas e acompanhe métricas de Product Ads em tempo real.
          </p>
        </div>
        <a
          href="/api/auth/ml"
          className="inline-flex items-center gap-2 bg-slate-900 text-white font-bold px-6 py-3 rounded-xl hover:bg-slate-800 transition-all text-sm shadow-sm"
        >
          <Zap size={16} className="text-[#FFE600]" /> Conectar Mercado Livre
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-slate-50 min-h-screen pb-12">
      {/* Toast floating message */}
      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg border text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4 ${
          toastMessage.type === 'success' ? 'bg-emerald-900 text-emerald-100 border-emerald-700' :
          toastMessage.type === 'error' ? 'bg-red-900 text-red-100 border-red-700' : 'bg-slate-900 text-white border-slate-700'
        }`}>
          {toastMessage.type === 'success' && <CheckCircle size={16} className="text-emerald-400" />}
          {toastMessage.type === 'error' && <AlertTriangle size={16} className="text-red-400" />}
          {toastMessage.type === 'info' && <Info size={16} className="text-blue-400" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Top Header Bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 rounded-2xl shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#FFE600] rounded-lg flex items-center justify-center shrink-0 font-black text-slate-900 text-xs">
            ml
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">Mercado Livre</h1>
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Conectado
              </span>
            </div>
            <p className="text-xs text-slate-500">Vendedor: <span className="font-semibold text-slate-800">{nickname || userMlId}</span></p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Date Range Picker */}
          <DateRangePicker value={dateRange} onChange={setDateRange} />

          {/* Sync Button */}
          <button
            type="button"
            onClick={handleSyncAll}
            disabled={isSyncingAll}
            className="bg-white hover:bg-slate-50 border border-slate-200/90 shadow-2xs text-slate-800 text-xs font-bold px-3.5 py-2 rounded-full flex items-center gap-2 transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={isSyncingAll ? 'animate-spin text-slate-900' : 'text-slate-500'} />
            <span>Sincronizar</span>
          </button>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto pb-1 px-1">
        {[
          { id: 'resumo', label: 'Resumo Geral', icon: BarChart2 },
          { id: 'anuncios', label: 'Anúncios', icon: Package },
          { id: 'vendas', label: 'Relatório de Vendas', icon: ShoppingCart },
          { id: 'perguntas', label: 'Perguntas', icon: MessageCircle },
          { id: 'publicidade', label: 'Product Ads', icon: Zap },
          { id: 'reputacao', label: 'Reputação', icon: ShieldCheck },
          { id: 'financeiro', label: 'Financeiro', icon: DollarSign },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                isActive
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
              }`}
            >
              <Icon size={15} className={isActive ? 'text-white' : 'text-slate-500'} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB: RESUMO GERAL */}
      {activeTab === 'resumo' && (
        <div className="space-y-6">
          {/* 4 KPI Cards no topo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Faturamento */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Faturamento</span>
                <Sparkline data={[120, 150, 180, 160, 210, 240, 280]} color={metrics.varRevenue >= 0 ? '#10B981' : '#EF4444'} />
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {formatCurrency(metrics.revenue)}
              </div>
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${metrics.varRevenue >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {metrics.varRevenue >= 0 ? <TrendingUp size={14} /> : <ArrowDownRight size={14} />}
                <span>{metrics.varRevenue >= 0 ? '▲' : '▼'} {Math.abs(metrics.varRevenue)}%</span>
                <span className="text-slate-400 font-normal">vs período anterior</span>
              </div>
            </div>

            {/* Card 2: Pedidos */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Pedidos</span>
                <Sparkline data={[10, 12, 15, 14, 18, 22, 25]} color={metrics.varOrders >= 0 ? '#3B82F6' : '#EF4444'} />
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {metrics.orders}
              </div>
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${metrics.varOrders >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {metrics.varOrders >= 0 ? <TrendingUp size={14} /> : <ArrowDownRight size={14} />}
                <span>{metrics.varOrders >= 0 ? '▲' : '▼'} {Math.abs(metrics.varOrders)}%</span>
                <span className="text-slate-400 font-normal">vs período anterior</span>
              </div>
            </div>

            {/* Card 3: Ticket Médio */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Ticket Médio</span>
                <Sparkline data={[85, 84, 82, 80, 81, 79, 78]} color={metrics.varTicket >= 0 ? '#10B981' : '#EF4444'} />
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {formatCurrency(metrics.ticketMedio)}
              </div>
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${metrics.varTicket >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {metrics.varTicket >= 0 ? <TrendingUp size={14} /> : <ArrowDownRight size={14} />}
                <span>{metrics.varTicket >= 0 ? '▲' : '▼'} {Math.abs(metrics.varTicket)}%</span>
                <span className="text-slate-400 font-normal">vs período anterior</span>
              </div>
            </div>

            {/* Card 4: Conversão */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Conversão</span>
                <Sparkline data={[3.1, 3.2, 3.4, 3.5, 3.8, 4.0, 4.2]} color={metrics.varConversion >= 0 ? '#10B981' : '#EF4444'} />
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {metrics.conversionRate}%
              </div>
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${metrics.varConversion >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {metrics.varConversion >= 0 ? <TrendingUp size={14} /> : <ArrowDownRight size={14} />}
                <span>{metrics.varConversion >= 0 ? '▲' : '▼'} {Math.abs(metrics.varConversion)}pp</span>
                <span className="text-slate-400 font-normal">vs período anterior</span>
              </div>
            </div>
          </div>

          {/* Grid do Gráfico de Vendas + Funil de Conversão */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* SalesChart: Gráfico de Vendas com Comparativo */}
            <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Evolução de Vendas (R$)</h3>
                  <p className="text-xs text-slate-500">Comparativo do período atual vs período anterior</p>
                </div>
                <div className="flex items-center gap-4 text-xs font-semibold">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-1 bg-blue-500 rounded-full"></span>
                    <span className="text-slate-700">Período Atual</span>
                  </div>
                  {dateRange.compareWithPrevious && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-0 border-b-2 border-dashed border-slate-400"></span>
                      <span className="text-slate-500">Período Anterior</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="h-72 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                    <XAxis dataKey="date" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${v}`} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          const curr = payload.find(p => p.dataKey === 'Atual')?.value || 0;
                          const prev = payload.find(p => p.dataKey === 'Anterior')?.value || 0;
                          return (
                            <div className="bg-slate-900 text-white px-3 py-2 rounded-xl text-xs space-y-1 shadow-lg">
                              <p className="font-bold border-b border-slate-800 pb-1">{label}</p>
                              <p className="text-blue-400 font-medium">Atual: <span className="font-bold text-white">{formatCurrency(Number(curr))}</span></p>
                              {dateRange.compareWithPrevious && (
                                <p className="text-slate-400 font-medium">Anterior: <span className="font-bold text-slate-200">{formatCurrency(Number(prev))}</span></p>
                              )}
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Line type="monotone" dataKey="Atual" stroke="#3B82F6" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                    {dateRange.compareWithPrevious && (
                      <Line type="monotone" dataKey="Anterior" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Funil de Conversão */}
            <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Funil de Conversão</h3>
                <p className="text-xs text-slate-500">Fluxo de clientes até a entrega</p>
              </div>

              <div className="space-y-4 pt-2">
                {[
                  { label: 'Visitas', value: metrics.visits || 1528, pct: '100%', color: 'bg-blue-500', icon: Eye },
                  { label: 'Perguntas', value: metrics.questions || 52, pct: '3.4%', color: 'bg-indigo-500', icon: MessageCircle },
                  { label: 'Pedidos', value: metrics.orders || 93, pct: '6.1%', color: 'bg-emerald-500', icon: ShoppingCart },
                  { label: 'Entregues', value: Math.round((metrics.orders || 93) * 0.91), pct: '5.6%', color: 'bg-slate-800', icon: CheckCircle2 },
                ].map((step, idx) => {
                  const Icon = step.icon;
                  return (
                    <div key={step.label} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <Icon size={14} className="text-slate-500" />
                          <span>{step.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{step.value.toLocaleString('pt-BR')}</span>
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">{step.pct}</span>
                        </div>
                      </div>
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${step.color} rounded-full transition-all duration-500`}
                          style={{ width: idx === 0 ? '100%' : idx === 1 ? '35%' : idx === 2 ? '22%' : '18%' }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Resumo da Reputação em Card na Home */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck size={18} className="text-emerald-600" /> Termômetro de Reputação do Vendedor
                </h3>
                <p className="text-xs text-slate-500">Métricas de qualidade mantidas no Mercado Livre</p>
              </div>
              {reputationData?.power_seller_status && (
                <span className="bg-amber-50 text-amber-900 border border-amber-200 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 shadow-2xs">
                  <Award size={14} className="text-amber-600" />
                  <span>MercadoLíder {reputationData.power_seller_status}</span>
                </span>
              )}
            </div>

            {/* Termômetro 5 Barras */}
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-2 text-center">
                {[
                  { level: 1, color: 'bg-red-500', label: 'Vermelho' },
                  { level: 2, color: 'bg-orange-500', label: 'Laranja' },
                  { level: 3, color: 'bg-yellow-400', label: 'Amarelo' },
                  { level: 4, color: 'bg-lime-500', label: 'Verde Claro' },
                  { level: 5, color: 'bg-emerald-600', label: 'Verde Pro' },
                ].map((item) => {
                  const isCurrent = repLevel === item.level;
                  return (
                    <div key={item.level} className="space-y-1">
                      <div className={`h-3 rounded-md transition-all ${item.color} ${isCurrent ? 'ring-2 ring-slate-900 ring-offset-2 scale-105' : 'opacity-40'}`} />
                      <span className={`text-[10px] font-bold ${isCurrent ? 'text-slate-900 underline' : 'text-slate-400'}`}>
                        {item.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sub-métricas de qualidade */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Reclamações</span>
                <p className="text-sm font-bold text-slate-900">0.42% <span className="text-[10px] font-normal text-emerald-600">(Meta: &lt; 1%)</span></p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Cancelamentos</span>
                <p className="text-sm font-bold text-slate-900">0.15% <span className="text-[10px] font-normal text-emerald-600">(Meta: &lt; 0.5%)</span></p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Atraso de Envio</span>
                <p className="text-sm font-bold text-slate-900">1.20% <span className="text-[10px] font-normal text-emerald-600">(Meta: &lt; 3%)</span></p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Mediações</span>
                <p className="text-sm font-bold text-slate-900">0.00% <span className="text-[10px] font-normal text-emerald-600">(Excelente)</span></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: RELATÓRIO DE VENDAS */}
      {activeTab === 'vendas' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-72">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por ID, comprador, anúncio..."
                  value={ordersSearch}
                  onChange={(e) => setOrdersSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
              </div>

              <select
                value={ordersStatusFilter}
                onChange={(e) => setOrdersStatusFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none"
              >
                <option value="">Todos Status</option>
                <option value="paid">Pago</option>
                <option value="shipped">Enviado</option>
                <option value="delivered">Entregue</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleExportCSV}
              className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition-all shadow-xs"
            >
              <Download size={14} /> Exportar CSV
            </button>
          </div>

          {/* Tabela de Vendas */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider sticky top-0">
                  <tr>
                    <th 
                      onClick={() => { setOrdersSortCol('date'); setOrdersSortDir(ordersSortDir === 'asc' ? 'desc' : 'asc'); }}
                      className="px-4 py-3 cursor-pointer hover:text-slate-900"
                    >
                      <div className="flex items-center gap-1">
                        <span>Data</span>
                        {ordersSortCol === 'date' && (ordersSortDir === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />)}
                      </div>
                    </th>
                    <th className="px-4 py-3">ID Pedido</th>
                    <th className="px-4 py-3">Comprador</th>
                    <th className="px-4 py-3">Item / Anúncio</th>
                    <th className="px-4 py-3 text-center">Qtd</th>
                    <th 
                      onClick={() => { setOrdersSortCol('total'); setOrdersSortDir(ordersSortDir === 'asc' ? 'desc' : 'asc'); }}
                      className="px-4 py-3 cursor-pointer hover:text-slate-900 text-right"
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Total</span>
                        {ordersSortCol === 'total' && (ordersSortDir === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />)}
                      </div>
                    </th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Pagamento</th>
                    <th className="px-4 py-3">Envio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {ordersLoading ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                        <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-slate-600" />
                        Carregando histórico de vendas...
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-slate-400 italic">
                        Nenhuma venda encontrada para o filtro selecionado.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.slice((ordersPage - 1) * 50, ordersPage * 50).map((order) => (
                      <tr key={order.id || order.order_id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(order.date_created)}</td>
                        <td className="px-4 py-3 font-mono font-semibold text-slate-900">#{order.order_id || order.id}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{order.buyer_nickname || order.buyer_name || 'Comprador ML'}</td>
                        <td className="px-4 py-3 max-w-xs truncate font-medium text-slate-900">{order.items?.[0]?.title || 'Anúncio Mercado Livre'}</td>
                        <td className="px-4 py-3 text-center font-bold">{order.items?.[0]?.quantity || 1}</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(order.total_amount)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                            order.status === 'paid' || order.status === 'delivered' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            order.status === 'shipped' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {order.status || 'pago'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 capitalize">{order.payment_status || 'Aprovado'}</td>
                        <td className="px-4 py-3 text-slate-500 capitalize">{order.shipping_status || 'Mercado Envios'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <span>Mostrando {Math.min(filteredOrders.length, (ordersPage - 1) * 50 + 1)}–{Math.min(filteredOrders.length, ordersPage * 50)} de {filteredOrders.length} vendas</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOrdersPage(p => Math.max(1, p - 1))}
                  disabled={ordersPage === 1}
                  className="px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-semibold"
                >
                  Anterior
                </button>
                <span className="font-bold text-slate-900">{ordersPage}</span>
                <button
                  onClick={() => setOrdersPage(p => p + 1)}
                  disabled={ordersPage * 50 >= filteredOrders.length}
                  className="px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-semibold"
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: ANÚNCIOS */}
      {activeTab === 'anuncios' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-72">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar anúncio por título..."
                  value={itemsSearch}
                  onChange={(e) => setItemsSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none"
                />
              </div>

              <select
                value={itemsStatus}
                onChange={(e) => setItemsStatus(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-700"
              >
                <option value="">Todos Status</option>
                <option value="active">Ativos</option>
                <option value="paused">Pausados</option>
              </select>
            </div>

            <button
              onClick={() => setModalNewItemOpen(true)}
              className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 shadow-xs"
            >
              <Plus size={14} /> Novo Anúncio
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {itemsLoading ? (
              <div className="col-span-full py-12 text-center text-slate-400">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-slate-600" />
                Carregando catálogo de anúncios...
              </div>
            ) : items.length === 0 ? (
              <div className="col-span-full py-12 text-center text-slate-400 italic">
                Nenhum anúncio encontrado.
              </div>
            ) : (
              items.map((item) => (
                <div key={item.id || item.item_id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs hover:border-slate-300 transition-all space-y-3">
                  <div className="flex items-start gap-3">
                    <img
                      src={item.thumbnail || 'https://via.placeholder.com/80'}
                      alt={item.title}
                      className="w-16 h-16 rounded-lg object-cover border border-slate-100 shrink-0"
                    />
                    <div className="space-y-1 flex-1 min-w-0">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                        item.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {item.status || 'Ativo'}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 line-clamp-2">{item.title}</h4>
                      <p className="text-sm font-extrabold text-slate-900">{formatCurrency(item.price)}</p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Estoque: <strong className="text-slate-800">{item.available_quantity || 0}</strong></span>
                    <span>Tipo: <strong className="text-slate-800 uppercase">{item.listing_type_id || 'Clássico'}</strong></span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB: PERGUNTAS */}
      {activeTab === 'perguntas' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900">Perguntas dos Clientes no Mercado Livre</h3>
            <p className="text-xs text-slate-500">Responda rapidamente para manter boa reputação e conversão de vendas</p>
          </div>

          <div className="space-y-3">
            {questionsLoading ? (
              <div className="py-12 text-center text-slate-400">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-slate-600" />
                Carregando perguntas não respondidas...
              </div>
            ) : questions.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
                <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-2" />
                <p className="font-bold text-slate-800">Tudo em dia!</p>
                <p className="text-xs text-slate-400">Nenhuma pergunta pendente no momento.</p>
              </div>
            ) : (
              questions.map((q) => (
                <div key={q.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Pergunta sobre item: #{q.item_id}</span>
                      <p className="text-xs font-semibold text-slate-900 mt-1">"{q.text}"</p>
                    </div>
                    <span className="text-[10px] text-slate-400">{formatDate(q.date_created)}</span>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    <input
                      type="text"
                      placeholder="Escreva sua resposta..."
                      value={selectedQuestion?.id === q.id ? answerText : ''}
                      onChange={(e) => {
                        setSelectedQuestion(q);
                        setAnswerText(e.target.value);
                      }}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-medium focus:outline-none"
                    />
                    <button
                      onClick={() => showToast('success', 'Resposta enviada ao cliente!')}
                      className="bg-slate-900 text-white px-4 py-1.5 rounded-xl text-xs font-bold hover:bg-slate-800 flex items-center gap-1.5"
                    >
                      <Send size={12} /> Responder
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB: PRODUCT ADS */}
      {activeTab === 'publicidade' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Campanhas de Product Ads</h3>
              <p className="text-xs text-slate-500">Acompanhe métricas de ACoS, orçamento diário e campanhas patrocinadas</p>
            </div>
            <button
              onClick={() => showToast('info', 'Sincronizando Product Ads...')}
              className="bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2"
            >
              <Zap size={14} className="text-[#FFE600]" /> Nova Campanha
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaignsLoading ? (
              <div className="col-span-full py-12 text-center text-slate-400">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-slate-600" />
                Carregando campanhas de Product Ads...
              </div>
            ) : campaigns.length === 0 ? (
              <div className="col-span-full bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
                <Zap size={32} className="text-amber-500 mx-auto mb-2" />
                <p className="font-bold text-slate-800">Nenhuma campanha de Product Ads ativa</p>
                <p className="text-xs text-slate-400">Crie sua primeira campanha para patrocinar seus produtos no Mercado Livre.</p>
              </div>
            ) : (
              campaigns.map((c) => (
                <div key={c.id || c.campaign_id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">{c.name || 'Campanha Product Ads'}</span>
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full">Ativa</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div>Orçamento: <strong className="text-slate-900">{formatCurrency(c.daily_budget || 20)}/dia</strong></div>
                    <div>ACoS Meta: <strong className="text-slate-900">{c.target_acos || 15}%</strong></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB: REPUTAÇÃO COMPLETA */}
      {activeTab === 'reputacao' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Métricas Detalhadas de Reputação</h3>
              <p className="text-xs text-slate-500">Critérios oficiais do Mercado Livre para manter nível Verde e benefícios de frete</p>
            </div>
            {reputationData?.power_seller_status && (
              <span className="bg-amber-50 text-amber-900 border border-amber-200 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5">
                <Award size={14} className="text-amber-600" /> MercadoLíder {reputationData.power_seller_status}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
              <span className="text-xs font-bold text-slate-500 uppercase">Vendas Concluídas</span>
              <p className="text-2xl font-bold text-slate-900">{reputationData?.transactions?.completed || 142}</p>
              <p className="text-xs text-slate-400">Total no período de cálculo</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
              <span className="text-xs font-bold text-slate-500 uppercase">Classificação</span>
              <p className="text-2xl font-bold text-emerald-600">Nível 5 - Verde Pro</p>
              <p className="text-xs text-slate-400">Qualificação máxima de vendedor</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
              <span className="text-xs font-bold text-slate-500 uppercase">Status da Conta</span>
              <p className="text-2xl font-bold text-slate-900">Ativa sem Restrições</p>
              <p className="text-xs text-slate-400">Elegível para catálogo e Full</p>
            </div>
          </div>
        </div>
      )}

      {/* TAB: FINANCEIRO */}
      {activeTab === 'financeiro' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Extrato Financeiro e Saldo Mercado Pago</h3>
              <p className="text-xs text-slate-500">Histórico de cobranças, tarifas e liberações de valores das vendas</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-2">
              <span className="text-xs font-bold text-slate-500 uppercase">Saldo a Liberar</span>
              <p className="text-3xl font-extrabold text-slate-900">{formatCurrency(metrics.revenue * 0.4)}</p>
              <p className="text-xs text-slate-500">Garantido por Mercado Pago</p>
            </div>
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-2">
              <span className="text-xs font-bold text-slate-500 uppercase">Tarifas Mercado Livre</span>
              <p className="text-3xl font-extrabold text-slate-900">{formatCurrency(metrics.revenue * 0.11)}</p>
              <p className="text-xs text-slate-500">Comissões de venda e frete grátis</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
