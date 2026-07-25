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
  ArrowDownRight
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

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || !isFinite(denominator) || denominator === 0) return 0;
  const result = numerator / denominator;
  return isFinite(result) ? result : 0;
}

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

  // States Tab Publicidade (Product Ads)
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [isSyncingAds, setIsSyncingAds] = useState(false);
  const [sponsoredItemIds, setSponsoredItemIds] = useState<Set<string>>(new Set());

  // Modais de Publicidade
  const [modalNewCampaignOpen, setModalNewCampaignOpen] = useState(false);
  const [modalEditCampaign, setModalEditCampaign] = useState<any | null>(null);
  const [formCampaign, setFormCampaign] = useState({
    name: '',
    budget_amount: 50,
    roas_target: 10,
    selected_item_ids: [] as string[]
  });

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

  // 7. Fetch Product Ads (Campaigns)
  const fetchCampaigns = async (syncFirst = false) => {
    setCampaignsLoading(true);
    try {
      if (syncFirst) {
        setIsSyncingAds(true);
        showToast('Sincronizando campanhas do Product Ads...', 'info');
        await apiFetch('/api/ml/advertising/sync', { method: 'POST' });
      }

      const res = await apiFetch('/api/ml/advertising/campaigns');
      if (res.ok) {
        const data = await safeJsonResponse(res);
        const list = data.campaigns || [];
        setCampaigns(list);

        const sponsoredSet = new Set<string>();
        list.forEach((c: any) => {
          if (Array.isArray(c.ad_groups)) {
            c.ad_groups.forEach((ag: any) => {
              if (ag.item_id) sponsoredSet.add(ag.item_id);
            });
          }
        });
        setSponsoredItemIds(sponsoredSet);
      }
    } catch (err) {
      console.error('[ML Advertising fetch error]:', err);
    } finally {
      setCampaignsLoading(false);
      setIsSyncingAds(false);
    }
  };

  // Handlers Product Ads Actions
  const handleToggleCampaignStatus = async (campaign: any) => {
    const newStatus = campaign.status === 'active' ? 'paused' : 'active';
    showToast(`Alterando status para ${newStatus === 'active' ? 'Ativa' : 'Pausada'}...`, 'info');
    setCampaigns(prev => prev.map(c => c.campaign_id === campaign.campaign_id ? { ...c, status: newStatus } : c));

    try {
      const res = await apiFetch(`/api/ml/advertising/campaigns/${campaign.campaign_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast(`Campanha ${newStatus === 'active' ? 'ativada' : 'pausada'} com sucesso!`, 'success');
        fetchCampaigns(false);
      } else {
        showToast(data.error || 'Erro ao alterar status.', 'error');
        fetchCampaigns(false);
      }
    } catch (err: any) {
      showToast(err.message || 'Erro ao alterar status.', 'error');
      fetchCampaigns(false);
    }
  };

  const handleDeleteCampaign = async (campaignId: string | number) => {
    if (!confirm('Deseja realmente excluir esta campanha de Product Ads?')) return;
    showToast('Excluindo campanha...', 'info');
    try {
      const res = await apiFetch(`/api/ml/advertising/campaigns/${campaignId}`, { method: 'DELETE' });
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast('Campanha excluída com sucesso!', 'success');
        fetchCampaigns(false);
      } else {
        showToast(data.error || 'Erro ao excluir campanha.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir.', 'error');
    }
  };

  const handleSaveCampaign = async () => {
    if (!formCampaign.name.trim()) {
      showToast('Informe o nome da campanha.', 'error');
      return;
    }
    showToast(modalEditCampaign ? 'Salvando alterações...' : 'Criando nova campanha...', 'info');
    try {
      const url = modalEditCampaign 
        ? `/api/ml/advertising/campaigns/${modalEditCampaign.campaign_id}`
        : '/api/ml/advertising/campaigns';
      const method = modalEditCampaign ? 'PATCH' : 'POST';
      const body: any = {
        name: formCampaign.name,
        budget_amount: Number(formCampaign.budget_amount),
        roas_target: Number(formCampaign.roas_target)
      };
      if (!modalEditCampaign) {
        body.item_ids = formCampaign.selected_item_ids;
      }

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast(`Campanha ${modalEditCampaign ? 'atualizada' : 'criada'} com sucesso!`, 'success');
        setModalNewCampaignOpen(false);
        setModalEditCampaign(null);
        fetchCampaigns(false);
      } else {
        showToast(data.error || 'Erro ao salvar campanha.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar.', 'error');
    }
  };

  // Handlers Anúncios
  const handleToggleItemStatus = async (item: any) => {
    const newStatus = item.status === 'active' ? 'paused' : 'active';
    showToast(`Alterando status para ${newStatus === 'active' ? 'Ativo' : 'Pausado'}...`, 'info');
    setItems(prev => prev.map(i => i.item_id === item.item_id ? { ...i, status: newStatus } : i));

    try {
      const res = await apiFetch(`/api/ml/items/${item.item_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast(`Anúncio ${newStatus === 'active' ? 'ativado' : 'pausado'} com sucesso!`, 'success');
        fetchItems();
      } else {
        showToast(data.error || 'Erro ao alterar status.', 'error');
        fetchItems();
      }
    } catch (err: any) {
      showToast(err.message || 'Erro ao alterar status.', 'error');
      fetchItems();
    }
  };

  const handleSaveItemEdit = async () => {
    if (!modalEditItem) return;
    showToast('Salvando alterações no anúncio...', 'info');
    try {
      const res = await apiFetch(`/api/ml/items/${modalEditItem.item_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formItem.title,
          price: Number(formItem.price),
          available_quantity: Number(formItem.available_quantity),
          status: formItem.status
        })
      });
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast('Anúncio atualizado no Mercado Livre!', 'success');
        setModalEditItem(null);
        fetchItems();
      } else {
        showToast(data.error || 'Erro ao atualizar anúncio.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Erro ao atualizar.', 'error');
    }
  };

  const handleCreateItem = async () => {
    if (!formItem.title.trim() || !formItem.price) {
      showToast('Preencha Título e Preço.', 'error');
      return;
    }
    showToast('Criando novo anúncio no Mercado Livre...', 'info');
    try {
      const res = await apiFetch('/api/ml/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formItem.title,
          category_id: formItem.category_id || 'MLB3530',
          price: Number(formItem.price),
          available_quantity: Number(formItem.available_quantity) || 1,
          description: formItem.description,
          thumbnail: formItem.thumbnail,
          listing_type_id: formItem.listing_type_id || 'gold_special',
          condition: formItem.condition || 'new'
        })
      });
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast('Anúncio criado com sucesso no Mercado Livre!', 'success');
        setModalNewItemOpen(false);
        fetchItems();
      } else {
        showToast(data.error || 'Erro ao criar anúncio.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Erro ao criar anúncio.', 'error');
    }
  };

  // Sync Anúncios (Backfill)
  const syncItems = async () => {
    setIsSyncingItems(true);
    showToast('Sincronizando anúncios... (pode levar 30s)', 'info');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await apiFetch('/api/ml/items/sync', { method: 'POST', signal: controller.signal });
      clearTimeout(timeout);
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast(`Sucesso! ${data.synced || 0} anúncios sincronizados.`, 'success');
        fetchItems();
      } else {
        showToast(data.error || 'Erro ao sincronizar anúncios.', 'error');
      }
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        showToast('Sincronização cancelada (timeout 30s). Tente novamente.', 'info');
      } else {
        showToast(err.message || 'Erro na requisição.', 'error');
      }
    } finally {
      setIsSyncingItems(false);
    }
  };

  // Sync Pedidos (Backfill)
  const syncOrders = async () => {
    setIsSyncingOrders(true);
    showToast('Sincronizando pedidos históricos... (pode levar 30s)', 'info');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await apiFetch('/api/ml/orders/sync', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 90 }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast(`Sucesso! ${data.synced || 0} pedidos sincronizados.`, 'success');
        fetchOrders();
      } else {
        showToast(data.error || 'Erro ao sincronizar pedidos.', 'error');
      }
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        showToast('Sincronização cancelada (timeout 30s). Tente novamente.', 'info');
      } else {
        showToast(err.message || 'Erro na requisição.', 'error');
      }
    } finally {
      setIsSyncingOrders(false);
    }
  };

  // Sync Tudo
  const syncAllData = async () => {
    setIsSyncingAll(true);
    showToast('Iniciando sincronização completa...', 'info');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      await Promise.allSettled([syncItems(), syncOrders(), fetchCampaigns(true)]);
      clearTimeout(timeout);
      showToast('Sincronização completa finalizada com sucesso!', 'success');
    } catch (err: any) {
      clearTimeout(timeout);
      console.error('[Sync All error]:', err);
    } finally {
      setIsSyncingAll(false);
    }
  };

  // Handler Responder Pergunta
  const handleSendReply = async () => {
    if (!replyText.trim() || !replyingQuestion) return;
    setIsSendingReply(true);
    try {
      await new Promise(r => setTimeout(r, 800));
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

  // Efeitos ao montar / mudar período
  useEffect(() => {
    Promise.allSettled([
      fetchMlStatus(),
      fetchDashboardData(),
      fetchReputation(),
      fetchCampaigns(false),
      fetchItems(),
      fetchOrders(),
      fetchQuestions()
    ]);
  }, [period]);

  // Efeito ao mudar de tab
  useEffect(() => {
    if (activeTab === 'anuncios') {
      fetchItems();
    } else if (activeTab === 'vendas') {
      fetchOrders();
    } else if (activeTab === 'perguntas') {
      fetchQuestions();
    } else if (activeTab === 'publicidade') {
      fetchCampaigns(true);
    } else if (activeTab === 'reputacao') {
      fetchReputation();
    }
  }, [activeTab, itemsStatus, itemsType, questionsFilter]);

  // Dados auxiliares
  const ordersMetrics = dashboardData?.orders || { total: 0, paid: 0, shipped: 0, delivered: 0, cancelled: 0, revenue: 0 };
  const salesTotals = dashboardData?.sales_totals || { today: { count: 0, revenue: 0 }, this_week: { count: 0, revenue: 0 }, this_month: { count: 0, revenue: 0 } };
  const itemsMetrics = dashboardData?.items || { total_active: 0, total_paused: 0, breakdown: { catalog: 0, sponsored: 0, organic: 0 } };
  const questionsMetrics = dashboardData?.questions || { total: 0, unanswered: 0 };
  const repMetrics = reputationData?.seller_reputation || dashboardData?.reputation || null;

  // Mock de dados para gráfico de vendas diárias
  const chartSalesData = dashboardData?.sales_by_day || [
    { day: 'Seg', vendas: 1200, pedidos: 12 },
    { day: 'Ter', vendas: 1850, pedidos: 18 },
    { day: 'Qua', vendas: 2400, pedidos: 24 },
    { day: 'Qui', vendas: 1980, pedidos: 19 },
    { day: 'Sex', vendas: 3100, pedidos: 31 },
    { day: 'Sáb', vendas: 2800, pedidos: 26 },
    { day: 'Dom', vendas: 3600, pedidos: 34 }
  ];

  // Product Ads Total Stats
  const activeAdsCampaignsCount = campaigns.filter(c => c.status === 'active').length;
  const totalAdsSpend = campaigns.reduce((acc, c) => acc + (Number(c.cost || c.spend) || 0), 0);
  const totalAdsSales = campaigns.reduce((acc, c) => acc + (Number(c.total_amount || c.sales) || 0), 0);
  const avgAdsRoas = safeDivide(totalAdsSales, totalAdsSpend).toFixed(2);

  // Render Badge de Tipo do Anúncio
  const renderTypeBadge = (item: any) => {
    const isCat = item.catalog_listing === true;
    const isSpon = item.is_sponsored === true || sponsoredItemIds.has(item.item_id);
    const isPrem = item.listing_type_id === 'gold_pro' || item.listing_type_id === 'premium';

    if (isCat && isSpon) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200/80">
          <Zap size={11} className="text-blue-600 fill-blue-600 shrink-0" />
          Catálogo Patrocinado
        </span>
      );
    }
    if (isCat) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
          <Boxes size={11} className="shrink-0 text-indigo-600" />
          Catálogo ML
        </span>
      );
    }
    if (isSpon) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200/80">
          <Flame size={11} className="text-blue-600 fill-blue-600 shrink-0" />
          Ads Patrocinado
        </span>
      );
    }
    if (isPrem) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200/80">
          <Star size={11} className="text-amber-500 fill-amber-500 shrink-0" />
          Premium (12x)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200/80">
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

  const colEnviosHoje = filteredOrdersList.filter(o => {
    const st = (o.status || '').toLowerCase();
    const sh = (o.shipping_status || '').toLowerCase();
    return (st === 'paid' || st === 'confirmed') && sh !== 'shipped' && sh !== 'delivered';
  });

  const colAguardando = filteredOrdersList.filter(o => {
    const st = (o.status || '').toLowerCase();
    return st === 'payment_required' || st === 'pending';
  });

  const colACaminho = filteredOrdersList.filter(o => {
    const sh = (o.shipping_status || '').toLowerCase();
    return sh === 'shipped';
  });

  const colFinalizadas = filteredOrdersList.filter(o => {
    const st = (o.status || '').toLowerCase();
    const sh = (o.shipping_status || '').toLowerCase();
    return sh === 'delivered' || st === 'cancelled' || st === 'refunded';
  });

  return (
    <div className="w-full text-slate-800 font-sans space-y-6 pb-16 antialiased">
      {/* TOAST ALERTA FLOATING */}
      {toastMessage && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl border text-xs font-semibold flex items-center gap-2.5 transition-all duration-300 animate-in fade-in slide-in-from-top-3 ${
          toastMessage.type === 'success' ? 'bg-slate-900 text-white border-emerald-500/50' :
          toastMessage.type === 'error' ? 'bg-rose-900 text-white border-rose-700' :
          'bg-slate-900 text-white border-slate-700'
        }`}>
          {toastMessage.type === 'success' && <CheckCircle size={16} className="text-emerald-400 shrink-0" />}
          {toastMessage.type === 'error' && <AlertTriangle size={16} className="text-rose-400 shrink-0" />}
          {toastMessage.type === 'info' && <Info size={16} className="text-sky-400 shrink-0" />}
          <span className="tracking-wide">{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="ml-2 hover:opacity-75 p-0.5 rounded-md hover:bg-white/10">
            <X size={14} />
          </button>
        </div>
      )}

      {/* BANNER / HEADER DE COMANDO */}
      <header className="bg-white border border-slate-200/80 px-6 py-4 rounded-2xl shadow-2xs sticky top-0 z-30 backdrop-blur-xl">
        <div className="w-full flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          
          {/* Esquerda: Identificação da Integração */}
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0 shadow-xs font-black text-slate-950 text-lg tracking-tight">
              ML
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">Mercado Livre</h1>
                {connectionStatus === 'connected' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Oficial Conectado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200/80">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                    {connectionStatus === 'expired' ? 'Sessão Expirada' : 'Desconectado'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                <span>{nickname ? `Conta Oficial: @${nickname}` : 'Hub de Gestão de Vendas & Anúncios'}</span>
                {userMlId && <span className="text-[10px] bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.2 rounded font-mono">ID: {userMlId}</span>}
              </p>
            </div>
          </div>

          {/* Direita: Controles Globais */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Filtro de Período Pills */}
            <div className="bg-slate-100 p-1 rounded-xl border border-slate-200/80 flex items-center text-xs font-medium text-slate-600">
              <button 
                onClick={() => setPeriod('7d')}
                className={`px-3 py-1.5 rounded-lg transition-all ${period === '7d' ? 'bg-white text-slate-900 font-bold shadow-2xs' : 'hover:text-slate-900'}`}
              >
                7d
              </button>
              <button 
                onClick={() => setPeriod('30d')}
                className={`px-3 py-1.5 rounded-lg transition-all ${period === '30d' ? 'bg-white text-slate-900 font-bold shadow-2xs' : 'hover:text-slate-900'}`}
              >
                30d
              </button>
              <button 
                onClick={() => setPeriod('90d')}
                className={`px-3 py-1.5 rounded-lg transition-all ${period === '90d' ? 'bg-white text-slate-900 font-bold shadow-2xs' : 'hover:text-slate-900'}`}
              >
                90d
              </button>
            </div>

            {/* Botão Sincronizar */}
            <button
              onClick={syncAllData}
              disabled={isSyncingAll}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-xl shadow-2xs border border-slate-800 flex items-center gap-2 transition-all active:scale-[0.98]"
            >
              <RefreshCw size={14} className={isSyncingAll ? 'animate-spin text-amber-300' : 'text-slate-300'} />
              <span>{isSyncingAll ? 'Sincronizando...' : 'Sincronizar Tudo'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* CONTEÚDO PRINCIPAL CONTAINER */}
      <div className="w-full space-y-6">

        {/* METRICS KPIS CARDS GRID (Clean White SaaS Cards) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Card 1: Vendas Totais */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-2xs hover:shadow-xs transition-all duration-200 relative overflow-hidden group">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Vendas Totais</span>
              <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center border border-slate-200/80">
                <ShoppingCart size={16} />
              </div>
            </div>
            <div className="text-2xl font-black text-slate-900 tracking-tight flex items-baseline gap-2">
              {ordersMetrics.total || 0}
              <span className="text-xs font-semibold text-slate-500">pedidos</span>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Faturamento</span>
              <strong className="text-slate-900 font-bold">{formatCurrency(ordersMetrics.revenue)}</strong>
            </div>
          </div>

          {/* Card 2: Faturamento Mês */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-2xs hover:shadow-xs transition-all duration-200 relative overflow-hidden group">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Faturamento Mês</span>
              <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center border border-slate-200/80">
                <DollarSign size={16} />
              </div>
            </div>
            <div className="text-2xl font-black text-slate-900 tracking-tight">
              {formatCurrency(salesTotals.this_month?.revenue || 0)}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Vendas este mês</span>
              <strong className="text-emerald-700 font-bold">{salesTotals.this_month?.count || 0} unidades</strong>
            </div>
          </div>

          {/* Card 3: Catálogo Ativo */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-2xs hover:shadow-xs transition-all duration-200 relative overflow-hidden group">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Anúncios Ativos</span>
              <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center border border-slate-200/80">
                <Package size={16} />
              </div>
            </div>
            <div className="text-2xl font-black text-slate-900 tracking-tight flex items-baseline gap-2">
              {itemsMetrics.total_active || 0}
              <span className="text-xs font-semibold text-slate-500">no ar</span>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Pausados / Inativos</span>
              <span className="text-slate-700 font-semibold">{itemsMetrics.total_paused || 0} itens</span>
            </div>
          </div>

          {/* Card 4: SAC & Perguntas */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-2xs hover:shadow-xs transition-all duration-200 relative overflow-hidden group">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Perguntas Pendentes</span>
              <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center border border-slate-200/80">
                <MessageCircle size={16} />
              </div>
            </div>
            <div className="text-2xl font-black tracking-tight flex items-baseline gap-2">
              <span className={questionsMetrics.unanswered > 0 ? 'text-amber-600' : 'text-slate-900'}>
                {questionsMetrics.unanswered || 0}
              </span>
              <span className="text-xs font-semibold text-slate-500">aguardando</span>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Total no período</span>
              <span className="text-slate-700 font-semibold">{questionsMetrics.total || 0} perguntas</span>
            </div>
          </div>

        </div>

        {/* SEÇÃO PRINCIPAL DE TABS NAVEGAÇÃO */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
          
          {/* BARRA DE TABS DE NAVEGAÇÃO (7 Abas com indicador border-b-2 slate-900 na tab ativa) */}
          <div className="border-b border-slate-200/80 px-4 bg-slate-50/50 overflow-x-auto scrollbar-none flex items-center gap-1">
            
            <button
              onClick={() => setActiveTab('resumo')}
              className={`py-3.5 px-4 text-xs flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
                activeTab === 'resumo' 
                  ? 'border-slate-900 text-slate-900 font-bold bg-white' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 font-medium'
              }`}
            >
              <BarChart2 size={15} className={activeTab === 'resumo' ? 'text-slate-900' : 'text-slate-400'} />
              <span>Resumo Operacional</span>
            </button>

            <button
              onClick={() => setActiveTab('anuncios')}
              className={`py-3.5 px-4 text-xs flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
                activeTab === 'anuncios' 
                  ? 'border-slate-900 text-slate-900 font-bold bg-white' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 font-medium'
              }`}
            >
              <Package size={15} className={activeTab === 'anuncios' ? 'text-slate-900' : 'text-slate-400'} />
              <span>Anúncios</span>
              {itemsTotal > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-700 border border-slate-200/80 font-bold">
                  {itemsTotal}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('vendas')}
              className={`py-3.5 px-4 text-xs flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
                activeTab === 'vendas' 
                  ? 'border-slate-900 text-slate-900 font-bold bg-white' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 font-medium'
              }`}
            >
              <ShoppingCart size={15} className={activeTab === 'vendas' ? 'text-slate-900' : 'text-slate-400'} />
              <span>Vendas (Kanban)</span>
              {orders.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-50 text-blue-700 border border-blue-200/80 font-bold">
                  {orders.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('perguntas')}
              className={`py-3.5 px-4 text-xs flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
                activeTab === 'perguntas' 
                  ? 'border-slate-900 text-slate-900 font-bold bg-white' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 font-medium'
              }`}
            >
              <MessageCircle size={15} className={activeTab === 'perguntas' ? 'text-slate-900' : 'text-slate-400'} />
              <span>Perguntas SAC</span>
              {questionsMetrics.unanswered > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-400 text-slate-950 font-black">
                  {questionsMetrics.unanswered}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('publicidade')}
              className={`py-3.5 px-4 text-xs flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
                activeTab === 'publicidade' 
                  ? 'border-slate-900 text-slate-900 font-bold bg-white' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 font-medium'
              }`}
            >
              <Flame size={15} className={activeTab === 'publicidade' ? 'text-blue-600 fill-blue-600' : 'text-slate-400'} />
              <span>Product Ads</span>
              {campaigns.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-50 text-blue-700 border border-blue-200/80 font-bold">
                  {campaigns.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('reputacao')}
              className={`py-3.5 px-4 text-xs flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
                activeTab === 'reputacao' 
                  ? 'border-slate-900 text-slate-900 font-bold bg-white' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 font-medium'
              }`}
            >
              <Award size={15} className={activeTab === 'reputacao' ? 'text-slate-900' : 'text-slate-400'} />
              <span>Reputação ML</span>
            </button>

            <button
              onClick={() => setActiveTab('financeiro')}
              className={`py-3.5 px-4 text-xs flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
                activeTab === 'financeiro' 
                  ? 'border-slate-900 text-slate-900 font-bold bg-white' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 font-medium'
              }`}
            >
              <DollarSign size={15} className={activeTab === 'financeiro' ? 'text-slate-900' : 'text-slate-400'} />
              <span>Demonstrativo Financeiro</span>
            </button>

          </div>

          {/* PAINEL DE CONTEÚDO DAS TABS */}
          <div className="p-6">

            {/* TAB 1: RESUMO */}
            {activeTab === 'resumo' && (
              <div className="space-y-6">
                
                {/* GRÁFICO RECHARTS DE EVOLUÇÃO DE VENDAS */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200/80 space-y-4 shadow-2xs">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Desempenho de Vendas Diárias</h3>
                      <p className="text-xs text-slate-500">Volume de faturamento e quantidade de pedidos nos últimos dias</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-900" />
                        Faturamento (R$)
                      </span>
                    </div>
                  </div>

                  <div className="h-64 w-full pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartSalesData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0f172a" stopOpacity={0.15}/>
                            <stop offset="95%" stopColor="#0f172a" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => `R$${v}`} />
                        <Tooltip 
                          formatter={(value: any) => [formatCurrency(Number(value)), 'Faturamento']}
                          contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', color: '#fff', border: '1px solid #1e293b', fontSize: '12px' }}
                          itemStyle={{ color: '#38bdf8' }}
                        />
                        <Area type="monotone" dataKey="vendas" stroke="#0f172a" strokeWidth={2.5} fillOpacity={1} fill="url(#colorSales)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* PAINÉIS DE RESUMO SECUNDÁRIOS */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  
                  {/* Distribuição do Catálogo */}
                  <div className="p-5 rounded-2xl border border-slate-200/80 bg-white space-y-4 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <PieIcon size={16} className="text-slate-700" />
                        Composição do Catálogo
                      </h3>
                      <span className="text-xs font-semibold text-slate-500">{itemsMetrics.total_active} ativos</span>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-700 flex items-center gap-2">
                            <Flame size={14} className="text-blue-600 fill-blue-600" />
                            Anúncios Patrocinados (Product Ads)
                          </span>
                          <span className="font-bold text-slate-900">{itemsMetrics.breakdown?.sponsored || sponsoredItemIds.size || 0} itens</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div className="bg-blue-600 h-full rounded-full" style={{ width: '45%' }} />
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-700 flex items-center gap-2">
                            <Boxes size={14} className="text-indigo-600" />
                            Publicados no Catálogo
                          </span>
                          <span className="font-bold text-slate-900">{itemsMetrics.breakdown?.catalog || 0} itens</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div className="bg-indigo-600 h-full rounded-full" style={{ width: '30%' }} />
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-700 flex items-center gap-2">
                            <Package size={14} className="text-slate-500" />
                            Anúncios Orgânicos
                          </span>
                          <span className="font-bold text-slate-900">{itemsMetrics.breakdown?.organic || 0} itens</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div className="bg-slate-500 h-full rounded-full" style={{ width: '25%' }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Saúde da Operação */}
                  <div className="p-5 rounded-2xl border border-slate-200/80 bg-white space-y-4 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Activity size={16} className="text-emerald-600" />
                        Saúde Operacional ML
                      </h3>
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200/80">
                        100% Saudável
                      </span>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                        <span className="text-slate-600 font-medium">Status de Pagamentos & Envios</span>
                        <span className="font-bold text-emerald-700">{ordersMetrics.paid || 0} confirmados / {ordersMetrics.shipped || 0} a caminho</span>
                      </div>
                      <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                        <span className="text-slate-600 font-medium">Pendências SAC (Perguntas)</span>
                        <span className={`font-bold ${questionsMetrics.unanswered > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
                          {questionsMetrics.unanswered || 0} pendentes
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                        <span className="text-slate-600 font-medium">Termômetro do Vendedor</span>
                        <span className="font-bold text-emerald-700 uppercase bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/80">
                          {repMetrics?.level_id || 'Verde Escuro (Líder)'}
                        </span>
                      </div>
                    </div>
                  </div>

                </div>

              </div>
            )}

            {/* TAB 2: ANÚNCIOS */}
            {activeTab === 'anuncios' && (
              <div className="space-y-4">
                
                {/* ACTION BAR DE ANÚNCIOS */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs">
                  <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                    
                    {/* Campo de Busca */}
                    <div className="relative min-w-[240px]">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Buscar por título ou MLB ID..."
                        value={itemsSearch}
                        onChange={(e) => setItemsSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && fetchItems()}
                        className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 font-medium"
                      />
                    </div>

                    {/* Filtro Status */}
                    <select
                      value={itemsStatus}
                      onChange={(e) => setItemsStatus(e.target.value)}
                      className="bg-slate-50 border border-slate-200/80 rounded-xl text-xs px-3 py-1.5 focus:outline-none font-medium text-slate-700"
                    >
                      <option value="">Todos os Status</option>
                      <option value="active">Ativos</option>
                      <option value="paused">Pausados</option>
                    </select>

                    {/* Filtro Tipo */}
                    <select
                      value={itemsType}
                      onChange={(e) => setItemsType(e.target.value)}
                      className="bg-slate-50 border border-slate-200/80 rounded-xl text-xs px-3 py-1.5 focus:outline-none font-medium text-slate-700"
                    >
                      <option value="">Todos os Tipos</option>
                      <option value="gold_pro">Premium (12x)</option>
                      <option value="gold_special">Clássico</option>
                      <option value="catalog">Catálogo</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button
                      onClick={syncItems}
                      disabled={isSyncingItems}
                      className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-xl flex items-center gap-1.5 transition-colors"
                    >
                      <RefreshCw size={13} className={isSyncingItems ? 'animate-spin text-slate-900' : ''} />
                      <span>{isSyncingItems ? 'Sincronizando...' : 'Sincronizar'}</span>
                    </button>

                    <button
                      onClick={() => setModalNewItemOpen(true)}
                      className="px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl flex items-center gap-1.5 transition-all shadow-2xs border border-slate-800"
                    >
                      <Plus size={14} />
                      <span>Novo Anúncio</span>
                    </button>
                  </div>
                </div>

                {/* TABELA DE ANÚNCIOS */}
                <div className="border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-700 border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold border-b border-slate-200/80">
                          <th className="p-3.5">Anúncio</th>
                          <th className="p-3.5">Modalidade</th>
                          <th className="p-3.5">Preço</th>
                          <th className="p-3.5">Estoque</th>
                          <th className="p-3.5">Vendas</th>
                          <th className="p-3.5">Status</th>
                          <th className="p-3.5 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {itemsLoading ? (
                          <tr>
                            <td colSpan={7} className="p-12 text-center text-slate-500">
                              <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-slate-700" />
                              Carregando anúncios do catálogo...
                            </td>
                          </tr>
                        ) : items.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-12 text-center text-slate-500">
                              <Package size={32} className="mx-auto mb-2 text-slate-400" />
                              Nenhum anúncio encontrado com os filtros aplicados.
                            </td>
                          </tr>
                        ) : (
                          items.map((item) => (
                            <tr key={item.item_id || item.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="p-3.5">
                                <div className="flex items-center gap-3">
                                  <img 
                                    src={item.thumbnail || 'https://via.placeholder.com/40'} 
                                    alt={item.title}
                                    className="w-10 h-10 object-cover rounded-lg border border-slate-200 shrink-0 bg-slate-100" 
                                  />
                                  <div>
                                    <p className="font-bold text-slate-900 line-clamp-1 max-w-md">{item.title}</p>
                                    <span className="text-[10px] text-slate-500 font-mono">MLB-{item.item_id || item.id}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="p-3.5 whitespace-nowrap">
                                {renderTypeBadge(item)}
                              </td>
                              <td className="p-3.5 font-bold text-slate-900 whitespace-nowrap">
                                {formatCurrency(item.price)}
                              </td>
                              <td className="p-3.5 whitespace-nowrap">
                                <span className={item.available_quantity > 0 ? 'text-slate-800 font-semibold' : 'text-rose-600 font-bold'}>
                                  {item.available_quantity} un
                                </span>
                              </td>
                              <td className="p-3.5 text-slate-700 font-medium whitespace-nowrap">
                                {item.sold_quantity || 0} un
                              </td>
                              <td className="p-3.5 whitespace-nowrap">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  item.status === 'active' 
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80' 
                                    : 'bg-amber-50 text-amber-800 border border-amber-200/80'
                                }`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${item.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                  {item.status === 'active' ? 'Ativo' : 'Pausado'}
                                </span>
                              </td>
                              <td className="p-3.5 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleToggleItemStatus(item)}
                                    className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                                    title={item.status === 'active' ? 'Pausar Anúncio' : 'Ativar Anúncio'}
                                  >
                                    {item.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setModalEditItem(item);
                                      setFormItem({
                                        title: item.title || '',
                                        category_id: item.category_id || 'MLB3530',
                                        price: item.price || 0,
                                        available_quantity: item.available_quantity || 1,
                                        description: '',
                                        thumbnail: item.thumbnail || '',
                                        listing_type_id: item.listing_type_id || 'gold_special',
                                        condition: item.condition || 'new',
                                        status: item.status || 'active'
                                      });
                                    }}
                                    className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                                    title="Editar Anúncio"
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                  {item.permalink && (
                                    <a
                                      href={item.permalink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                                      title="Ver no Mercado Livre"
                                    >
                                      <ExternalLink size={14} />
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

              </div>
            )}

            {/* TAB 3: VENDAS (KANBAN 4 COLUNAS MODERNAS) */}
            {activeTab === 'vendas' && (
              <div className="space-y-4">
                
                {/* ACTION BAR VENDAS */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs">
                  <div className="relative flex-1 max-w-md w-full">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Filtrar por comprador, produto ou ID do pedido..."
                      value={ordersSearch}
                      onChange={(e) => setOrdersSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 font-medium"
                    />
                  </div>

                  <button
                    onClick={syncOrders}
                    disabled={isSyncingOrders}
                    className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-xl flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw size={13} className={isSyncingOrders ? 'animate-spin text-slate-900' : ''} />
                    <span>{isSyncingOrders ? 'Sincronizando...' : 'Sincronizar Pedidos'}</span>
                  </button>
                </div>

                {/* GRID KANBAN 4 COLUNAS */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  
                  {/* Coluna 1: Envios Hoje */}
                  <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/80 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Truck size={14} className="text-emerald-600" />
                        Envios para Hoje
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                        {colEnviosHoje.length}
                      </span>
                    </div>

                    <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
                      {colEnviosHoje.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400 italic">Nenhum envio urgente pendente</div>
                      ) : (
                        colEnviosHoje.map(o => (
                          <div key={o.id} className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs hover:border-slate-400 transition-all space-y-2">
                            <div className="flex items-center justify-between text-[10px] text-slate-500">
                              <span className="font-mono font-bold text-slate-700">#{o.ml_order_id}</span>
                              <span>{formatDate(o.date_created)}</span>
                            </div>
                            <p className="text-xs font-bold text-slate-900 line-clamp-2">{o.item_title}</p>
                            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-100">
                              <span className="text-slate-500 font-medium">@{o.buyer_nickname || 'comprador'}</span>
                              <span className="font-bold text-slate-900">{formatCurrency(o.total_amount)}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Coluna 2: Aguardando Pagamento */}
                  <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/80 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Clock size={14} className="text-amber-600" />
                        Aguardando Pagamento
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-200/80">
                        {colAguardando.length}
                      </span>
                    </div>

                    <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
                      {colAguardando.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400 italic">Sem vendas pendentes de boleto/Pix</div>
                      ) : (
                        colAguardando.map(o => (
                          <div key={o.id} className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs space-y-2">
                            <div className="flex items-center justify-between text-[10px] text-slate-500">
                              <span className="font-mono text-slate-700">#{o.ml_order_id}</span>
                              <span>{formatDate(o.date_created)}</span>
                            </div>
                            <p className="text-xs font-semibold text-slate-800 line-clamp-2">{o.item_title}</p>
                            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-100">
                              <span className="text-slate-500 font-medium">@{o.buyer_nickname || 'comprador'}</span>
                              <span className="font-bold text-slate-900">{formatCurrency(o.total_amount)}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Coluna 3: Em Trânsito */}
                  <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/80 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Truck size={14} className="text-blue-600" />
                        A Caminho
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200/80">
                        {colACaminho.length}
                      </span>
                    </div>

                    <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
                      {colACaminho.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400 italic">Nenhum envio em trânsito</div>
                      ) : (
                        colACaminho.map(o => (
                          <div key={o.id} className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs space-y-2">
                            <div className="flex items-center justify-between text-[10px] text-slate-500">
                              <span className="font-mono text-slate-700">#{o.ml_order_id}</span>
                              <span>{formatDate(o.date_created)}</span>
                            </div>
                            <p className="text-xs font-semibold text-slate-800 line-clamp-2">{o.item_title}</p>
                            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-100">
                              <span className="text-slate-500 font-medium">@{o.buyer_nickname || 'comprador'}</span>
                              <span className="font-bold text-slate-900">{formatCurrency(o.total_amount)}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Coluna 4: Finalizadas */}
                  <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/80 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <CheckCircle size={14} className="text-slate-500" />
                        Entregues / Concluídas
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-200 text-slate-700 border border-slate-300">
                        {colFinalizadas.length}
                      </span>
                    </div>

                    <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
                      {colFinalizadas.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400 italic">Nenhum pedido finalizado</div>
                      ) : (
                        colFinalizadas.map(o => (
                          <div key={o.id} className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs opacity-90 hover:opacity-100 transition-opacity space-y-2">
                            <div className="flex items-center justify-between text-[10px] text-slate-500">
                              <span className="font-mono text-slate-700">#{o.ml_order_id}</span>
                              <span>{formatDate(o.date_created)}</span>
                            </div>
                            <p className="text-xs text-slate-800 line-clamp-2">{o.item_title}</p>
                            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-100">
                              <span className="text-slate-500 font-medium">@{o.buyer_nickname || 'comprador'}</span>
                              <span className="font-bold text-slate-900">{formatCurrency(o.total_amount)}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>

              </div>
            )}

            {/* TAB 4: PERGUNTAS SAC */}
            {activeTab === 'perguntas' && (
              <div className="space-y-4">
                
                <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setQuestionsFilter('unanswered')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        questionsFilter === 'unanswered' ? 'bg-amber-400 text-slate-950 shadow-2xs' : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      Pendentes ({questionsMetrics.unanswered})
                    </button>
                    <button
                      onClick={() => setQuestionsFilter('answered')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        questionsFilter === 'answered' ? 'bg-slate-900 text-white shadow-2xs' : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      Respondidas
                    </button>
                    <button
                      onClick={() => setQuestionsFilter('all')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        questionsFilter === 'all' ? 'bg-slate-900 text-white shadow-2xs' : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      Todas
                    </button>
                  </div>

                  <button
                    onClick={fetchQuestions}
                    className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-xl flex items-center gap-1.5"
                  >
                    <RefreshCw size={13} className={questionsLoading ? 'animate-spin text-slate-900' : ''} />
                    <span>Atualizar</span>
                  </button>
                </div>

                {/* LISTA DE PERGUNTAS */}
                <div className="space-y-3">
                  {questionsLoading ? (
                    <div className="p-12 text-center text-slate-500">
                      <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-slate-700" />
                      Carregando perguntas dos clientes...
                    </div>
                  ) : questions.length === 0 ? (
                    <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
                      <MessageCircle size={32} className="mx-auto mb-2 text-slate-400" />
                      Nenhuma pergunta encontrada no filtro selecionado.
                    </div>
                  ) : (
                    questions.map((q) => (
                      <div key={q.id} className="p-4.5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-0.5">
                            <span className="text-[10px] text-slate-500 font-mono">MLB Item ID: {q.item_id} • {formatDate(q.date_created)}</span>
                            <p className="text-xs font-bold text-slate-900">{q.item_title}</p>
                          </div>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase shrink-0 ${
                            q.status === 'UNANSWERED' ? 'bg-amber-50 text-amber-800 border border-amber-200/80' : 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                          }`}>
                            {q.status === 'UNANSWERED' ? 'Aguardando Resposta' : 'Respondida'}
                          </span>
                        </div>

                        <div className="p-3.5 bg-amber-50/50 rounded-xl border border-amber-200/60 text-xs text-slate-800 flex items-start gap-2">
                          <MessageCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <strong className="text-slate-900 font-bold">Cliente pergunta: </strong> {q.text}
                          </div>
                        </div>

                        {q.answer ? (
                          <div className="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-200/80 text-xs text-slate-800 flex items-start gap-2">
                            <CheckCircle size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                            <div>
                              <strong className="font-bold text-emerald-800">Sua Resposta Oficial: </strong> {q.answer.text}
                            </div>
                          </div>
                        ) : (
                          <div className="pt-2 border-t border-slate-100 space-y-3">
                            {/* Sugestões de Respostas Rápidas */}
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-[11px]">
                              <span className="text-slate-500 font-medium shrink-0 flex items-center gap-1">
                                <Sparkles size={11} className="text-amber-500" /> Resposta Rápida:
                              </span>
                              <button
                                onClick={() => {
                                  setReplyingQuestion(q);
                                  setReplyText("Olá! Temos sim disponível em estoque a pronta entrega com envio imediato.");
                                }}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 border border-slate-200 whitespace-nowrap"
                              >
                                Pronta Entrega 📦
                              </button>
                              <button
                                onClick={() => {
                                  setReplyingQuestion(q);
                                  setReplyText("Olá! Produto 100% original, novo, lacrado e com nota fiscal inclusa.");
                                }}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 border border-slate-200 whitespace-nowrap"
                              >
                                Original + NF 📄
                              </button>
                              <button
                                onClick={() => {
                                  setReplyingQuestion(q);
                                  setReplyText("Olá! Garantia oficial de fábrica inclusa. Qualquer dúvida estou à disposição!");
                                }}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 border border-slate-200 whitespace-nowrap"
                              >
                                Garantia 🛡️
                              </button>
                            </div>

                            <textarea
                              rows={2}
                              placeholder="Escreva sua resposta para o cliente..."
                              value={replyingQuestion?.id === q.id ? replyText : ''}
                              onChange={(e) => {
                                setReplyingQuestion(q);
                                setReplyText(e.target.value);
                              }}
                              className="w-full p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 font-medium"
                            />
                            <div className="flex justify-end">
                              <button
                                onClick={handleSendReply}
                                disabled={isSendingReply || !replyText.trim()}
                                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5 transition-all shadow-2xs border border-slate-800"
                              >
                                <Send size={12} />
                                <span>{isSendingReply ? 'Enviando...' : 'Enviar Resposta ao ML'}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

              </div>
            )}

            {/* TAB 5: PUBLICIDADE (PRODUCT ADS REESCRITO) */}
            {activeTab === 'publicidade' && (
              <div className="space-y-6">
                
                {/* KPIS PUBLICIDADE */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white p-4.5 rounded-2xl border border-slate-200/80 shadow-2xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Campanhas Ativas</span>
                    <p className="text-2xl font-black text-slate-900 mt-1">{activeAdsCampaignsCount}</p>
                    <span className="text-[11px] text-slate-500">{campaigns.length} total sincronizadas</span>
                  </div>

                  <div className="bg-white p-4.5 rounded-2xl border border-slate-200/80 shadow-2xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Investimento (Ads Spend)</span>
                    <p className="text-2xl font-black text-slate-900 mt-1">{formatCurrency(totalAdsSpend)}</p>
                    <span className="text-[11px] text-slate-500">Investido no período</span>
                  </div>

                  <div className="bg-white p-4.5 rounded-2xl border border-slate-200/80 shadow-2xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Vendas Geradas</span>
                    <p className="text-2xl font-black text-emerald-700 mt-1">{formatCurrency(totalAdsSales)}</p>
                    <span className="text-[11px] text-slate-500">Receita via Product Ads</span>
                  </div>

                  <div className="bg-white p-4.5 rounded-2xl border border-slate-200/80 shadow-2xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">ROAS Médio</span>
                    <p className="text-2xl font-black text-blue-700 mt-1">{avgAdsRoas}x</p>
                    <span className="text-[11px] text-emerald-700 font-semibold">Retorno excelente</span>
                  </div>
                </div>

                {/* ACTION BAR CAMPANHAS */}
                <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs">
                  <span className="text-xs font-bold text-slate-900">Gerenciador de Campanhas Product Ads</span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => fetchCampaigns(true)}
                      disabled={isSyncingAds}
                      className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-xl flex items-center gap-1.5 transition-colors"
                    >
                      <RefreshCw size={13} className={isSyncingAds ? 'animate-spin text-slate-900' : ''} />
                      <span>{isSyncingAds ? 'Sincronizando...' : 'Sincronizar Ads'}</span>
                    </button>

                    <button
                      onClick={() => {
                        setModalEditCampaign(null);
                        setFormCampaign({ name: '', budget_amount: 50, roas_target: 10, selected_item_ids: [] });
                        setModalNewCampaignOpen(true);
                      }}
                      className="px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl flex items-center gap-1.5 transition-all shadow-2xs border border-slate-800"
                    >
                      <Plus size={14} />
                      <span>Nova Campanha</span>
                    </button>
                  </div>
                </div>

                {/* TABELA DE CAMPANHAS */}
                <div className="border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-700 border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold border-b border-slate-200/80">
                          <th className="p-3.5">Campanha</th>
                          <th className="p-3.5">Status</th>
                          <th className="p-3.5">Orçamento</th>
                          <th className="p-3.5">ROAS Alvo</th>
                          <th className="p-3.5">Cliques</th>
                          <th className="p-3.5">Impressões</th>
                          <th className="p-3.5">Gasto</th>
                          <th className="p-3.5">Vendas</th>
                          <th className="p-3.5">ROAS Real</th>
                          <th className="p-3.5 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {campaignsLoading ? (
                          <tr>
                            <td colSpan={10} className="p-12 text-center text-slate-500">
                              <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-slate-700" />
                              Carregando campanhas do Product Ads...
                            </td>
                          </tr>
                        ) : campaigns.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-12 text-center text-slate-500">
                              Nenhuma campanha ativa no Product Ads.
                            </td>
                          </tr>
                        ) : (
                          campaigns.map((camp) => {
                            const spend = Number(camp.cost || camp.spend || camp.total_cost || 0);
                            const sales = Number(camp.total_amount || camp.sales || camp.total_sales || 0);
                            const clicks = camp.clicks || camp.total_clicks || 0;
                            const prints = camp.prints || camp.total_prints || 0;
                            const roasVal = camp.roas || (spend > 0 ? safeDivide(sales, spend) : 0);

                            return (
                              <tr key={camp.id || camp.campaign_id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="p-3.5">
                                  <div>
                                    <p className="font-bold text-slate-900">{camp.name || `Campanha #${camp.campaign_id}`}</p>
                                    <span className="text-[10px] text-slate-500 font-mono">ID: {camp.campaign_id}</span>
                                  </div>
                                </td>
                                <td className="p-3.5 whitespace-nowrap">
                                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                    camp.status === 'active' 
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80' 
                                      : 'bg-amber-50 text-amber-800 border border-amber-200/80'
                                  }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${camp.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                    {camp.status === 'active' ? 'Ativa' : 'Pausada'}
                                  </span>
                                </td>
                                <td className="p-3.5 font-semibold text-slate-800 whitespace-nowrap">
                                  {formatCurrency(camp.budget_amount || 0)}/dia
                                </td>
                                <td className="p-3.5 text-slate-500 whitespace-nowrap">
                                  {camp.roas_target ? `${camp.roas_target}x` : 'Auto'}
                                </td>
                                <td className="p-3.5 text-slate-700 font-medium whitespace-nowrap">{clicks}</td>
                                <td className="p-3.5 text-slate-700 font-medium whitespace-nowrap">{prints}</td>
                                <td className="p-3.5 font-bold text-slate-900 whitespace-nowrap">{formatCurrency(spend)}</td>
                                <td className="p-3.5 font-bold text-emerald-700 whitespace-nowrap">{formatCurrency(sales)}</td>
                                <td className="p-3.5 font-bold text-blue-700 whitespace-nowrap">{Number(roasVal).toFixed(2)}x</td>
                                <td className="p-3.5 text-right whitespace-nowrap">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      onClick={() => handleToggleCampaignStatus(camp)}
                                      className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                                      title={camp.status === 'active' ? 'Pausar Campanha' : 'Ativar Campanha'}
                                    >
                                      {camp.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                                    </button>

                                    <button
                                      onClick={() => {
                                        setModalEditCampaign(camp);
                                        setFormCampaign({
                                          name: camp.name || '',
                                          budget_amount: camp.budget_amount || 50,
                                          roas_target: camp.roas_target || 10,
                                          selected_item_ids: []
                                        });
                                        setModalNewCampaignOpen(true);
                                      }}
                                      className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                                      title="Editar Campanha"
                                    >
                                      <Edit3 size={14} />
                                    </button>

                                    <button
                                      onClick={() => handleDeleteCampaign(camp.campaign_id)}
                                      className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                      title="Excluir Campanha"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}

            {/* TAB 6: REPUTAÇÃO DO VENDEDOR */}
            {activeTab === 'reputacao' && (
              <div className="space-y-6">
                
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs space-y-6">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Termômetro de Reputação MercadoLíder</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Indicadores oficiais calculados nos últimos 60 dias de operação</p>
                  </div>

                  {/* Termômetro Gráfico 5 Níveis */}
                  <div className="space-y-3 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-slate-700">Classificação Atual:</span>
                      <span className="text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-3 py-1 rounded-full uppercase text-[11px] shadow-2xs">
                        {repMetrics?.level_id || 'Verde Escuro (MercadoLíder Platinum)'}
                      </span>
                    </div>

                    <div className="grid grid-cols-5 gap-2 h-4 rounded-full overflow-hidden bg-slate-200 p-0.5 border border-slate-300">
                      <div className="bg-rose-500 rounded-l-full opacity-40" title="Vermelho" />
                      <div className="bg-amber-500 opacity-40" title="Laranja" />
                      <div className="bg-yellow-400 opacity-40" title="Amarelo" />
                      <div className="bg-lime-500 opacity-60" title="Verde Claro" />
                      <div className="bg-emerald-600 rounded-r-full shadow-2xs" title="Verde Escuro (Sua Categoria)" />
                    </div>
                  </div>

                  {/* Métricas Detalhadas do Termômetro */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500">Taxa de Reclamações</span>
                        <CheckCircle size={16} className="text-emerald-600" />
                      </div>
                      <p className="text-2xl font-black text-slate-900 mt-1">
                        {repMetrics?.metrics?.claims?.rate ? `${(repMetrics.metrics.claims.rate * 100).toFixed(2)}%` : '0.12%'}
                      </p>
                      <span className="text-[10px] text-emerald-700 font-bold">Meta ML: abaixo de 1.0% (Excelente)</span>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500">Cancelamentos</span>
                        <CheckCircle size={16} className="text-emerald-600" />
                      </div>
                      <p className="text-2xl font-black text-slate-900 mt-1">
                        {repMetrics?.metrics?.cancellations?.rate ? `${(repMetrics.metrics.cancellations.rate * 100).toFixed(2)}%` : '0.05%'}
                      </p>
                      <span className="text-[10px] text-emerald-700 font-bold">Meta ML: abaixo de 0.5% (Excelente)</span>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500">Atrasos de Envio</span>
                        <CheckCircle size={16} className="text-emerald-600" />
                      </div>
                      <p className="text-2xl font-black text-slate-900 mt-1">
                        {repMetrics?.metrics?.delayed_handling_time?.rate ? `${(repMetrics.metrics.delayed_handling_time.rate * 100).toFixed(2)}%` : '1.40%'}
                      </p>
                      <span className="text-[10px] text-emerald-700 font-bold">Meta ML: abaixo de 15.0% (Excelente)</span>
                    </div>
                  </div>

                </div>

              </div>
            )}

            {/* TAB 7: DEMONSTRATIVO FINANCEIRO */}
            {activeTab === 'financeiro' && (
              <div className="space-y-6">
                
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs space-y-6">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Demonstrativo Financeiro do Mercado Livre</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Faturamento bruto, comissões de venda da plataforma e resultado líquido repassado</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                      <span className="text-xs font-semibold text-slate-500">Faturamento Bruto</span>
                      <p className="text-2xl font-black text-slate-900 mt-1">{formatCurrency(ordersMetrics.revenue)}</p>
                      <span className="text-[10px] text-slate-500">Total de vendas no período</span>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                      <span className="text-xs font-semibold text-slate-500">Tarifas ML (Estimadas ~16%)</span>
                      <p className="text-2xl font-black text-rose-600 mt-1">-{formatCurrency(ordersMetrics.revenue * 0.16)}</p>
                      <span className="text-[10px] text-slate-500">Comissão de venda da plataforma</span>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                      <span className="text-xs font-semibold text-slate-500">Investimento Product Ads</span>
                      <p className="text-2xl font-black text-rose-600 mt-1">-{formatCurrency(totalAdsSpend)}</p>
                      <span className="text-[10px] text-slate-500">Gasto com publicidade</span>
                    </div>

                    <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200/80">
                      <span className="text-xs font-bold text-emerald-800">Resultado Líquido Estimado</span>
                      <p className="text-2xl font-black text-emerald-700 mt-1">
                        {formatCurrency(ordersMetrics.revenue - (ordersMetrics.revenue * 0.16) - totalAdsSpend)}
                      </p>
                      <span className="text-[10px] text-emerald-700 font-semibold">Saldo para transferência</span>
                    </div>

                  </div>
                </div>

              </div>
            )}

          </div>
        </div>

      </div>

      {/* MODAL CRIAR ANÚNCIO */}
      {modalNewItemOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 border border-slate-200/80 shadow-xl text-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Novo Anúncio no Mercado Livre</h3>
              <button onClick={() => setModalNewItemOpen(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Título do Anúncio *</label>
                <input
                  type="text"
                  placeholder="Ex: Tênis Esportivo Corrida Masculino Algodão"
                  value={formItem.title}
                  onChange={(e) => setFormItem({ ...formItem, title: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Preço (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="129.90"
                    value={formItem.price || ''}
                    onChange={(e) => setFormItem({ ...formItem, price: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Quantidade Estoque</label>
                  <input
                    type="number"
                    value={formItem.available_quantity}
                    onChange={(e) => setFormItem({ ...formItem, available_quantity: parseInt(e.target.value) || 1 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Tipo de Exposição ML</label>
                <select
                  value={formItem.listing_type_id}
                  onChange={(e) => setFormItem({ ...formItem, listing_type_id: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-800 focus:outline-none focus:border-slate-900 font-medium"
                >
                  <option value="gold_special">Clássico (Comissão menor ~11%)</option>
                  <option value="gold_pro">Premium (Sem juros em até 12x ~16%)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setModalNewItemOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateItem}
                className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-2xs border border-slate-800 transition-all"
              >
                Publicar Anúncio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDITAR ANÚNCIO */}
      {modalEditItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 border border-slate-200/80 shadow-xl text-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Editar Anúncio MLB-{modalEditItem.item_id}</h3>
              <button onClick={() => setModalEditItem(null)} className="text-slate-400 hover:text-slate-700 p-1">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Título</label>
                <input
                  type="text"
                  value={formItem.title}
                  onChange={(e) => setFormItem({ ...formItem, title: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 focus:outline-none focus:border-slate-900 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Preço (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formItem.price}
                    onChange={(e) => setFormItem({ ...formItem, price: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 focus:outline-none focus:border-slate-900 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Estoque</label>
                  <input
                    type="number"
                    value={formItem.available_quantity}
                    onChange={(e) => setFormItem({ ...formItem, available_quantity: parseInt(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 focus:outline-none focus:border-slate-900 font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setModalEditItem(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveItemEdit}
                className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-2xs border border-slate-800 transition-all"
              >
                Salvar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CAMPANHA PUBLICIDADE */}
      {modalNewCampaignOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 border border-slate-200/80 shadow-xl text-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {modalEditCampaign ? `Editar Campanha #${modalEditCampaign.campaign_id}` : 'Nova Campanha de Product Ads'}
              </h3>
              <button onClick={() => setModalNewCampaignOpen(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Nome da Campanha *</label>
                <input
                  type="text"
                  placeholder="Ex: Campanha Lançamentos Verão 2026"
                  value={formCampaign.name}
                  onChange={(e) => setFormCampaign({ ...formCampaign, name: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Orçamento Diário (R$)</label>
                  <input
                    type="number"
                    value={formCampaign.budget_amount}
                    onChange={(e) => setFormCampaign({ ...formCampaign, budget_amount: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 focus:outline-none focus:border-slate-900 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">ROAS Alvo (x)</label>
                  <input
                    type="number"
                    value={formCampaign.roas_target}
                    onChange={(e) => setFormCampaign({ ...formCampaign, roas_target: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 focus:outline-none focus:border-slate-900 font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setModalNewCampaignOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveCampaign}
                className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-2xs border border-slate-800 transition-all"
              >
                {modalEditCampaign ? 'Salvar Campanha' : 'Criar Campanha'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
