import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Search, 
  FileSpreadsheet, 
  ChevronDown, 
  ChevronRight, 
  Check, 
  CheckSquare, 
  Square, 
  Sparkles, 
  Calendar, 
  Layers, 
  RefreshCw, 
  Loader2, 
  ExternalLink,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { apiFetch } from '../services/apiClient';

export interface MetricItem {
  id: string;
  label: string;
  format?: 'currency' | 'number' | 'percent' | 'decimal' | 'time' | 'text';
  category?: string;
  description?: string;
}

export interface MetricCategory {
  id: string;
  label: string;
  icon?: string;
  metrics: MetricItem[];
}

export interface PresetOption {
  id: string;
  label: string;
  description?: string;
  metricIds: string[];
}

export interface ExportConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  platform: 'meta_ads' | 'mercado_livre' | 'google_ads';
  title?: string;
  campaigns?: Array<{ id: string | number; name: string }>;
  defaultSpreadsheetId?: string;
  defaultStartDate?: string;
  defaultEndDate?: string;
  defaultAggregation?: 'total' | 'daily' | 'monthly' | string;
  startDate?: string;
  endDate?: string;
  onExport: (config: {
    spreadsheetId: string;
    startDate: string;
    endDate: string;
    aggregation: 'total' | 'daily' | 'monthly';
    selectedCampaigns: string[];
    selectedMetrics: string[];
    sheetName?: string;
    dataType?: string;
  }) => Promise<void>;
  isExporting?: boolean;
  sheetsConnected?: boolean;
  isConnected?: boolean;
  onConnectSheets?: () => void;
  automationEnabled?: boolean;
  automationLastRunAt?: string | null;
  automationLastRunStatus?: string | null;
  automationLastRunError?: string | null;
  isSavingAutomation?: boolean;
  onToggleAutomation?: (enabled: boolean, spreadsheetId: string) => Promise<void>;
  automationStatus?: {
    lastRunAt?: string | null;
    lastRunStatus?: string | null;
    lastRunError?: string | null;
  };
}

