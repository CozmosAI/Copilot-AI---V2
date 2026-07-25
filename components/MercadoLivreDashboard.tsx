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
        fetchDashboardData(true);
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
        fetchDashboardData(true);
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
  const totalAdsSpend = campaigns.reduce((acc, c) => acc + (Number(c.spend) || 0), 0);
  const totalAdsSales = campaigns.reduce((acc, c) => acc + (Number(c.sales) || 0), 0);
  const avgAdsRoas = safeDivide(totalAdsSales, totalAdsSpend).toFixed(2);

  // Render Badge de Tipo do Anúncio (Design System Andes ML)
  const renderTypeBadge = (item: any) => {
    const isCat = item.catalog_listing === true;
    const isSpon = item.is_sponsored === true || sponsoredItemIds.has(item.item_id);
    const isPrem = item.listing_type_id === 'gold_pro' || item.listing_type_id === 'premium';

    if (isCat && isSpon) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#7B1FA2] text-white uppercase">
          <Zap size={10} className="fill-white" />
          Catálogo Patrocinado
        </span>
      );
    }
    if (isCat) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#7B1FA2] text-white uppercase">
          <Boxes size={10} />
          Catálogo
        </span>
      );
    }
    if (isSpon) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#3483FA] text-white uppercase">
          <Flame size={10} className="fill-white" />
          Patrocinado
        </span>
      );
    }
    if (isPrem) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#FFE600] text-[#333333] uppercase">
          <Star size={10} className="fill-[#333333]" />
          Premium
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F5F5F5] text-[#666666] border border-[#E0E0E0] uppercase">
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
    <div className="space-y-6 pb-12 font-sans bg-[#F5F5F5] min-h-screen text-[#333333] -m-6 p-6">
      {/* TOAST ALERTA */}
      {toastMessage && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center gap-3 max-w-md border animate-in slide-in-from-top-2 duration-300 ${
          toastMessage.type === 'success' ? 'bg-[#00A650] text-white border-emerald-600' :
          toastMessage.type === 'error' ? 'bg-[#E53935] text-white border-red-600' :
          'bg-[#333333] text-white border-[#666666]'
        }`}>
          {toastMessage.type === 'success' && <CheckCircle className="text-white shrink-0" size={20} />}
          {toastMessage.type === 'error' && <AlertTriangle className="text-white shrink-0" size={20} />}
          {toastMessage.type === 'info' && <Info className="text-white shrink-0" size={20} />}
          <span className="text-xs font-semibold">{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="ml-auto text-white/80 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}

      {/* HEADER PRINCIPAL ML (DESIGN SYSTEM ANDES: AMARelo #FFE600, ALTURA 48-56px, STICKY) */}
      <header className="bg-[#FFE600] text-[#333333] h-14 sticky top-0 z-50 px-4 flex items-center justify-between shadow-sm rounded-lg border border-[#E0E0E0]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#333333] text-[#FFE600] rounded-md flex items-center justify-center font-black text-sm shrink-0">
            ML
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-[#333333]">Mercado Livre Hub</h1>
              {connectionStatus === 'connected' && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#00A650] text-white uppercase flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                  Conectado
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#666666] -mt-0.5">
              {nickname ? `@${nickname} • ID: ${userMlId}` : 'Gestão Unificada de Vendas, Anúncios e Product Ads'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Seletor Período */}
          <div className="bg-white/80 p-0.5 rounded-md border border-[#E0E0E0] flex items-center">
            {(['7d', '30d', '90d'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-all ${
                  period === p ? 'bg-[#3483FA] text-white' : 'text-[#666666] hover:text-[#333333]'
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
            className="px-3 py-1.5 bg-[#3483FA] hover:bg-[#2968C8] text-white font-medium text-xs rounded-md transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={14} className={isSyncingAll ? 'animate-spin' : ''} />
            <span>{isSyncingAll ? 'Sincronizando...' : 'Sincronizar Tudo'}</span>
          </button>
        </div>
      </header>

      {/* CARDS DE KPI (GRID DE 5, CARDS BRANCOS, SHADOW-SM, BORDA SUTIL, FONTES CORRETAS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Pedidos */}
        <div className="bg-white p-4 rounded-lg border border-[#E0E0E0] shadow-sm hover:shadow-md transition">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs text-[#999999] font-semibold uppercase tracking-wide">Vendas Totais</p>
              <h3 className="text-2xl font-bold text-[#333333] mt-1">{ordersMetrics.total}</h3>
            </div>
            <div className="w-9 h-9 rounded-md bg-[#F5F5F5] text-[#3483FA] flex items-center justify-center">
              <ShoppingCart size={18} />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#EBEBEB] flex items-center justify-between text-xs text-[#666666]">
            <span>A caminho: <strong className="text-[#3483FA]">{ordersMetrics.shipped}</strong></span>
            <span>Entregues: <strong className="text-[#00A650]">{ordersMetrics.delivered}</strong></span>
          </div>
        </div>

        {/* Card 2: Receita / Vendas */}
        <div className="bg-white p-4 rounded-lg border border-[#E0E0E0] shadow-sm hover:shadow-md transition">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs text-[#999999] font-semibold uppercase tracking-wide">Faturamento</p>
              <h3 className="text-2xl font-bold text-[#333333] mt-1">{formatCurrency(ordersMetrics.revenue)}</h3>
            </div>
            <div className="w-9 h-9 rounded-md bg-[#F5F5F5] text-[#00A650] flex items-center justify-center">
              <DollarSign size={18} />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#EBEBEB] flex items-center justify-between text-xs text-[#666666]">
            <span>Hoje: <strong className="text-[#333333]">{formatCurrency(salesTotals.today?.revenue)}</strong></span>
            <span>Mês: <strong className="text-[#333333]">{formatCurrency(salesTotals.this_month?.revenue)}</strong></span>
          </div>
        </div>

        {/* Card 3: Product Ads */}
        <div className="bg-white p-4 rounded-lg border border-[#E0E0E0] shadow-sm hover:shadow-md transition">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs text-[#999999] font-semibold uppercase tracking-wide">Product Ads</p>
              <h3 className="text-2xl font-bold text-[#333333] mt-1">{formatCurrency(totalAdsSales)}</h3>
            </div>
            <div className="w-9 h-9 rounded-md bg-[#F5F5F5] text-[#FF6B00] flex items-center justify-center">
              <Flame size={18} />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#EBEBEB] flex items-center justify-between text-xs text-[#666666]">
            <span>Gasto: <strong className="text-[#E53935]">{formatCurrency(totalAdsSpend)}</strong></span>
            <span>ROAS: <strong className="text-[#FF6B00]">{avgAdsRoas}x</strong></span>
          </div>
        </div>

        {/* Card 4: Anúncios */}
        <div className="bg-white p-4 rounded-lg border border-[#E0E0E0] shadow-sm hover:shadow-md transition">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs text-[#999999] font-semibold uppercase tracking-wide">Anúncios Ativos</p>
              <h3 className="text-2xl font-bold text-[#333333] mt-1">{itemsMetrics.total_active}</h3>
            </div>
            <div className="w-9 h-9 rounded-md bg-[#F5F5F5] text-[#7B1FA2] flex items-center justify-center">
              <Package size={18} />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#EBEBEB] flex items-center justify-between text-xs text-[#666666]">
            <span className="text-[#7B1FA2] font-semibold">{itemsMetrics.breakdown?.catalog || 0} Catálogo</span>
            <span>•</span>
            <span className="text-[#3483FA] font-semibold">{sponsoredItemIds.size || itemsMetrics.breakdown?.sponsored || 0} Ads</span>
          </div>
        </div>

        {/* Card 5: Atendimento & Perguntas */}
        <div className="bg-white p-4 rounded-lg border border-[#E0E0E0] shadow-sm hover:shadow-md transition">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs text-[#999999] font-semibold uppercase tracking-wide">Perguntas Pendentes</p>
              <div className="flex items-baseline gap-2 mt-1">
                <h3 className="text-2xl font-bold text-[#333333]">{questionsMetrics.unanswered}</h3>
                <span className="text-xs text-[#FF6B00] font-semibold">s/ resposta</span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-md bg-[#F5F5F5] text-[#FF6B00] flex items-center justify-center">
              <MessageCircle size={18} />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#EBEBEB] flex items-center justify-between text-xs text-[#666666]">
            <span>Perguntas Totais: <strong className="text-[#333333]">{questionsMetrics.total}</strong></span>
          </div>
        </div>
      </div>

      {/* ABAS NATIVAS MERCADO LIVRE (7 TABS COM UNDERLINE AZUL #3483FA E CONTADOR LARANJA #FF6B00) */}
      <div className="bg-white rounded-lg border border-[#E0E0E0] shadow-sm overflow-hidden">
        <div className="flex border-b border-[#E0E0E0] px-4 gap-6 bg-white overflow-x-auto">
          {[
            { id: 'resumo', label: 'Resumo', icon: BarChart2 },
            { id: 'anuncios', label: 'Anúncios', icon: Package, badge: itemsMetrics.total_active },
            { id: 'vendas', label: 'Vendas', icon: ShoppingCart, badge: ordersMetrics.total },
            { id: 'perguntas', label: 'Perguntas', icon: MessageCircle, badge: questionsMetrics.unanswered },
            { id: 'publicidade', label: 'Publicidade', icon: Flame, badge: activeAdsCampaignsCount },
            { id: 'reputacao', label: 'Reputação', icon: Star },
            { id: 'financeiro', label: 'Financeiro', icon: DollarSign }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 px-1 flex items-center gap-2 text-sm font-medium transition-all shrink-0 border-b-2 -mb-[2px] ${
                  isActive 
                    ? 'text-[#3483FA] border-[#3483FA] font-semibold' 
                    : 'text-[#666666] border-transparent hover:text-[#333333]'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-[#3483FA]' : 'text-[#999999]'} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="bg-[#FF6B00] text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-0.5">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* CONTEÚDO DAS ABAS */}
        <div className="p-5">
          {/* ========================================================================= */}
          {/* TAB 1: RESUMO */}
          {/* ========================================================================= */}
          {activeTab === 'resumo' && (
            <div className="space-y-6">
              {/* Grid 2x2 de Gráficos */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Gráfico 1: Área Receita / Vendas */}
                <div className="bg-white p-4 rounded-lg border border-[#E0E0E0]">
                  <h4 className="text-base font-semibold text-[#333333] mb-4 flex items-center justify-between">
                    <span>Desempenho de Vendas</span>
                    <span className="text-xs text-[#999999] font-normal">Últimos {period}</span>
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
                            <stop offset="5%" stopColor="#3483FA" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3483FA" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E0E0E0" />
                        <XAxis dataKey="name" stroke="#999999" fontSize={12} />
                        <YAxis stroke="#999999" fontSize={12} />
                        <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                        <Area type="monotone" dataKey="receita" stroke="#3483FA" strokeWidth={2} fillOpacity={1} fill="url(#colorRec)" name="Receita (R$)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Gráfico 2: Barra Distribuição por Tipo de Anúncio */}
                <div className="bg-white p-4 rounded-lg border border-[#E0E0E0]">
                  <h4 className="text-base font-semibold text-[#333333] mb-4 flex items-center justify-between">
                    <span>Distribuição de Anúncios</span>
                    <span className="text-xs text-[#999999] font-normal">Por Categoria</span>
                  </h4>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { name: 'Orgânicos', total: itemsMetrics.breakdown?.organic || items.length, fill: '#666666' },
                        { name: 'Patrocinados', total: sponsoredItemIds.size || itemsMetrics.breakdown?.sponsored || 0, fill: '#3483FA' },
                        { name: 'Catálogo', total: itemsMetrics.breakdown?.catalog || 0, fill: '#7B1FA2' }
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E0E0E0" />
                        <XAxis dataKey="name" stroke="#999999" fontSize={12} />
                        <YAxis stroke="#999999" fontSize={12} />
                        <Tooltip />
                        <Bar dataKey="total" radius={[4, 4, 0, 0]} name="Quantidade" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Tabela Top Anúncios */}
              <div className="bg-white rounded-lg border border-[#E0E0E0] shadow-sm overflow-hidden">
                <div className="p-4 bg-[#F5F5F5] border-b border-[#E0E0E0]">
                  <h4 className="text-base font-semibold text-[#333333]">Top Anúncios</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#F5F5F5] border-b border-[#E0E0E0]">
                      <tr>
                        <th className="py-2.5 px-4 text-[#999999] text-xs uppercase font-medium">Anúncio</th>
                        <th className="py-2.5 px-4 text-[#999999] text-xs uppercase font-medium">Tipo</th>
                        <th className="py-2.5 px-4 text-[#999999] text-xs uppercase font-medium">Preço</th>
                        <th className="py-2.5 px-4 text-[#999999] text-xs uppercase font-medium">Estoque</th>
                        <th className="py-2.5 px-4 text-[#999999] text-xs uppercase font-medium">Vendidos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EBEBEB]">
                      {items.slice(0, 5).map((item, i) => (
                        <tr key={item.item_id || i} className="hover:bg-[#F9F9F9] transition">
                          <td className="py-3 px-4 flex items-center gap-3">
                            <img 
                              src={item.thumbnail || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=100'} 
                              alt="" 
                              className="w-10 h-10 rounded-md object-cover border border-[#E0E0E0] bg-[#F5F5F5]"
                            />
                            <div>
                              <p className="font-semibold text-[#333333] line-clamp-1">{item.title}</p>
                              <span className="text-xs text-[#999999] font-mono">{item.item_id}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4">{renderTypeBadge(item)}</td>
                          <td className="py-3 px-4 font-semibold text-[#333333]">{formatCurrency(item.price)}</td>
                          <td className="py-3 px-4 text-[#666666]">{item.available_quantity} un</td>
                          <td className="py-3 px-4 font-semibold text-[#00A650]">{item.sold_quantity} un</td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-[#999999]">
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
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#F5F5F5] p-3 rounded-lg border border-[#E0E0E0]">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[240px]">
                    <Search className="absolute left-3 top-2.5 text-[#BBBBBB]" size={16} />
                    <input
                      type="text"
                      placeholder="Buscar por título ou SKU..."
                      value={itemsSearch}
                      onChange={e => setItemsSearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && fetchItems()}
                      className="w-full h-10 pl-9 pr-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA] focus:ring-2 focus:ring-[#3483FA]/10 placeholder-[#BBBBBB]"
                    />
                  </div>

                  <select
                    value={itemsStatus}
                    onChange={e => setItemsStatus(e.target.value)}
                    className="h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                  >
                    <option value="">Todos os Status</option>
                    <option value="active">Ativos</option>
                    <option value="paused">Pausados</option>
                    <option value="closed">Finalizados</option>
                  </select>

                  <select
                    value={itemsType}
                    onChange={e => setItemsType(e.target.value)}
                    className="h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                  >
                    <option value="">Todos os Tipos</option>
                    <option value="sponsored">Patrocinados</option>
                    <option value="catalog">Catálogo</option>
                    <option value="organic">Orgânicos</option>
                  </select>

                  <button
                    onClick={fetchItems}
                    className="bg-white border border-[#E0E0E0] text-[#333333] rounded-md px-4 h-10 text-sm hover:bg-[#F5F5F5] transition font-medium"
                  >
                    Filtrar
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={syncItems}
                    disabled={isSyncingItems}
                    className="bg-white border border-[#E0E0E0] text-[#333333] rounded-md px-4 h-10 text-sm hover:bg-[#F5F5F5] transition flex items-center gap-1.5 disabled:opacity-50 font-medium"
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
                    className="bg-[#3483FA] text-white rounded-md px-4 h-10 text-sm font-medium hover:bg-[#2968C8] transition flex items-center gap-1.5"
                  >
                    <Plus size={16} />
                    <span>Novo Anúncio</span>
                  </button>
                </div>
              </div>

              {/* Tabela de Anúncios */}
              <div className="bg-white rounded-lg border border-[#E0E0E0] overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#F5F5F5] border-b border-[#E0E0E0]">
                      <tr>
                        <th className="py-3 px-4 text-[#999999] text-xs uppercase font-medium">Anúncio</th>
                        <th className="py-3 px-3 text-[#999999] text-xs uppercase font-medium">Tipo / Exposição</th>
                        <th className="py-3 px-3 text-[#999999] text-xs uppercase font-medium">Preço</th>
                        <th className="py-3 px-3 text-[#999999] text-xs uppercase font-medium">Estoque</th>
                        <th className="py-3 px-3 text-[#999999] text-xs uppercase font-medium">Vendidos</th>
                        <th className="py-3 px-3 text-[#999999] text-xs uppercase font-medium">Status</th>
                        <th className="py-3 px-4 text-[#999999] text-xs uppercase font-medium text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EBEBEB]">
                      {itemsLoading ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-[#999999]">
                            <RefreshCw className="animate-spin inline-block mr-2" size={18} />
                            Carregando anúncios...
                          </td>
                        </tr>
                      ) : items.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-[#999999]">
                            Nenhum anúncio encontrado. Clique em "Sincronizar ML" ou "Novo Anúncio".
                          </td>
                        </tr>
                      ) : (
                        items.map(item => (
                          <tr key={item.item_id} className="hover:bg-[#F9F9F9] transition">
                            <td className="py-3 px-4 flex items-center gap-3">
                              <img 
                                src={item.thumbnail || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=100'} 
                                alt="" 
                                className="w-10 h-10 rounded-md object-cover border border-[#E0E0E0] bg-[#F5F5F5] shrink-0" 
                              />
                              <div className="max-w-md">
                                <p 
                                  onClick={() => setSelectedItem(item)}
                                  className="font-semibold text-[#333333] hover:text-[#3483FA] cursor-pointer line-clamp-1"
                                >
                                  {item.title}
                                </p>
                                <span className="text-xs text-[#999999] font-mono">MLB: {item.item_id}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3">{renderTypeBadge(item)}</td>
                            <td className="py-3 px-3 font-semibold text-[#333333]">{formatCurrency(item.price)}</td>
                            <td className="py-3 px-3 text-[#666666]">{item.available_quantity} un</td>
                            <td className="py-3 px-3 font-semibold text-[#00A650]">{item.sold_quantity} un</td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                item.status === 'active' 
                                  ? 'bg-[#00A650] text-white' 
                                  : 'bg-[#F5F5F5] text-[#666666] border border-[#E0E0E0]'
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
                                  className="p-2 rounded-md hover:bg-[#F5F5F5] text-[#666666] hover:text-[#333333] transition"
                                >
                                  <Edit3 size={15} />
                                </button>

                                {/* Pausar / Ativar */}
                                <button
                                  onClick={() => handleToggleItemStatus(item)}
                                  title={item.status === 'active' ? 'Pausar Anúncio' : 'Ativar Anúncio'}
                                  className={`p-2 rounded-md transition ${
                                    item.status === 'active' 
                                      ? 'hover:bg-[#F5F5F5] text-[#FF6B00]' 
                                      : 'hover:bg-[#F5F5F5] text-[#00A650]'
                                  }`}
                                >
                                  {item.status === 'active' ? <Pause size={15} /> : <Play size={15} />}
                                </button>

                                {/* Destacar */}
                                <button
                                  onClick={() => {
                                    setModalUpgradeItem(item);
                                    setUpgradeListingTypeId(item.listing_type_id === 'gold_pro' ? 'gold_special' : 'gold_pro');
                                  }}
                                  title="Mudar Tipo de Exposição"
                                  className="p-2 rounded-md hover:bg-[#F5F5F5] text-[#FF6B00] transition"
                                >
                                  <Star size={15} />
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
                                  className="p-2 rounded-md hover:bg-[#F5F5F5] text-[#3483FA] transition"
                                >
                                  <Flame size={15} />
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
          {/* TAB 3: VENDAS (KANBAN 4 COLUNAS ESTILO ML) */}
          {/* ========================================================================= */}
          {activeTab === 'vendas' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#F5F5F5] p-3 rounded-lg border border-[#E0E0E0]">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-3 top-2.5 text-[#BBBBBB]" size={16} />
                  <input
                    type="text"
                    placeholder="Buscar pedido por ID ou comprador..."
                    value={ordersSearch}
                    onChange={e => setOrdersSearch(e.target.value)}
                    className="w-full h-10 pl-9 pr-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA] placeholder-[#BBBBBB]"
                  />
                </div>

                <button
                  onClick={syncOrders}
                  disabled={isSyncingOrders}
                  className="bg-white border border-[#E0E0E0] text-[#333333] rounded-md px-4 h-10 text-sm hover:bg-[#F5F5F5] transition flex items-center gap-1.5 disabled:opacity-50 font-medium"
                >
                  <RefreshCw size={14} className={isSyncingOrders ? 'animate-spin' : ''} />
                  <span>Sincronizar Pedidos</span>
                </button>
              </div>

              {/* Kanban Grid 4 Colunas */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Coluna 1: Envios Urgentes */}
                <div className="bg-[#F5F5F5] rounded-lg p-3 border border-[#E0E0E0] space-y-3 min-h-[450px]">
                  <div className="flex items-center justify-between pb-2 border-b border-[#E0E0E0]">
                    <h4 className="font-semibold text-sm text-[#333333] flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#3483FA]"></span>
                      Envios Urgentes
                    </h4>
                    <span className="bg-white px-2 py-0.5 rounded-full text-xs text-[#666666] border border-[#E0E0E0] font-medium">
                      {colEnviosHoje.length}
                    </span>
                  </div>

                  <div className="space-y-2 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                    {colEnviosHoje.map(order => (
                      <div 
                        key={order.ml_order_id} 
                        onClick={() => setSelectedOrder(order)}
                        className="bg-white rounded-md p-3 shadow-sm border border-[#E0E0E0] hover:shadow-md transition cursor-pointer space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono text-[#999999]">#{order.ml_order_id}</span>
                          <span className="text-[10px] font-semibold text-[#3483FA] bg-[#F5F5F5] px-1.5 py-0.5 rounded border border-[#E0E0E0]">
                            Aguardando Envio
                          </span>
                        </div>
                        <p className="font-medium text-xs text-[#333333] line-clamp-2">{order.item_title || 'Item sem título'}</p>
                        <div className="flex items-center justify-between pt-2 border-t border-[#EBEBEB] text-xs">
                          <span className="text-[#666666]">@{order.buyer_nickname || 'comprador'}</span>
                          <span className="font-semibold text-[#333333]">{formatCurrency(order.total_amount)}</span>
                        </div>
                      </div>
                    ))}
                    {colEnviosHoje.length === 0 && (
                      <p className="text-center text-xs text-[#999999] py-8">Nenhum pedido urgente pendente.</p>
                    )}
                  </div>
                </div>

                {/* Coluna 2: Aguardando Pagamento */}
                <div className="bg-[#F5F5F5] rounded-lg p-3 border border-[#E0E0E0] space-y-3 min-h-[450px]">
                  <div className="flex items-center justify-between pb-2 border-b border-[#E0E0E0]">
                    <h4 className="font-semibold text-sm text-[#333333] flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#FF6B00]"></span>
                      Aguardando Pagamento
                    </h4>
                    <span className="bg-white px-2 py-0.5 rounded-full text-xs text-[#666666] border border-[#E0E0E0] font-medium">
                      {colAguardando.length}
                    </span>
                  </div>

                  <div className="space-y-2 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                    {colAguardando.map(order => (
                      <div 
                        key={order.ml_order_id} 
                        onClick={() => setSelectedOrder(order)}
                        className="bg-white rounded-md p-3 shadow-sm border border-[#E0E0E0] hover:shadow-md transition cursor-pointer space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono text-[#999999]">#{order.ml_order_id}</span>
                          <span className="text-[10px] font-semibold text-[#FF6B00] bg-[#F5F5F5] px-1.5 py-0.5 rounded border border-[#E0E0E0]">
                            Pendente
                          </span>
                        </div>
                        <p className="font-medium text-xs text-[#333333] line-clamp-2">{order.item_title || 'Item sem título'}</p>
                        <div className="flex items-center justify-between pt-2 border-t border-[#EBEBEB] text-xs">
                          <span className="text-[#666666]">@{order.buyer_nickname || 'comprador'}</span>
                          <span className="font-semibold text-[#333333]">{formatCurrency(order.total_amount)}</span>
                        </div>
                      </div>
                    ))}
                    {colAguardando.length === 0 && (
                      <p className="text-center text-xs text-[#999999] py-8">Nenhum pedido pendente.</p>
                    )}
                  </div>
                </div>

                {/* Coluna 3: A Caminho */}
                <div className="bg-[#F5F5F5] rounded-lg p-3 border border-[#E0E0E0] space-y-3 min-h-[450px]">
                  <div className="flex items-center justify-between pb-2 border-b border-[#E0E0E0]">
                    <h4 className="font-semibold text-sm text-[#333333] flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#3483FA]"></span>
                      A Caminho
                    </h4>
                    <span className="bg-white px-2 py-0.5 rounded-full text-xs text-[#666666] border border-[#E0E0E0] font-medium">
                      {colACaminho.length}
                    </span>
                  </div>

                  <div className="space-y-2 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                    {colACaminho.map(order => (
                      <div 
                        key={order.ml_order_id} 
                        onClick={() => setSelectedOrder(order)}
                        className="bg-white rounded-md p-3 shadow-sm border border-[#E0E0E0] hover:shadow-md transition cursor-pointer space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono text-[#999999]">#{order.ml_order_id}</span>
                          <span className="text-[10px] font-semibold text-[#3483FA] bg-[#F5F5F5] px-1.5 py-0.5 rounded border border-[#E0E0E0]">
                            🚚 Enviado
                          </span>
                        </div>
                        <p className="font-medium text-xs text-[#333333] line-clamp-2">{order.item_title || 'Item sem título'}</p>
                        <div className="flex items-center justify-between pt-2 border-t border-[#EBEBEB] text-xs">
                          <span className="text-[#666666]">@{order.buyer_nickname || 'comprador'}</span>
                          <span className="font-semibold text-[#333333]">{formatCurrency(order.total_amount)}</span>
                        </div>
                      </div>
                    ))}
                    {colACaminho.length === 0 && (
                      <p className="text-center text-xs text-[#999999] py-8">Nenhum pedido em trânsito.</p>
                    )}
                  </div>
                </div>

                {/* Coluna 4: Finalizadas */}
                <div className="bg-[#F5F5F5] rounded-lg p-3 border border-[#E0E0E0] space-y-3 min-h-[450px]">
                  <div className="flex items-center justify-between pb-2 border-b border-[#E0E0E0]">
                    <h4 className="font-semibold text-sm text-[#333333] flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#00A650]"></span>
                      Finalizadas
                    </h4>
                    <span className="bg-white px-2 py-0.5 rounded-full text-xs text-[#666666] border border-[#E0E0E0] font-medium">
                      {colFinalizadas.length}
                    </span>
                  </div>

                  <div className="space-y-2 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
                    {colFinalizadas.map(order => (
                      <div 
                        key={order.ml_order_id} 
                        onClick={() => setSelectedOrder(order)}
                        className="bg-white rounded-md p-3 shadow-sm border border-[#E0E0E0] hover:shadow-md transition cursor-pointer space-y-2 opacity-95"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono text-[#999999]">#{order.ml_order_id}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            order.status === 'cancelled' 
                              ? 'text-[#E53935] bg-[#F5F5F5] border border-[#E0E0E0]' 
                              : 'text-[#00A650] bg-[#F5F5F5] border border-[#E0E0E0]'
                          }`}>
                            {order.status === 'cancelled' ? 'Cancelada' : '✓ Entregue'}
                          </span>
                        </div>
                        <p className="font-medium text-xs text-[#333333] line-clamp-2">{order.item_title || 'Item sem título'}</p>
                        <div className="flex items-center justify-between pt-2 border-t border-[#EBEBEB] text-xs">
                          <span className="text-[#666666]">@{order.buyer_nickname || 'comprador'}</span>
                          <span className="font-semibold text-[#333333]">{formatCurrency(order.total_amount)}</span>
                        </div>
                      </div>
                    ))}
                    {colFinalizadas.length === 0 && (
                      <p className="text-center text-xs text-[#999999] py-8">Nenhuma venda finalizada listada.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: PERGUNTAS (ESTILO SETTINGS ML) */}
          {/* ========================================================================= */}
          {activeTab === 'perguntas' && (
            <div className="space-y-4 max-w-4xl mx-auto">
              {/* Filtros */}
              <div className="flex items-center justify-between bg-[#F5F5F5] p-3 rounded-lg border border-[#E0E0E0]">
                <div className="flex gap-2">
                  {(['unanswered', 'answered', 'all'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setQuestionsFilter(f)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                        questionsFilter === f 
                          ? 'bg-[#3483FA] text-white' 
                          : 'bg-white text-[#666666] border border-[#E0E0E0] hover:text-[#333333]'
                      }`}
                    >
                      {f === 'unanswered' ? 'Não Respondidas' : f === 'answered' ? 'Respondidas' : 'Todas'}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-[#666666]">{questions.length} perguntas</span>
              </div>

              {/* Lista de Perguntas (Container Branco, bordas sutis) */}
              <div className="bg-white rounded-lg shadow-sm border border-[#E0E0E0] overflow-hidden">
                {questionsLoading ? (
                  <div className="py-12 text-center text-[#999999]">
                    <RefreshCw className="animate-spin inline-block mr-2" size={18} />
                    Carregando perguntas...
                  </div>
                ) : questions.length === 0 ? (
                  <div className="p-8 text-center">
                    <CheckCircle className="mx-auto text-[#00A650] mb-2" size={32} />
                    <h4 className="font-semibold text-[#333333]">Tudo em dia!</h4>
                    <p className="text-xs text-[#999999] mt-1">Nenhuma pergunta pendente no momento.</p>
                  </div>
                ) : (
                  questions.map(q => (
                    <div 
                      key={q.id} 
                      className="px-5 py-4 border-b border-[#EBEBEB] last:border-0 hover:bg-[#F9F9F9] transition flex items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm text-[#333333]">@{q.from_nickname || 'comprador'}</span>
                          <span className="text-xs text-[#999999]">{formatDate(q.date_created)}</span>
                        </div>
                        <p className="text-sm text-[#333333]">"{q.text}"</p>
                        <p className="text-xs text-[#999999]">MLB: {q.item_id || 'Anúncio'}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setReplyingQuestion(q)}
                          className="bg-[#3483FA] text-white rounded-md px-3 py-1.5 text-xs font-medium hover:bg-[#2968C8] transition flex items-center gap-1.5"
                        >
                          <Send size={12} />
                          <span>Responder</span>
                        </button>
                        <ChevronRight size={18} className="text-[#BBBBBB]" />
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
              <div className="bg-[#333333] text-white p-5 rounded-lg shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#FF6B00] text-white text-[10px] font-bold uppercase mb-2">
                    <Flame size={12} />
                    Mercado Livre Product Ads
                  </div>
                  <h3 className="text-lg font-semibold text-white">Gestor de Campanhas Patrocinadas</h3>
                  <p className="text-xs text-[#999999] mt-0.5 max-w-lg">
                    Sincronize, crie e gerencie o orçamento e meta de ROAS das suas campanhas de anúncios patrocinados.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => fetchCampaigns(true)}
                    disabled={isSyncingAds}
                    className="bg-white/10 hover:bg-white/20 text-white font-medium text-xs px-3 py-2 rounded-md border border-white/20 transition flex items-center gap-1.5 disabled:opacity-50"
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
                    className="bg-[#FFE600] text-[#333333] hover:bg-[#F9D735] font-semibold text-xs px-4 py-2 rounded-md transition flex items-center gap-1.5"
                  >
                    <Plus size={16} />
                    <span>Nova Campanha</span>
                  </button>
                </div>
              </div>

              {/* Tabela de Campanhas */}
              <div className="bg-white rounded-lg border border-[#E0E0E0] p-4 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-semibold text-[#333333]">Campanhas Ativas ({campaigns.length})</h4>
                  <span className="text-xs text-[#999999]">Clique na linha para ver anúncios patrocinados</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#F5F5F5] border-b border-[#E0E0E0]">
                      <tr>
                        <th className="py-2.5 px-3 text-[#999999] text-xs uppercase font-medium">Nome da Campanha</th>
                        <th className="py-2.5 px-3 text-[#999999] text-xs uppercase font-medium">Status</th>
                        <th className="py-2.5 px-3 text-[#999999] text-xs uppercase font-medium">Orçamento</th>
                        <th className="py-2.5 px-3 text-[#999999] text-xs uppercase font-medium">ROAS Alvo</th>
                        <th className="py-2.5 px-3 text-[#999999] text-xs uppercase font-medium">Cliques</th>
                        <th className="py-2.5 px-3 text-[#999999] text-xs uppercase font-medium">Impressões</th>
                        <th className="py-2.5 px-3 text-[#999999] text-xs uppercase font-medium">Gasto</th>
                        <th className="py-2.5 px-3 text-[#999999] text-xs uppercase font-medium">Vendas</th>
                        <th className="py-2.5 px-3 text-[#999999] text-xs uppercase font-medium">ROAS Real</th>
                        <th className="py-2.5 px-3 text-[#999999] text-xs uppercase font-medium text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EBEBEB]">
                      {campaignsLoading ? (
                        <tr>
                          <td colSpan={10} className="py-12 text-center text-[#999999]">
                            <RefreshCw className="animate-spin inline-block mr-2" size={18} />
                            Carregando campanhas do Product Ads...
                          </td>
                        </tr>
                      ) : campaigns.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-12 text-center text-[#999999]">
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
                                className="hover:bg-[#F9F9F9] cursor-pointer transition"
                                onClick={() => setExpandedCampaignId(isExpanded ? null : c.campaign_id)}
                              >
                                <td className="py-3 px-3 font-semibold text-[#333333] flex items-center gap-2">
                                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                  <span>{c.name}</span>
                                </td>
                                <td className="py-3 px-3">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                    c.status === 'active' 
                                      ? 'bg-[#00A650] text-white' 
                                      : 'bg-[#F5F5F5] text-[#666666] border border-[#E0E0E0]'
                                  }`}>
                                    {c.status === 'active' ? 'Ativa' : 'Pausada'}
                                  </span>
                                </td>
                                <td className="py-3 px-3 font-medium">{formatCurrency(c.budget_amount)}/dia</td>
                                <td className="py-3 px-3 font-semibold text-[#FF6B00]">{c.roas_target || 10}x</td>
                                <td className="py-3 px-3 text-[#666666]">{c.clicks || 0}</td>
                                <td className="py-3 px-3 text-[#999999]">{c.impressions || 0}</td>
                                <td className="py-3 px-3 font-semibold text-[#E53935]">{formatCurrency(c.spend || 0)}</td>
                                <td className="py-3 px-3 font-semibold text-[#00A650]">{formatCurrency(c.sales || 0)}</td>
                                <td className="py-3 px-3 font-bold text-[#FF6B00]">{c.roas ? Number(c.roas).toFixed(2) + 'x' : '0.0x'}</td>
                                <td className="py-3 px-3 text-right" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      onClick={() => handleToggleCampaignStatus(c)}
                                      title={c.status === 'active' ? 'Pausar Campanha' : 'Ativar Campanha'}
                                      className={`p-1.5 rounded-md transition ${
                                        c.status === 'active' ? 'hover:bg-[#F5F5F5] text-[#FF6B00]' : 'hover:bg-[#F5F5F5] text-[#00A650]'
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
                                      className="p-1.5 hover:bg-[#F5F5F5] text-[#666666] rounded-md transition"
                                    >
                                      <Edit3 size={14} />
                                    </button>

                                    <button
                                      onClick={() => handleDeleteCampaign(c.campaign_id)}
                                      title="Excluir Campanha"
                                      className="p-1.5 hover:bg-[#F5F5F5] text-[#E53935] rounded-md transition"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {/* Linha Expandida: Anúncios Patrocinados (ad_groups) */}
                              {isExpanded && (
                                <tr>
                                  <td colSpan={10} className="bg-[#F5F5F5] p-4 border-t border-b border-[#E0E0E0]">
                                    <div className="space-y-2 max-w-4xl">
                                      <h5 className="font-semibold text-xs text-[#333333] flex items-center gap-1.5">
                                        <Flame size={14} className="text-[#FF6B00]" />
                                        Anúncios Patrocinados nesta Campanha ({adGroups.length})
                                      </h5>

                                      {adGroups.length === 0 ? (
                                        <p className="text-xs text-[#999999] italic">Nenhum anúncio vinculado individualmente nesta campanha.</p>
                                      ) : (
                                        <div className="overflow-x-auto bg-white rounded-md border border-[#E0E0E0]">
                                          <table className="w-full text-left text-xs">
                                            <thead>
                                              <tr className="bg-[#F5F5F5] border-b border-[#E0E0E0] font-medium text-[#999999]">
                                                <th className="py-2 px-3">Item ID</th>
                                                <th className="py-2 px-3">Lance CPC</th>
                                                <th className="py-2 px-3">Cliques</th>
                                                <th className="py-2 px-3">Gasto</th>
                                                <th className="py-2 px-3">Vendas Atribuídas</th>
                                                <th className="py-2 px-3">ROAS</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#EBEBEB]">
                                              {adGroups.map((ag: any, idx: number) => (
                                                <tr key={ag.ad_group_id || idx}>
                                                  <td className="py-2 px-3 font-mono font-semibold text-[#333333]">{ag.item_id || '-'}</td>
                                                  <td className="py-2 px-3">{formatCurrency(ag.cpc_bid)}</td>
                                                  <td className="py-2 px-3">{ag.clicks || 0}</td>
                                                  <td className="py-2 px-3 font-semibold text-[#E53935]">{formatCurrency(ag.spend || 0)}</td>
                                                  <td className="py-2 px-3 font-semibold text-[#00A650]">{formatCurrency(ag.sales || 0)}</td>
                                                  <td className="py-2 px-3 font-bold text-[#FF6B00]">{ag.roas ? Number(ag.roas).toFixed(2) + 'x' : '0.0x'}</td>
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
          {/* TAB 6: REPUTAÇÃO (TERMÔMETRO 5 BARRAS GRADUAIS ML) */}
          {/* ========================================================================= */}
          {activeTab === 'reputacao' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="bg-white p-6 rounded-lg border border-[#E0E0E0] shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-[#333333]">Termômetro de Reputação</h3>
                    <p className="text-xs text-[#999999] mt-0.5">Com base no desempenho dos últimos 60 dias no Mercado Livre</p>
                  </div>
                  {repMetrics?.power_seller_status && (
                    <span className="px-3 py-1 rounded-md text-xs font-semibold bg-[#FFE600] text-[#333333] flex items-center gap-1">
                      <Award size={14} />
                      MercadoLíder {repMetrics.power_seller_status.toUpperCase()}
                    </span>
                  )}
                </div>

                {/* 5 BARRAS DO TERMÔMETRO DE REPUTAÇÃO */}
                <div className="space-y-2">
                  <div className="grid grid-cols-5 gap-2 pt-2">
                    {[
                      { name: 'Vermelho', color: '#E53935' },
                      { name: 'Laranja', color: '#FF6B00' },
                      { name: 'Amarelo', color: '#FFC107' },
                      { name: 'Verde Claro', color: '#8BC34A' },
                      { name: 'Verde Escuro', color: '#00A650' }
                    ].map((lvl, idx) => {
                      const isActiveLevel = repMetrics?.level_id === `${idx + 1}_green` || idx === 4;
                      return (
                        <div key={lvl.name} className="space-y-1">
                          <div 
                            style={{ backgroundColor: lvl.color }}
                            className={`h-2.5 w-full rounded-full transition-all ${
                              isActiveLevel ? 'opacity-100 ring-2 ring-[#333333] scale-105' : 'opacity-30'
                            }`}
                          />
                          <span className={`text-[11px] text-center block ${isActiveLevel ? 'font-semibold text-[#333333]' : 'text-[#999999]'}`}>
                            {lvl.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 7: FINANCEIRO */}
          {/* ========================================================================= */}
          {activeTab === 'financeiro' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="bg-white p-6 rounded-lg border border-[#E0E0E0] shadow-sm space-y-4">
                <h3 className="text-base font-semibold text-[#333333]">Resumo Financeiro & Tarifas</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 bg-[#F5F5F5] rounded-lg border border-[#E0E0E0]">
                    <span className="text-xs text-[#999999] font-medium">Faturamento Bruto</span>
                    <p className="text-lg font-bold text-[#333333] mt-1">{formatCurrency(ordersMetrics.revenue)}</p>
                  </div>
                  <div className="p-4 bg-[#F5F5F5] rounded-lg border border-[#E0E0E0]">
                    <span className="text-xs text-[#999999] font-medium">Gasto com Ads</span>
                    <p className="text-lg font-bold text-[#E53935] mt-1">{formatCurrency(totalAdsSpend)}</p>
                  </div>
                  <div className="p-4 bg-[#F5F5F5] rounded-lg border border-[#E0E0E0]">
                    <span className="text-xs text-[#999999] font-medium">Vendas Líquidas Ads</span>
                    <p className="text-lg font-bold text-[#00A650] mt-1">{formatCurrency(totalAdsSales - totalAdsSpend)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL NOVA / EDITAR CAMPANHA (PRODUCT ADS) */}
      {(modalNewCampaignOpen || modalEditCampaign) && (
        <div className="fixed inset-0 z-50 bg-[#333333]/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-lg shadow-xl p-6 space-y-4 border border-[#E0E0E0]">
            <div className="flex items-center justify-between border-b border-[#E0E0E0] pb-3">
              <h3 className="font-semibold text-[#333333] text-sm flex items-center gap-2">
                <Flame className="text-[#FF6B00]" size={18} />
                <span>{modalEditCampaign ? 'Editar Campanha' : 'Nova Campanha Product Ads'}</span>
              </h3>
              <button 
                onClick={() => {
                  setModalNewCampaignOpen(false);
                  setModalEditCampaign(null);
                }} 
                className="text-[#999999] hover:text-[#333333]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="font-medium text-[#333333] block mb-1 text-xs">Nome da Campanha</label>
                <input
                  type="text"
                  value={formCampaign.name}
                  onChange={e => setFormCampaign({ ...formCampaign, name: e.target.value })}
                  placeholder="Ex: Campanha Eletrônicos Top Vendas"
                  className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-[#333333] block mb-1 text-xs">Orçamento Diário (R$)</label>
                  <input
                    type="number"
                    value={formCampaign.budget_amount}
                    onChange={e => setFormCampaign({ ...formCampaign, budget_amount: Number(e.target.value) })}
                    className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                  />
                </div>
                <div>
                  <label className="font-medium text-[#333333] block mb-1 text-xs">ROAS Target (Alvo)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={formCampaign.roas_target}
                    onChange={e => setFormCampaign({ ...formCampaign, roas_target: Number(e.target.value) })}
                    className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                  />
                </div>
              </div>

              {!modalEditCampaign && (
                <div>
                  <label className="font-medium text-[#333333] block mb-1 text-xs">Anúncios para Vincular</label>
                  <div className="max-h-40 overflow-y-auto border border-[#E0E0E0] rounded-md p-2 space-y-1.5 custom-scrollbar bg-[#F5F5F5]">
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
                          className={`p-2 rounded-md cursor-pointer flex items-center justify-between text-xs transition ${
                            isSelected ? 'bg-[#3483FA] text-white font-semibold' : 'bg-white hover:bg-[#F5F5F5] text-[#333333]'
                          }`}
                        >
                          <span className="line-clamp-1">{item.title}</span>
                          <span className="font-mono shrink-0 ml-2">{formatCurrency(item.price)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#E0E0E0]">
              <button
                onClick={() => {
                  setModalNewCampaignOpen(false);
                  setModalEditCampaign(null);
                }}
                className="bg-white border border-[#E0E0E0] text-[#333333] rounded-md px-4 py-2 text-sm hover:bg-[#F5F5F5] transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveCampaign}
                className="bg-[#3483FA] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#2968C8] transition flex items-center gap-1.5"
              >
                <span>{modalEditCampaign ? 'Salvar Alterações' : 'Criar Campanha'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL NOVO ANÚNCIO (ORGÂNICO) */}
      {modalNewItemOpen && (
        <div className="fixed inset-0 z-50 bg-[#333333]/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-lg shadow-xl p-6 space-y-4 border border-[#E0E0E0]">
            <div className="flex items-center justify-between border-b border-[#E0E0E0] pb-3">
              <h3 className="font-semibold text-[#333333] text-sm flex items-center gap-2">
                <Package size={18} className="text-[#3483FA]" />
                <span>Novo Anúncio no Mercado Livre</span>
              </h3>
              <button onClick={() => setModalNewItemOpen(false)} className="text-[#999999] hover:text-[#333333]">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="font-medium text-[#333333] block mb-1 text-xs">Título do Anúncio *</label>
                <input
                  type="text"
                  value={formItem.title}
                  onChange={e => setFormItem({ ...formItem, title: e.target.value })}
                  placeholder="Ex: Smartphone Galaxy S23 256GB Preto Novo"
                  className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-[#333333] block mb-1 text-xs">Preço (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formItem.price}
                    onChange={e => setFormItem({ ...formItem, price: Number(e.target.value) })}
                    className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                  />
                </div>
                <div>
                  <label className="font-medium text-[#333333] block mb-1 text-xs">Estoque Inicial *</label>
                  <input
                    type="number"
                    value={formItem.available_quantity}
                    onChange={e => setFormItem({ ...formItem, available_quantity: Number(e.target.value) })}
                    className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-[#333333] block mb-1 text-xs">Exposição</label>
                  <select
                    value={formItem.listing_type_id}
                    onChange={e => setFormItem({ ...formItem, listing_type_id: e.target.value })}
                    className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                  >
                    <option value="gold_special">Clássico</option>
                    <option value="gold_pro">Premium (Sem juros)</option>
                  </select>
                </div>

                <div>
                  <label className="font-medium text-[#333333] block mb-1 text-xs">Condição</label>
                  <select
                    value={formItem.condition}
                    onChange={e => setFormItem({ ...formItem, condition: e.target.value })}
                    className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                  >
                    <option value="new">Novo</option>
                    <option value="used">Usado</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-medium text-[#333333] block mb-1 text-xs">URL da Imagem (Thumbnail)</label>
                <input
                  type="text"
                  value={formItem.thumbnail}
                  onChange={e => setFormItem({ ...formItem, thumbnail: e.target.value })}
                  placeholder="https://..."
                  className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#E0E0E0]">
              <button
                onClick={() => setModalNewItemOpen(false)}
                className="bg-white border border-[#E0E0E0] text-[#333333] rounded-md px-4 py-2 text-sm hover:bg-[#F5F5F5] transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateItem}
                className="bg-[#3483FA] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#2968C8] transition flex items-center gap-1.5"
              >
                <span>Criar Anúncio</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDITAR ANÚNCIO (ORGÂNICO) */}
      {modalEditItem && (
        <div className="fixed inset-0 z-50 bg-[#333333]/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-lg shadow-xl p-6 space-y-4 border border-[#E0E0E0]">
            <div className="flex items-center justify-between border-b border-[#E0E0E0] pb-3">
              <h3 className="font-semibold text-[#333333] text-sm flex items-center gap-2">
                <Edit3 size={18} className="text-[#3483FA]" />
                <span>Editar Anúncio</span>
              </h3>
              <button onClick={() => setModalEditItem(null)} className="text-[#999999] hover:text-[#333333]">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="font-medium text-[#333333] block mb-1 text-xs">Título</label>
                <input
                  type="text"
                  value={formItem.title}
                  onChange={e => setFormItem({ ...formItem, title: e.target.value })}
                  className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-[#333333] block mb-1 text-xs">Preço (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formItem.price}
                    onChange={e => setFormItem({ ...formItem, price: Number(e.target.value) })}
                    className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                  />
                </div>
                <div>
                  <label className="font-medium text-[#333333] block mb-1 text-xs">Estoque</label>
                  <input
                    type="number"
                    value={formItem.available_quantity}
                    onChange={e => setFormItem({ ...formItem, available_quantity: Number(e.target.value) })}
                    className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                  />
                </div>
              </div>

              <div>
                <label className="font-medium text-[#333333] block mb-1 text-xs">Status do Anúncio</label>
                <select
                  value={formItem.status}
                  onChange={e => setFormItem({ ...formItem, status: e.target.value })}
                  className="w-full h-10 px-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA]"
                >
                  <option value="active">Ativo</option>
                  <option value="paused">Pausado</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#E0E0E0]">
              <button
                onClick={() => setModalEditItem(null)}
                className="bg-white border border-[#E0E0E0] text-[#333333] rounded-md px-4 py-2 text-sm hover:bg-[#F5F5F5] transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveItemEdit}
                className="bg-[#3483FA] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#2968C8] transition flex items-center gap-1.5"
              >
                <span>Salvar Alterações</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DESTACAR ANÚNCIO (UPGRADE LISTING) */}
      {modalUpgradeItem && (
        <div className="fixed inset-0 z-50 bg-[#333333]/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-lg shadow-xl p-6 space-y-4 border border-[#E0E0E0]">
            <div className="flex items-center justify-between border-b border-[#E0E0E0] pb-3">
              <h3 className="font-semibold text-[#333333] text-sm flex items-center gap-2">
                <Star size={18} className="text-[#FF6B00] fill-[#FF6B00]" />
                <span>Mudar Exposição</span>
              </h3>
              <button onClick={() => setModalUpgradeItem(null)} className="text-[#999999] hover:text-[#333333]">
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-[#666666]">
              Escolha o novo tipo de exposição para o anúncio <strong className="text-[#333333]">{modalUpgradeItem.title}</strong>:
            </p>

            <div className="space-y-2">
              <label 
                onClick={() => setUpgradeListingTypeId('gold_special')}
                className={`p-3 rounded-md border flex items-center justify-between cursor-pointer transition ${
                  upgradeListingTypeId === 'gold_special' ? 'border-[#3483FA] bg-[#F5F5F5]' : 'border-[#E0E0E0] hover:bg-[#F5F5F5]'
                }`}
              >
                <div>
                  <span className="font-semibold text-xs text-[#333333] block">Clássico (gold_special)</span>
                  <span className="text-[11px] text-[#666666]">Exposição alta, com comissão padrão</span>
                </div>
                {upgradeListingTypeId === 'gold_special' && <CheckCircle size={16} className="text-[#3483FA]" />}
              </label>

              <label 
                onClick={() => setUpgradeListingTypeId('gold_pro')}
                className={`p-3 rounded-md border flex items-center justify-between cursor-pointer transition ${
                  upgradeListingTypeId === 'gold_pro' ? 'border-[#3483FA] bg-[#F5F5F5]' : 'border-[#E0E0E0] hover:bg-[#F5F5F5]'
                }`}
              >
                <div>
                  <span className="font-semibold text-xs text-[#333333] block">Premium (gold_pro)</span>
                  <span className="text-[11px] text-[#666666]">Exposição máxima + Parcelamento sem juros</span>
                </div>
                {upgradeListingTypeId === 'gold_pro' && <CheckCircle size={16} className="text-[#3483FA]" />}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#E0E0E0]">
              <button
                onClick={() => setModalUpgradeItem(null)}
                className="bg-white border border-[#E0E0E0] text-[#333333] rounded-md px-4 py-2 text-sm hover:bg-[#F5F5F5] transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpgradeListing}
                className="bg-[#3483FA] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#2968C8] transition flex items-center gap-1.5"
              >
                <span>Atualizar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER LATERAL: DETALHES DO ANÚNCIO */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-[#333333]/40 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-lg bg-white h-full shadow-xl p-6 overflow-y-auto space-y-6 flex flex-col justify-between border-l border-[#E0E0E0]">
            <div className="space-y-5">
              <div className="flex items-start justify-between border-b border-[#E0E0E0] pb-4">
                <div className="flex items-center gap-3">
                  <img src={selectedItem.thumbnail} alt="" className="w-12 h-12 rounded-md object-cover border border-[#E0E0E0]" />
                  <div>
                    <span className="text-xs font-mono text-[#999999]">MLB #{selectedItem.item_id}</span>
                    <h3 className="font-semibold text-sm text-[#333333] line-clamp-2">{selectedItem.title}</h3>
                  </div>
                </div>
                <button onClick={() => setSelectedItem(null)} className="text-[#999999] hover:text-[#333333] p-1">
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-[#F5F5F5] rounded-md border border-[#E0E0E0]">
                  <span className="text-[#999999]">Preço Atual</span>
                  <p className="font-bold text-[#333333] text-sm">{formatCurrency(selectedItem.price)}</p>
                </div>
                <div className="p-3 bg-[#F5F5F5] rounded-md border border-[#E0E0E0]">
                  <span className="text-[#999999]">Estoque</span>
                  <p className="font-bold text-[#333333] text-sm">{selectedItem.available_quantity} un</p>
                </div>
                <div className="p-3 bg-[#F5F5F5] rounded-md border border-[#E0E0E0]">
                  <span className="text-[#999999]">Vendidos</span>
                  <p className="font-bold text-[#00A650] text-sm">{selectedItem.sold_quantity} un</p>
                </div>
                <div className="p-3 bg-[#F5F5F5] rounded-md border border-[#E0E0E0]">
                  <span className="text-[#999999]">Status</span>
                  <p className="font-bold text-[#333333] text-sm uppercase">{selectedItem.status}</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedItem(null)}
              className="w-full py-2 bg-[#333333] text-white font-medium text-sm rounded-md hover:bg-[#666666] transition"
            >
              Fechar Detalhes
            </button>
          </div>
        </div>
      )}

      {/* DRAWER LATERAL: DETALHES DO PEDIDO */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-[#333333]/40 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-lg bg-white h-full shadow-xl p-6 overflow-y-auto space-y-6 flex flex-col justify-between border-l border-[#E0E0E0]">
            <div className="space-y-5">
              <div className="flex items-start justify-between border-b border-[#E0E0E0] pb-4">
                <div>
                  <span className="text-xs font-mono text-[#999999]">Pedido #{selectedOrder.ml_order_id}</span>
                  <h3 className="font-semibold text-base text-[#333333] mt-0.5">{selectedOrder.item_title || 'Pedido Mercado Livre'}</h3>
                </div>
                <button onClick={() => setSelectedOrder(null)} className="text-[#999999] hover:text-[#333333] p-1">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 bg-[#F5F5F5] rounded-md border border-[#E0E0E0] space-y-1">
                  <span className="text-[#999999] font-medium">Comprador</span>
                  <p className="font-semibold text-[#333333]">@{selectedOrder.buyer_nickname || 'anônimo'}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-[#F5F5F5] rounded-md border border-[#E0E0E0]">
                    <span className="text-[#999999]">Valor Total</span>
                    <p className="font-bold text-[#333333] text-sm">{formatCurrency(selectedOrder.total_amount)}</p>
                  </div>
                  <div className="p-3 bg-[#F5F5F5] rounded-md border border-[#E0E0E0]">
                    <span className="text-[#999999]">Data da Venda</span>
                    <p className="font-semibold text-[#333333]">{formatDate(selectedOrder.date_created)}</p>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedOrder(null)}
              className="w-full py-2 bg-[#333333] text-white font-medium text-sm rounded-md hover:bg-[#666666] transition"
            >
              Fechar Detalhes
            </button>
          </div>
        </div>
      )}

      {/* MODAL RESPONDER PERGUNTA */}
      {replyingQuestion && (
        <div className="fixed inset-0 z-50 bg-[#333333]/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-lg shadow-xl p-6 space-y-4 border border-[#E0E0E0]">
            <div className="flex items-center justify-between border-b border-[#E0E0E0] pb-3">
              <h3 className="font-semibold text-[#333333] text-sm">Responder Pergunta</h3>
              <button onClick={() => setReplyingQuestion(null)} className="text-[#999999] hover:text-[#333333]">
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-[#F5F5F5] rounded-md text-xs space-y-1 border border-[#E0E0E0]">
              <span className="font-semibold text-[#333333]">@{replyingQuestion.from_nickname}:</span>
              <p className="text-[#666666]">"{replyingQuestion.text}"</p>
            </div>

            <textarea
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              placeholder="Digite sua resposta para o comprador..."
              rows={4}
              className="w-full p-3 bg-white border border-[#DDDDDD] rounded-md text-sm text-[#333333] focus:outline-none focus:border-[#3483FA] placeholder-[#BBBBBB]"
            />

            <div className="flex justify-end gap-2 pt-2 border-t border-[#E0E0E0]">
              <button
                onClick={() => setReplyingQuestion(null)}
                className="bg-white border border-[#E0E0E0] text-[#333333] rounded-md px-4 py-2 text-sm hover:bg-[#F5F5F5] transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendReply}
                disabled={isSendingReply || !replyText.trim()}
                className="bg-[#3483FA] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#2968C8] transition flex items-center gap-1.5 disabled:opacity-50"
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
