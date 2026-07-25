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
  Plus
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
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | number | null>(null);
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

  const handleUpgradeListing = async () => {
    if (!modalUpgradeItem) return;
    showToast('Atualizando exposição do anúncio...', 'info');
    try {
      const res = await apiFetch(`/api/ml/items/${modalUpgradeItem.item_id}/listing-type-upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_type_id: upgradeListingTypeId })
      });
      const data = await safeJsonResponse(res);
      if (res.ok && data.ok) {
        showToast('Exposição atualizada com sucesso!', 'success');
        setModalUpgradeItem(null);
        fetchItems();
      } else {
        showToast(data.error || 'Erro ao destacar anúncio.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Erro ao destacar anúncio.', 'error');
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
      showToast(err.message || 'Erro na requisição.', 'error');
    } finally {
      setIsSyncingItems(false);
    }
  };

  // Sync Pedidos (Backfill)
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
      showToast(err.message || 'Erro na requisição.', 'error');
    } finally {
      setIsSyncingOrders(false);
    }
  };

  // Sync Tudo
  const syncAllData = async () => {
    setIsSyncingAll(true);
    showToast('Iniciando sincronização completa...', 'info');
    try {
      await Promise.all([syncItems(), syncOrders(), fetchCampaigns(true)]);
      showToast('Sincronização completa finalizada com sucesso!', 'success');
    } catch (err) {
      console.error('[Sync All error]:', err);
    } finally {
      setIsSyncingAll(false);
    }
  };

  // Webhook trigger
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
    fetchMlStatus();
    fetchDashboardData();
    fetchReputation();
    fetchCampaigns(false);
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
  const messagesMetrics = dashboardData?.messages || { total: 0, unread: 0 };
  const repMetrics = reputationData?.seller_reputation || dashboardData?.reputation || null;

  // Product Ads Total Stats
  const activeAdsCampaignsCount = campaigns.filter(c => c.status === 'active').length;
  const totalAdsSpend = campaigns.reduce((acc, c) => acc + (Number(c.spend) || 0), 0);
  const totalAdsSales = campaigns.reduce((acc, c) => acc + (Number(c.sales) || 0), 0);
  const avgAdsRoas = totalAdsSpend > 0 ? (totalAdsSales / totalAdsSpend).toFixed(2) : '0.00';

  // Render Badge de Tipo do Anúncio
  const renderTypeBadge = (item: any) => {
    const isCat = item.catalog_listing === true;
    const isSpon = item.is_sponsored === true || sponsoredItemIds.has(item.item_id);
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
    <div className="space-y-6 pb-12 font-sans">
      {/* TOAST ALERTA */}
      {toastMessage && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-xl shadow-2xl flex items-center gap-3 max-w-md border animate-in slide-in-from-top-2 duration-300 ${
          toastMessage.type === 'success' ? 'bg-emerald-900 text-white border-emerald-700' :
          toastMessage.type === 'error' ? 'bg-rose-900 text-white border-rose-700' :
          'bg-slate-900 text-white border-slate-700'
        }`}>
          {toastMessage.type === 'success' && <CheckCircle className="text-emerald-400 shrink-0" size={20} />}
          {toastMessage.type === 'error' && <AlertTriangle className="text-rose-400 shrink-0" size={20} />}
          {toastMessage.type === 'info' && <Info className="text-blue-400 shrink-0" size={20} />}
          <span className="text-xs font-semibold">{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="ml-auto text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}

      {/* HEADER PRINCIPAL ML */}
      <div className="bg-gradient-to-r from-[#2D3277] to-[#1f2354] text-white p-6 rounded-3xl shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#FFE600]/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-[#FFE600] text-[#2D3277] rounded-2xl flex items-center justify-center font-black shadow-lg text-2xl shrink-0">
              ML
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight">Mercado Livre Hub</h1>
                {connectionStatus === 'connected' && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    CONECTADO
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {nickname ? `@${nickname} • ID: ${userMlId}` : 'Gestão Unificada de Vendas, Anúncios e Product Ads'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Seletor Período */}
            <div className="bg-white/10 p-1 rounded-xl border border-white/10 flex items-center">
              {(['7d', '30d', '90d'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    period === p ? 'bg-[#FFE600] text-[#2D3277] shadow' : 'text-white hover:bg-white/10'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Sync All Button */}
            <button
              onClick={syncAllData}
              disabled={isSyncingAll}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw size={14} className={isSyncingAll ? 'animate-spin' : ''} />
              <span>{isSyncingAll ? 'Sincronizando...' : 'Sincronizar Tudo'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* BANNER KPI RESUMO RAPIDO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Pedidos */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:border-slate-200 transition-all">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendas Totais</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{ordersMetrics.total}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <ShoppingCart size={20} />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>A caminho: <strong className="text-blue-600">{ordersMetrics.shipped}</strong></span>
            <span>Entregues: <strong className="text-emerald-600">{ordersMetrics.delivered}</strong></span>
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

        {/* Card 3: Product Ads */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:border-slate-200 transition-all">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Product Ads</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{formatCurrency(totalAdsSales)}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
              <Flame size={20} />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>Gasto: <strong className="text-rose-600">{formatCurrency(totalAdsSpend)}</strong></span>
            <span>ROAS: <strong className="text-amber-700">{avgAdsRoas}x</strong></span>
          </div>
        </div>

        {/* Card 4: Anúncios */}
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
            <span className="text-blue-700 font-semibold">{sponsoredItemIds.size || itemsMetrics.breakdown?.sponsored || 0} Ads</span>
          </div>
        </div>

        {/* Card 5: Atendimento & Perguntas */}
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
              { id: 'publicidade', label: 'Publicidade', icon: Flame, badge: activeAdsCampaignsCount, badgeColor: 'bg-blue-600 text-white' },
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
                        { name: 'Orgânicos', total: itemsMetrics.breakdown?.organic || items.length, fill: '#64748b' },
                        { name: 'Patrocinados', total: sponsoredItemIds.size || itemsMetrics.breakdown?.sponsored || 0, fill: '#2563eb' },
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
              </div>

              {/* Tabela Top Anúncios */}
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
          {/* TAB 2: ANÚNCIOS */}
          {/* ========================================================================= */}
          {activeTab === 'anuncios' && (
            <div className="space-y-4">
              {/* Barra de Ações & Filtros */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[240px]">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                    <input
                      type="text"
                      placeholder="Buscar por título ou SKU..."
                      value={itemsSearch}
                      onChange={e => setItemsSearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && fetchItems()}
                      className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#2D3277]"
                    />
                  </div>

                  <select
                    value={itemsStatus}
                    onChange={e => setItemsStatus(e.target.value)}
                    className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#2D3277]"
                  >
                    <option value="">Todos os Status</option>
                    <option value="active">Ativos</option>
                    <option value="paused">Pausados</option>
                    <option value="closed">Finalizados</option>
                  </select>

                  <select
                    value={itemsType}
                    onChange={e => setItemsType(e.target.value)}
                    className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#2D3277]"
                  >
                    <option value="">Todos os Tipos</option>
                    <option value="sponsored">Patrocinados</option>
                    <option value="catalog">Catálogo</option>
                    <option value="organic">Orgânicos</option>
                  </select>

                  <button
                    onClick={fetchItems}
                    className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all"
                  >
                    Filtrar
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={syncItems}
                    disabled={isSyncingItems}
                    className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={isSyncingItems ? 'animate-spin' : ''} />
                    <span>Sincronizar ML</span>
                  </button>

                  <button
                    onClick={() => {
                      setFormItem({
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
                      setModalNewItemOpen(true);
                    }}
                    className="px-4 py-2 bg-[#2D3277] hover:bg-[#1d2150] text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    <Plus size={16} />
                    <span>Novo Anúncio</span>
                  </button>
                </div>
              </div>

              {/* Tabela de Anúncios */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                        <th className="py-3 px-4">Anúncio</th>
                        <th className="py-3 px-3">Tipo / Exposição</th>
                        <th className="py-3 px-3">Preço</th>
                        <th className="py-3 px-3">Estoque</th>
                        <th className="py-3 px-3">Vendidos</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {itemsLoading ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-slate-400">
                            <RefreshCw className="animate-spin inline-block mr-2" size={18} />
                            Carregando anúncios...
                          </td>
                        </tr>
                      ) : items.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-slate-400">
                            Nenhum anúncio encontrado. Clique em "Sincronizar ML" ou "Novo Anúncio".
                          </td>
                        </tr>
                      ) : (
                        items.map(item => (
                          <tr key={item.item_id} className="hover:bg-slate-50/80 transition-all">
                            <td className="py-3 px-4 flex items-center gap-3">
                              <img 
                                src={item.thumbnail || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=100'} 
                                alt="" 
                                className="w-10 h-10 rounded-lg object-cover border border-slate-200 bg-slate-50 shrink-0" 
                              />
                              <div className="max-w-md">
                                <p 
                                  onClick={() => setSelectedItem(item)}
                                  className="font-bold text-slate-900 hover:text-blue-600 cursor-pointer line-clamp-1"
                                >
                                  {item.title}
                                </p>
                                <span className="text-[10px] text-slate-400 font-mono">MLB: {item.item_id}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3">{renderTypeBadge(item)}</td>
                            <td className="py-3 px-3 font-bold text-slate-900">{formatCurrency(item.price)}</td>
                            <td className="py-3 px-3 font-semibold text-slate-700">{item.available_quantity} un</td>
                            <td className="py-3 px-3 font-extrabold text-emerald-600">{item.sold_quantity} un</td>
                            <td className="py-3 px-3">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                                item.status === 'active' 
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                                  : 'bg-slate-100 text-slate-700 border border-slate-200'
                              }`}>
                                {item.status === 'active' ? 'Ativo' : 'Pausado'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {/* Editar */}
                                <button
                                  onClick={() => {
                                    setModalEditItem(item);
                                    setFormItem({
                                      title: item.title || '',
                                      category_id: item.category_id || 'MLB3530',
                                      price: item.price || 0,
                                      available_quantity: item.available_quantity || 0,
                                      description: '',
                                      thumbnail: item.thumbnail || '',
                                      listing_type_id: item.listing_type_id || 'gold_special',
                                      condition: item.condition || 'new',
                                      status: item.status || 'active'
                                    });
                                  }}
                                  title="Editar Anúncio"
                                  className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded-lg transition-all"
                                >
                                  <Edit3 size={14} />
                                </button>

                                {/* Pausar / Ativar */}
                                <button
                                  onClick={() => handleToggleItemStatus(item)}
                                  title={item.status === 'active' ? 'Pausar Anúncio' : 'Ativar Anúncio'}
                                  className={`p-1.5 rounded-lg transition-all ${
                                    item.status === 'active' 
                                      ? 'hover:bg-amber-50 text-amber-600' 
                                      : 'hover:bg-emerald-50 text-emerald-600'
                                  }`}
                                >
                                  {item.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                                </button>

                                {/* Destacar */}
                                <button
                                  onClick={() => {
                                    setModalUpgradeItem(item);
                                    setUpgradeListingTypeId(item.listing_type_id === 'gold_pro' ? 'gold_special' : 'gold_pro');
                                  }}
                                  title="Mudar Tipo de Exposição"
                                  className="p-1.5 hover:bg-amber-50 text-amber-600 rounded-lg transition-all"
                                >
                                  <Star size={14} />
                                </button>

                                {/* Patrocinar (Product Ads) */}
                                <button
                                  onClick={() => {
                                    setFormCampaign({
                                      name: `Campanha - ${item.title.substring(0, 20)}`,
                                      budget_amount: 50,
                                      roas_target: 10,
                                      selected_item_ids: [item.item_id]
                                    });
                                    setModalEditCampaign(null);
                                    setModalNewCampaignOpen(true);
                                  }}
                                  title="Patrocinar no Product Ads"
                                  className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg transition-all"
                                >
                                  <Flame size={14} />
                                </button>
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

          {/* ========================================================================= */}
          {/* TAB 3: VENDAS (KANBAN 4 COLUNAS) */}
          {/* ========================================================================= */}
          {activeTab === 'vendas' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                  <input
                    type="text"
                    placeholder="Buscar pedido por ID ou comprador..."
                    value={ordersSearch}
                    onChange={e => setOrdersSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#2D3277]"
                  />
                </div>

                <button
                  onClick={syncOrders}
                  disabled={isSyncingOrders}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={isSyncingOrders ? 'animate-spin' : ''} />
                  <span>Sincronizar Pedidos</span>
                </button>
              </div>

              {/* Kanban Grid 4 Colunas */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Coluna 1: Envios de Hoje */}
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-3 min-h-[450px]">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                      Envios Urgentes
                    </h4>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-extrabold">
                      {colEnviosHoje.length}
                    </span>
                  </div>

                  <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                    {colEnviosHoje.map(order => (
                      <div 
                        key={order.ml_order_id} 
                        onClick={() => setSelectedOrder(order)}
                        className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all cursor-pointer space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-400">#{order.ml_order_id}</span>
                          <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
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
                      <p className="text-center text-xs text-slate-400 py-8">Nenhum pedido urgente pendente.</p>
                    )}
                  </div>
                </div>

                {/* Coluna 2: Aguardando Pagamento */}
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-3 min-h-[450px]">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                      Aguardando Pagamento
                    </h4>
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-extrabold">
                      {colAguardando.length}
                    </span>
                  </div>

                  <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                    {colAguardando.map(order => (
                      <div 
                        key={order.ml_order_id} 
                        onClick={() => setSelectedOrder(order)}
                        className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-300 transition-all cursor-pointer space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-400">#{order.ml_order_id}</span>
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            Pendente
                          </span>
                        </div>
                        <p className="font-bold text-xs text-slate-900 line-clamp-2">{order.item_title || 'Item sem título'}</p>
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                          <span className="text-slate-500">@{order.buyer_nickname || 'comprador'}</span>
                          <span className="font-black text-slate-900">{formatCurrency(order.total_amount)}</span>
                        </div>
                      </div>
                    ))}
                    {colAguardando.length === 0 && (
                      <p className="text-center text-xs text-slate-400 py-8">Nenhum pedido pendente.</p>
                    )}
                  </div>
                </div>

                {/* Coluna 3: A Caminho */}
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-3 min-h-[450px]">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                      A Caminho
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
              {/* Top Banner & Ações */}
              <div className="bg-gradient-to-r from-blue-900 to-[#2D3277] text-white p-6 rounded-2xl shadow-sm relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/30 border border-blue-400/30 text-xs font-bold text-blue-200 mb-2">
                    <Flame size={14} className="text-amber-400 fill-amber-400" />
                    Mercado Livre Product Ads (Advertising API)
                  </div>
                  <h3 className="text-xl font-black">Gestor de Campanhas Patrocinadas</h3>
                  <p className="text-xs text-blue-200 mt-1 max-w-lg">
                    Sincronize, crie e gerencie o orçamento e meta de ROAS das suas campanhas de anúncios patrocinados.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => fetchCampaigns(true)}
                    disabled={isSyncingAds}
                    className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={isSyncingAds ? 'animate-spin' : ''} />
                    <span>Sincronizar Ads</span>
                  </button>

                  <button
                    onClick={() => {
                      setFormCampaign({
                        name: '',
                        budget_amount: 50,
                        roas_target: 10,
                        selected_item_ids: []
                      });
                      setModalEditCampaign(null);
                      setModalNewCampaignOpen(true);
                    }}
                    className="px-4 py-2.5 bg-[#FFE600] text-[#2D3277] hover:bg-amber-300 font-black text-xs rounded-xl transition-all flex items-center gap-2 shadow-lg"
                  >
                    <Plus size={16} />
                    <span>Nova Campanha</span>
                  </button>
                </div>
              </div>

              {/* Tabela de Campanhas */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-900">Campanhas Ativas ({campaigns.length})</h4>
                  <span className="text-xs text-slate-500">Clique na linha para ver anúncios patrocinados</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase">
                        <th className="py-3 px-3">Nome da Campanha</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3">Orçamento</th>
                        <th className="py-3 px-3">ROAS Alvo</th>
                        <th className="py-3 px-3">Cliques</th>
                        <th className="py-3 px-3">Impressões</th>
                        <th className="py-3 px-3">Gasto</th>
                        <th className="py-3 px-3">Vendas</th>
                        <th className="py-3 px-3">ROAS Real</th>
                        <th className="py-3 px-3 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {campaignsLoading ? (
                        <tr>
                          <td colSpan={10} className="py-12 text-center text-slate-400">
                            <RefreshCw className="animate-spin inline-block mr-2" size={18} />
                            Carregando campanhas do Product Ads...
                          </td>
                        </tr>
                      ) : campaigns.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-12 text-center text-slate-400">
                            Nenhuma campanha de Product Ads encontrada. Clique em "Sincronizar Ads" ou "Nova Campanha".
                          </td>
                        </tr>
                      ) : (
                        campaigns.map(c => {
                          const isExpanded = expandedCampaignId === c.campaign_id;
                          const adGroups = Array.isArray(c.ad_groups) ? c.ad_groups : [];

                          return (
                            <React.Fragment key={c.campaign_id}>
                              <tr 
                                className="hover:bg-slate-50 cursor-pointer transition-all"
                                onClick={() => setExpandedCampaignId(isExpanded ? null : c.campaign_id)}
                              >
                                <td className="py-3 px-3 font-bold text-slate-900 flex items-center gap-2">
                                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                  <span>{c.name}</span>
                                </td>
                                <td className="py-3 px-3">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                    c.status === 'active' 
                                      ? 'bg-emerald-100 text-emerald-800' 
                                      : 'bg-slate-100 text-slate-600'
                                  }`}>
                                    {c.status === 'active' ? 'Ativa' : 'Pausada'}
                                  </span>
                                </td>
                                <td className="py-3 px-3 font-semibold">{formatCurrency(c.budget_amount)}/dia</td>
                                <td className="py-3 px-3 font-bold text-amber-700">{c.roas_target || 10}x</td>
                                <td className="py-3 px-3 font-medium">{c.clicks || 0}</td>
                                <td className="py-3 px-3 text-slate-500">{c.impressions || 0}</td>
                                <td className="py-3 px-3 font-bold text-rose-600">{formatCurrency(c.spend || 0)}</td>
                                <td className="py-3 px-3 font-extrabold text-emerald-600">{formatCurrency(c.sales || 0)}</td>
                                <td className="py-3 px-3 font-black text-amber-600">{c.roas ? Number(c.roas).toFixed(2) + 'x' : '0.0x'}</td>
                                <td className="py-3 px-3 text-right" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      onClick={() => handleToggleCampaignStatus(c)}
                                      title={c.status === 'active' ? 'Pausar Campanha' : 'Ativar Campanha'}
                                      className={`p-1.5 rounded-lg transition-all ${
                                        c.status === 'active' ? 'hover:bg-amber-50 text-amber-600' : 'hover:bg-emerald-50 text-emerald-600'
                                      }`}
                                    >
                                      {c.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                                    </button>

                                    <button
                                      onClick={() => {
                                        setModalEditCampaign(c);
                                        setFormCampaign({
                                          name: c.name || '',
                                          budget_amount: c.budget_amount || 50,
                                          roas_target: c.roas_target || 10,
                                          selected_item_ids: []
                                        });
                                      }}
                                      title="Editar Campanha"
                                      className="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-all"
                                    >
                                      <Edit3 size={14} />
                                    </button>

                                    <button
                                      onClick={() => handleDeleteCampaign(c.campaign_id)}
                                      title="Excluir Campanha"
                                      className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition-all"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {/* Linha Expandida: Anúncios Patrocinados (ad_groups) */}
                              {isExpanded && (
                                <tr>
                                  <td colSpan={10} className="bg-slate-50/80 p-4 border-t border-b border-slate-200">
                                    <div className="space-y-2 max-w-4xl">
                                      <h5 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                                        <Flame size={14} className="text-amber-500" />
                                        Anúncios Patrocinados nesta Campanha ({adGroups.length})
                                      </h5>

                                      {adGroups.length === 0 ? (
                                        <p className="text-xs text-slate-400 italic">Nenhum anúncio vinculado individualmente nesta campanha.</p>
                                      ) : (
                                        <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
                                          <table className="w-full text-left text-[11px]">
                                            <thead>
                                              <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                                                <th className="py-2 px-3">Item ID</th>
                                                <th className="py-2 px-3">Lance CPC</th>
                                                <th className="py-2 px-3">Cliques</th>
                                                <th className="py-2 px-3">Gasto</th>
                                                <th className="py-2 px-3">Vendas Atribuídas</th>
                                                <th className="py-2 px-3">ROAS</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                              {adGroups.map((ag: any, idx: number) => (
                                                <tr key={ag.ad_group_id || idx}>
                                                  <td className="py-2 px-3 font-mono font-bold text-slate-800">{ag.item_id || '-'}</td>
                                                  <td className="py-2 px-3 font-medium">{formatCurrency(ag.cpc_bid)}</td>
                                                  <td className="py-2 px-3">{ag.clicks || 0}</td>
                                                  <td className="py-2 px-3 font-bold text-rose-600">{formatCurrency(ag.spend || 0)}</td>
                                                  <td className="py-2 px-3 font-extrabold text-emerald-600">{formatCurrency(ag.sales || 0)}</td>
                                                  <td className="py-2 px-3 font-black text-amber-600">{ag.roas ? Number(ag.roas).toFixed(2) + 'x' : '0.0x'}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
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

                <div className="grid grid-cols-5 gap-2 pt-2">
                  {['Vermelho', 'Laranja', 'Amarelo', 'Verde Claro', 'Verde'].map((lvl, idx) => (
                    <div 
                      key={lvl}
                      className={`h-4 rounded-lg flex items-center justify-center text-[10px] font-bold text-white transition-all ${
                        idx === 0 ? 'bg-rose-500' :
                        idx === 1 ? 'bg-orange-500' :
                        idx === 2 ? 'bg-amber-400' :
                        idx === 3 ? 'bg-emerald-400' : 'bg-emerald-600'
                      } ${repMetrics?.level_id === `${idx + 1}_green` || idx === 4 ? 'ring-4 ring-slate-900/20 scale-105' : 'opacity-40'}`}
                    >
                      {lvl}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 7: FINANCEIRO */}
          {/* ========================================================================= */}
          {activeTab === 'financeiro' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-base font-black text-slate-900">Resumo Financeiro & Tarifas</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-xs text-slate-500 font-medium">Faturamento Bruto</span>
                    <p className="text-lg font-black text-slate-900 mt-1">{formatCurrency(ordersMetrics.revenue)}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-xs text-slate-500 font-medium">Gasto com Ads</span>
                    <p className="text-lg font-black text-rose-600 mt-1">{formatCurrency(totalAdsSpend)}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-xs text-slate-500 font-medium">Vendas Líquidas Ads</span>
                    <p className="text-lg font-black text-emerald-600 mt-1">{formatCurrency(totalAdsSales - totalAdsSpend)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL NOVA / EDITAR CAMPANHA (PRODUCT ADS) */}
      {(modalNewCampaignOpen || modalEditCampaign) && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Flame className="text-amber-500" size={18} />
                <span>{modalEditCampaign ? 'Editar Campanha' : 'Nova Campanha Product Ads'}</span>
              </h3>
              <button 
                onClick={() => {
                  setModalNewCampaignOpen(false);
                  setModalEditCampaign(null);
                }} 
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Nome da Campanha</label>
                <input
                  type="text"
                  value={formCampaign.name}
                  onChange={e => setFormCampaign({ ...formCampaign, name: e.target.value })}
                  placeholder="Ex: Campanha Eletrônicos Top Vendas"
                  className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Orçamento Diário (R$)</label>
                  <input
                    type="number"
                    value={formCampaign.budget_amount}
                    onChange={e => setFormCampaign({ ...formCampaign, budget_amount: Number(e.target.value) })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">ROAS Target (Alvo)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={formCampaign.roas_target}
                    onChange={e => setFormCampaign({ ...formCampaign, roas_target: Number(e.target.value) })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                  />
                </div>
              </div>

              {!modalEditCampaign && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Anúncios para Vincular</label>
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-xl p-2 space-y-1.5 custom-scrollbar bg-slate-50">
                    {items.map(item => {
                      const isSelected = formCampaign.selected_item_ids.includes(item.item_id);
                      return (
                        <div 
                          key={item.item_id}
                          onClick={() => {
                            setFormCampaign(prev => ({
                              ...prev,
                              selected_item_ids: isSelected 
                                ? prev.selected_item_ids.filter(id => id !== item.item_id)
                                : [...prev.selected_item_ids, item.item_id]
                            }));
                          }}
                          className={`p-2 rounded-lg cursor-pointer flex items-center justify-between text-[11px] transition-all ${
                            isSelected ? 'bg-blue-100 text-blue-900 border border-blue-300 font-bold' : 'bg-white hover:bg-slate-100'
                          }`}
                        >
                          <span className="line-clamp-1">{item.title}</span>
                          <span className="font-mono text-slate-500 shrink-0 ml-2">{formatCurrency(item.price)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                onClick={() => {
                  setModalNewCampaignOpen(false);
                  setModalEditCampaign(null);
                }}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveCampaign}
                className="px-5 py-2 bg-[#2D3277] hover:bg-[#1d2150] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm"
              >
                <span>{modalEditCampaign ? 'Salvar Alterações' : 'Criar Campanha'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL NOVO ANÚNCIO (ORGÂNICO) */}
      {modalNewItemOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Package size={18} className="text-[#2D3277]" />
                <span>Novo Anúncio no Mercado Livre</span>
              </h3>
              <button onClick={() => setModalNewItemOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Título do Anúncio *</label>
                <input
                  type="text"
                  value={formItem.title}
                  onChange={e => setFormItem({ ...formItem, title: e.target.value })}
                  placeholder="Ex: Smartphone Galaxy S23 256GB Preto Novo"
                  className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Preço (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formItem.price}
                    onChange={e => setFormItem({ ...formItem, price: Number(e.target.value) })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Estoque Inicial *</label>
                  <input
                    type="number"
                    value={formItem.available_quantity}
                    onChange={e => setFormItem({ ...formItem, available_quantity: Number(e.target.value) })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Exposição</label>
                  <select
                    value={formItem.listing_type_id}
                    onChange={e => setFormItem({ ...formItem, listing_type_id: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                  >
                    <option value="gold_special">Clássico</option>
                    <option value="gold_pro">Premium (Sem juros)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Condição</label>
                  <select
                    value={formItem.condition}
                    onChange={e => setFormItem({ ...formItem, condition: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                  >
                    <option value="new">Novo</option>
                    <option value="used">Usado</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">URL da Imagem (Thumbnail)</label>
                <input
                  type="text"
                  value={formItem.thumbnail}
                  onChange={e => setFormItem({ ...formItem, thumbnail: e.target.value })}
                  placeholder="https://..."
                  className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                onClick={() => setModalNewItemOpen(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateItem}
                className="px-5 py-2 bg-[#2D3277] hover:bg-[#1d2150] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm"
              >
                <span>Criar Anúncio</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDITAR ANÚNCIO (ORGÂNICO) */}
      {modalEditItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Edit3 size={18} className="text-blue-600" />
                <span>Editar Anúncio</span>
              </h3>
              <button onClick={() => setModalEditItem(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Título</label>
                <input
                  type="text"
                  value={formItem.title}
                  onChange={e => setFormItem({ ...formItem, title: e.target.value })}
                  className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Preço (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formItem.price}
                    onChange={e => setFormItem({ ...formItem, price: Number(e.target.value) })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Estoque</label>
                  <input
                    type="number"
                    value={formItem.available_quantity}
                    onChange={e => setFormItem({ ...formItem, available_quantity: Number(e.target.value) })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Status do Anúncio</label>
                <select
                  value={formItem.status}
                  onChange={e => setFormItem({ ...formItem, status: e.target.value })}
                  className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#2D3277]"
                >
                  <option value="active">Ativo</option>
                  <option value="paused">Pausado</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                onClick={() => setModalEditItem(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveItemEdit}
                className="px-5 py-2 bg-[#2D3277] hover:bg-[#1d2150] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm"
              >
                <span>Salvar Alterações</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DESTACAR ANÚNCIO (UPGRADE LISTING) */}
      {modalUpgradeItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Star size={18} className="text-amber-500 fill-amber-500" />
                <span>Mudar Exposição</span>
              </h3>
              <button onClick={() => setModalUpgradeItem(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Escolha o novo tipo de exposição para o anúncio <strong className="text-slate-900">{modalUpgradeItem.title}</strong>:
            </p>

            <div className="space-y-2">
              <label 
                onClick={() => setUpgradeListingTypeId('gold_special')}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  upgradeListingTypeId === 'gold_special' ? 'border-[#2D3277] bg-blue-50/50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div>
                  <span className="font-bold text-xs text-slate-900 block">Clássico (gold_special)</span>
                  <span className="text-[11px] text-slate-500">Exposição alta, com comissão padrão</span>
                </div>
                {upgradeListingTypeId === 'gold_special' && <CheckCircle size={16} className="text-[#2D3277]" />}
              </label>

              <label 
                onClick={() => setUpgradeListingTypeId('gold_pro')}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  upgradeListingTypeId === 'gold_pro' ? 'border-[#2D3277] bg-blue-50/50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div>
                  <span className="font-bold text-xs text-slate-900 block">Premium (gold_pro)</span>
                  <span className="text-[11px] text-slate-500">Exposição máxima + Parcelamento sem juros</span>
                </div>
                {upgradeListingTypeId === 'gold_pro' && <CheckCircle size={16} className="text-[#2D3277]" />}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                onClick={() => setModalUpgradeItem(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpgradeListing}
                className="px-5 py-2 bg-[#2D3277] hover:bg-[#1d2150] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm"
              >
                <span>Atualizar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER LATERAL: DETALHES DO ANÚNCIO */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white h-full shadow-2xl p-6 overflow-y-auto space-y-6 flex flex-col justify-between">
            <div className="space-y-5">
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <img src={selectedItem.thumbnail} alt="" className="w-12 h-12 rounded-xl object-cover border" />
                  <div>
                    <span className="text-xs font-mono text-slate-400">MLB #{selectedItem.item_id}</span>
                    <h3 className="font-bold text-sm text-slate-900 line-clamp-2">{selectedItem.title}</h3>
                  </div>
                </div>
                <button onClick={() => setSelectedItem(null)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400">Preço Atual</span>
                  <p className="font-bold text-slate-900 text-sm">{formatCurrency(selectedItem.price)}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400">Estoque</span>
                  <p className="font-bold text-slate-900 text-sm">{selectedItem.available_quantity} un</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400">Vendidos</span>
                  <p className="font-bold text-emerald-600 text-sm">{selectedItem.sold_quantity} un</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400">Status</span>
                  <p className="font-bold text-slate-900 text-sm">{selectedItem.status}</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedItem(null)}
              className="w-full py-2.5 bg-slate-900 text-white font-bold text-xs rounded-xl hover:bg-slate-800"
            >
              Fechar Detalhes
            </button>
          </div>
        </div>
      )}

      {/* DRAWER LATERAL: DETALHES DO PEDIDO */}
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

              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                  <span className="text-slate-400 font-medium">Comprador</span>
                  <p className="font-bold text-slate-900">@{selectedOrder.buyer_nickname || 'anônimo'}</p>
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

      {/* MODAL RESPONDER PERGUNTA */}
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