// Fallback Catalog if API is unreachable
const FALLBACK_CATALOG: Record<string, Record<string, MetricItem[]>> = {
  meta_ads: {
    delivery: [
      { id: 'spend', label: 'Investimento (R$)', format: 'currency' },
      { id: 'impressions', label: 'Impressões', format: 'number' },
      { id: 'reach', label: 'Alcance', format: 'number' },
      { id: 'frequency', label: 'Frequência', format: 'decimal' },
      { id: 'cpm', label: 'CPM (R$)', format: 'currency' },
      { id: 'cpp', label: 'Custo por 1.000 Pessoas (CPP)', format: 'currency' },
      { id: 'clicks', label: 'Cliques Totais', format: 'number' },
      { id: 'inline_link_clicks', label: 'Cliques no Link', format: 'number' },
      { id: 'ctr', label: 'CTR Todos (%)', format: 'percent' },
      { id: 'inline_link_click_ctr', label: 'CTR no Link (%)', format: 'percent' },
      { id: 'cpc', label: 'CPC Todos (R$)', format: 'currency' },
      { id: 'cost_per_inline_link_click', label: 'CPC no Link (R$)', format: 'currency' }
    ],
    engagement: [
      { id: 'post_engagement', label: 'Engajamentos com a Publicação', format: 'number' },
      { id: 'page_engagement', label: 'Engajamentos com a Página', format: 'number' },
      { id: 'post_reactions', label: 'Reações no Post', format: 'number' },
      { id: 'post_comments', label: 'Comentários no Post', format: 'number' },
      { id: 'post_shares', label: 'Compartilhamentos', format: 'number' },
      { id: 'post_saves', label: 'Salvamentos do Post', format: 'number' },
      { id: 'cost_per_post_engagement', label: 'Custo por Engajamento (R$)', format: 'currency' }
    ],
    video: [
      { id: 'video_3s_views', label: 'Visualizações de Vídeo (3 seg)', format: 'number' },
      { id: 'video_p25_watched', label: 'Vídeo Assistido até 25%', format: 'number' },
      { id: 'video_p50_watched', label: 'Vídeo Assistido até 50%', format: 'number' },
      { id: 'video_p75_watched', label: 'Vídeo Assistido até 75%', format: 'number' },
      { id: 'video_p100_watched', label: 'Vídeo Assistido até 100%', format: 'number' },
      { id: 'video_thruplay', label: 'ThruPlays (15s ou completo)', format: 'number' },
      { id: 'cost_per_thruplay', label: 'Custo por ThruPlay (R$)', format: 'currency' },
      { id: 'video_avg_time_watched', label: 'Tempo Médio de Reprodução (s)', format: 'decimal' }
    ],
    conversions: [
      { id: 'leads', label: 'Leads (Cadastros)', format: 'number' },
      { id: 'cost_per_lead', label: 'Custo por Lead (CPL)', format: 'currency' },
      { id: 'purchases', label: 'Compras no Site', format: 'number' },
      { id: 'cost_per_purchase', label: 'Custo por Compra (CPA)', format: 'currency' },
      { id: 'purchase_value', label: 'Valor Total das Compras (R$)', format: 'currency' },
      { id: 'roas', label: 'ROAS de Compras', format: 'decimal' },
      { id: 'add_to_cart', label: 'Adições ao Carrinho', format: 'number' },
      { id: 'cost_per_add_to_cart', label: 'Custo por Adição ao Carrinho', format: 'currency' },
      { id: 'initiate_checkout', label: 'Checkouts Iniciados', format: 'number' },
      { id: 'cost_per_initiate_checkout', label: 'Custo por Checkout Iniciado', format: 'currency' },
      { id: 'messaging_conversations_started', label: 'Conversas Iniciadas (WhatsApp/Direct)', format: 'number' },
      { id: 'cost_per_messaging_conversation', label: 'Custo por Conversa (R$)', format: 'currency' }
    ],
    quality: [
      { id: 'quality_ranking', label: 'Classificação de Qualidade', format: 'text' },
      { id: 'engagement_rate_ranking', label: 'Taxa de Engajamento Classificação', format: 'text' },
      { id: 'conversion_rate_ranking', label: 'Taxa de Conversão Classificação', format: 'text' }
    ]
  },
  mercado_livre: {
    sales: [
      { id: 'revenue', label: 'Faturamento Bruto (R$)', format: 'currency' },
      { id: 'net_revenue', label: 'Faturamento Líquido (R$)', format: 'currency' },
      { id: 'orders', label: 'Total de Pedidos', format: 'number' },
      { id: 'units_sold', label: 'Unidades Vendidas', format: 'number' },
      { id: 'ticket_medio', label: 'Ticket Médio (R$)', format: 'currency' },
      { id: 'cancelled_orders', label: 'Pedidos Cancelados', format: 'number' },
      { id: 'cancellation_rate', label: 'Taxa de Cancelamento (%)', format: 'percent' }
    ],
    traffic: [
      { id: 'visits', label: 'Visitas Totais', format: 'number' },
      { id: 'conversion_rate', label: 'Taxa de Conversão da Loja (%)', format: 'percent' },
      { id: 'questions', label: 'Perguntas Recebidas', format: 'number' },
      { id: 'question_response_time', label: 'Tempo Médio de Resposta (min)', format: 'number' }
    ],
    advertising: [
      { id: 'ad_spend', label: 'Investimento Product Ads (R$)', format: 'currency' },
      { id: 'ad_revenue', label: 'Receita Atribuída ao Ads (R$)', format: 'currency' },
      { id: 'acos', label: 'ACOS (%)', format: 'percent' },
      { id: 'roas', label: 'ROAS Product Ads', format: 'decimal' },
      { id: 'ad_impressions', label: 'Impressões de Anúncios', format: 'number' },
      { id: 'ad_clicks', label: 'Cliques em Anúncios', format: 'number' },
      { id: 'ad_ctr', label: 'CTR Ads (%)', format: 'percent' },
      { id: 'ad_cpc', label: 'CPC Médio Ads (R$)', format: 'currency' },
      { id: 'ad_sales_units', label: 'Vendas Atribuídas Ads', format: 'number' }
    ],
    finance: [
      { id: 'commission_fees', label: 'Tarifas de Venda ML (R$)', format: 'currency' },
      { id: 'shipping_fees', label: 'Custos de Frete / Envio (R$)', format: 'currency' },
      { id: 'taxes_estimated', label: 'Impostos Estimados (R$)', format: 'currency' },
      { id: 'gross_profit', label: 'Margem Bruta (R$)', format: 'currency' }
    ]
  },
  google_ads: {
    delivery: [
      { id: 'spend', label: 'Custo / Investimento (R$)', format: 'currency' },
      { id: 'impressions', label: 'Impressões', format: 'number' },
      { id: 'clicks', label: 'Cliques', format: 'number' },
      { id: 'ctr', label: 'CTR (%)', format: 'percent' },
      { id: 'cpc', label: 'CPC Médio (R$)', format: 'currency' },
      { id: 'cpm', label: 'CPM Médio (R$)', format: 'currency' }
    ],
    conversions: [
      { id: 'conversions', label: 'Conversões', format: 'number' },
      { id: 'cost_per_conversion', label: 'Custo / Conversão (CPA)', format: 'currency' },
      { id: 'conversion_rate', label: 'Taxa de Conversão (%)', format: 'percent' },
      { id: 'conversions_value', label: 'Valor das Conversões (R$)', format: 'currency' },
      { id: 'roas', label: 'ROAS (Valor / Custo)', format: 'decimal' }
    ],
    search_keywords: [
      { id: 'search_term', label: 'Termo de Pesquisa', format: 'text' },
      { id: 'keyword', label: 'Palavra-chave', format: 'text' },
      { id: 'match_type', label: 'Tipo de Correspondência', format: 'text' },
      { id: 'quality_score', label: 'Índice de Qualidade (1-10)', format: 'number' }
    ]
  }
};

