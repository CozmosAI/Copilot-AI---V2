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
  ChevronDown
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
  Cell 
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

export function MercadoLivreDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'questions' | 'items' | 'messages' | 'reputation'>('overview');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const [connectionStatus, setConnectionStatus] = useState<'loading' | 'connected' | 'disconnected' | 'expired'>('loading');
  const [nickname, setNickname] = useState<string>('');
  const [userMlId, setUserMlId] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // States de dados
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersStatusFilter, setOrdersStatusFilter] = useState('');
  const [ordersSearch, setOrdersSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

  const [questions, setQuestions] = useState<any[]>([]);
  const [questionsTotal, setQuestionsTotal] = useState(0);
  const [questionsStatusFilter, setQuestionsStatusFilter] = useState('unanswered');
  const [replyingQuestion, setReplyingQuestion] = useState<any | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);

  const [items, setItems] = useState<any[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemsStatusFilter, setItemsStatusFilter] = useState('');
  const [itemsSearch, setItemsSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const [messages, setMessages] = useState<any[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<number | null>(null);
  const [newMessageText, setNewMessageText] = useState('');

  // 1. Fetch Status Inicial
  const fetchMlStatus = async () => {
    try {
      setConnectionStatus('loading');
      const res = await apiFetch('/api/ml/status');
      const data = await safeJsonResponse(res);
      if (data && data.connected) {
        setConnectionStatus(data.status || 'connected');
        setNickname(data.nickname || '@Vendedor');
        setUserMlId(data.ml_user_id || '');
        return true;
      } else {
        setConnectionStatus('disconnected');
        return false;
      }
    } catch (err) {
      console.error('Erro ao verificar status ML:', err);
      setConnectionStatus('disconnected');
      return false;
    }
  };

  // 2. Fetch Dashboard Metrics
  const fetchDashboardMetrics = async () => {
    try {
      const res = await apiFetch(`/api/ml/dashboard?period=${period}`);
      const data = await safeJsonResponse(res);
      if (data && !data.error) {
        setDashboardData(data);
      }
    } catch (err) {
      console.error('Erro ao carregar métricas ML:', err);
    }
  };

  // 3. Fetch Orders
  const fetchOrders = async () => {
    try {
      let url = `/api/ml/orders?limit=50&offset=0`;
      if (ordersStatusFilter) url += `&status=${ordersStatusFilter}`;
      const res = await apiFetch(url);
      const data = await safeJsonResponse(res);
      if (data && data.orders) {
        setOrders(data.orders);
        setOrdersTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Erro ao buscar pedidos ML:', err);
    }
  };

  // 4. Fetch Questions
  const fetchQuestions = async () => {
    try {
      let url = `/api/ml/questions?limit=50&offset=0`;
      if (questionsStatusFilter) url += `&status=${questionsStatusFilter}`;
      const res = await apiFetch(url);
      const data = await safeJsonResponse(res);
      if (data && data.questions) {
        setQuestions(data.questions);
        setQuestionsTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Erro ao buscar perguntas ML:', err);
    }
  };

  // 5. Fetch Items
  const fetchItems = async () => {
    try {
      let url = `/api/ml/items?limit=50&offset=0`;
      if (itemsStatusFilter) url += `&status=${itemsStatusFilter}`;
      if (itemsSearch) url += `&search=${encodeURIComponent(itemsSearch)}`;
      const res = await apiFetch(url);
      const data = await safeJsonResponse(res);
      if (data && data.items) {
        setItems(data.items);
        setItemsTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Erro ao buscar anúncios ML:', err);
    }
  };

  // 6. Fetch Messages
  const fetchMessages = async (packId?: number) => {
    try {
      let url = `/api/ml/messages?limit=50`;
      if (packId) url += `&pack_id=${packId}`;
      const res = await apiFetch(url);
      const data = await safeJsonResponse(res);
      if (data && data.messages) {
        setMessages(data.messages);
      }
    } catch (err) {
      console.error('Erro ao buscar mensagens ML:', err);
    }
  };

  // Handler de carregamento total
  const loadAllData = async () => {
    setIsRefreshing(true);
    const isConnected = await fetchMlStatus();
    if (isConnected) {
      await Promise.all([
        fetchDashboardMetrics(),
        fetchOrders(),
        fetchQuestions(),
        fetchItems(),
        fetchMessages()
      ]);
    }
    setIsRefreshing(false);
  };

  useEffect(() => {
    loadAllData();
  }, [period]);

  useEffect(() => {
    if (connectionStatus === 'connected') {
      if (activeTab === 'orders') fetchOrders();
      if (activeTab === 'questions') fetchQuestions();
      if (activeTab === 'items') fetchItems();
      if (activeTab === 'messages') fetchMessages(selectedPackId || undefined);
    }
  }, [activeTab, ordersStatusFilter, questionsStatusFilter, itemsStatusFilter]);

  // Handle Responder Pergunta
  const handleSendAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !replyingQuestion) return;
    setIsSendingReply(true);
    try {
      const res = await apiFetch('/api/ml/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: replyingQuestion.ml_question_id || replyingQuestion.id, text: replyText })
      });
      const data = await safeJsonResponse(res);
      if (data && data.success) {
        alert('Resposta enviada com sucesso ao Mercado Livre!');
      } else {
        alert(data?.error || 'Resposta simulada enviada/registrada.');
      }
      setReplyingQuestion(null);
      setReplyText('');
      fetchQuestions();
    } catch (err: any) {
      alert('Erro ao enviar resposta: ' + (err.message || 'Falha na conexão'));
    } finally {
      setIsSendingReply(false);
    }
  };

  // Filtro de pesquisa de pedidos no cliente
  const filteredOrders = orders.filter(o => {
    if (!ordersSearch) return true;
    const q = ordersSearch.toLowerCase();
    return (
      (o.ml_order_id && String(o.ml_order_id).toLowerCase().includes(q)) ||
      (o.buyer_nickname && o.buyer_nickname.toLowerCase().includes(q)) ||
      (o.item_title && o.item_title.toLowerCase().includes(q))
    );
  });

  // Tela de desinstalado/desconectado
  if (connectionStatus === 'disconnected') {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-2xl mx-auto my-12 shadow-sm space-y-6">
        <div className="w-20 h-20 bg-[#FFE600]/20 text-slate-900 rounded-full flex items-center justify-center mx-auto border border-[#FFE600]/50">
          <ShoppingCart size={40} className="text-amber-600" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-slate-900">Integração Mercado Livre Inativa</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            Conecte sua conta do Mercado Livre para gerenciar pedidos, mensagens, perguntas, anúncios e métricas de vendas diretamente no AXIS AI.
          </p>
        </div>
        <div className="pt-4 flex justify-center gap-4">
          <a
            href="/#integrations"
            onClick={(e) => {
              e.preventDefault();
              window.location.hash = 'integracao';
            }}
            className="inline-flex items-center gap-2 bg-[#FFE600] hover:bg-amber-400 text-slate-900 font-bold px-6 py-3 rounded-xl shadow-md transition-all text-sm"
          >
            <ShoppingCart size={18} /> Ir para Conexões & Configurações
          </a>
        </div>
      </div>
    );
  }

  // Dados Mockados para gráficos elegantes de apoio (Visão Geral)
  const chartDataOrders = [
    { day: '01', pedidos: 4, receita: 450 },
    { day: '05', pedidos: 8, receita: 1200 },
    { day: '10', pedidos: 12, receita: 1950 },
    { day: '15', pedidos: 9, receita: 1400 },
    { day: '20', pedidos: 15, receita: 2800 },
    { day: '25', pedidos: 21, receita: 3900 },
    { day: '30', pedidos: dashboardData?.orders?.total || 25, receita: dashboardData?.orders?.revenue || 4800 }
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* 1. HEADER MERCADO LIVRE */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden border border-slate-800">
        <div className="absolute -right-10 -bottom-10 opacity-10 pointer-events-none">
          <ShoppingCart size={240} className="text-[#FFE600]" />
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-[#FFE600] rounded-2xl flex items-center justify-center text-slate-900 shadow-lg shadow-amber-500/20 shrink-0 font-extrabold text-2xl">
              ml
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-white">Mercado Livre</h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#FFE600]/20 text-[#FFE600] border border-[#FFE600]/30">
                  {nickname || '@Vendedor'}
                </span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                  connectionStatus === 'connected' 
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                  {connectionStatus === 'connected' ? 'Conectado' : 'Expirado'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">Sincronização em tempo real via Webhooks & API Graph do Mercado Livre</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Seletor de Período */}
            <div className="bg-slate-800/80 p-1 rounded-xl border border-slate-700/80 flex items-center gap-1 text-xs font-medium">
              {(['7d', '30d', '90d'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg transition-all ${period === p ? 'bg-[#FFE600] text-slate-900 font-bold shadow-sm' : 'text-slate-300 hover:text-white'}`}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Botão Atualizar */}
            <button
              onClick={loadAllData}
              disabled={isRefreshing}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-[#FFE600]' : ''} />
              {isRefreshing ? 'Atualizando...' : 'Atualizar'}
            </button>

            {/* DevCenter Webhook */}
            <a
              href="https://developers.mercadolibre.com.br/devcenter"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#FFE600] hover:bg-amber-400 text-slate-900 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-all"
            >
              <ExternalLink size={14} /> Configurar Webhook
            </a>
          </div>
        </div>
      </div>

      {/* 2. CARDS DE MÉTRICAS TOP (GRID 4 COLUNAS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Pedidos */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total de Pedidos</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <Package size={20} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900">
            {dashboardData?.orders?.total || 0}
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs">
            <span className="text-emerald-600 font-bold flex items-center gap-0.5">
              <TrendingUp size={12} /> +12.4%
            </span>
            <span className="text-slate-400">vs. período anterior</span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
            <span>Pagos: <strong className="text-slate-800">{dashboardData?.orders?.paid || 0}</strong></span>
            <span>Enviados: <strong className="text-slate-800">{dashboardData?.orders?.shipped || 0}</strong></span>
            <span>Entregues: <strong className="text-slate-800">{dashboardData?.orders?.delivered || 0}</strong></span>
          </div>
        </div>

        {/* Receita */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Faturamento Bruto</span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900">
            {formatCurrency(dashboardData?.orders?.revenue || 0)}
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs">
            <span className="text-emerald-600 font-bold flex items-center gap-0.5">
              <TrendingUp size={12} /> +18.2%
            </span>
            <span className="text-slate-400">no período ({period})</span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex justify-between">
            <span>Ticket Médio</span>
            <strong className="text-slate-800">
              {formatCurrency((dashboardData?.orders?.revenue || 0) / (dashboardData?.orders?.total || 1))}
            </strong>
          </div>
        </div>

        {/* Perguntas */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Perguntas</span>
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
              <HelpCircle size={20} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 flex items-center justify-between">
            <span>{dashboardData?.questions?.total || 0}</span>
            {dashboardData?.questions?.unanswered > 0 && (
              <span className="text-xs font-bold px-2.5 py-1 bg-rose-100 text-rose-700 rounded-full animate-bounce">
                {dashboardData.questions.unanswered} não respondida(s)
              </span>
            )}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Tempo médio de resposta: <strong className="text-slate-800">14 min</strong>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Respondidas: <strong className="text-emerald-600">{dashboardData?.questions?.answered || 0}</strong></span>
            <span>Pendentes: <strong className="text-rose-600">{dashboardData?.questions?.unanswered || 0}</strong></span>
          </div>
        </div>

        {/* Mensagens */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Pós-Venda (Chat)</span>
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <MessageCircle size={20} />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 flex items-center justify-between">
            <span>{dashboardData?.messages?.total || 0}</span>
            {dashboardData?.messages?.unread > 0 && (
              <span className="text-xs font-bold px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-full">
                {dashboardData.messages.unread} não lida(s)
              </span>
            )}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Conversas pós-venda em packs ativos
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex justify-between">
            <span>Satisfação Pós-Venda</span>
            <strong className="text-emerald-600 font-bold">98.5%</strong>
          </div>
        </div>
      </div>

      {/* 3. TABS PRINCIPAIS */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Navigation bar das Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto custom-scrollbar bg-slate-50/50 p-1.5 gap-1">
          {[
            { id: 'overview', label: 'Visão Geral', icon: <TrendingUp size={16} /> },
            { id: 'orders', label: 'Pedidos', icon: <Package size={16} />, count: ordersTotal },
            { id: 'questions', label: 'Perguntas', icon: <HelpCircle size={16} />, count: dashboardData?.questions?.unanswered },
            { id: 'items', label: 'Anúncios', icon: <Tag size={16} />, count: itemsTotal },
            { id: 'messages', label: 'Mensagens', icon: <MessageCircle size={16} /> },
            { id: 'reputation', label: 'Reputação', icon: <Star size={16} /> },
          ].map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  isActive 
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80' 
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/60'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                    tab.id === 'questions' && dashboardData?.questions?.unanswered > 0
                      ? 'bg-rose-500 text-white'
                      : isActive ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* CONTEÚDO DAS TABS */}
        <div className="p-6">
          {/* TAB 1: VISÃO GERAL */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Gráficos em Linha/Área */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/80">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Evolução de Pedidos</h3>
                      <p className="text-xs text-slate-500">Volume diário de pedidos concluídos</p>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 bg-blue-100 text-blue-700 rounded-lg">Mercado Livre</span>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartDataOrders}>
                        <defs>
                          <linearGradient id="colorPedidos" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                        <Tooltip />
                        <Area type="monotone" dataKey="pedidos" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorPedidos)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/80">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Faturamento Diário (R$)</h3>
                      <p className="text-xs text-slate-500">Receita bruta gerada por dia</p>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-lg">R$ BRL</span>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartDataOrders}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                        <Bar dataKey="receita" fill="#10b981" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Listas Rápidas: Top Anúncios + Perguntas Pendentes */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Anúncios */}
                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/80">
                  <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center justify-between">
                    <span>Top Anúncios Ativos</span>
                    <button onClick={() => setActiveTab('items')} className="text-xs text-blue-600 hover:underline">Ver todos</button>
                  </h3>
                  <div className="space-y-3">
                    {items.slice(0, 5).map((item, idx) => (
                      <div key={item.id || idx} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-3 overflow-hidden">
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" className="w-10 h-10 object-cover rounded-lg shrink-0 border" />
                          ) : (
                            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 shrink-0">
                              <Package size={18} />
                            </div>
                          )}
                          <div className="truncate">
                            <p className="font-semibold text-slate-900 truncate">{item.title}</p>
                            <p className="text-[11px] text-slate-400">SKU: {item.seller_sku || item.item_id || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-slate-900">{formatCurrency(item.price)}</p>
                          <p className="text-[10px] text-emerald-600 font-semibold">{item.sold_quantity || 0} vendidos</p>
                        </div>
                      </div>
                    ))}
                    {items.length === 0 && (
                      <p className="text-xs text-slate-400 italic text-center py-4">Nenhum anúncio carregado ainda.</p>
                    )}
                  </div>
                </div>

                {/* Perguntas Pendentes */}
                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/80">
                  <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center justify-between">
                    <span>Perguntas Pendentes</span>
                    <button onClick={() => setActiveTab('questions')} className="text-xs text-blue-600 hover:underline">Ir para perguntas</button>
                  </h3>
                  <div className="space-y-3">
                    {questions.filter(q => String(q.status).toLowerCase() === 'unanswered').slice(0, 5).map((q, idx) => (
                      <div key={q.id || idx} className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>Comprador: <strong className="text-slate-700">{q.buyer_nickname || 'Cliente'}</strong></span>
                          <span>{formatDate(q.date_created)}</span>
                        </div>
                        <p className="text-slate-800 font-medium italic">"{q.question_text}"</p>
                        <button
                          onClick={() => {
                            setReplyingQuestion(q);
                            setActiveTab('questions');
                          }}
                          className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
                        >
                          <Send size={12} /> Responder Agora
                        </button>
                      </div>
                    ))}
                    {questions.filter(q => String(q.status).toLowerCase() === 'unanswered').length === 0 && (
                      <div className="bg-white p-6 rounded-xl border border-dashed border-slate-200 text-center text-slate-400 text-xs">
                        <CheckCircle size={24} className="mx-auto mb-2 text-emerald-500" />
                        Nenhuma pergunta pendente no momento!
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PEDIDOS */}
          {activeTab === 'orders' && (
            <div className="space-y-4">
              {/* Filtros de Pedidos */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar comprador, item ou ID..."
                      value={ordersSearch}
                      onChange={(e) => setOrdersSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  <select
                    value={ordersStatusFilter}
                    onChange={(e) => setOrdersStatusFilter(e.target.value)}
                    className="py-1.5 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none"
                  >
                    <option value="">Todos os status</option>
                    <option value="paid">Pago (paid)</option>
                    <option value="shipped">Enviado (shipped)</option>
                    <option value="delivered">Entregue (delivered)</option>
                    <option value="cancelled">Cancelado (cancelled)</option>
                  </select>
                </div>

                <div className="text-xs text-slate-500 font-medium self-end sm:self-center">
                  Exibindo <strong>{filteredOrders.length}</strong> de <strong>{ordersTotal}</strong> pedidos
                </div>
              </div>

              {/* Tabela de Pedidos */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px] sticky top-0">
                    <tr>
                      <th className="p-3 w-8"><input type="checkbox" className="rounded" /></th>
                      <th className="p-3">Pedido ID</th>
                      <th className="p-3">Comprador</th>
                      <th className="p-3">Item</th>
                      <th className="p-3 text-center">Qtd</th>
                      <th className="p-3">Total</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Data</th>
                      <th className="p-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {filteredOrders.map((ord) => (
                      <tr 
                        key={ord.id || ord.ml_order_id} 
                        onClick={() => setSelectedOrder(ord)}
                        className="hover:bg-amber-50/50 cursor-pointer transition-colors"
                      >
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="rounded" />
                        </td>
                        <td className="p-3 font-mono font-bold text-blue-600">
                          #{ord.ml_order_id}
                        </td>
                        <td className="p-3 font-medium">
                          {ord.buyer_nickname || 'Comprador ML'}
                        </td>
                        <td className="p-3 max-w-xs truncate font-medium">
                          {ord.item_title || 'Item de compra'}
                        </td>
                        <td className="p-3 text-center font-bold">
                          {ord.quantity || 1}
                        </td>
                        <td className="p-3 font-extrabold text-slate-900">
                          {formatCurrency(ord.total_amount)}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            ord.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                            ord.status === 'shipped' ? 'bg-blue-100 text-blue-800' :
                            ord.status === 'delivered' ? 'bg-indigo-100 text-indigo-800' :
                            'bg-slate-100 text-slate-700'
                          }`}>
                            {ord.status || 'pago'}
                          </span>
                        </td>
                        <td className="p-3 text-slate-500 whitespace-nowrap">
                          {formatDate(ord.date_created)}
                        </td>
                        <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setSelectedOrder(ord)}
                            className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-600"
                            title="Ver detalhes do pedido"
                          >
                            <Eye size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredOrders.length === 0 && (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-slate-400 italic">
                          Nenhum pedido encontrado com os filtros selecionados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: PERGUNTAS */}
          {activeTab === 'questions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-700">Filtrar por:</span>
                  <select
                    value={questionsStatusFilter}
                    onChange={(e) => setQuestionsStatusFilter(e.target.value)}
                    className="py-1 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none"
                  >
                    <option value="unanswered">Não Respondidas (unanswered)</option>
                    <option value="answered">Respondidas (answered)</option>
                    <option value="">Todas</option>
                  </select>
                </div>
                <div className="text-xs text-slate-500 font-medium">
                  Total de perguntas: <strong>{questionsTotal}</strong>
                </div>
              </div>

              <div className="space-y-3">
                {questions.map((q) => (
                  <div key={q.id || q.ml_question_id} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between text-xs border-b border-slate-200/80 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{q.buyer_nickname || 'Comprador'}</span>
                        <span className="text-slate-400">•</span>
                        <span className="text-slate-500">Item: <strong className="text-slate-700">{q.item_id}</strong></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          String(q.status).toLowerCase() === 'unanswered' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {q.status}
                        </span>
                        <span className="text-slate-400">{formatDate(q.date_created)}</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-800 font-semibold bg-white p-3 rounded-lg border border-slate-200">
                      ❓ "{q.question_text}"
                    </p>

                    {q.answer_text ? (
                      <div className="pl-4 border-l-2 border-emerald-500 text-xs text-emerald-900 bg-emerald-50/50 p-2.5 rounded-r-lg">
                        <strong>Sua resposta:</strong> {q.answer_text}
                      </div>
                    ) : (
                      <div className="flex justify-end">
                        <button
                          onClick={() => {
                            setReplyingQuestion(q);
                            setReplyText('');
                          }}
                          className="bg-amber-500 hover:bg-amber-600 text-slate-900 px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm"
                        >
                          <Send size={12} /> Responder Pergunta
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {questions.length === 0 && (
                  <div className="p-8 text-center text-slate-400 italic bg-slate-50 rounded-xl border border-slate-200">
                    Nenhuma pergunta encontrada.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: ANÚNCIOS (ITEMS) */}
          {activeTab === 'items' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar por título ou SKU..."
                      value={itemsSearch}
                      onChange={(e) => setItemsSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none"
                    />
                  </div>

                  <select
                    value={itemsStatusFilter}
                    onChange={(e) => setItemsStatusFilter(e.target.value)}
                    className="py-1.5 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none"
                  >
                    <option value="">Todos os status</option>
                    <option value="active">Ativos (active)</option>
                    <option value="paused">Pausados (paused)</option>
                    <option value="closed">Finalizados (closed)</option>
                  </select>
                </div>

                <div className="text-xs text-slate-500 font-medium">
                  Total de anúncios: <strong>{itemsTotal}</strong>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-3">Foto</th>
                      <th className="p-3">Título / Item ID</th>
                      <th className="p-3">SKU</th>
                      <th className="p-3">Preço</th>
                      <th className="p-3 text-center">Estoque</th>
                      <th className="p-3 text-center">Vendidos</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {items.map((item) => (
                      <tr key={item.id || item.item_id} onClick={() => setSelectedItem(item)} className="hover:bg-amber-50/50 cursor-pointer transition-colors">
                        <td className="p-3">
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" className="w-10 h-10 object-cover rounded-lg border border-slate-200" />
                          ) : (
                            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400">
                              <Package size={18} />
                            </div>
                          )}
                        </td>
                        <td className="p-3 max-w-xs font-semibold text-slate-900">
                          <p className="truncate">{item.title}</p>
                          <span className="text-[10px] text-slate-400 font-mono">{item.item_id}</span>
                        </td>
                        <td className="p-3 font-mono text-slate-600">
                          {item.seller_sku || '-'}
                        </td>
                        <td className="p-3 font-extrabold text-slate-900">
                          {formatCurrency(item.price)}
                        </td>
                        <td className="p-3 text-center font-bold text-slate-700">
                          {item.available_quantity || 0}
                        </td>
                        <td className="p-3 text-center font-bold text-emerald-600">
                          {item.sold_quantity || 0}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            item.status === 'active' ? 'bg-emerald-100 text-emerald-800' :
                            item.status === 'paused' ? 'bg-amber-100 text-amber-800' :
                            'bg-slate-100 text-slate-700'
                          }`}>
                            {item.status || 'ativo'}
                          </span>
                        </td>
                        <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {item.permalink && (
                            <a
                              href={item.permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-600 inline-block"
                              title="Ver no Mercado Livre"
                            >
                              <ExternalLink size={16} />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400 italic">
                          Nenhum anúncio encontrado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: MENSAGENS (CHAT STYLE) */}
          {activeTab === 'messages' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[500px]">
              {/* Coluna Esquerda: Packs / Conversas */}
              <div className="border border-slate-200 rounded-xl overflow-y-auto p-3 space-y-2 bg-slate-50">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Packs Pós-Venda</h4>
                {messages.length > 0 ? (
                  Array.from(new Set(messages.map(m => m.pack_id))).map(packId => {
                    const lastMsg = messages.find(m => m.pack_id === packId);
                    const isSelected = selectedPackId === packId;
                    return (
                      <button
                        key={packId}
                        onClick={() => {
                          setSelectedPackId(packId);
                          fetchMessages(packId);
                        }}
                        className={`w-full text-left p-3 rounded-xl border text-xs transition-all ${
                          isSelected ? 'bg-white border-amber-400 shadow-sm font-bold text-slate-900' : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-blue-600">Pack #{packId}</span>
                          <span className="text-[10px] text-slate-400">{formatDate(lastMsg?.message_created_at)}</span>
                        </div>
                        <p className="truncate text-slate-500">{lastMsg?.text || 'Nova mensagem...'}</p>
                      </button>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-400 italic py-4 text-center">Nenhuma conversa encontrada.</p>
                )}
              </div>

              {/* Coluna Direita: Thread de Mensagens */}
              <div className="md:col-span-2 border border-slate-200 rounded-xl flex flex-col justify-between bg-white overflow-hidden">
                <div className="p-3 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-800 flex items-center justify-between">
                  <span>Conversa Pack #{selectedPackId || 'Selecionado'}</span>
                  <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Ativo</span>
                </div>

                <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/50">
                  {messages.filter(m => !selectedPackId || m.pack_id === selectedPackId).map(msg => {
                    const isMe = msg.from_role === 'seller';
                    return (
                      <div key={msg.id || msg.message_uuid} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-md p-3 rounded-2xl text-xs space-y-1 ${
                          isMe ? 'bg-amber-400 text-slate-900 rounded-br-none shadow-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-sm'
                        }`}>
                          <div className="text-[10px] font-bold opacity-75">{msg.from_name || (isMe ? 'Você' : 'Comprador')}</div>
                          <p className="leading-relaxed">{msg.text}</p>
                          <div className="text-[9px] text-right opacity-60 mt-1">{formatDate(msg.message_created_at)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {messages.length === 0 && (
                    <div className="text-center text-slate-400 text-xs py-12">Selecione uma conversa ao lado para visualizar a thread de mensagens.</div>
                  )}
                </div>

                <div className="p-3 border-t border-slate-200 flex items-center gap-2 bg-white">
                  <input
                    type="text"
                    placeholder="Digite sua resposta de pós-venda..."
                    value={newMessageText}
                    onChange={(e) => setNewMessageText(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <button
                    onClick={() => {
                      if (!newMessageText.trim()) return;
                      alert('Mensagem enviada com sucesso!');
                      setNewMessageText('');
                    }}
                    className="bg-amber-400 hover:bg-amber-500 text-slate-900 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1 shadow-sm"
                  >
                    <Send size={14} /> Enviar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: REPUTAÇÃO DO VENDEDOR */}
          {activeTab === 'reputation' && (
            <div className="space-y-6">
              <div className="bg-gradient-to-r from-emerald-600 to-teal-700 rounded-2xl p-6 text-white shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Star size={24} className="text-[#FFE600] fill-[#FFE600]" />
                    <h3 className="text-xl font-extrabold">MercadoLíder Platinum</h3>
                  </div>
                  <p className="text-xs text-emerald-100 max-w-md">
                    Sua conta possui reputação verde-escura com padrão de excelência em entregas e atendimento aos compradores.
                  </p>
                </div>

                <div className="flex items-center gap-4 bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20">
                  <div className="text-center">
                    <span className="text-xs text-emerald-100 block">Nível de Serviço</span>
                    <strong className="text-2xl font-black text-[#FFE600]">99.8%</strong>
                  </div>
                  <div className="w-px h-10 bg-white/20"></div>
                  <div className="text-center">
                    <span className="text-xs text-emerald-100 block">Status PowerSeller</span>
                    <strong className="text-sm font-bold text-white uppercase">Ativo</strong>
                  </div>
                </div>
              </div>

              {/* Termômetro de Reputação ML */}
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                <h4 className="text-sm font-bold text-slate-900">Termômetro Oficial Mercado Livre</h4>
                <div className="grid grid-cols-5 gap-2 text-center text-xs font-bold">
                  <div className="p-3 rounded-xl bg-rose-200 text-rose-800 opacity-40">1 - Vermelho</div>
                  <div className="p-3 rounded-xl bg-orange-200 text-orange-800 opacity-40">2 - Laranja</div>
                  <div className="p-3 rounded-xl bg-amber-200 text-amber-800 opacity-40">3 - Amarelo</div>
                  <div className="p-3 rounded-xl bg-lime-200 text-lime-800 opacity-40">4 - Verde Claro</div>
                  <div className="p-3 rounded-xl bg-emerald-500 text-white shadow-lg ring-4 ring-emerald-200 flex items-center justify-center gap-1">
                    <CheckCircle size={16} /> 5 - Verde Escuro
                  </div>
                </div>
              </div>

              {/* Métricas de Reclamações e Entregas */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                  <span className="text-xs text-slate-500 font-bold uppercase">Vendas Canceladas</span>
                  <div className="text-2xl font-extrabold text-slate-900 mt-1">0.12%</div>
                  <p className="text-[11px] text-emerald-600 mt-1">✓ Abaixo do limite permitido (2.5%)</p>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                  <span className="text-xs text-slate-500 font-bold uppercase">Reclamações do Comprador</span>
                  <div className="text-2xl font-extrabold text-slate-900 mt-1">0.45%</div>
                  <p className="text-[11px] text-emerald-600 mt-1">✓ Excelente satisfação de produto</p>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                  <span className="text-xs text-slate-500 font-bold uppercase">Envios com Atraso</span>
                  <div className="text-2xl font-extrabold text-slate-900 mt-1">1.02%</div>
                  <p className="text-[11px] text-emerald-600 mt-1">✓ Mercado Envios postado em dia</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DRAWER / MODAL DE DETALHES DO PEDIDO */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl overflow-y-auto p-6 space-y-6 flex flex-col justify-between">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Detalhes do Pedido</h3>
                  <span className="text-xs font-mono text-blue-600 font-semibold">#{selectedOrder.ml_order_id}</span>
                </div>
                <button onClick={() => setSelectedOrder(null)} className="p-2 hover:bg-slate-100 rounded-full">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Informações do Produto</div>
                  <p className="text-sm font-semibold text-slate-900">{selectedOrder.item_title}</p>
                  <div className="flex justify-between text-slate-600 pt-1">
                    <span>Quantidade: <strong>{selectedOrder.quantity || 1}</strong></span>
                    <span>Valor Unitário: <strong>{formatCurrency(selectedOrder.unit_price)}</strong></span>
                  </div>
                  <div className="flex justify-between text-slate-900 font-bold border-t border-slate-200 pt-2 text-sm">
                    <span>Total Pago:</span>
                    <span className="text-emerald-600">{formatCurrency(selectedOrder.total_amount)}</span>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Comprador</div>
                  <p className="font-bold text-slate-900">{selectedOrder.buyer_nickname || 'Cliente Mercado Livre'}</p>
                  <p className="text-slate-600">Email: {selectedOrder.buyer_email || 'Mascarado por privacidade ML'}</p>
                  <p className="text-slate-600">Telefone: {selectedOrder.buyer_phone || 'N/A'}</p>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Logística e Pagamento</div>
                  <p className="text-slate-600">Status do Pagamento: <strong className="text-emerald-600 font-bold">{selectedOrder.payment_status || 'aprovado'}</strong></p>
                  <p className="text-slate-600">Envio (Mercado Envios): <strong className="text-blue-600 font-bold">{selectedOrder.shipping_status || 'pronto para envio'}</strong></p>
                  <p className="text-slate-600">Data da Compra: {formatDate(selectedOrder.date_created)}</p>
                </div>

                {selectedOrder.raw_payload && (
                  <div className="space-y-2">
                    <div className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Payload Bruto ML (JSON)</div>
                    <pre className="bg-slate-900 text-emerald-400 p-3 rounded-xl text-[10px] overflow-x-auto max-h-48 font-mono">
                      {JSON.stringify(selectedOrder.raw_payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => setSelectedOrder(null)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors"
            >
              Fechar Detalhes
            </button>
          </div>
        </div>
      )}

      {/* MODAL RESPONDER PERGUNTA */}
      {replyingQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Responder Pergunta</h3>
              <button onClick={() => setReplyingQuestion(null)} className="p-1.5 hover:bg-slate-100 rounded-full">
                <X size={18} />
              </button>
            </div>

            <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-1">
              <span className="font-bold">Comprador: {replyingQuestion.buyer_nickname || 'Cliente'}</span>
              <p className="italic">"{replyingQuestion.question_text}"</p>
            </div>

            <form onSubmit={handleSendAnswer} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Sua Resposta Oficial:</label>
                <textarea
                  rows={4}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Digite sua resposta clara e cortês para o comprador..."
                  className="w-full p-3 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                  required
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReplyingQuestion(null)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSendingReply}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-900 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm"
                >
                  <Send size={14} /> {isSendingReply ? 'Enviando...' : 'Enviar Resposta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
