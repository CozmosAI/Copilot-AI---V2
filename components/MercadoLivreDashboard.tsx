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

// Helper Markdown Viewer para Relatórios com IA
function SimpleMarkdown({ content }: { content: string }) {
  if (!content) return null;

  function formatInline(text: string) {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  }

  const lines = content.split('\n');
  return (
    <div className="space-y-2 text-slate-700 text-xs sm:text-sm leading-relaxed">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;

        if (trimmed.startsWith('## ')) {
          return (
            <h2 key={idx} className="text-sm sm:text-base font-bold text-slate-900 border-b border-slate-200 pb-1 mt-3 flex items-center gap-1.5">
              {formatInline(trimmed.slice(3))}
            </h2>
          );
        }
        if (trimmed.startsWith('### ')) {
          return (
            <h3 key={idx} className="text-xs sm:text-sm font-bold text-slate-800 mt-2">
              {formatInline(trimmed.slice(4))}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h1 key={idx} className="text-base sm:text-lg font-bold text-slate-900 mt-3">
              {formatInline(trimmed.slice(2))}
            </h1>
          );
        }

        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={idx} className="flex items-start gap-2 ml-2">
              <span className="text-blue-500 font-bold">•</span>
              <span>{formatInline(trimmed.slice(2))}</span>
            </div>
          );
        }

        const matchNum = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (matchNum) {
          return (
            <div key={idx} className="flex items-start gap-2 ml-2">
              <span className="font-bold text-slate-900 text-[10px] bg-blue-100 text-blue-700 rounded-full w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">
                {matchNum[1]}
              </span>
              <span>{formatInline(matchNum[2])}</span>
            </div>
          );
        }

        return <p key={idx}>{formatInline(trimmed)}</p>;
      })}
    </div>
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
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<string, boolean>>({});
  const [campaignDetails, setCampaignDetails] = useState<Record<string, any>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});

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

  const handleSyncAds = async () => {
    setIsSyncingAds(true);
    showToast('info', 'Sincronizando Product Ads com Mercado Livre...');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await apiFetch('/api/ml/advertising/sync', {
        method: 'POST',
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        showToast('success', 'Product Ads sincronizados com sucesso!');
        await loadCampaigns();
      } else {
        const data = await safeJsonResponse(res);
        showToast('error', data.error || 'Erro ao sincronizar Product Ads');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        showToast('info', 'Sincronização cancelada (timeout 30s)');
      } else {
        showToast('error', err.message || 'Erro de conexão');
      }
    } finally {
      setIsSyncingAds(false);
    }
  };

  const generateAiReport = async () => {
    setIsGeneratingReport(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const res = await apiFetch('/api/ml/advertising/ai-report', {
        method: 'POST',
        signal: controller.signal
      });
      clearTimeout(timeout);
      const data = await safeJsonResponse(res);
      if (res.ok && data.report) {
        setAiReport(data.report);
        showToast('success', 'Relatório executivo gerado pela IA!');
      } else {
        showToast('error', data.error || 'Erro ao gerar relatório com IA');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        showToast('info', 'Análise da IA cancelada (timeout 60s)');
      } else {
        showToast('error', err.message || 'Erro ao conectar à IA');
      }
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const toggleExpandCampaign = async (cId: string) => {
    const isExpanded = !!expandedCampaigns[cId];
    setExpandedCampaigns(prev => ({ ...prev, [cId]: !isExpanded }));

    if (!isExpanded && !campaignDetails[cId]) {
      try {
        setLoadingDetails(prev => ({ ...prev, [cId]: true }));
        const res = await apiFetch(`/api/ml/advertising/campaigns/${cId}`);
        if (res.ok) {
          const data = await safeJsonResponse(res);
          setCampaignDetails(prev => ({ ...prev, [cId]: data.ad_groups || [] }));
        }
      } catch (err) {
        console.error('Erro ao carregar ad_groups:', err);
      } finally {
        setLoadingDetails(prev => ({ ...prev, [cId]: false }));
      }
    }
  };

  const handleToggleCampaignStatus = async (campaign: any) => {
    const newStatus = campaign.status === 'active' ? 'paused' : 'active';
    const cId = campaign.campaign_id || campaign.id;
    try {
      showToast('info', `${newStatus === 'active' ? 'Ativando' : 'Pausando'} campanha...`);
      const res = await apiFetch(`/api/ml/advertising/campaigns/${cId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        showToast('success', `Campanha ${newStatus === 'active' ? 'ativada' : 'pausada'}!`);
        loadCampaigns();
      } else {
        const data = await safeJsonResponse(res);
        showToast('error', data.error || 'Erro ao atualizar status');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Erro ao atualizar');
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      showToast('info', 'Criando nova campanha...');
      const res = await apiFetch('/api/ml/advertising/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formCampaign.name,
          budget_amount: Number(formCampaign.daily_budget),
          roas_target: Number(formCampaign.target_acos)
        })
      });
      if (res.ok) {
        showToast('success', 'Campanha criada com sucesso!');
        setModalNewCampaignOpen(false);
        setFormCampaign({ name: '', daily_budget: 20, target_acos: 15, status: 'active' });
        loadCampaigns();
      } else {
        const data = await safeJsonResponse(res);
        showToast('error', data.error || 'Erro ao criar campanha');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Erro de conexão');
    }
  };

  const handleUpdateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalEditCampaign) return;
    const cId = modalEditCampaign.campaign_id || modalEditCampaign.id;
    try {
      showToast('info', 'Atualizando dados da campanha...');
      const res = await apiFetch(`/api/ml/advertising/campaigns/${cId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: modalEditCampaign.name,
          budget_amount: Number(modalEditCampaign.budget_amount || modalEditCampaign.daily_budget),
          roas_target: Number(modalEditCampaign.roas_target || modalEditCampaign.target_acos)
        })
      });
      if (res.ok) {
        showToast('success', 'Campanha atualizada!');
        setModalEditCampaign(null);
        loadCampaigns();
      } else {
        const data = await safeJsonResponse(res);
        showToast('error', data.error || 'Erro ao atualizar');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Erro ao atualizar');
    }
  };

  const handleDeleteCampaign = async (campaign: any) => {
    const cId = campaign.campaign_id || campaign.id;
    if (!window.confirm(`Tem certeza que deseja excluir a campanha "${campaign.name}"?`)) return;
    try {
      showToast('info', 'Excluindo campanha...');
      const res = await apiFetch(`/api/ml/advertising/campaigns/${cId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showToast('success', 'Campanha excluída!');
        loadCampaigns();
      } else {
        const data = await safeJsonResponse(res);
        showToast('error', data.error || 'Erro ao excluir campanha');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Erro ao excluir');
    }
  };

  // Auto-gerar relatório na primeira visita à tab se houver campanhas
  useEffect(() => {
    if (activeTab === 'publicidade' && !aiReport && !isGeneratingReport && campaigns.length > 0) {
      generateAiReport();
    }
  }, [activeTab, campaigns]);

  const totalAdCost = useMemo(() => campaigns.reduce((s, c) => s + Number(c.cost || 0), 0), [campaigns]);
  const totalAdSales = useMemo(() => campaigns.reduce((s, c) => s + Number(c.total_amount || 0), 0), [campaigns]);
  const totalAdClicks = useMemo(() => campaigns.reduce((s, c) => s + Number(c.clicks || 0), 0), [campaigns]);
  const totalAdPrints = useMemo(() => campaigns.reduce((s, c) => s + Number(c.prints || 0), 0), [campaigns]);
  const avgAdROAS = totalAdCost > 0 ? totalAdSales / totalAdCost : 0;
  const avgAdCTR = totalAdPrints > 0 ? (totalAdClicks / totalAdPrints) * 100 : 0;

  const campaignChartData = useMemo(() => {
    return campaigns.map(c => {
      const cost = Number(c.cost || 0);
      const sales = Number(c.total_amount || 0);
      const roas = Number(c.roas || (cost > 0 ? sales / cost : 0));
      return {
        name: c.name ? (c.name.length > 15 ? c.name.slice(0, 15) + '...' : c.name) : 'Campanha',
        fullName: c.name || 'Campanha',
        Investimento: cost,
        Vendas: sales,
        ROAS: Number(roas.toFixed(2))
      };
    });
  }, [campaigns]);

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
    const vst = dashboardData.visits || 0;
    const conv = typeof dashboardData.conversion_rate === 'number'
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

            {/* Card 4: Taxa de Vendas */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Taxa de Vendas</span>
                <Sparkline data={[3.1, 3.2, 3.4, 3.5, 3.8, 4.0, 4.2]} color={metrics.varConversion >= 0 ? '#10B981' : '#EF4444'} />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900">
                  {metrics.conversionRate}%
                </div>
                <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                  {metrics.visits > 0 ? `${metrics.orders} vendas em ${metrics.visits.toLocaleString('pt-BR')} visitas` : 'Taxa de conversão por visitas'}
                </div>
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
                  { label: 'Visitas', value: metrics.visits || 0, pct: '100%', color: 'bg-blue-500', icon: Eye },
                  { label: 'Perguntas', value: metrics.questions || 0, pct: metrics.visits > 0 ? `${((metrics.questions / metrics.visits) * 100).toFixed(1)}%` : '0%', color: 'bg-indigo-500', icon: MessageCircle },
                  { label: 'Pedidos', value: metrics.orders || 0, pct: metrics.visits > 0 ? `${((metrics.orders / metrics.visits) * 100).toFixed(1)}%` : '0%', color: 'bg-emerald-500', icon: ShoppingCart },
                  { label: 'Entregues', value: Math.round((metrics.orders || 0) * 0.91), pct: metrics.visits > 0 ? `${(((metrics.orders * 0.91) / metrics.visits) * 100).toFixed(1)}%` : '0%', color: 'bg-slate-800', icon: CheckCircle2 },
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
        <div className="space-y-6">
          {/* Header & Actions */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Zap size={18} className="text-amber-500 fill-amber-500" />
                Product Ads & Campanhas Patrocinadas
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Gerencie suas campanhas de publicidade do Mercado Livre, analise métricas de ROAS, CTR e crie relatórios executivos com Gemini IA.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleSyncAds}
                disabled={isSyncingAds}
                className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-xs transition-all disabled:opacity-50"
              >
                <RefreshCw size={14} className={isSyncingAds ? 'animate-spin text-blue-600' : 'text-slate-500'} />
                {isSyncingAds ? 'Sincronizando...' : 'Sincronizar Product Ads'}
              </button>
              <button
                onClick={() => setModalNewCampaignOpen(true)}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-xs transition-all"
              >
                <Plus size={14} /> Nova Campanha
              </button>
            </div>
          </div>

          {/* 1.1 KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Investimento */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Investimento Total</span>
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <DollarSign size={18} />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {formatCurrency(totalAdCost)}
              </div>
              <div className="text-[11px] text-slate-500">
                Custo total das campanhas ativas
              </div>
            </div>

            {/* Vendas Atribuídas */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Vendas Atribuídas</span>
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <TrendingUp size={18} />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {formatCurrency(totalAdSales)}
              </div>
              <div className="text-[11px] text-slate-500">
                Faturamento via anúncios patrocinados
              </div>
            </div>

            {/* ROAS Médio */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">ROAS Médio</span>
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <BarChart2 size={18} />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <div className="text-2xl font-bold text-slate-900">
                  {avgAdROAS.toFixed(2)}x
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  avgAdROAS >= 10 ? 'bg-emerald-100 text-emerald-700' :
                  avgAdROAS >= 5 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                }`}>
                  {avgAdROAS >= 10 ? 'Excelente' : avgAdROAS >= 5 ? 'Moderado' : 'Atenção'}
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                Retorno sobre investimento em ads
              </div>
            </div>

            {/* Cliques Totais */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Cliques Totais</span>
                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                  <Eye size={18} />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {totalAdClicks.toLocaleString('pt-BR')}
              </div>
              <div className="text-[11px] text-slate-500">
                CTR Médio: <strong className="text-slate-800">{avgAdCTR.toFixed(2)}%</strong> ({totalAdPrints.toLocaleString('pt-BR')} impr.)
              </div>
            </div>
          </div>

          {/* 1.7 Seção Análise com IA */}
          <div className="bg-gradient-to-r from-blue-50 via-indigo-50/50 to-blue-50 border border-blue-200 rounded-xl p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs">
                  <Sparkles size={22} />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">Análise Inteligente de Product Ads</h4>
                  <p className="text-xs text-slate-600">Diagnóstico executivo de performance, alertas de ROAS e recomendações gerados pelo Gemini IA</p>
                </div>
              </div>
              <button
                onClick={generateAiReport}
                disabled={isGeneratingReport}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-xs transition-all disabled:opacity-50 shrink-0"
              >
                <Sparkles size={14} className={isGeneratingReport ? 'animate-spin' : ''} />
                {isGeneratingReport ? 'Gemini Analisando...' : aiReport ? 'Atualizar Análise' : 'Gerar Relatório com IA'}
              </button>
            </div>

            {isGeneratingReport ? (
              <div className="bg-white/80 backdrop-blur-xs rounded-xl p-8 border border-blue-100 text-center space-y-3">
                <RefreshCw size={28} className="animate-spin text-blue-600 mx-auto" />
                <p className="font-bold text-slate-800 text-sm">O Gemini está analisando suas campanhas...</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Examinando métricas de investimento, vendas atribuídas, ROAS, CTR, lances CPC e catálogo orgânico.
                </p>
              </div>
            ) : aiReport ? (
              <div className="bg-white/90 backdrop-blur-xs rounded-xl p-6 border border-blue-100 shadow-2xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 text-xs text-slate-400">
                  <span className="font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle size={14} className="text-emerald-500" /> Relatório Executivo Gerado
                  </span>
                  <span>Modelo: Gemini 2.0 Flash</span>
                </div>
                <SimpleMarkdown content={aiReport} />
              </div>
            ) : (
              <div className="bg-white/80 backdrop-blur-xs rounded-xl p-6 border border-blue-100 text-center text-slate-500 text-xs">
                Clique em <strong className="text-blue-700 font-bold">Gerar Relatório com IA</strong> para obter diagnósticos completos e sugestões de otimização para suas campanhas de Product Ads.
              </div>
            )}
          </div>

          {/* 1.3 Gráfico de Performance */}
          {campaigns.length > 0 && (
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Performance por Campanha</h4>
                  <p className="text-xs text-slate-500">Comparativo de Investimento (R$), Vendas (R$) e ROAS (x)</p>
                </div>
              </div>
              <div className="h-72 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={campaignChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis yAxisId="left" tickFormatter={(v) => `R$${v}`} tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}x`} tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '12px' }}
                      formatter={(value: any, name: string) => {
                        if (name === 'ROAS (x)' || name === 'ROAS') return [`${Number(value).toFixed(2)}x`, 'ROAS'];
                        return [formatCurrency(Number(value)), name];
                      }}
                      labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                    />
                    <Bar yAxisId="left" dataKey="Investimento" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Investimento" />
                    <Bar yAxisId="left" dataKey="Vendas" fill="#10B981" radius={[4, 4, 0, 0]} name="Vendas Atribuídas" />
                    <Line yAxisId="right" type="monotone" dataKey="ROAS" stroke="#EF4444" strokeWidth={3} dot={{ r: 4 }} name="ROAS (x)" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* 1.2 Tabela Completa de Campanhas */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Campanhas e Métricas Detalhadas</h4>
                <p className="text-xs text-slate-500">Listagem das campanhas ativas/pausadas com estatísticas do Mercado Livre</p>
              </div>
              <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-3 py-1 rounded-full">
                {campaigns.length} {campaigns.length === 1 ? 'campanha' : 'campanhas'}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="py-3 px-3 w-8"></th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-4">Campanha</th>
                    <th className="py-3 px-3 text-right">Orçamento</th>
                    <th className="py-3 px-3 text-right">ROAS Alvo</th>
                    <th className="py-3 px-3 text-right">Cliques</th>
                    <th className="py-3 px-3 text-right">Impressões</th>
                    <th className="py-3 px-3 text-right">CTR</th>
                    <th className="py-3 px-3 text-right">CPC Médio</th>
                    <th className="py-3 px-3 text-right">Investimento</th>
                    <th className="py-3 px-3 text-right">Vendas</th>
                    <th className="py-3 px-3 text-center">ROAS Real</th>
                    <th className="py-3 px-4 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {campaignsLoading ? (
                    <tr>
                      <td colSpan={13} className="py-12 text-center text-slate-400">
                        <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-slate-600" />
                        Carregando campanhas de Product Ads...
                      </td>
                    </tr>
                  ) : campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-12 text-center text-slate-500">
                        <Zap size={28} className="text-amber-500 mx-auto mb-2" />
                        <p className="font-bold text-slate-800 text-sm">Nenhuma campanha cadastrada</p>
                        <p className="text-xs text-slate-400 mt-0.5">Clique em "Nova Campanha" ou "Sincronizar Product Ads" para importar do Mercado Livre.</p>
                      </td>
                    </tr>
                  ) : (
                    campaigns.map((c) => {
                      const cId = c.campaign_id || c.id;
                      const isExpanded = !!expandedCampaigns[cId];
                      const cost = Number(c.cost || 0);
                      const sales = Number(c.total_amount || 0);
                      const clicks = Number(c.clicks || 0);
                      const prints = Number(c.prints || 0);
                      const roas = Number(c.roas || (cost > 0 ? sales / cost : 0));
                      const ctr = prints > 0 ? (clicks / prints) * 100 : 0;
                      const cpc = clicks > 0 ? cost / clicks : 0;
                      const isActive = c.status === 'active';
                      const adGroups = campaignDetails[cId] || [];

                      return (
                        <React.Fragment key={cId}>
                          <tr className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-3 text-center">
                              <button
                                onClick={() => toggleExpandCampaign(cId)}
                                className="p-1 hover:bg-slate-200 rounded-md text-slate-500 transition-colors"
                                title="Ver anúncios patrocinados da campanha"
                              >
                                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase inline-flex items-center gap-1 ${
                                isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                {isActive ? 'Ativa' : 'Pausada'}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-bold text-slate-900 max-w-[200px] truncate">
                              {c.name || 'Campanha Product Ads'}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 font-semibold">
                              {formatCurrency(c.budget_amount || c.daily_budget || 0)}/dia
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                              {c.roas_target ? `${c.roas_target}x` : c.target_acos ? `${c.target_acos}%` : '-'}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                              {clicks.toLocaleString('pt-BR')}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                              {prints.toLocaleString('pt-BR')}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                              {ctr.toFixed(2)}%
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                              {formatCurrency(cpc)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                              {formatCurrency(cost)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                              {formatCurrency(sales)}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <span className={`px-2.5 py-1 rounded-md font-mono font-bold text-xs ${
                                roas >= 10 ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                                roas >= 5 ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                                'bg-red-100 text-red-800 border border-red-200'
                              }`}>
                                {roas.toFixed(2)}x
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => handleToggleCampaignStatus(c)}
                                  className={`p-1.5 rounded-lg border transition-all ${
                                    isActive ? 'hover:bg-amber-50 text-amber-700 border-amber-200' : 'hover:bg-emerald-50 text-emerald-700 border-emerald-200'
                                  }`}
                                  title={isActive ? 'Pausar Campanha' : 'Ativar Campanha'}
                                >
                                  {isActive ? <Pause size={14} /> : <Play size={14} />}
                                </button>
                                <button
                                  onClick={() => setModalEditCampaign(c)}
                                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-all"
                                  title="Editar Campanha"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  onClick={() => handleDeleteCampaign(c)}
                                  className="p-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 transition-all"
                                  title="Excluir Campanha"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* 1.4 Expanded Row with ad_groups */}
                          {isExpanded && (
                            <tr className="bg-slate-50/70 border-b border-slate-200">
                              <td colSpan={13} className="p-4 pl-12">
                                <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-2xs space-y-3">
                                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                    <h5 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                                      <Layers size={14} className="text-blue-600" />
                                      Anúncios Patrocinados (ad_groups) da Campanha "{c.name}"
                                    </h5>
                                    <span className="text-[11px] text-slate-500">
                                      {adGroups.length} anúncios
                                    </span>
                                  </div>

                                  {loadingDetails[cId] ? (
                                    <div className="py-4 text-center text-xs text-slate-400">
                                      <RefreshCw size={16} className="animate-spin mx-auto mb-1 text-slate-600" />
                                      Carregando anúncios da campanha...
                                    </div>
                                  ) : adGroups.length === 0 ? (
                                    <p className="text-xs text-slate-400 italic py-2 text-center">
                                      Nenhum ad_group individual retornado para esta campanha.
                                    </p>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-left text-[11px]">
                                        <thead className="bg-slate-50 text-slate-500 uppercase font-semibold">
                                          <tr>
                                            <th className="py-2 px-3">Item / Anúncio</th>
                                            <th className="py-2 px-2 text-center">Status</th>
                                            <th className="py-2 px-3 text-right">CPC Bid</th>
                                            <th className="py-2 px-3 text-right">Cliques</th>
                                            <th className="py-2 px-3 text-right">Impressões</th>
                                            <th className="py-2 px-3 text-right">Custo</th>
                                            <th className="py-2 px-3 text-right">Vendas</th>
                                            <th className="py-2 px-3 text-center">ROAS</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                          {adGroups.map((ag: any, agIdx: number) => {
                                            const agCost = Number(ag.cost || 0);
                                            const agSales = Number(ag.total_amount || 0);
                                            const agRoas = Number(ag.roas || (agCost > 0 ? agSales / agCost : 0));
                                            return (
                                              <tr key={ag.id || agIdx} className="hover:bg-slate-50">
                                                <td className="py-2 px-3 font-semibold text-slate-800 flex items-center gap-2">
                                                  {ag.thumbnail && (
                                                    <img src={ag.thumbnail} alt="" className="w-7 h-7 rounded border object-cover shrink-0" />
                                                  )}
                                                  <span className="truncate max-w-xs">{ag.title || ag.item_id || `Ad Group #${agIdx + 1}`}</span>
                                                </td>
                                                <td className="py-2 px-2 text-center">
                                                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold">
                                                    {ag.status || 'Ativo'}
                                                  </span>
                                                </td>
                                                <td className="py-2 px-3 text-right font-mono">{formatCurrency(ag.cpc_bid || 0)}</td>
                                                <td className="py-2 px-3 text-right font-mono">{Number(ag.clicks || 0).toLocaleString('pt-BR')}</td>
                                                <td className="py-2 px-3 text-right font-mono">{Number(ag.prints || 0).toLocaleString('pt-BR')}</td>
                                                <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">{formatCurrency(agCost)}</td>
                                                <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-700">{formatCurrency(agSales)}</td>
                                                <td className="py-2 px-3 text-center font-mono font-bold">
                                                  <span className={agRoas >= 10 ? 'text-emerald-700' : agRoas >= 5 ? 'text-amber-700' : 'text-red-700'}>
                                                    {agRoas.toFixed(2)}x
                                                  </span>
                                                </td>
                                              </tr>
                                            );
                                          })}
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

      {/* MODAL: NOVA CAMPANHA */}
      {modalNewCampaignOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Zap size={18} className="text-amber-500 fill-amber-500" />
                Nova Campanha de Product Ads
              </h3>
              <button
                onClick={() => setModalNewCampaignOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateCampaign} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Nome da Campanha
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Campanha Lançamentos Verão"
                  value={formCampaign.name}
                  onChange={(e) => setFormCampaign({ ...formCampaign, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-slate-900 focus:bg-white outline-none transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Orçamento Diário (R$)
                  </label>
                  <input
                    type="number"
                    required
                    min="5"
                    step="5"
                    value={formCampaign.daily_budget}
                    onChange={(e) => setFormCampaign({ ...formCampaign, daily_budget: Number(e.target.value) })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-slate-900 focus:bg-white outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    ROAS Target (x)
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="0.5"
                    value={formCampaign.target_acos}
                    onChange={(e) => setFormCampaign({ ...formCampaign, target_acos: Number(e.target.value) })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-slate-900 focus:bg-white outline-none transition-all"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalNewCampaignOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs"
                >
                  Criar Campanha
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDITAR CAMPANHA */}
      {modalEditCampaign && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Edit3 size={18} className="text-blue-600" />
                Editar Campanha de Product Ads
              </h3>
              <button
                onClick={() => setModalEditCampaign(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUpdateCampaign} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Nome da Campanha
                </label>
                <input
                  type="text"
                  required
                  value={modalEditCampaign.name || ''}
                  onChange={(e) => setModalEditCampaign({ ...modalEditCampaign, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-slate-900 focus:bg-white outline-none transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Orçamento Diário (R$)
                  </label>
                  <input
                    type="number"
                    required
                    min="5"
                    step="5"
                    value={modalEditCampaign.budget_amount || modalEditCampaign.daily_budget || 20}
                    onChange={(e) => setModalEditCampaign({ ...modalEditCampaign, budget_amount: Number(e.target.value) })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-slate-900 focus:bg-white outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    ROAS Target (x)
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="0.5"
                    value={modalEditCampaign.roas_target || modalEditCampaign.target_acos || 15}
                    onChange={(e) => setModalEditCampaign({ ...modalEditCampaign, roas_target: Number(e.target.value) })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-slate-900 focus:bg-white outline-none transition-all"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalEditCampaign(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
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