const CATEGORY_NAMES: Record<string, string> = {
  delivery: '🚀 Veiculação & Alcance',
  engagement: '💬 Engajamento & Social',
  video: '🎬 Vídeo & Retenção',
  conversions: '🎯 Conversões & Vendas',
  quality: '⭐ Qualidade & Diagnóstico',
  sales: '💰 Vendas & Faturamento',
  traffic: '👀 Tráfego & Visitas',
  advertising: '📢 Product Ads & Patrocinados',
  finance: '🧾 Tarifas & Financeiro',
  search_keywords: '🔍 Termos & Palavras-chave'
};

export const ExportConfigDrawer: React.FC<ExportConfigDrawerProps> = ({
  isOpen,
  onClose,
  platform,
  title,
  campaigns = [],
  defaultSpreadsheetId = '',
  defaultStartDate,
  defaultEndDate,
  defaultAggregation,
  startDate,
  endDate,
  onExport,
  isExporting = false,
  sheetsConnected = true,
  isConnected,
  onConnectSheets,
  automationEnabled = false,
  automationLastRunAt,
  automationLastRunStatus,
  automationLastRunError,
  isSavingAutomation = false,
  onToggleAutomation,
  automationStatus
}) => {
  const [catalog, setCatalog] = useState<Record<string, MetricItem[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [spreadsheetId, setSpreadsheetId] = useState(defaultSpreadsheetId);
  const [exportStartDate, setExportStartDate] = useState(() => {
    if (defaultStartDate) return defaultStartDate;
    if (startDate) return startDate;
    const d = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  });
  const [exportEndDate, setExportEndDate] = useState(() => {
    if (defaultEndDate) return defaultEndDate;
    if (endDate) return endDate;
    return new Date().toISOString().split('T')[0];
  });
  const [aggregation, setAggregation] = useState<'total' | 'daily' | 'monthly'>((defaultAggregation as any) || 'total');
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>(['all']);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [activePreset, setActivePreset] = useState<string | null>('performance');
  const [isSavingAuto, setIsSavingAuto] = useState(false);
  const [isAutoEnabled, setIsAutoEnabled] = useState(automationEnabled);

  // Computed status
  const effectiveStatus = automationStatus || {
    lastRunAt: automationLastRunAt,
    lastRunStatus: automationLastRunStatus,
    lastRunError: automationLastRunError
  };

  // Sync default values
  useEffect(() => {
    if (defaultSpreadsheetId) {
      setSpreadsheetId(defaultSpreadsheetId);
    } else {
      const saved = localStorage.getItem(`${platform}_sheets_export_id`) || localStorage.getItem('google_sheets_spreadsheet_id') || '';
      if (saved) setSpreadsheetId(saved);
    }
  }, [defaultSpreadsheetId, platform]);

  useEffect(() => {
    setIsAutoEnabled(automationEnabled);
  }, [automationEnabled]);

  // Load metrics catalog
  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const res = await apiFetch(`/api/export/metrics?platform=${platform}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data[platform]) {
            setCatalog(data[platform]);
            return;
          }
        }
      } catch (err) {
        console.warn('Could not fetch metrics catalog from API, using fallback:', err);
      }
      setCatalog(FALLBACK_CATALOG[platform] || {});
    };
    loadCatalog();
  }, [platform]);

  // Initial category open states
  useEffect(() => {
    const initialExpanded: Record<string, boolean> = {};
    Object.keys(catalog).forEach((cat, idx) => {
      initialExpanded[cat] = idx === 0 || idx === 1; // Open first two by default
    });
    setExpandedCategories(initialExpanded);
  }, [catalog]);

  // Preset definitions based on platform
  const presets: PresetOption[] = useMemo(() => {
    if (platform === 'meta_ads') {
      return [
        {
          id: 'performance',
          label: '⚡ Performance & Tráfego',
          description: 'Investimento, impressões, cliques, CTR, CPC, leads, compras e ROAS',
          metricIds: ['spend', 'impressions', 'reach', 'cpm', 'clicks', 'inline_link_clicks', 'ctr', 'inline_link_click_ctr', 'cpc', 'cost_per_inline_link_click', 'leads', 'cost_per_lead', 'purchases', 'cost_per_purchase', 'purchase_value', 'roas']
        },
        {
          id: 'ecommerce',
          label: '🛍️ E-commerce & Conversões',
          description: 'Funil completo de compras, carrinho, checkout e receita',
          metricIds: ['spend', 'impressions', 'inline_link_clicks', 'inline_link_click_ctr', 'cost_per_inline_link_click', 'add_to_cart', 'cost_per_add_to_cart', 'initiate_checkout', 'cost_per_initiate_checkout', 'purchases', 'cost_per_purchase', 'purchase_value', 'roas']
        },
        {
          id: 'branding',
          label: '📢 Alcance & Vídeo',
          description: 'Alcance, frequência, reproduções de vídeo (3s, ThruPlay, 100%) e engajamento',
          metricIds: ['spend', 'impressions', 'reach', 'frequency', 'cpm', 'video_3s_views', 'video_thruplay', 'cost_per_thruplay', 'video_p50_watched', 'video_p100_watched', 'post_engagement', 'post_reactions']
        },
        {
          id: 'all',
          label: '🌟 Completo (Todas as Métricas)',
          description: 'Exportar todas as mais de 30 métricas detalhadas do catálogo',
          metricIds: Object.values(catalog).flatMap(cats => cats.map(m => m.id))
        }
      ];
    } else if (platform === 'mercado_livre') {
      return [
        {
          id: 'executive',
          label: '📊 Visão Executiva',
          description: 'Faturamento bruto, líquido, pedidos, ticket médio, visitas e conversão',
          metricIds: ['revenue', 'net_revenue', 'orders', 'units_sold', 'ticket_medio', 'visits', 'conversion_rate', 'gross_profit']
        },
        {
          id: 'ads_focus',
          label: '🚀 Product Ads & Campanhas',
          description: 'Gasto em publicidade, receita atribuída, ACOS, ROAS, cliques e CTR',
          metricIds: ['ad_spend', 'ad_revenue', 'acos', 'roas', 'ad_impressions', 'ad_clicks', 'ad_ctr', 'ad_cpc', 'ad_sales_units']
        },
        {
          id: 'financial',
          label: '🧾 Financeiro & Tarifas',
          description: 'Faturamento, tarifas de venda ML, frete, impostos e margem bruta',
          metricIds: ['revenue', 'net_revenue', 'commission_fees', 'shipping_fees', 'taxes_estimated', 'gross_profit', 'orders']
        },
        {
          id: 'all',
          label: '🌟 Completo',
          description: 'Exportar todas as métricas do Mercado Livre',
          metricIds: Object.values(catalog).flatMap(cats => cats.map(m => m.id))
        }
      ];
    } else {
      return [
        {
          id: 'standard',
          label: '🎯 Desempenho & Conversões',
          description: 'Custo, impressões, cliques, CTR, CPC, conversões, CPA e ROAS',
          metricIds: ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'conversions', 'cost_per_conversion', 'conversion_rate', 'conversions_value', 'roas']
        },
        {
          id: 'all',
          label: '🌟 Todas as Métricas',
          description: 'Exportação completa de termos e métricas',
          metricIds: Object.values(catalog).flatMap(cats => cats.map(m => m.id))
        }
      ];
    }
  }, [platform, catalog]);

  // Set initial selected metrics when presets or catalog loads
  useEffect(() => {
    if (selectedMetrics.length === 0 && presets.length > 0) {
      setSelectedMetrics(presets[0].metricIds);
      setActivePreset(presets[0].id);
    }
  }, [presets, selectedMetrics.length]);

  // Handle Preset selection
  const handleApplyPreset = (preset: PresetOption) => {
    setActivePreset(preset.id);
    setSelectedMetrics(preset.metricIds);
  };

  // Toggle single metric
  const toggleMetric = (id: string) => {
    setActivePreset(null);
    setSelectedMetrics(prev => 
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  };

  // Toggle category
  const toggleCategoryAll = (metrics: MetricItem[]) => {
    setActivePreset(null);
    const metricIds = metrics.map(m => m.id);
    const allSelected = metricIds.every(id => selectedMetrics.includes(id));
    if (allSelected) {
      setSelectedMetrics(prev => prev.filter(id => !metricIds.includes(id)));
    } else {
      setSelectedMetrics(prev => Array.from(new Set([...prev, ...metricIds])));
    }
  };

  // Select all or deselect all metrics
  const handleSelectAllGlobal = () => {
    setActivePreset('all');
    const allIds = Object.values(catalog).flatMap(cats => cats.map(m => m.id));
    setSelectedMetrics(allIds);
  };

  const handleDeselectAllGlobal = () => {
    setActivePreset(null);
    setSelectedMetrics([]);
  };

  // Toggle category accordion
  const toggleAccordion = (categoryKey: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [categoryKey]: !prev[categoryKey]
    }));
  };

  // Filter metrics based on search query
  const filteredCatalog = useMemo(() => {
    if (!searchQuery.trim()) return catalog;
    const query = searchQuery.toLowerCase().trim();
    const result: Record<string, MetricItem[]> = {};

    Object.entries(catalog).forEach(([categoryKey, metrics]) => {
      const filtered = metrics.filter(
        m => m.label.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)
      );
      if (filtered.length > 0) {
        result[categoryKey] = filtered;
      }
    });

    return result;
  }, [catalog, searchQuery]);

  // Handle Export Submit
  const handleExportSubmit = async () => {
    if (!spreadsheetId.trim()) return;
    localStorage.setItem(`${platform}_sheets_export_id`, spreadsheetId.trim());
    await onExport({
      spreadsheetId: spreadsheetId.trim(),
      startDate: exportStartDate,
      endDate: exportEndDate,
      aggregation,
      selectedCampaigns: selectedCampaignIds,
      selectedMetrics
    });
  };

  const handleToggleAuto = async () => {
    if (!onToggleAutomation) return;
    setIsSavingAuto(true);
    try {
      const next = !isAutoEnabled;
      setIsAutoEnabled(next);
      await onToggleAutomation(next, spreadsheetId.trim());
    } finally {
      setIsSavingAuto(false);
    }
  };

  const getFormatBadge = (format?: string) => {
    switch (format) {
      case 'currency':
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">R$</span>;
      case 'percent':
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">%</span>;
      case 'decimal':
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">0.0x</span>;
      case 'time':
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">tempo</span>;
      default:
        return <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">123</span>;
    }
  };

  const platformTitle = title || (
    platform === 'meta_ads' 
      ? 'Configuração de Exportação — Meta Ads' 
      : platform === 'mercado_livre' 
      ? 'Configuração de Exportação — Mercado Livre' 
      : 'Configuração de Exportação — Google Ads'
  );

  const tabsPreview = useMemo(() => {
    if (platform === 'meta_ads') {
      return [
        { title: 'Meta Ads - Visão Geral', desc: 'Resumo da conta com métricas diárias e consolidadas' },
        { title: 'Meta Ads - Campanhas', desc: 'Desempenho detalhado por campanha e período selecionado' },
        { title: 'Meta Ads - Ad Sets', desc: 'Segmentação, lances e performance por conjunto de anúncios' },
        { title: 'Meta Ads - Anúncios', desc: 'Criativos, formatos, links e conversões por anúncio' }
      ];
    } else if (platform === 'mercado_livre') {
      return [
        { title: 'ML - Visão Geral', desc: 'Faturamento, pedidos, visitas e conversão consolidada' },
        { title: 'ML - Vendas Detalhadas', desc: 'Linhas diárias de pedidos e itens faturados' },
        { title: 'ML - Product Ads', desc: 'Campanhas patrocinadas, ACOS, ROAS e investimento' }
      ];
    } else {
      return [
        { title: 'Google Ads - Campanhas', desc: 'Desempenho por campanha e conversões' },
        { title: 'Google Ads - Palavras-chave', desc: 'Índice de qualidade e métricas de palavras' },
        { title: 'Google Ads - Termos de Pesquisa', desc: 'Termos digitados pelos usuários no Google' }
      ];
    }
  }, [platform]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      <div 
        id="export-config-drawer" 
        className="bg-white w-full max-w-[500px] h-full shadow-2xl flex flex-col border-l border-slate-200 overflow-hidden animate-in slide-in-from-right duration-300"
      >
        {/* DRAWER HEADER */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h3 className="font-bold text-sm leading-tight text-white">{platformTitle}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {selectedMetrics.length} métricas selecionadas • Multi-abas automáticas
              </p>
            </div>
          </div>
          <button
            id="btn-close-export-drawer"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* SCROLLABLE DRAWER CONTENT */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-slate-50/50">
          {/* 1. GOOGLE SHEETS CONNECTION & SPREADSHEET INPUT */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className={sheetsConnected ? 'text-emerald-600' : 'text-amber-500'} />
                <span className="text-xs font-bold text-slate-800">
                  {sheetsConnected ? 'Google Sheets Conectado' : 'Google Sheets Desconectado'}
                </span>
              </div>
              {onConnectSheets && (
                <button
                  type="button"
                  onClick={onConnectSheets}
                  className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                >
                  {sheetsConnected ? 'Reautorizar Conta' : 'Conectar Conta Google'}
                </button>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Link ou ID da Planilha Google
              </label>
              <input
                type="text"
                id="input-spreadsheet-target"
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
                placeholder="Ex: https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5n..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-medium focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white outline-none transition-all placeholder:text-slate-400"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                As abas serão criadas ou atualizadas automaticamente dentro desta planilha.
              </p>
            </div>
          </div>

          {/* 2. DATES & AGGREGATION LEVEL */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Calendar size={14} className="text-blue-600" />
                Período & Granularidade
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(1);
                    setExportStartDate(d.toISOString().split('T')[0]);
                    setExportEndDate(new Date().toISOString().split('T')[0]);
                  }}
                  className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
                >
                  Mês Atual
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    const past = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
                    setExportStartDate(past.toISOString().split('T')[0]);
                    setExportEndDate(now.toISOString().split('T')[0]);
                  }}
                  className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
                >
                  30 Dias
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Data Início
                </label>
                <input
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => setExportStartDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:border-emerald-500 focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Data Fim
                </label>
                <input
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => setExportEndDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:border-emerald-500 focus:bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Visualização das Linhas (Agregação)
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setAggregation('total')}
                  className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                    aggregation === 'total'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Total Acumulado
                </button>
                <button
                  type="button"
                  onClick={() => setAggregation('daily')}
                  className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                    aggregation === 'daily'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Por Dia (Dia a Dia)
                </button>
                <button
                  type="button"
                  onClick={() => setAggregation('monthly')}
                  className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                    aggregation === 'monthly'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Por Mês
                </button>
              </div>
            </div>

            {/* Campaign Selection if applicable */}
            {campaigns.length > 0 && (
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Filtro de Campanhas
                </label>
                <select
                  value={selectedCampaignIds.includes('all') ? 'all' : 'select'}
                  onChange={(e) => {
                    if (e.target.value === 'all') {
                      setSelectedCampaignIds(['all']);
                    } else {
                      setSelectedCampaignIds([]);
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-500"
                >
                  <option value="all">Exportar Todas as Campanhas ({campaigns.length})</option>
                  <option value="select">Selecionar Campanhas Específicas</option>
                </select>

                {!selectedCampaignIds.includes('all') && (
                  <div className="mt-2 border border-slate-200 bg-white rounded-xl p-2 max-h-36 overflow-y-auto space-y-1">
                    {campaigns.map((camp) => {
                      const isChecked = selectedCampaignIds.includes(String(camp.id));
                      return (
                        <label
                          key={camp.id}
                          className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg cursor-pointer text-xs font-medium text-slate-800 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                setSelectedCampaignIds(prev => prev.filter(id => id !== String(camp.id)));
                              } else {
                                setSelectedCampaignIds(prev => [...prev.filter(id => id !== 'all'), String(camp.id)]);
                              }
                            }}
                            className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4 border-slate-300"
                          />
                          <span className="truncate">{camp.name || camp.id}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. PRESET SELECTOR (CHIPS) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Sparkles size={14} className="text-amber-500" />
                Presets Rápidos de Métricas
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllGlobal}
                  className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  Marcar Todas
                </button>
                <span className="text-slate-300">•</span>
                <button
                  type="button"
                  onClick={handleDeselectAllGlobal}
                  className="text-[10px] font-bold text-slate-500 hover:underline cursor-pointer"
                >
                  Limpar
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => {
                const isSelected = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-xs'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{preset.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-blue-200/70 text-blue-900' : 'bg-slate-100 text-slate-600'}`}>
                      {preset.metricIds.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. SEARCH & METRICS CATALOG (ACCORDION) */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            {/* Search Input */}
            <div className="p-3 border-b border-slate-150 bg-slate-50/50">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar métricas (ex: ROAS, cliques, leads, compras)..."
                  className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Categories & Metric Checkboxes */}
            <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
              {Object.keys(filteredCatalog).length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  Nenhuma métrica encontrada para &quot;{searchQuery}&quot;.
                </div>
              ) : (
                Object.entries(filteredCatalog).map(([catKey, metrics]) => {
                  const isExpanded = expandedCategories[catKey] || Boolean(searchQuery);
                  const catSelectedCount = metrics.filter(m => selectedMetrics.includes(m.id)).length;
                  const isAllCatSelected = metrics.length > 0 && catSelectedCount === metrics.length;
                  const isSomeCatSelected = catSelectedCount > 0 && !isAllCatSelected;

                  return (
                    <div key={catKey} className="transition-colors">
                      {/* Accordion Header */}
                      <div className="flex items-center justify-between p-3.5 hover:bg-slate-50/80 cursor-pointer select-none">
                        <div 
                          className="flex items-center gap-2 flex-1"
                          onClick={() => toggleAccordion(catKey)}
                        >
                          {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                          <span className="text-xs font-bold text-slate-900">
                            {CATEGORY_NAMES[catKey] || catKey.toUpperCase()}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-400">
                            ({catSelectedCount}/{metrics.length})
                          </span>
                        </div>

                        {/* Category Quick Select Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCategoryAll(metrics);
                          }}
                          className="text-[10px] font-bold text-slate-500 hover:text-blue-600 px-2 py-0.5 rounded hover:bg-slate-100 cursor-pointer"
                        >
                          {isAllCatSelected ? 'Desmarcar Grupo' : 'Marcar Grupo'}
                        </button>
                      </div>

                      {/* Accordion Body */}
                      {isExpanded && (
                        <div className="p-3 pt-0 grid grid-cols-1 gap-1 bg-slate-50/30">
                          {metrics.map((metric) => {
                            const isChecked = selectedMetrics.includes(metric.id);
                            return (
                              <label
                                key={metric.id}
                                className={`flex items-center justify-between p-2 rounded-xl text-xs transition-colors cursor-pointer ${
                                  isChecked ? 'bg-blue-50/60 text-slate-900 font-semibold' : 'hover:bg-slate-100/60 text-slate-700'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleMetric(metric.id)}
                                    className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4 border-slate-300"
                                  />
                                  <span className="truncate">{metric.label}</span>
                                </div>
                                <div className="shrink-0">
                                  {getFormatBadge(metric.format)}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 5. MULTI-TABS PREVIEW INFO */}
          <div className="bg-emerald-50/50 rounded-2xl p-4 border border-emerald-100 space-y-2">
            <h4 className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
              <Layers size={14} className="text-emerald-700" />
              Estrutura das Abas Geradas
            </h4>
            <div className="space-y-1.5">
              {tabsPreview.map((tab, idx) => (
                <div key={idx} className="bg-white/80 border border-emerald-200/60 rounded-xl p-2.5 flex items-start justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-800">{tab.title}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{tab.desc}</p>
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100/70 px-1.5 py-0.5 rounded">
                    Aba {idx + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 6. DAILY AUTOMATION TOGGLE */}
          {onToggleAutomation && (
            <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-900">Atualização Diária Automática</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Exporta e sincroniza com a planilha a cada 24h automaticamente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleAuto}
                  disabled={isSavingAuto || isSavingAutomation || !spreadsheetId.trim()}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isAutoEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      isAutoEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {isAutoEnabled && effectiveStatus && (
                <div className="border-t border-slate-100 pt-2.5 text-[10px] space-y-1 text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>Status da Automação:</span>
                    <span className={`font-bold uppercase ${
                      effectiveStatus.lastRunStatus === 'success' ? 'text-emerald-600' :
                      effectiveStatus.lastRunStatus === 'error' ? 'text-rose-600' : 'text-slate-500'
                    }`}>
                      {effectiveStatus.lastRunStatus === 'success' ? 'Ativo & Atualizado' :
                       effectiveStatus.lastRunStatus === 'error' ? 'Falha na Execução' : 'Agendado (Próximas 24h)'}
                    </span>
                  </div>
                  {effectiveStatus.lastRunAt && (
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Última Execução:</span>
                      <span>{new Date(effectiveStatus.lastRunAt).toLocaleString('pt-BR')}</span>
                    </div>
                  )}
                  {effectiveStatus.lastRunError && (
                    <div className="bg-rose-50 border border-rose-100 rounded-lg p-2 text-rose-700 mt-1 break-words font-medium">
                      <strong>Erro:</strong> {effectiveStatus.lastRunError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* DRAWER FOOTER ACTION */}
        <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 font-medium">
            <span className="font-bold text-slate-900">{selectedMetrics.length}</span> métricas prontas
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              id="btn-confirm-export-sheets"
              type="button"
              onClick={handleExportSubmit}
              disabled={isExporting || !spreadsheetId.trim() || selectedMetrics.length === 0}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all cursor-pointer"
            >
              {isExporting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Gerando Planilha...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet size={15} />
                  <span>Exportar para Sheets</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
