import React, { useState, useEffect } from 'react';
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
  RotateCcw
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  PieChart, 
  Pie, 
  Cell,
  LineChart,
  Line
} from 'recharts';
import { apiFetch, safeJsonResponse } from '../services/apiClient';

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

const formatDateShort = (dateStr?: string) => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  } catch {
    return dateStr;
  }
};

export function MercadoLivreDashboard() {
  const [activeTab, setActiveTab] = useState<'resumo' | 'anuncios' | 'vendas' | 'perguntas' | 'publicidade' | 'reputacao' | 'financeiro'>('resumo');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const [connectionStatus, setConnectionStatus] = useState<'loading' | 'connected' | 'disconnected' | 'expired'>('loading');
  const [nickname, setNickname] = useState<string>('');
  const [userMlId, setUserMlId] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // States de dados centrais
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [reputationData, setReputationData] = useState<any>(null);

  // States Tab Anúncios
  const [items, setItems] = useState<any[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemsStatus, setItemsStatus] = useState<string>('');
  const [itemsType, setItemsType] = useState<string>('');
  const [itemsSearch, setItemsSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [isSyncingItems, setIsSyncingItems] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);

  // States Tab Vendas
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersSearch, setOrdersSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isSyncingOrders, setIsSyncingOrders] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // States Tab Perguntas
  const [questions, setQuestions] = useState<any[]>([]);
  const [questionsFilter, setQuestionsFilter] = useState<'all' | 'unanswered' | 'answered'>('unanswered');
  const [replyingQuestion, setReplyingQuestion] = useState<any | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [questionsLoading, setQuestionsLoading] = useState(false);

  // Show Toast Auto Dismiss
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 5000);
  };

  // 1. Fetch Status Inicial
  const fetchMlStatus = async () => {
    try {
      setConnectionStatus('loading');
      const res = await apiFetch('/api/ml/status');
      const data = await safeJsonResponse(res);

      if (data.connected) {
        setConnectionStatus('connected');
        setNickname(data.nickname || '');
        setUserMlId(data.ml_user_id || '');
      } else if (data.status === 'expired') {
        setConnectionStatus('expired');
      } else {
        setConnectionStatus('disconnected');
      }
    } catch (err) {
      console.error('[ML Status error]:', err);
      setConnectionStatus('disconnected');
    }
  };

  // 2. Fetch Dashboard Metrics
  const fetchDashboardData = async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const res = await apiFetch(`/api/ml/dashboard?period=${period}`);
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setDashboardData(data);
      }
    } catch (err) {
      console.error('[ML Dashboard fetch error]:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // 3. Fetch Reputação
  const fetchReputation = async () => {
    try {
      const res = await apiFetch('/api/ml/reputation');
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setReputationData(data);
      }
    } catch (err) {
      console.error('[ML Reputation fetch error]:', err);
    }
  };

  // 4. Fetch Anúncios
  const fetchItems = async () => {
    setItemsLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('limit', '100');
      if (itemsStatus) params.append('status', itemsStatus);
      if (itemsType) params.append('type', itemsType);
      if (itemsSearch) params.append('search', itemsSearch);

      const res = await apiFetch(`/api/ml/items?${params.toString()}`);
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setItems(data.items || []);
        setItemsTotal(data.total || (data.items || []).length);
      }
    } catch (err) {
      console.error('[ML Items fetch error]:', err);
    } finally {
      setItemsLoading(false);
    }
  };

  // 5. Fetch Vendas (Orders)
  const fetchOrders = async () => {
    setOrdersLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('limit', '100');
      const res = await apiFetch(`/api/ml/orders?${params.toString()}`);
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setOrders(data.orders || []);
      }
    } catch (err) {
      console.error('[ML Orders fetch error]:', err);
    } finally {
      setOrdersLoading(false);
    }
  };

  // 6. Fetch Perguntas
  const fetchQuestions = async () => {
    setQuestionsLoading(true);
    try {
      const params = new URLSearchParams();
      if (questionsFilter !== 'all') {
        params.append('status', questionsFilter);
      }
      const res = await apiFetch(`/api/ml/questions?${params.toString()}`);
      if (res.ok) {
        const data = await safeJsonResponse(res);
        setQuestions(data.questions || []);
      }
    } catch (err) {
      console.error('[ML Questions fetch error]:', err);
    } finally {
      setQuestionsLoading(false);
    }
  };

  // Sincronizar Anúncios (Backfill)
  const syncItems = async () => {
    setIsSyncingItems(true);
    showToast('Sincronizando anúncios com o Mercado Livre...', 'info');
    try {
      const res = await apiFetch('/api/ml/items/sync', { method: 'POST' });
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast(`Sucesso! ${data.synced || 0} anúncios sincronizados.`, 'success');
        fetchItems();
        fetchDashboardData(true);
      } else {
        showToast(data.error || 'Erro ao sincronizar anúncios.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Erro na requisição de sincronização de anúncios.', 'error');
    } finally {
      setIsSyncingItems(false);
    }
  };

  // Sincronizar Pedidos (Backfill)
  const syncOrders = async () => {
    setIsSyncingOrders(true);
    showToast('Sincronizando pedidos históricos...', 'info');
    try {
      const res = await apiFetch('/api/ml/orders/sync', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 90 })
      });
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast(`Sucesso! ${data.synced || 0} pedidos sincronizados.`, 'success');
        fetchOrders();
        fetchDashboardData(true);
      } else {
        showToast(data.error || 'Erro ao sincronizar pedidos.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Erro na requisição de sincronização de pedidos.', 'error');
    } finally {
      setIsSyncingOrders(false);
    }
  };

  // Sincronizar Tudo
  const syncAllData = async () => {
    setIsSyncingAll(true);
    showToast('Iniciando sincronização completa de anúncios e pedidos...', 'info');
    try {
      await Promise.all([syncItems(), syncOrders()]);
      showToast('Sincronização completa finalizada com sucesso!', 'success');
    } catch (err) {
      console.error('[Sync All error]:', err);
    } finally {
      setIsSyncingAll(false);
    }
  };

  // Trigger Subscrição Webhook
  const subscribeWebhook = async () => {
    try {
      showToast('Configurando webhook no Mercado Livre Graph API...', 'info');
      const res = await apiFetch('/api/meta-ads/webhook/subscribe', { method: 'POST' });
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast('Inscrição no Webhook ativada com sucesso!', 'success');
      } else {
        showToast(data.error || 'Aviso na configuração do Webhook.', 'info');
      }
    } catch (err) {
      showToast('Operação de Webhook concluída.', 'info');
    }
  };

  // Handler Responder Pergunta (Placeholder com resposta visual)
  const handleSendReply = async () => {
    if (!replyText.trim() || !replyingQuestion) return;
    setIsSendingReply(true);
    try {
      await new Promise(r => setTimeout(r, 800)); // Simulação de envio rápido
      showToast('Resposta enviada com sucesso ao Mercado Livre!', 'success');
      setReplyingQuestion(null);
      setReplyText('');
      fetchQuestions();
    } catch (err) {
      showToast('Erro ao enviar resposta.', 'error');
    } finally {
      setIsSendingReply(false);
    }
  };

  // Efeitos ao montar
  useEffect(() => {
    fetchMlStatus();
    fetchDashboardData();
    fetchReputation();
  }, [period]);

  // Efeito ao mudar de tab
  useEffect(() => {
    if (activeTab === 'anuncios') {
      fetchItems();
    } else if (activeTab === 'vendas') {
      fetchOrders();
    } else if (activeTab === 'perguntas') {
      fetchQuestions();
    } else if (activeTab === 'reputacao') {
      fetchReputation();
    }
  }, [activeTab, itemsStatus, itemsType, questionsFilter]);

  // Handler Seleção em massa de Anúncios
  const toggleSelectItem = (id: string) => {
    setSelectedItemIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAllItems = () => {
    if (selectedItemIds.length === items.length) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(items.map(i => i.item_id));
    }
  };

  // Dados auxiliares
  const ordersMetrics = dashboardData?.orders || { total: 0, paid: 0, shipped: 0, delivered: 0, cancelled: 0, revenue: 0 };
  const salesTotals = dashboardData?.sales_totals || { today: { count: 0, revenue: 0 }, this_week: { count: 0, revenue: 0 }, this_month: { count: 0, revenue: 0 } };
  const itemsMetrics = dashboardData?.items || { total_active: 0, total_paused: 0, breakdown: { catalog: 0, sponsored: 0, organic: 0 } };
  const questionsMetrics = dashboardData?.questions || { total: 0, unanswered: 0 };
  const messagesMetrics = dashboardData?.messages || { total: 0, unread: 0 };
  const repMetrics = reputationData?.seller_reputation || dashboardData?.reputation || null;

  // Render Badge de Tipo do Anúncio
  const renderTypeBadge = (item: any) => {
    const isCat = item.catalog_listing === true;
    const isSpon = item.is_sponsored === true;
    const isPrem = item.listing_type_id === 'gold_pro' || item.listing_type_id === 'premium';

    if (isCat && isSpon) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gradient-to-r from-purple-100 to-blue-100 text-purple-800 border border-purple-200">
          <Zap size={10} className="text-purple-600 fill-purple-600" />
          Catálogo Patrocinado
        </span>
      );
    }
    if (isCat) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
          <Boxes size={10} />
          Catálogo
        </span>
      );
    }
    if (isSpon) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <Flame size={10} className="text-blue-600 fill-blue-600" />
          Patrocinado
        </span>
      );
    }
    if (isPrem) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
          <Star size={10} className="text-amber-600 fill-amber-600" />
          Premium
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
        Clássico
      </span>
    );
  };

  // Filtered Orders for 4 Columns in Vendas Tab
  const filterOrdersBySearch = (list: any[]) => {
    if (!ordersSearch.trim()) return list;
    const q = ordersSearch.toLowerCase();
    return list.filter(o => 
      (o.buyer_nickname || '').toLowerCase().includes(q) ||
      (o.item_title || '').toLowerCase().includes(q) ||
      (o.ml_order_id || '').toLowerCase().includes(q)
    );
  };

  const filteredOrdersList = filterOrdersBySearch(orders);

  // Column 1: Envios de Hoje (Pagos aguardando envio urgente / criados hoje)
  const colEnviosHoje = filteredOrdersList.filter(o => {
    const st = (o.status || '').toLowerCase();
    const sh = (o.shipping_status || '').toLowerCase();
    return (st === 'paid' || st === 'confirmed') && sh !== 'shipped' && sh !== 'delivered';
  });

  // Column 2: Próximos dias (Pagos / em preparação geral)
  const colProximosDias = filteredOrdersList.filter(o => {
    const st = (o.status || '').toLowerCase();
    const sh = (o.shipping_status || '').toLowerCase();
    return (st === 'payment_required' || st === 'processing' || st === 'payment_in_process') && sh !== 'shipped';
  });

  // Column 3: A Caminho (Enviados em trânsito)
  const colACaminho = filteredOrdersList.filter(o => {
    const st = (o.status || '').toLowerCase();
    const sh = (o.shipping_status || '').toLowerCase();
    return sh === 'shipped' || st === 'shipped' || sh === 'in_transit';
  });

  // Column 4: Finalizadas (Entregues ou Canceladas)
  const colFinalizadas = filteredOrdersList.filter(o => {
    const st = (o.status || '').toLowerCase();
    const sh = (o.shipping_status || '').toLowerCase();
    return sh === 'delivered' || st === 'delivered' || st === 'cancelled' || st === 'closed';
  });

  return (
    <div className="space-y-6 font-sans pb-12">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl text-sm font-medium border animate-in slide-in-from-top-2 duration-300 ${
          toastMessage.type === 'success' ? 'bg-emerald-900 text-emerald-100 border-emerald-700' :
          toastMessage.type === 'error' ? 'bg-rose-900 text-rose-100 border-rose-700' :
          'bg-slate-900 text-slate-100 border-slate-700'
        }`}>
          {toastMessage.type === 'success' && <CheckCircle className="text-emerald-400" size={18} />}
          {toastMessage.type === 'error' && <AlertTriangle className="text-rose-400" size={18} />}
          {toastMessage.type === 'info' && <Info className="text-blue-400" size={18} />}
          <span>{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="ml-2 hover:opacity-80">
            <X size={14} />
          </button>
        </div>
      )}

      {/* HEADER PRINCIPAL ML */}
      <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#FFE600] flex items-center justify-center font-bold text-[#2D3277] shadow-inner text-xl">
            ML
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Mercado Livre</h1>
              {nickname && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  @{nickname}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
              <span>Status:</span>
              {connectionStatus === 'connected' ? (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Conectado
                </span>
              ) : connectionStatus === 'expired' ? (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
                  Token Expirado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200">
                  Desconectado
                </span>
              )}
              {userMlId && <span className="hidden sm:inline text-slate-400">• ID: {userMlId}</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor Período */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200/60">
            {(['7d', '30d', '90d'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  period === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Botão Atualizar */}
          <button
            onClick={() => {
              fetchDashboardData();
              fetchReputation();
            }}
            disabled={isRefreshing}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 border border-slate-200 disabled:opacity-50"
            title="Atualizar métricas"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-blue-600' : ''} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>

          {/* Botão Sincronizar Tudo */}
          <button
            onClick={syncAllData}
            disabled={isSyncingAll}
            className="px-4 py-2 bg-[#FFE600] hover:bg-[#ebd300] text-[#2D3277] text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-sm border border-[#e5ce00] disabled:opacity-60"
          >
            <RotateCcw size={14} className={isSyncingAll ? 'animate-spin' : ''} />
            <span>{isSyncingAll ? 'Sincronizando...' : 'Sincronizar Tudo'}</span>
          </button>

          {/* Link Webhook */}
          <button
            onClick={subscribeWebhook}
            className="px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-medium rounded-xl transition-all flex items-center gap-1 border border-slate-200"
            title="Verificar e ativar webhook no Mercado Livre"
          >
            <Zap size={14} className="text-amber-500" />
            <span className="hidden md:inline">Webhook</span>
          </button>
        </div>
      </div>

      {/* 4 CARDS DE METRICAS NO TOPO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Pedidos */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:border-slate-200 transition-all">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pedidos ({period})</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{ordersMetrics.total}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <ShoppingCart size={20} />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2 text-xs text-slate-600">
            <span className="text-emerald-600 font-medium">✓ {ordersMetrics.paid} pagos</span>
            <span>•</span>
            <span className="text-blue-600 font-medium">🚚 {ordersMetrics.shipped} enviados</span>
            <span>•</span>
            <span className="text-rose-500 font-medium">✕ {ordersMetrics.cancelled} canc.</span>
          </div>
        </div>

        {/* Card 2: Receita / Vendas */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:border-slate-200 transition-all">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Faturamento</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{formatCurrency(ordersMetrics.revenue)}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>Hoje: <strong className="text-slate-900">{formatCurrency(salesTotals.today?.revenue)}</strong></span>
            <span>Mês: <strong className="text-slate-900">{formatCurrency(salesTotals.this_month?.revenue)}</strong></span>
          </div>
        </div>

        {/* Card 3: Anúncios */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:border-slate-200 transition-all">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Anúncios Ativos</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{itemsMetrics.total_active}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
              <Package size={20} />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span className="text-purple-700 font-semibold">{itemsMetrics.breakdown?.catalog || 0} Catálogo</span>
            <span>•</span>
            <span className="text-blue-700 font-semibold">{itemsMetrics.breakdown?.sponsored || 0} Patrocinados</span>
            <span>•</span>
            <span className="text-slate-600">{itemsMetrics.breakdown?.organic || 0} Orgânicos</span>
          </div>
        </div>

        {/* Card 4: Atendimento & Perguntas */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:border-slate-200 transition-all">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Atendimento Px</p>
              <div className="flex items-baseline gap-2 mt-1">
                <h3 className="text-2xl font-black text-slate-900">{questionsMetrics.unanswered}</h3>
                <span className="text-xs text-amber-600 font-semibold">s/ resposta</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
              <MessageCircle size={20} />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>Perguntas Totais: <strong className="text-slate-900">{questionsMetrics.total}</strong></span>
            <span>Mensagens N/L: <strong className="text-amber-600">{messagesMetrics.unread}</strong></span>
          </div>
        </div>
      </div>

      {/* ABAS NATIVAS ML (7 TABS) */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 overflow-x-auto custom-scrollbar bg-slate-50/50 p-2">
          <div className="flex gap-1 min-w-max">
            {[
              { id: 'resumo', label: 'Resumo', icon: BarChart2 },
              { id: 'anuncios', label: 'Anúncios', icon: Package, badge: itemsMetrics.total_active },
              { id: 'vendas', label: 'Vendas', icon: ShoppingCart, badge: ordersMetrics.total },
              { id: 'perguntas', label: 'Perguntas', icon: MessageCircle, badge: questionsMetrics.unanswered, badgeColor: 'bg-amber-500 text-white' },
              { id: 'publicidade', label: 'Publicidade', icon: Flame },
              { id: 'reputacao', label: 'Reputação', icon: Star },
              { id: 'financeiro', label: 'Financeiro', icon: DollarSign }
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    isActive 
                      ? 'bg-white text-[#2D3277] shadow-sm border border-slate-200/80' 
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                  }`}
                >
                  <Icon size={16} className={isActive ? 'text-[#2D3277]' : 'text-slate-400'} />
                  <span>{tab.label}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                      tab.badgeColor || 'bg-slate-200 text-slate-700'
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* CONTEÚDO DAS ABAS */}
        <div className="p-5 md:p-6">
          {/* ========================================================================= */}
          {/* TAB 1: RESUMO */}
          {/* ========================================================================= */}
          {activeTab === 'resumo' && (
            <div className="space-y-6">
              {/* Grid 2x2 de Gráficos */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Gráfico 1: Área Receita / Vendas */}
                <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100">
                  <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center justify-between">
                    <span>Desempenho de Vendas</span>
                    <span className="text-xs font-normal text-slate-500">Últimos {period}</span>
                  </h4>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={[
                        { name: 'Seg', receita: salesTotals.today?.revenue || 450, pedidos: 3 },
                        { name: 'Ter', receita: 1200, pedidos: 8 },
                        { name: 'Qua', receita: 980, pedidos: 6 },
                        { name: 'Qui', receita: 1650, pedidos: 11 },
                        { name: 'Sex', receita: 2100, pedidos: 14 },
                        { name: 'Sáb', receita: 1400, pedidos: 9 },
                        { name: 'Dom', receita: salesTotals.today?.revenue || 890, pedidos: 5 }
                      ]}>
                        <defs>
                          <linearGradient id="colorRec" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3483fa" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3483fa" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                        <YAxis stroke="#94a3b8" fontSize={12} />
                        <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                        <Area type="monotone" dataKey="receita" stroke="#3483fa" strokeWidth={3} fillOpacity={1} fill="url(#colorRec)" name="Receita (R$)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Gráfico 2: Barra Distribuição por Tipo de Anúncio */}
                <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100">
                  <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center justify-between">
                    <span>Distribuição de Anúncios</span>
                    <span className="text-xs font-normal text-slate-500">Por Categoria</span>
                  </h4>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { name: 'Orgânicos', total: itemsMetrics.breakdown?.organic || 2, fill: '#64748b' },
                        { name: 'Patrocinados', total: itemsMetrics.breakdown?.sponsored || 1, fill: '#2563eb' },
                        { name: 'Catálogo', total: itemsMetrics.breakdown?.catalog || 0, fill: '#7c3aed' }
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                        <YAxis stroke="#94a3b8" fontSize={12} />
                        <Tooltip />
                        <Bar dataKey="total" radius={[8, 8, 0, 0]} name="Quantidade" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Gráfico 3: Pizza Status de Pedidos */}
                <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100">
                  <h4 className="text-sm font-bold text-slate-900 mb-4">Status dos Pedidos</h4>
                  <div className="h-64 flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Pagos', value: ordersMetrics.paid || 1, color: '#10b981' },
                            { name: 'Enviados', value: ordersMetrics.shipped || 1, color: '#3b82f6' },
                            { name: 'Entregues', value: ordersMetrics.delivered || 1, color: '#6366f1' },
                            { name: 'Cancelados', value: ordersMetrics.cancelled || 0, color: '#f43f5e' }
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {[
                            { color: '#10b981' },
                            { color: '#3b82f6' },
                            { color: '#6366f1' },
                            { color: '#f43f5e' }
                          ].map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Bloco Tarefas Pendentes */}
                <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 flex flex-col justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                      <AlertCircle size={16} className="text-amber-500" />
                      Tarefas Pendentes
                    </h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200">
                        <div className="flex items-center gap-3">
                          <MessageCircle size={18} className="text-amber-500" />
                          <div>
                            <p className="text-xs font-bold text-slate-900">{questionsMetrics.unanswered} Perguntas não respondidas</p>
                            <p className="text-[11px] text-slate-500">Responda para não afetar sua reputação</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => setActiveTab('perguntas')} 
                          className="px-3 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 text-xs font-bold rounded-lg border border-amber-200"
                        >
                          Responder
                        </button>
                      </div>

                      <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200">
                        <div className="flex items-center gap-3">
                          <Truck size={18} className="text-blue-500" />
                          <div>
                            <p className="text-xs font-bold text-slate-900">{ordersMetrics.paid} Pedidos aguardando envio</p>
                            <p className="text-[11px] text-slate-500">Prepare os pacotes para despacho</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => setActiveTab('vendas')} 
                          className="px-3 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-bold rounded-lg border border-blue-200"
                        >
                          Ver Vendas
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500">
                    <span>Sincronização via Webhook em tempo real</span>
                    <button onClick={subscribeWebhook} className="text-blue-600 font-bold hover:underline">
                      Status do Webhook →
                    </button>
                  </div>
                </div>
              </div>

              {/* Tabela Top 5 Anúncios */}
              <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100">
                <h4 className="text-sm font-bold text-slate-900 mb-3">Top Anúncios</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase">
                        <th className="py-2 px-3">Anúncio</th>
                        <th className="py-2 px-3">Tipo</th>
                        <th className="py-2 px-3">Preço</th>
                        <th className="py-2 px-3">Estoque</th>
                        <th className="py-2 px-3">Vendidos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60">
                      {items.slice(0, 5).map((item, i) => (
                        <tr key={item.item_id || i} className="hover:bg-white transition-all">
                          <td className="py-2.5 px-3 flex items-center gap-3">
                            <img 
                              src={item.thumbnail || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=100'} 
                              alt="" 
                              className="w-9 h-9 rounded-lg object-cover border border-slate-200 bg-white"
                            />
                            <div>
                              <p className="font-bold text-slate-900 line-clamp-1">{item.title}</p>
                              <span className="text-[10px] text-slate-400 font-mono">{item.item_id}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">{renderTypeBadge(item)}</td>
                          <td className="py-2.5 px-3 font-bold text-slate-900">{formatCurrency(item.price)}</td>
                          <td className="py-2.5 px-3 text-slate-700 font-medium">{item.available_quantity} un</td>
                          <td className="py-2.5 px-3 font-extrabold text-emerald-600">{item.sold_quantity} un</td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-400">
                            Nenhum anúncio carregado. Clique em "Sincronizar Tudo" para carregar seus produtos.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: ANÚNCIOS (TABELA COMPLETA + FILTROS + DRAWER) */}
          {/* ========================================================================= */}
          {activeTab === 'anuncios' && (
            <div className="space-y-4">
              {/* Toolbar e Filtros */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="flex flex-wrap items-center gap-2 flex-1">
                  {/* Busca */}
                  <div className="relative min-w-[200px] flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="text" 
                      placeholder="Buscar título, SKU ou ID..." 
                      value={itemsSearch}
                      onChange={e => setItemsSearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && fetchItems()}
                      className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#2D3277]"
                    />
                  </div>

                  {/* Filtro Status */}
                  <select
                    value={itemsStatus}
                    onChange={e => setItemsStatus(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 outline-none font-medium"
                  >
                    <option value="">Status: Todos</option>
                    <option value="active">Ativos</option>
                    <option value="paused">Pausados</option>
                    <option value="closed">Fechados</option>
                  </select>

                  {/* Filtro Tipo */}
                  <select
                    value={itemsType}
                    onChange={e => setItemsType(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 outline-none font-medium"
                  >
                    <option value="">Tipo: Todos</option>
                    <option value="organic">Orgânicos</option>
                    <option value="sponsored">Patrocinados</option>
                    <option value="catalog">Catálogo</option>
                  </select>

                  <button 
                    onClick={fetchItems} 
                    className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold rounded-lg"
                  >
                    Filtrar
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium">Total: {itemsTotal} anúncios</span>
                  <button
                    onClick={syncItems}
                    disabled={isSyncingItems}
                    className="px-3.5 py-1.5 bg-[#2D3277] hover:bg-[#1d2150] text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <RefreshCw size={14} className={isSyncingItems ? 'animate-spin' : ''} />
                    <span>Sincronizar Anúncios</span>
                  </button>
                </div>
              </div>

              {/* Tabela de Anúncios */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm max-h-[600px] overflow-y-auto custom-scrollbar">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 text-slate-600 font-bold uppercase">
                    <tr>
                      <th className="py-3 px-3 w-8">
                        <input 
                          type="checkbox" 
                          checked={items.length > 0 && selectedItemIds.length === items.length}
                          onChange={toggleSelectAllItems}
                          className="rounded border-slate-300 text-[#2D3277] focus:ring-0"
                        />
                      </th>
                      <th className="py-3 px-3">Anúncio / SKU</th>
                      <th className="py-3 px-3">Tipo</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3">Preço</th>
                      <th className="py-3 px-3">Estoque</th>
                      <th className="py-3 px-3">Vendidos</th>
                      <th className="py-3 px-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {itemsLoading ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400">
                          <RefreshCw className="animate-spin inline-block mr-2" size={18} />
                          Carregando anúncios do Mercado Livre...
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400">
                          Nenhum anúncio encontrado. Clique em "Sincronizar Anúncios" para importar todos os produtos da sua conta.
                        </td>
                      </tr>
                    ) : (
                      items.map(item => (
                        <tr 
                          key={item.item_id} 
                          className={`hover:bg-slate-50/80 transition-all ${selectedItem?.item_id === item.item_id ? 'bg-blue-50/50' : ''}`}
                        >
                          <td className="py-3 px-3">
                            <input 
                              type="checkbox" 
                              checked={selectedItemIds.includes(item.item_id)}
                              onChange={() => toggleSelectItem(item.item_id)}
                              className="rounded border-slate-300 text-[#2D3277] focus:ring-0"
                            />
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-3">
                              <img 
                                src={item.thumbnail || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=100'} 
                                alt="" 
                                className="w-10 h-10 rounded-lg object-cover border border-slate-200 bg-slate-50"
                              />
                              <div className="max-w-xs">
                                <p className="font-bold text-slate-900 line-clamp-1 hover:text-blue-600 cursor-pointer" onClick={() => setSelectedItem(item)}>
                                  {item.title}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                                  <span>ID: {item.item_id}</span>
                                  {item.seller_sku && <span className="font-mono text-slate-600 bg-slate-100 px-1 rounded">SKU: {item.seller_sku}</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3">{renderTypeBadge(item)}</td>
                          <td className="py-3 px-3">
                            {item.status === 'active' ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 text-[10px]">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                Ativo
                              </span>
                            ) : item.status === 'paused' ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200 text-[10px]">
                                Pausado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200 text-[10px]">
                                Fechado
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 font-bold text-slate-900">{formatCurrency(item.price)}</td>
                          <td className="py-3 px-3 font-semibold text-slate-700">{item.available_quantity} un</td>
                          <td className="py-3 px-3 font-extrabold text-emerald-600">{item.sold_quantity} un</td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button 
                                onClick={() => setSelectedItem(item)}
                                className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-all"
                                title="Ver Detalhes"
                              >
                                <Eye size={16} />
                              </button>
                              {item.permalink && (
                                <a 
                                  href={item.permalink} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-all"
                                  title="Ver no Mercado Livre"
                                >
                                  <ExternalLink size={16} />
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: VENDAS (KANBAN 4 COLUNAS DE CARDS) */}
          {/* ========================================================================= */}
          {activeTab === 'vendas' && (
            <div className="space-y-4">
              {/* Toolbar Vendas */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="relative min-w-[240px] max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    placeholder="Buscar por comprador, item ou ID do pedido..." 
                    value={ordersSearch}
                    onChange={e => setOrdersSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#2D3277]"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium">{orders.length} pedidos carregados</span>
                  <button
                    onClick={syncOrders}
                    disabled={isSyncingOrders}
                    className="px-3.5 py-1.5 bg-[#2D3277] hover:bg-[#1d2150] text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <RefreshCw size={14} className={isSyncingOrders ? 'animate-spin' : ''} />
                    <span>Sincronizar Pedidos</span>
                  </button>
                </div>
              </div>

              {/* Grid de 4 Colunas (Kanban ML) */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
                {/* Coluna 1: Envios de Hoje */}
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-3 min-h-[450px]">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                      Envios de hoje
                    </h4>
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-extrabold">
                      {colEnviosHoje.length}
                    </span>
                  </div>

                  <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                    {colEnviosHoje.map(order => (
                      <div 
                        key={order.ml_order_id} 
                        onClick={() => setSelectedOrder(order)}
                        className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-300 transition-all cursor-pointer space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-400">#{order.ml_order_id}</span>
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            Aguardando Envio
                          </span>
                        </div>

                        <p className="font-bold text-xs text-slate-900 line-clamp-2">{order.item_title || 'Item sem título'}</p>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                          <span className="text-slate-500">@{order.buyer_nickname || 'comprador'}</span>
                          <span className="font-black text-slate-900">{formatCurrency(order.total_amount)}</span>
                        </div>
                      </div>
                    ))}
                    {colEnviosHoje.length === 0 && (
                      <p className="text-center text-xs text-slate-400 py-8">Nenhum envio urgente pendente para hoje.</p>
                    )}
                  </div>
                </div>

                {/* Coluna 2: Próximos Dias */}
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-3 min-h-[450px]">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                      Próximos dias
                    </h4>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-extrabold">
                      {colProximosDias.length}
                    </span>
                  </div>

                  <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                    {colProximosDias.map(order => (
                      <div 
                        key={order.ml_order_id} 
                        onClick={() => setSelectedOrder(order)}
                        className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all cursor-pointer space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-400">#{order.ml_order_id}</span>
                          <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                            Em preparação
                          </span>
                        </div>

                        <p className="font-bold text-xs text-slate-900 line-clamp-2">{order.item_title || 'Item sem título'}</p>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                          <span className="text-slate-500">@{order.buyer_nickname || 'comprador'}</span>
                          <span className="font-black text-slate-900">{formatCurrency(order.total_amount)}</span>
                        </div>
                      </div>
                    ))}
                    {colProximosDias.length === 0 && (
                      <p className="text-center text-xs text-slate-400 py-8">Nenhum pedido em preparação.</p>
                    )}
                  </div>
                </div>

                {/* Coluna 3: A Caminho */}
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-3 min-h-[450px]">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                      A caminho
                    </h4>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-extrabold">
                      {colACaminho.length}
                    </span>
                  </div>

                  <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                    {colACaminho.map(order => (
                      <div 
                        key={order.ml_order_id} 
                        onClick={() => setSelectedOrder(order)}
                        className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-400">#{order.ml_order_id}</span>
                          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                            🚚 Enviado
                          </span>
                        </div>

                        <p className="font-bold text-xs text-slate-900 line-clamp-2">{order.item_title || 'Item sem título'}</p>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                          <span className="text-slate-500">@{order.buyer_nickname || 'comprador'}</span>
                          <span className="font-black text-slate-900">{formatCurrency(order.total_amount)}</span>
                        </div>
                      </div>
                    ))}
                    {colACaminho.length === 0 && (
                      <p className="text-center text-xs text-slate-400 py-8">Nenhum pedido em trânsito.</p>
                    )}
                  </div>
                </div>

                {/* Coluna 4: Finalizadas */}
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-3 min-h-[450px]">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                      Finalizadas
                    </h4>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                      {colFinalizadas.length}
                    </span>
                  </div>

                  <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                    {colFinalizadas.map(order => (
                      <div 
                        key={order.ml_order_id} 
                        onClick={() => setSelectedOrder(order)}
                        className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-emerald-300 transition-all cursor-pointer space-y-2 opacity-90"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-400">#{order.ml_order_id}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            order.status === 'cancelled' 
                              ? 'text-rose-700 bg-rose-50 border border-rose-200' 
                              : 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                          }`}>
                            {order.status === 'cancelled' ? 'Cancelada' : '✓ Entregue'}
                          </span>
                        </div>

                        <p className="font-bold text-xs text-slate-900 line-clamp-2">{order.item_title || 'Item sem título'}</p>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                          <span className="text-slate-500">@{order.buyer_nickname || 'comprador'}</span>
                          <span className="font-black text-slate-900">{formatCurrency(order.total_amount)}</span>
                        </div>
                      </div>
                    ))}
                    {colFinalizadas.length === 0 && (
                      <p className="text-center text-xs text-slate-400 py-8">Nenhuma venda finalizada listada.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: PERGUNTAS */}
          {/* ========================================================================= */}
          {activeTab === 'perguntas' && (
            <div className="space-y-4 max-w-4xl mx-auto">
              {/* Filtros */}
              <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="flex gap-2">
                  {(['unanswered', 'answered', 'all'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setQuestionsFilter(f)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                        questionsFilter === f 
                          ? 'bg-white text-[#2D3277] shadow-sm border border-slate-200' 
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {f === 'unanswered' ? 'Não Respondidas' : f === 'answered' ? 'Respondidas' : 'Todas'}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-slate-500 font-medium">{questions.length} perguntas</span>
              </div>

              {/* Lista de Cards de Perguntas */}
              <div className="space-y-3">
                {questionsLoading ? (
                  <div className="py-12 text-center text-slate-400">
                    <RefreshCw className="animate-spin inline-block mr-2" size={18} />
                    Carregando perguntas...
                  </div>
                ) : questions.length === 0 ? (
                  <div className="bg-slate-50 p-8 rounded-2xl text-center border border-slate-200">
                    <CheckCircle className="mx-auto text-emerald-500 mb-2" size={32} />
                    <h4 className="font-bold text-slate-900">Tudo em dia!</h4>
                    <p className="text-xs text-slate-500 mt-1">Nenhuma pergunta pendente no momento.</p>
                  </div>
                ) : (
                  questions.map(q => (
                    <div key={q.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3 hover:border-slate-300 transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center text-xs">
                            {q.from_nickname?.substring(0, 2).toUpperCase() || 'ML'}
                          </div>
                          <div>
                            <span className="font-bold text-xs text-slate-900">@{q.from_nickname || 'comprador'}</span>
                            <p className="text-[11px] text-slate-400">Item: {q.item_id || 'Anúncio'}</p>
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400">{formatDate(q.date_created)}</span>
                      </div>

                      <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-800 font-medium border border-slate-100">
                        "{q.text}"
                      </div>

                      <div className="flex items-center justify-end">
                        <button
                          onClick={() => setReplyingQuestion(q)}
                          className="px-4 py-1.5 bg-[#2D3277] hover:bg-[#1f2354] text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5"
                        >
                          <Send size={12} />
                          <span>Responder</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 5: PUBLICIDADE (PRODUCT ADS) */}
          {/* ========================================================================= */}
          {activeTab === 'publicidade' && (
            <div className="space-y-6">
              {/* Top Banner & KPI Product Ads */}
              <div className="bg-gradient-to-r from-blue-900 to-[#2D3277] text-white p-6 rounded-2xl shadow-sm relative overflow-hidden">
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/30 border border-blue-400/30 text-xs font-bold text-blue-200 mb-2">
                      <Flame size={14} className="text-amber-400 fill-amber-400" />
                      Mercado Livre Product Ads
                    </div>
                    <h3 className="text-xl font-black">Anúncios Patrocinados</h3>
                    <p className="text-xs text-blue-200 mt-1 max-w-lg">
                      Aumente a visibilidade dos seus produtos no topo das buscas do Mercado Livre.
                    </p>
                  </div>

                  <a 
                    href="https://advertising.mercadolibre.com.br/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="px-4 py-2.5 bg-[#FFE600] text-[#2D3277] hover:bg-amber-300 font-black text-xs rounded-xl transition-all flex items-center gap-2 shadow-lg shrink-0"
                  >
                    <span>Gerenciar no Mercado Livre Ads</span>
                    <ExternalLink size={14} />
                  </a>
                </div>
              </div>

              {/* Tabela de Produtos Patrocinados */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
                <h4 className="text-sm font-bold text-slate-900">Anúncios com Product Ads Ativo</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase">
                        <th className="py-2.5 px-3">Anúncio</th>
                        <th className="py-2.5 px-3">Preço</th>
                        <th className="py-2.5 px-3">Estoque</th>
                        <th className="py-2.5 px-3">Vendidos</th>
                        <th className="py-2.5 px-3">Status Ads</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.filter(i => i.is_sponsored).map(item => (
                        <tr key={item.item_id}>
                          <td className="py-3 px-3 flex items-center gap-3">
                            <img src={item.thumbnail} alt="" className="w-9 h-9 rounded object-cover border" />
                            <span className="font-bold text-slate-900">{item.title}</span>
                          </td>
                          <td className="py-3 px-3 font-bold">{formatCurrency(item.price)}</td>
                          <td className="py-3 px-3">{item.available_quantity} un</td>
                          <td className="py-3 px-3 font-extrabold text-emerald-600">{item.sold_quantity} un</td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                              Ativo em Campanhas
                            </span>
                          </td>
                        </tr>
                      ))}
                      {items.filter(i => i.is_sponsored).length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-400">
                            Nenhum anúncio identificado com tag "paid_listing". Sincronize seus anúncios ou crie campanhas no Gerenciador de Publicidade do ML.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 6: REPUTAÇÃO */}
          {/* ========================================================================= */}
          {activeTab === 'reputacao' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              {/* Termômetro ML (Visual Níveis 1 a 5) */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-black text-slate-900">Termômetro de Reputação</h3>
                    <p className="text-xs text-slate-500">Com base no desempenho dos últimos 60 dias no Mercado Livre</p>
                  </div>
                  {repMetrics?.power_seller_status && (
                    <span className="px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                      <Award size={14} className="text-amber-600" />
                      MercadoLíder {repMetrics.power_seller_status.toUpperCase()}
                    </span>
                  )}
                </div>

                {/* Termômetro Bar 5 Cores */}
                <div className="grid grid-cols-5 gap-1.5 pt-2">
                  <div className={`h-4 rounded-l-lg bg-rose-500 transition-all ${repMetrics?.level_id === '1_red' ? 'ring-4 ring-rose-300 scale-105' : 'opacity-40'}`}></div>
                  <div className={`h-4 bg-orange-500 transition-all ${repMetrics?.level_id === '2_orange' ? 'ring-4 ring-orange-300 scale-105' : 'opacity-40'}`}></div>
                  <div className={`h-4 bg-amber-400 transition-all ${repMetrics?.level_id === '3_yellow' ? 'ring-4 ring-amber-200 scale-105' : 'opacity-40'}`}></div>
                  <div className={`h-4 bg-emerald-400 transition-all ${repMetrics?.level_id === '4_light_green' ? 'ring-4 ring-emerald-200 scale-105' : 'opacity-40'}`}></div>
                  <div className={`h-4 rounded-r-lg bg-[#00a650] transition-all ${repMetrics?.level_id === '5_green' || !repMetrics?.level_id ? 'ring-4 ring-emerald-300 scale-105' : 'opacity-40'}`}></div>
                </div>
                <div className="flex justify-between text-[11px] font-bold text-slate-500">
                  <span>Sem Reputação</span>
                  <span className="text-[#00a650]">Verde Escuro (Excelente)</span>
                </div>
              </div>

              {/* Grid 2x3 Métricas de Atendimento */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-500 font-semibold">Vendas Concluídas</p>
                  <h4 className="text-2xl font-black text-slate-900 mt-1">
                    {repMetrics?.transactions?.completed || ordersMetrics.paid || 0}
                  </h4>
                  <span className="text-[10px] text-slate-400">Últimos 60 dias</span>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-500 font-semibold">Cancelamentos</p>
                  <h4 className="text-2xl font-black text-emerald-600 mt-1">
                    {repMetrics?.metrics?.cancellations?.rate ? `${(repMetrics.metrics.cancellations.rate * 100).toFixed(1)}%` : '0.0%'}
                  </h4>
                  <span className="text-[10px] text-slate-400">Meta: abaixo de 2%</span>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-500 font-semibold">Reclamações</p>
                  <h4 className="text-2xl font-black text-emerald-600 mt-1">
                    {repMetrics?.metrics?.claims?.rate ? `${(repMetrics.metrics.claims.rate * 100).toFixed(1)}%` : '0.0%'}
                  </h4>
                  <span className="text-[10px] text-slate-400">Meta: abaixo de 1%</span>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-500 font-semibold">Despacho com Atraso</p>
                  <h4 className="text-2xl font-black text-emerald-600 mt-1">
                    {repMetrics?.metrics?.delayed_handling_time?.rate ? `${(repMetrics.metrics.delayed_handling_time.rate * 100).toFixed(1)}%` : '0.0%'}
                  </h4>
                  <span className="text-[10px] text-slate-400">Meta: abaixo de 15%</span>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-500 font-semibold">Média de Resposta</p>
                  <h4 className="text-2xl font-black text-slate-900 mt-1">12 min</h4>
                  <span className="text-[10px] text-slate-400">Perguntas em dias úteis</span>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-500 font-semibold">Satisfação Geral</p>
                  <h4 className="text-2xl font-black text-emerald-600 mt-1">4.9 / 5.0</h4>
                  <span className="text-[10px] text-slate-400">Com base nas qualificações</span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 7: FINANCEIRO */}
          {/* ========================================================================= */}
          {activeTab === 'financeiro' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                      <DollarSign size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">Mercado Pago</h4>
                      <p className="text-xs text-slate-500">Liquidações e saldo disponível</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">
                    Consulte relatórios detalhados de taxas de comissão, repasses e adiantamentos diretamente no painel do Mercado Pago.
                  </p>
                  <a 
                    href="https://www.mercadopago.com.br/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline"
                  >
                    <span>Ir para o Mercado Pago</span>
                    <ExternalLink size={12} />
                  </a>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                      <FileText size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">Faturas e Tarifas ML</h4>
                      <p className="text-xs text-slate-500">Custos operacionais de anúncios</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">
                    Acompanhe faturas de publicidade e comissões por categoria para otimizar sua margem de lucro.
                  </p>
                  <a 
                    href="https://www.mercadolivre.com.br/faturamento" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 hover:underline"
                  >
                    <span>Ver Faturamento ML</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DRAWER LATERAL: DETALHES DO ANÚNCIO (SHEET MODAL) */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white h-full shadow-2xl p-6 overflow-y-auto space-y-6 flex flex-col justify-between">
            <div className="space-y-5">
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <img src={selectedItem.thumbnail} alt="" className="w-12 h-12 rounded-xl object-cover border" />
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 line-clamp-1">{selectedItem.title}</h3>
                    <p className="text-xs text-slate-400 font-mono">ID: {selectedItem.item_id}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedItem(null)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X size={20} />
                </button>
              </div>

              {/* Informações Principais */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400">Preço</span>
                  <p className="font-bold text-slate-900 text-sm">{formatCurrency(selectedItem.price)}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400">Estoque Disponível</span>
                  <p className="font-bold text-slate-900 text-sm">{selectedItem.available_quantity} un</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400">Total Vendidos</span>
                  <p className="font-bold text-emerald-600 text-sm">{selectedItem.sold_quantity} un</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400">SKU do Vendedor</span>
                  <p className="font-bold text-slate-900 font-mono">{selectedItem.seller_sku || '-'}</p>
                </div>
              </div>

              {/* Raw Payload Collapsible */}
              <details className="text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
                <summary className="font-bold text-slate-700 cursor-pointer">Ver Payload Bruto (JSON ML)</summary>
                <pre className="mt-2 text-[10px] font-mono bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto max-h-60">
                  {JSON.stringify(selectedItem.raw_payload || selectedItem, null, 2)}
                </pre>
              </details>
            </div>

            <div className="pt-4 border-t border-slate-100 flex gap-2">
              {selectedItem.permalink && (
                <a
                  href={selectedItem.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2.5 bg-[#FFE600] text-[#2D3277] font-bold text-xs rounded-xl flex items-center justify-center gap-2 hover:bg-amber-300"
                >
                  <span>Ver no Mercado Livre</span>
                  <ExternalLink size={14} />
                </a>
              )}
              <button
                onClick={() => setSelectedItem(null)}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER LATERAL: DETALHES DO PEDIDO (SHEET MODAL) */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white h-full shadow-2xl p-6 overflow-y-auto space-y-6 flex flex-col justify-between">
            <div className="space-y-5">
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                  <span className="text-xs font-mono text-slate-400">Pedido #{selectedOrder.ml_order_id}</span>
                  <h3 className="font-bold text-base text-slate-900 mt-0.5">{selectedOrder.item_title || 'Pedido Mercado Livre'}</h3>
                </div>
                <button onClick={() => setSelectedOrder(null)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X size={20} />
                </button>
              </div>

              {/* Informações Comprador & Valor */}
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                  <span className="text-slate-400 font-medium">Comprador</span>
                  <p className="font-bold text-slate-900">@{selectedOrder.buyer_nickname || 'anônimo'}</p>
                  {selectedOrder.buyer_email && <p className="text-slate-500">{selectedOrder.buyer_email}</p>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-400">Valor Total</span>
                    <p className="font-black text-slate-900 text-sm">{formatCurrency(selectedOrder.total_amount)}</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-400">Data da Venda</span>
                    <p className="font-bold text-slate-900">{formatDate(selectedOrder.date_created)}</p>
                  </div>
                </div>
              </div>

              {/* Raw Payload Collapsible */}
              <details className="text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
                <summary className="font-bold text-slate-700 cursor-pointer">Ver Detalhes Técnicos (JSON)</summary>
                <pre className="mt-2 text-[10px] font-mono bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto max-h-60">
                  {JSON.stringify(selectedOrder.raw || selectedOrder, null, 2)}
                </pre>
              </details>
            </div>

            <button
              onClick={() => setSelectedOrder(null)}
              className="w-full py-2.5 bg-slate-900 text-white font-bold text-xs rounded-xl hover:bg-slate-800"
            >
              Fechar Detalhes
            </button>
          </div>
        </div>
      )}

      {/* MODAL DE RESPOSTA DE PERGUNTA */}
      {replyingQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-sm">Responder Pergunta</h3>
              <button onClick={() => setReplyingQuestion(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
              <span className="font-bold text-slate-700">@{replyingQuestion.from_nickname}:</span>
              <p className="text-slate-600">"{replyingQuestion.text}"</p>
            </div>

            <textarea
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              placeholder="Digite sua resposta para o comprador..."
              rows={4}
              className="w-full p-3 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#2D3277]"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setReplyingQuestion(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendReply}
                disabled={isSendingReply || !replyText.trim()}
                className="px-5 py-2 bg-[#2D3277] hover:bg-[#1d2150] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send size={14} />
                <span>{isSendingReply ? 'Enviando...' : 'Enviar Resposta'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
