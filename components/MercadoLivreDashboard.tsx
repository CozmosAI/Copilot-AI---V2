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
    showToast('Iniciando sincronização completa (pode levar 60s)...', 'info');
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
  const messagesMetrics = dashboardData?.messages || { total: 0, unread: 0 };
  const repMetrics = reputationData?.seller_reputation || dashboardData?.reputation || null;

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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
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
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans space-y-6 pb-12">
      {/* TOAST ALERTA */}
      {toastMessage && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200 ${
          toastMessage.type === 'success' ? 'bg-emerald-900 text-white border-emerald-800' :
          toastMessage.type === 'error' ? 'bg-rose-900 text-white border-rose-800' :
          'bg-slate-900 text-white border-slate-800'
        }`}>
          {toastMessage.type === 'success' && <CheckCircle size={16} className="text-emerald-400 shrink-0" />}
          {toastMessage.type === 'error' && <AlertTriangle size={16} className="text-rose-400 shrink-0" />}
          {toastMessage.type === 'info' && <Info size={16} className="text-blue-400 shrink-0" />}
          <span>{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="ml-2 hover:opacity-75">
            <X size={14} />
          </button>
        </div>
      )}

      {/* HEADER DE COMANDO (Elegante, Branco, Sem fundo amarelo apelativo) */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-2xs">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-300/30 border border-amber-300/50 flex items-center justify-center shrink-0 shadow-2xs">
              {/* Logo sutil ML */}
              <span className="font-extrabold text-amber-800 text-base">ML</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900 tracking-tight">Mercado Livre</h1>
                {connectionStatus === 'connected' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Conectado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                    {connectionStatus === 'expired' ? 'Sessão Expirada' : 'Desconectado'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {nickname ? `Vendedor: @${nickname}` : 'Integração oficial via API Mercado Livre'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Filtro de Período */}
            <div className="bg-slate-100 p-1 rounded-lg border border-slate-200 flex items-center text-xs font-medium text-slate-600">
              <button 
                onClick={() => setPeriod('7d')}
                className={`px-3 py-1.5 rounded-md transition-all ${period === '7d' ? 'bg-white text-slate-900 font-semibold shadow-2xs' : 'hover:text-slate-900'}`}
              >
                7 Dias
              </button>
              <button 
                onClick={() => setPeriod('30d')}
                className={`px-3 py-1.5 rounded-md transition-all ${period === '30d' ? 'bg-white text-slate-900 font-semibold shadow-2xs' : 'hover:text-slate-900'}`}
              >
                30 Dias
              </button>
              <button 
                onClick={() => setPeriod('90d')}
                className={`px-3 py-1.5 rounded-md transition-all ${period === '90d' ? 'bg-white text-slate-900 font-semibold shadow-2xs' : 'hover:text-slate-900'}`}
              >
                90 Dias
              </button>
            </div>

            {/* Botão de Sincronização */}
            <button
              onClick={syncAllData}
              disabled={isSyncingAll}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg shadow-2xs flex items-center gap-2 transition-colors"
            >
              <RefreshCw size={14} className={isSyncingAll ? 'animate-spin' : ''} />
              <span>{isSyncingAll ? 'Sincronizando...' : 'Sincronizar Tudo'}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 space-y-6">

        {/* CARDS DE KPIS PRINCIPAIS (Clean Grid) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:shadow-xs transition-shadow">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Vendas Totais</span>
              <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                <ShoppingCart size={16} />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {ordersMetrics.total || 0} <span className="text-xs font-medium text-slate-500">pedidos</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Faturamento: <strong className="text-slate-900">{formatCurrency(ordersMetrics.revenue)}</strong>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:shadow-xs transition-shadow">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Faturamento Mês</span>
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                <DollarSign size={16} />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {formatCurrency(salesTotals.this_month?.revenue || 0)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              <strong className="text-emerald-600">{salesTotals.this_month?.count || 0} vendas</strong> este mês
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:shadow-xs transition-shadow">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Catálogo Ativo</span>
              <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
                <Package size={16} />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {itemsMetrics.total_active || 0} <span className="text-xs font-medium text-slate-500">ativos</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {itemsMetrics.total_paused || 0} pausados / arquivados
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:shadow-xs transition-shadow">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Atendimento SAC</span>
              <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
                <MessageCircle size={16} />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {questionsMetrics.unanswered || 0} <span className="text-xs font-medium text-amber-600">sem resposta</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Total de {questionsMetrics.total || 0} perguntas no período
            </div>
          </div>
        </div>

        {/* NAVEGAÇÃO DE TABS (Estilo Shopify/VTEX) */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
          <div className="border-b border-slate-200 px-4 overflow-x-auto scrollbar-none flex items-center gap-1">
            <button
              onClick={() => setActiveTab('resumo')}
              className={`py-3.5 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'resumo' 
                  ? 'border-slate-900 text-slate-900' 
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <BarChart2 size={15} />
              <span>Resumo</span>
            </button>

            <button
              onClick={() => setActiveTab('anuncios')}
              className={`py-3.5 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'anuncios' 
                  ? 'border-slate-900 text-slate-900' 
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Package size={15} />
              <span>Anúncios</span>
              {itemsTotal > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-600">{itemsTotal}</span>}
            </button>

            <button
              onClick={() => setActiveTab('vendas')}
              className={`py-3.5 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'vendas' 
                  ? 'border-slate-900 text-slate-900' 
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShoppingCart size={15} />
              <span>Vendas</span>
              {orders.length > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-600">{orders.length}</span>}
            </button>

            <button
              onClick={() => setActiveTab('perguntas')}
              className={`py-3.5 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'perguntas' 
                  ? 'border-slate-900 text-slate-900' 
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <MessageCircle size={15} />
              <span>Perguntas</span>
              {questionsMetrics.unanswered > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-800 font-bold">{questionsMetrics.unanswered}</span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('publicidade')}
              className={`py-3.5 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'publicidade' 
                  ? 'border-slate-900 text-slate-900' 
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Flame size={15} className="text-blue-600" />
              <span>Publicidade (Product Ads)</span>
              {campaigns.length > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-blue-50 text-blue-700">{campaigns.length}</span>}
            </button>

            <button
              onClick={() => setActiveTab('reputacao')}
              className={`py-3.5 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'reputacao' 
                  ? 'border-slate-900 text-slate-900' 
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Award size={15} />
              <span>Reputação</span>
            </button>

            <button
              onClick={() => setActiveTab('financeiro')}
              className={`py-3.5 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'financeiro' 
                  ? 'border-slate-900 text-slate-900' 
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <DollarSign size={15} />
              <span>Financeiro ML</span>
            </button>
          </div>

          {/* CONTEÚDO DA TAB */}
          <div className="p-6">

            {/* TAB 1: RESUMO */}
            {activeTab === 'resumo' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                    <span className="text-xs font-medium text-slate-500">Vendas Hoje</span>
                    <p className="text-xl font-bold text-slate-900 mt-1">{formatCurrency(salesTotals.today?.revenue || 0)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{salesTotals.today?.count || 0} pedidos faturados</p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                    <span className="text-xs font-medium text-slate-500">Vendas Esta Semana</span>
                    <p className="text-xl font-bold text-slate-900 mt-1">{formatCurrency(salesTotals.this_week?.revenue || 0)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{salesTotals.this_week?.count || 0} pedidos faturados</p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                    <span className="text-xs font-medium text-slate-500">Vendas Este Mês</span>
                    <p className="text-xl font-bold text-slate-900 mt-1">{formatCurrency(salesTotals.this_month?.revenue || 0)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{salesTotals.this_month?.count || 0} pedidos faturados</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Performance dos Anúncios */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white">
                    <h3 className="text-sm font-bold text-slate-900 mb-4">Distribuição do Catálogo</h3>
                    <div className="space-y-3 text-xs">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="font-medium text-slate-700 flex items-center gap-2">
                          <Flame size={14} className="text-blue-600" />
                          Patrocinados (Product Ads)
                        </span>
                        <span className="font-bold text-slate-900">{itemsMetrics.breakdown?.sponsored || sponsoredItemIds.size || 0} itens</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="font-medium text-slate-700 flex items-center gap-2">
                          <Boxes size={14} className="text-purple-600" />
                          Listados no Catálogo
                        </span>
                        <span className="font-bold text-slate-900">{itemsMetrics.breakdown?.catalog || 0} itens</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="font-medium text-slate-700 flex items-center gap-2">
                          <Package size={14} className="text-slate-600" />
                          Anúncios Orgânicos
                        </span>
                        <span className="font-bold text-slate-900">{itemsMetrics.breakdown?.organic || 0} itens</span>
                      </div>
                    </div>
                  </div>

                  {/* Resumo da Operação */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white">
                    <h3 className="text-sm font-bold text-slate-900 mb-4">Resumo da Operação</h3>
                    <div className="space-y-3 text-xs">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="text-slate-600">Status dos Pedidos</span>
                        <span className="font-bold text-emerald-600">{ordersMetrics.paid || 0} pagos / {ordersMetrics.shipped || 0} enviados</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="text-slate-600">Perguntas a responder</span>
                        <span className={`font-bold ${questionsMetrics.unanswered > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                          {questionsMetrics.unanswered || 0} pendentes
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="text-slate-600">Termômetro do Vendedor</span>
                        <span className="font-bold text-emerald-600 uppercase">{repMetrics?.level_id || 'Verde (Excelente)'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: ANÚNCIOS */}
            {activeTab === 'anuncios' && (
              <div className="space-y-4">
                {/* Action Bar */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                    <div className="relative min-w-[220px]">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Buscar por título ou ID..."
                        value={itemsSearch}
                        onChange={(e) => setItemsSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && fetchItems()}
                        className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                      />
                    </div>

                    <select
                      value={itemsStatus}
                      onChange={(e) => setItemsStatus(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg text-xs px-2.5 py-1.5 focus:outline-none"
                    >
                      <option value="">Todos os Status</option>
                      <option value="active">Ativos</option>
                      <option value="paused">Pausados</option>
                    </select>

                    <select
                      value={itemsType}
                      onChange={(e) => setItemsType(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg text-xs px-2.5 py-1.5 focus:outline-none"
                    >
                      <option value="">Todos os Tipos</option>
                      <option value="gold_pro">Premium</option>
                      <option value="gold_special">Clássico</option>
                      <option value="catalog">Catálogo</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button
                      onClick={syncItems}
                      disabled={isSyncingItems}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5"
                    >
                      <RefreshCw size={13} className={isSyncingItems ? 'animate-spin' : ''} />
                      <span>{isSyncingItems ? 'Sincronizando...' : 'Sincronizar'}</span>
                    </button>

                    <button
                      onClick={() => setModalNewItemOpen(true)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5"
                    >
                      <Plus size={14} />
                      <span>Novo Anúncio</span>
                    </button>
                  </div>
                </div>

                {/* Tabela de Anúncios */}
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-700 border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold border-b border-slate-200">
                          <th className="p-3">Anúncio</th>
                          <th className="p-3">Tipo</th>
                          <th className="p-3">Preço</th>
                          <th className="p-3">Estoque</th>
                          <th className="p-3">Vendidos</th>
                          <th className="p-3">Status</th>
                          <th className="p-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {itemsLoading ? (
                          <tr>
                            <td colSpan={7} className="p-8 text-center text-slate-400">
                              <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                              Carregando anúncios...
                            </td>
                          </tr>
                        ) : items.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-8 text-center text-slate-500">
                              Nenhum anúncio encontrado.
                            </td>
                          </tr>
                        ) : (
                          items.map((item) => (
                            <tr key={item.item_id || item.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="p-3">
                                <div className="flex items-center gap-3">
                                  <img 
                                    src={item.thumbnail || 'https://via.placeholder.com/40'} 
                                    alt={item.title}
                                    className="w-10 h-10 object-cover rounded-md border border-slate-200 shrink-0" 
                                  />
                                  <div>
                                    <p className="font-semibold text-slate-900 line-clamp-1 max-w-md">{item.title}</p>
                                    <span className="text-[10px] text-slate-400 font-mono">{item.item_id || item.id}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                {renderTypeBadge(item)}
                              </td>
                              <td className="p-3 font-semibold text-slate-900 whitespace-nowrap">
                                {formatCurrency(item.price)}
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                <span className={item.available_quantity > 0 ? 'text-slate-700 font-medium' : 'text-rose-600 font-bold'}>
                                  {item.available_quantity} un
                                </span>
                              </td>
                              <td className="p-3 text-slate-600 whitespace-nowrap">
                                {item.sold_quantity || 0}
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  item.status === 'active' 
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}>
                                  {item.status === 'active' ? 'Ativo' : 'Pausado'}
                                </span>
                              </td>
                              <td className="p-3 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleToggleItemStatus(item)}
                                    className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
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
                                    className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
                                    title="Editar Anúncio"
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                  {item.permalink && (
                                    <a
                                      href={item.permalink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
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

            {/* TAB 3: VENDAS (KANBAN 4 COLUNAS) */}
            {activeTab === 'vendas' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="relative flex-1 max-w-sm">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Filtrar por comprador, produto ou ID do pedido..."
                      value={ordersSearch}
                      onChange={(e) => setOrdersSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none"
                    />
                  </div>

                  <button
                    onClick={syncOrders}
                    disabled={isSyncingOrders}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5"
                  >
                    <RefreshCw size={13} className={isSyncingOrders ? 'animate-spin' : ''} />
                    <span>{isSyncingOrders ? 'Sincronizando...' : 'Sincronizar Pedidos'}</span>
                  </button>
                </div>

                {/* Grid Kanban */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Coluna 1: Envios Hoje */}
                  <div className="bg-slate-100/70 p-3 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Truck size={14} className="text-emerald-600" />
                        Envios para Hoje
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
                        {colEnviosHoje.length}
                      </span>
                    </div>

                    <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
                      {colEnviosHoje.map(o => (
                        <div key={o.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs hover:shadow-xs transition-shadow space-y-2">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-mono font-bold text-slate-600">#{o.ml_order_id}</span>
                            <span>{formatDate(o.date_created)}</span>
                          </div>
                          <p className="text-xs font-bold text-slate-900 line-clamp-2">{o.item_title}</p>
                          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                            <span className="text-slate-500">@{o.buyer_nickname || 'comprador'}</span>
                            <span className="font-bold text-slate-900">{formatCurrency(o.total_amount)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Coluna 2: Aguardando */}
                  <div className="bg-slate-100/70 p-3 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Clock size={14} className="text-amber-600" />
                        Aguardando Pagamento
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800">
                        {colAguardando.length}
                      </span>
                    </div>

                    <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
                      {colAguardando.map(o => (
                        <div key={o.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-mono text-slate-600">#{o.ml_order_id}</span>
                            <span>{formatDate(o.date_created)}</span>
                          </div>
                          <p className="text-xs font-semibold text-slate-800 line-clamp-2">{o.item_title}</p>
                          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                            <span className="text-slate-500">@{o.buyer_nickname || 'comprador'}</span>
                            <span className="font-bold text-slate-900">{formatCurrency(o.total_amount)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Coluna 3: Em Trânsito */}
                  <div className="bg-slate-100/70 p-3 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Truck size={14} className="text-blue-600" />
                        A Caminho
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800">
                        {colACaminho.length}
                      </span>
                    </div>

                    <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
                      {colACaminho.map(o => (
                        <div key={o.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-mono text-slate-600">#{o.ml_order_id}</span>
                            <span>{formatDate(o.date_created)}</span>
                          </div>
                          <p className="text-xs font-semibold text-slate-800 line-clamp-2">{o.item_title}</p>
                          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                            <span className="text-slate-500">@{o.buyer_nickname || 'comprador'}</span>
                            <span className="font-bold text-slate-900">{formatCurrency(o.total_amount)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Coluna 4: Finalizadas */}
                  <div className="bg-slate-100/70 p-3 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <CheckCircle size={14} className="text-slate-600" />
                        Entregues / Concluídas
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-200 text-slate-700">
                        {colFinalizadas.length}
                      </span>
                    </div>

                    <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
                      {colFinalizadas.map(o => (
                        <div key={o.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2 opacity-80 hover:opacity-100 transition-opacity">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-mono text-slate-600">#{o.ml_order_id}</span>
                            <span>{formatDate(o.date_created)}</span>
                          </div>
                          <p className="text-xs text-slate-800 line-clamp-2">{o.item_title}</p>
                          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                            <span className="text-slate-500">@{o.buyer_nickname || 'comprador'}</span>
                            <span className="font-bold text-slate-900">{formatCurrency(o.total_amount)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: PERGUNTAS */}
            {activeTab === 'perguntas' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setQuestionsFilter('unanswered')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        questionsFilter === 'unanswered' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-white text-slate-600 border border-slate-200'
                      }`}
                    >
                      Pendentes ({questionsMetrics.unanswered})
                    </button>
                    <button
                      onClick={() => setQuestionsFilter('answered')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        questionsFilter === 'answered' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'
                      }`}
                    >
                      Respondidas
                    </button>
                    <button
                      onClick={() => setQuestionsFilter('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        questionsFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'
                      }`}
                    >
                      Todas
                    </button>
                  </div>

                  <button
                    onClick={fetchQuestions}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5"
                  >
                    <RefreshCw size={13} className={questionsLoading ? 'animate-spin' : ''} />
                    <span>Atualizar</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {questionsLoading ? (
                    <div className="p-12 text-center text-slate-400">
                      <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                      Carregando perguntas...
                    </div>
                  ) : questions.length === 0 ? (
                    <div className="p-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
                      Nenhuma pergunta encontrada com o filtro selecionado.
                    </div>
                  ) : (
                    questions.map((q) => (
                      <div key={q.id} className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-400 font-mono">Item ID: {q.item_id} • {formatDate(q.date_created)}</span>
                            <p className="text-xs font-bold text-slate-900">{q.item_title}</p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                            q.status === 'UNANSWERED' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {q.status === 'UNANSWERED' ? 'Pendente' : 'Respondida'}
                          </span>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-800">
                          <strong className="text-slate-900 font-semibold">Pergunta: </strong> {q.text}
                        </div>

                        {q.answer ? (
                          <div className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-100 text-xs text-emerald-900">
                            <strong className="font-semibold text-emerald-800">Sua Resposta: </strong> {q.answer.text}
                          </div>
                        ) : (
                          <div className="pt-2 border-t border-slate-100 space-y-2">
                            <textarea
                              rows={2}
                              placeholder="Digite sua resposta oficial..."
                              value={replyingQuestion?.id === q.id ? replyText : ''}
                              onChange={(e) => {
                                setReplyingQuestion(q);
                                setReplyText(e.target.value);
                              }}
                              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:bg-white focus:ring-1 focus:ring-slate-900"
                            />
                            <div className="flex justify-end">
                              <button
                                onClick={handleSendReply}
                                disabled={isSendingReply || !replyText.trim()}
                                className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5"
                              >
                                <Send size={12} />
                                <span>{isSendingReply ? 'Enviando...' : 'Enviar Resposta'}</span>
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

            {/* TAB 5: PUBLICIDADE (PRODUCT ADS V2 REESCRITO) */}
            {activeTab === 'publicidade' && (
              <div className="space-y-6">
                {/* KPIs de Performance de Ads */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-xs font-semibold uppercase text-slate-500">Campanhas Ativas</span>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{activeAdsCampaignsCount}</p>
                    <span className="text-[11px] text-slate-400">{campaigns.length} total sincronizadas</span>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-xs font-semibold uppercase text-slate-500">Investimento (Gasto)</span>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalAdsSpend)}</p>
                    <span className="text-[11px] text-slate-400">Total investido no período</span>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-xs font-semibold uppercase text-slate-500">Vendas Geradas</span>
                    <p className="text-2xl font-bold text-emerald-600 mt-1">{formatCurrency(totalAdsSales)}</p>
                    <span className="text-[11px] text-slate-400">Receita via Product Ads</span>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-xs font-semibold uppercase text-slate-500">ROAS Médio</span>
                    <p className="text-2xl font-bold text-blue-600 mt-1">{avgAdsRoas}x</p>
                    <span className="text-[11px] text-slate-400">Retorno sobre investimento</span>
                  </div>
                </div>

                {/* Header de Ações */}
                <div className="flex items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">Gerenciador Product Ads</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => fetchCampaigns(true)}
                      disabled={isSyncingAds}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5"
                    >
                      <RefreshCw size={13} className={isSyncingAds ? 'animate-spin' : ''} />
                      <span>{isSyncingAds ? 'Sincronizando...' : 'Sincronizar Ads'}</span>
                    </button>

                    <button
                      onClick={() => {
                        setModalEditCampaign(null);
                        setFormCampaign({ name: '', budget_amount: 50, roas_target: 10, selected_item_ids: [] });
                        setModalNewCampaignOpen(true);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5"
                    >
                      <Plus size={14} />
                      <span>Nova Campanha</span>
                    </button>
                  </div>
                </div>

                {/* Tabela de Campanhas */}
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-700 border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold border-b border-slate-200">
                          <th className="p-3">Campanha</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Orçamento</th>
                          <th className="p-3">ROAS Alvo</th>
                          <th className="p-3">Cliques</th>
                          <th className="p-3">Impressões</th>
                          <th className="p-3">Investido (R$)</th>
                          <th className="p-3">Vendas (R$)</th>
                          <th className="p-3">ROAS Real</th>
                          <th className="p-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {campaignsLoading ? (
                          <tr>
                            <td colSpan={10} className="p-8 text-center text-slate-400">
                              <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                              Carregando campanhas do Product Ads...
                            </td>
                          </tr>
                        ) : campaigns.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-8 text-center text-slate-500">
                              Nenhuma campanha encontrada no Product Ads.
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
                              <React.Fragment key={camp.id || camp.campaign_id}>
                                <tr className="hover:bg-slate-50/80 transition-colors">
                                  <td className="p-3">
                                    <div>
                                      <p className="font-bold text-slate-900">{camp.name || `Campanha #${camp.campaign_id}`}</p>
                                      <span className="text-[10px] text-slate-400 font-mono">ID: {camp.campaign_id}</span>
                                    </div>
                                  </td>
                                  <td className="p-3 whitespace-nowrap">
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                      camp.status === 'active' 
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                                    }`}>
                                      {camp.status === 'active' ? 'Ativa' : 'Pausada'}
                                    </span>
                                  </td>
                                  <td className="p-3 font-semibold text-slate-800 whitespace-nowrap">
                                    {formatCurrency(camp.budget_amount || 0)}/dia
                                  </td>
                                  <td className="p-3 text-slate-600 whitespace-nowrap">
                                    {camp.roas_target ? `${camp.roas_target}x` : 'Automático'}
                                  </td>
                                  <td className="p-3 text-slate-700 font-medium whitespace-nowrap">{clicks}</td>
                                  <td className="p-3 text-slate-700 font-medium whitespace-nowrap">{prints}</td>
                                  <td className="p-3 font-bold text-slate-900 whitespace-nowrap">{formatCurrency(spend)}</td>
                                  <td className="p-3 font-bold text-emerald-600 whitespace-nowrap">{formatCurrency(sales)}</td>
                                  <td className="p-3 font-bold text-blue-600 whitespace-nowrap">{Number(roasVal).toFixed(2)}x</td>
                                  <td className="p-3 text-right whitespace-nowrap">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        onClick={() => handleToggleCampaignStatus(camp)}
                                        className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
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
                                        className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
                                        title="Editar Campanha"
                                      >
                                        <Edit3 size={14} />
                                      </button>

                                      <button
                                        onClick={() => handleDeleteCampaign(camp.campaign_id)}
                                        className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                                        title="Excluir Campanha"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
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

            {/* TAB 6: REPUTAÇÃO (TERMÔMETRO MODERNO) */}
            {activeTab === 'reputacao' && (
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-6">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Nível do Vendedor</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Indicadores oficiais de qualidade e reputação do Mercado Livre</p>
                  </div>

                  {/* Termômetro de Reputação (5 cores elegantes) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-600">Termômetro Atual:</span>
                      <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full uppercase">
                        {repMetrics?.level_id || '5_green (Líder / Excelente)'}
                      </span>
                    </div>

                    <div className="grid grid-cols-5 gap-1.5 h-3.5 rounded-full overflow-hidden bg-slate-100 p-0.5 border border-slate-200">
                      <div className="bg-rose-400 rounded-l-full opacity-60" title="Vermelho" />
                      <div className="bg-amber-400 opacity-60" title="Laranja" />
                      <div className="bg-yellow-400 opacity-60" title="Amarelo" />
                      <div className="bg-lime-400 opacity-80" title="Verde Claro" />
                      <div className="bg-emerald-500 rounded-r-full shadow-xs" title="Verde Escuro (Sua posição)" />
                    </div>
                  </div>

                  {/* Métricas do Termômetro */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-slate-100">
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-xs font-medium text-slate-500">Reclamações</span>
                      <p className="text-xl font-bold text-slate-900 mt-1">
                        {repMetrics?.metrics?.claims?.rate ? `${(repMetrics.metrics.claims.rate * 100).toFixed(2)}%` : '0.00%'}
                      </p>
                      <span className="text-[10px] text-slate-400">Meta ML: abaixo de 1.0%</span>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-xs font-medium text-slate-500">Cancelamentos</span>
                      <p className="text-xl font-bold text-slate-900 mt-1">
                        {repMetrics?.metrics?.cancellations?.rate ? `${(repMetrics.metrics.cancellations.rate * 100).toFixed(2)}%` : '0.00%'}
                      </p>
                      <span className="text-[10px] text-slate-400">Meta ML: abaixo de 0.5%</span>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-xs font-medium text-slate-500">Tempo de Envio com Atraso</span>
                      <p className="text-xl font-bold text-slate-900 mt-1">
                        {repMetrics?.metrics?.delayed_handling_time?.rate ? `${(repMetrics.metrics.delayed_handling_time.rate * 100).toFixed(2)}%` : '0.00%'}
                      </p>
                      <span className="text-[10px] text-slate-400">Meta ML: abaixo de 10.0%</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 7: FINANCEIRO ML */}
            {activeTab === 'financeiro' && (
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-6">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Demonstrativo Financeiro do Mercado Livre</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Visão detalhada de faturamento bruto, tarifas da plataforma e saldo líquido</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-xs font-medium text-slate-500">Faturamento Bruto</span>
                      <p className="text-xl font-bold text-slate-900 mt-1">{formatCurrency(ordersMetrics.revenue)}</p>
                      <span className="text-[10px] text-slate-400">Vendas confirmadas no período</span>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-xs font-medium text-slate-500">Tarifas ML (Estimadas ~16%)</span>
                      <p className="text-xl font-bold text-rose-600 mt-1">-{formatCurrency(ordersMetrics.revenue * 0.16)}</p>
                      <span className="text-[10px] text-slate-400">Comissão de venda da plataforma</span>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-xs font-medium text-slate-500">Gasto em Publicidade</span>
                      <p className="text-xl font-bold text-rose-600 mt-1">-{formatCurrency(totalAdsSpend)}</p>
                      <span className="text-[10px] text-slate-400">Product Ads</span>
                    </div>

                    <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-200">
                      <span className="text-xs font-bold text-emerald-800">Resultado Líquido Estimado</span>
                      <p className="text-xl font-bold text-emerald-700 mt-1">
                        {formatCurrency(ordersMetrics.revenue - (ordersMetrics.revenue * 0.16) - totalAdsSpend)}
                      </p>
                      <span className="text-[10px] text-emerald-600">Disponível para repasse</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

      </div>

      {/* MODAL CRIAR/EDITAR ANÚNCIO */}
      {modalNewItemOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Novo Anúncio no Mercado Livre</h3>
              <button onClick={() => setModalNewItemOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Título do Anúncio *</label>
                <input
                  type="text"
                  placeholder="Ex: Camiseta Masculina 100% Algodão Premium"
                  value={formItem.title}
                  onChange={(e) => setFormItem({ ...formItem, title: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Preço (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="99.90"
                    value={formItem.price || ''}
                    onChange={(e) => setFormItem({ ...formItem, price: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-1 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Quantidade em Estoque</label>
                  <input
                    type="number"
                    value={formItem.available_quantity}
                    onChange={(e) => setFormItem({ ...formItem, available_quantity: parseInt(e.target.value) || 1 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-1 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Tipo de Exposição</label>
                <select
                  value={formItem.listing_type_id}
                  onChange={(e) => setFormItem({ ...formItem, listing_type_id: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-1 focus:ring-slate-900"
                >
                  <option value="gold_special">Clássico (Comissão Menor)</option>
                  <option value="gold_pro">Premium (Sem juros em até 12x)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setModalNewItemOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateItem}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                Publicar no Mercado Livre
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDITAR ANÚNCIO */}
      {modalEditItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Editar Anúncio #{modalEditItem.item_id}</h3>
              <button onClick={() => setModalEditItem(null)} className="text-slate-400 hover:text-slate-600">
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
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white"
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
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Estoque</label>
                  <input
                    type="number"
                    value={formItem.available_quantity}
                    onChange={(e) => setFormItem({ ...formItem, available_quantity: parseInt(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setModalEditItem(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveItemEdit}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                Salvar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CRIAR/EDITAR CAMPANHA DE ADS */}
      {modalNewCampaignOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {modalEditCampaign ? `Editar Campanha #${modalEditCampaign.campaign_id}` : 'Nova Campanha de Product Ads'}
              </h3>
              <button onClick={() => setModalNewCampaignOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Nome da Campanha *</label>
                <input
                  type="text"
                  placeholder="Ex: Campanha Tênis & Moda Verão"
                  value={formCampaign.name}
                  onChange={(e) => setFormCampaign({ ...formCampaign, name: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Orçamento Diário (R$)</label>
                  <input
                    type="number"
                    value={formCampaign.budget_amount}
                    onChange={(e) => setFormCampaign({ ...formCampaign, budget_amount: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-1 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">ROAS Alvo (x)</label>
                  <input
                    type="number"
                    value={formCampaign.roas_target}
                    onChange={(e) => setFormCampaign({ ...formCampaign, roas_target: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-1 focus:ring-slate-900"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setModalNewCampaignOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveCampaign}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
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
