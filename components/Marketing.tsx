
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { apiFetch } from '../services/apiClient';
import { 
  Instagram, DollarSign, TrendingUp, Bot, Users, Target, MousePointer2, Eye,
  Filter, Loader2, Zap, AlertCircle, LayoutDashboard, Layers, Grid, Type, MessageSquare,
  ArrowUpRight, ArrowDownRight, Search, ChevronDown, ChevronUp, ChevronRight, X, Plus, Trash2, Calculator, Save, Bell,
  FileUp, Download, Image as ImageIcon, Play, Pause, Pencil, Settings, Folder, HelpCircle, Edit2, FileSpreadsheet
} from 'lucide-react';
import { AdPreviewDrawer } from './AdPreviewDrawer';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Brush, ComposedChart, Bar
} from 'recharts';
import html2canvas from 'html2canvas';
import { useApp } from '../App';
import { 
  getGoogleCampaigns, getGoogleOverview, getGoogleAdGroups, getGoogleKeywords, getGoogleAds, getGoogleAssetGroups,
  getGoogleMccOverview, getGoogleSearchTerms, getGooglePmaxAssets, checkGoogleAdsAlerts,
  toggleGoogleCampaignStatus, updateGoogleCampaignBudget
} from '../services/googleAdsService';
import {
  getMetaOverview, getMetaCampaigns, getMetaAdGroups, getMetaAds, getMetaSearchTerms,
  toggleMetaCampaignStatus, updateMetaCampaignBudget
} from '../services/metaAdsService';
import { signInWithGoogleSheets } from '../services/googleSheetsService';
import { GoogleAdsLogo, MetaAdsLogo } from './icons/CustomLogos';
import { DateRangePicker, DateRangeSelection } from './DateRangePicker';
import { CustomMetricBuilder } from './CustomMetricBuilder';
import { CustomMetricsManager } from './CustomMetricsManager';
import { evaluateFormula, formatValue, CustomMetric as CustomMetricFull } from '../utils/customMetrics';

// --- TYPES ---
type BaseMetricType = 'clicks' | 'impressions' | 'spend' | 'conversions' | 'conversionsValue';
type MetricType = BaseMetricType | string;
type MetricFormat = 'number' | 'currency' | 'percent';
type MetricOperator = '/' | '*' | '+' | '-';

interface CustomMetric {
    id: string;
    name: string;
    numerator: BaseMetricType;
    operator: MetricOperator;
    denominator: BaseMetricType;
    multiplier?: number;
    format: MetricFormat;
    color: string;
}

interface Alert {
    id: string;
    type: 'budget_warning' | 'cpl_warning' | 'status_change';
    severity: 'high' | 'medium' | 'low';
    message: string;
}

type SortConfig = { key: string; direction: 'asc' | 'desc' } | null;

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || !isFinite(denominator) || denominator === 0) return 0;
  const result = numerator / denominator;
  return isFinite(result) ? result : 0;
}

const PREBUILT_METRICS: CustomMetric[] = [
    { id: 'roas', name: 'ROAS', numerator: 'conversionsValue', operator: '/', denominator: 'spend', format: 'currency', color: '#10b981' },
    { id: 'convRate', name: 'Taxa de Conv.', numerator: 'conversions', operator: '/', denominator: 'clicks', multiplier: 100, format: 'percent', color: '#f59e0b' },
    { id: 'cpm', name: 'CPM', numerator: 'spend', operator: '/', denominator: 'impressions', multiplier: 1000, format: 'currency', color: '#6366f1' },
    { id: 'valuePerClick', name: 'Valor/Clique', numerator: 'conversionsValue', operator: '/', denominator: 'clicks', format: 'currency', color: '#ec4899' }
];

const DEFAULT_METRIC_STYLES: Record<string, { label: string, color: string, axisId: string, strokeDasharray: string }> = {
    clicks: { label: 'Cliques', color: '#3b82f6', axisId: 'left', strokeDasharray: '0' }, // Blue
    impressions: { label: 'Impressões', color: '#a855f7', axisId: 'right', strokeDasharray: '0' }, // Purple
    spend: { label: 'Custo', color: '#22c55e', axisId: 'left', strokeDasharray: '0' }, // Green
    conversions: { label: 'Conversões', color: '#f97316', axisId: 'right', strokeDasharray: '0' }, // Orange
    conversionsValue: { label: 'Valor Conv.', color: '#ef4444', axisId: 'left', strokeDasharray: '0' } // Red
};

const Marketing: React.FC = () => {
  const { marketingDateFilter, setMarketingDateFilterByLabel, setMarketingCustomDateRange, googleAdsToken, googleSheetsToken, setGoogleSheetsToken, metrics, user, metaAdsStatus, adsData, preloadAdsData } = useApp();
  const [loading, setLoading] = useState(false);
  const [activePlatform, setActivePlatform] = useState<'google' | 'meta'>('google');
  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'adgroups' | 'keywords' | 'ads' | 'assetgroups' | 'searchterms' | 'accounts'>('overview');
  
  // Google Sheets Export States
  const [isSheetsModalOpen, setIsSheetsModalOpen] = useState(false);
  const [exportSpreadsheetId, setExportSpreadsheetId] = useState(() => localStorage.getItem('google_sheets_export_id') || '');
  const [isExportingSheets, setIsExportingSheets] = useState(false);
  const [exportStartDate, setExportStartDate] = useState(() => marketingDateFilter.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [exportEndDate, setExportEndDate] = useState(() => marketingDateFilter.end || new Date().toISOString().split('T')[0]);
  const [sheetsError, setSheetsError] = useState<string | null>(null);
  const [sheetsSuccess, setSheetsSuccess] = useState<string | null>(null);
  const [exportAggregation, setExportAggregation] = useState<'daily' | 'monthly' | 'total'>('total');
  const [exportCampaignIds, setExportCampaignIds] = useState<string[]>(['all']);

  useEffect(() => {
    if (marketingDateFilter.start) setExportStartDate(marketingDateFilter.start);
    if (marketingDateFilter.end) setExportEndDate(marketingDateFilter.end);
  }, [marketingDateFilter]);
  
  // Data States
  const [overviewData, setOverviewData] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [adGroups, setAdGroups] = useState<any[]>([]);
  const [keywords, setKeywords] = useState<any[]>([]);
  const [ads, setAds] = useState<any[]>([]);
  const [assetGroups, setAssetGroups] = useState<any[]>([]);
  const [searchTerms, setSearchTerms] = useState<any[]>([]);
  
  // Meta Data States
  const [metaOverviewData, setMetaOverviewData] = useState<any[]>([]);
  const [metaCampaigns, setMetaCampaigns] = useState<any[]>([]);
  const [metaAdGroups, setMetaAdGroups] = useState<any[]>([]);
  const [metaAds, setMetaAds] = useState<any[]>([]);
  const [metaSearchTerms, setMetaSearchTerms] = useState<any[]>([]);
  const [pmaxAssets, setPmaxAssets] = useState<any[]>([]);
  const [mccAccounts, setMccAccounts] = useState<any[]>([]);
  const [isMccUser, setIsMccUser] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedAccountName, setSelectedAccountName] = useState<string>('');
  const [searchTermFilter, setSearchTermFilter] = useState('');
  const [selectedMetaAdIdForPreview, setSelectedMetaAdIdForPreview] = useState<string | null>(null);
  const [metaPreviewPlatform, setMetaPreviewPlatform] = useState<'facebook' | 'instagram' | 'stories'>('facebook');
  
  // Date Range State
  const [dateRange, setDateRange] = useState<DateRangeSelection>({
    preset: '30d',
    from: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000),
    to: new Date(),
    compareWithPrevious: false
  });

  const handleDateRangeChange = (selection: DateRangeSelection) => {
    setDateRange(selection);
    const startStr = selection.from.toISOString().split('T')[0];
    const endStr = selection.to.toISOString().split('T')[0];
    setMarketingCustomDateRange(startStr, endStr);
    setIsCompareEnabled(selection.compareWithPrevious);

    if (selection.compareWithPrevious) {
      const diffDays = Math.max(1, Math.round((selection.to.getTime() - selection.from.getTime()) / (24 * 60 * 60 * 1000)));
      const compFrom = new Date(selection.from.getTime() - diffDays * 24 * 60 * 60 * 1000);
      const compTo = new Date(selection.from.getTime() - 24 * 60 * 60 * 1000);
      setCompareDateFilter({
        start: compFrom.toISOString().split('T')[0],
        end: compTo.toISOString().split('T')[0]
      });
    }
  };

  // Comparison State
  const [isCompareEnabled, setIsCompareEnabled] = useState(false);
  const [compareDateFilter, setCompareDateFilter] = useState({ 
      start: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], 
      end: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] 
  });
  const [campaignsComparison, setCampaignsComparison] = useState<any[]>([]);
  const [overviewComparison, setOverviewComparison] = useState<any[]>([]);

  // Alerts State
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isAlertOpen, setIsAlertOpen] = useState(false);

  // Report State
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [reportConfig, setReportConfig] = useState({
      clientName: '',
      agencyName: '',
      logoUrl: ''
  });
  const chartRef = useRef<HTMLDivElement>(null);
  const metaPreviewRef = useRef<HTMLDivElement>(null);
  const selectedAdRowRef = useRef<HTMLTableRowElement>(null);

  // Selection States
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [selectedAdGroupIds, setSelectedAdGroupIds] = useState<Set<string>>(new Set());
  const [selectedAdIds, setSelectedAdIds] = useState<Set<string>>(new Set());
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<Set<string>>(new Set());
  const [selectedSearchTermIds, setSelectedSearchTermIds] = useState<Set<string>>(new Set());

  // Tree Table Drill-down State
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [expandedAdSets, setExpandedAdSets] = useState<Set<string>>(new Set());
  const [selectedAdForPreview, setSelectedAdForPreview] = useState<any | null>(null);
  const [isPreviewDrawerOpen, setIsPreviewDrawerOpen] = useState(false);

  const toggleCampaignExpand = (campaignId: string) => {
    setExpandedCampaigns(prev => {
      const next = new Set(prev);
      const id = campaignId.toString();
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAdSetExpand = (adSetId: string) => {
    setExpandedAdSets(prev => {
      const next = new Set(prev);
      const id = adSetId.toString();
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdClick = (ad: any) => {
    setSelectedAdForPreview(ad);
    setIsPreviewDrawerOpen(true);
    // Auto-scroll duplo pra garantir centralização após render
    setTimeout(() => {
      document.getElementById('ad-row-' + ad.id)?.scrollIntoView({behavior:'smooth', block:'center'});
    }, 100);
    setTimeout(() => {
      document.getElementById('ad-row-' + ad.id)?.scrollIntoView({behavior:'smooth', block:'center'});
    }, 350);
  };

  // Filters & UI State
  const [selectedMetrics, setSelectedMetrics] = useState<MetricType[]>(['clicks', 'spend']);
  const [globalCampaignFilter, setGlobalCampaignFilter] = useState<string>(''); // ID da campanha
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  // Clear selection and tree expansions on tab/platform/filter change
  useEffect(() => {
    setSelectedCampaignIds(new Set());
    setSelectedAdGroupIds(new Set());
    setSelectedAdIds(new Set());
    setSelectedKeywordIds(new Set());
    setSelectedSearchTermIds(new Set());
    setExpandedCampaigns(new Set());
    setExpandedAdSets(new Set());
    setSelectedAdForPreview(null);
    setIsPreviewDrawerOpen(false);
  }, [activePlatform, activeTab, globalCampaignFilter, searchTermFilter, marketingDateFilter]);

  useEffect(() => {
    if (expandedCampaigns.size > 0) {
      const firstExpanded = Array.from(expandedCampaigns)[0];
      setTimeout(() => document.getElementById('campaign-row-' + firstExpanded)?.scrollIntoView({behavior:'smooth', block:'nearest'}), 100);
    }
  }, [expandedCampaigns]);

  const toggleCampaignSelection = (id: string) => {
    setSelectedCampaignIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllCampaigns = (campaignsList: any[]) => {
    const allIds = campaignsList.map(c => c.id.toString());
    setSelectedCampaignIds(prev => {
      const allSelected = allIds.length > 0 && allIds.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        allIds.forEach(id => next.delete(id));
      } else {
        allIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const toggleAdGroupSelection = (id: string) => {
    setSelectedAdGroupIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllAdGroups = (adGroupsList: any[]) => {
    const allIds = adGroupsList.map(ag => ag.id.toString());
    setSelectedAdGroupIds(prev => {
      const allSelected = allIds.length > 0 && allIds.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        allIds.forEach(id => next.delete(id));
      } else {
        allIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const toggleAdSelection = (id: string) => {
    setSelectedAdIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllAds = (adsList: any[]) => {
    const allIds = adsList.map(ad => ad.id.toString());
    setSelectedAdIds(prev => {
      const allSelected = allIds.length > 0 && allIds.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        allIds.forEach(id => next.delete(id));
      } else {
        allIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const toggleKeywordSelection = (id: string) => setSelectedKeywordIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAllKeywords = (ids: string[]) => setSelectedKeywordIds(prev => { const allSelected = ids.length > 0 && ids.every(id => prev.has(id)); const next = new Set(prev); if (allSelected) ids.forEach(id => next.delete(id)); else ids.forEach(id => next.add(id)); return next; });

  const toggleSearchTermSelection = (id: string) => setSelectedSearchTermIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAllSearchTerms = (ids: string[]) => setSelectedSearchTermIds(prev => { const allSelected = ids.length > 0 && ids.every(id => prev.has(id)); const next = new Set(prev); if (allSelected) ids.forEach(id => next.delete(id)); else ids.forEach(id => next.add(id)); return next; });

  const handleSelectMetaAd = (id: string) => {
    setSelectedMetaAdIdForPreview(id);
    setTimeout(() => {
      metaPreviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    setTimeout(() => {
      selectedAdRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };
  
  // Custom Metrics State
  const [customMetrics, setCustomMetrics] = useState<CustomMetric[]>(() => {
      const saved = localStorage.getItem('googleAds_customMetrics');
      return saved ? JSON.parse(saved) : PREBUILT_METRICS;
  });
  const [isMetricModalOpen, setIsMetricModalOpen] = useState(false);
  const [metaCustomMetrics, setMetaCustomMetrics] = useState<CustomMetricFull[]>([]);
  const [isMetricBuilderOpen, setIsMetricBuilderOpen] = useState(false);
  const [isMetricManagerOpen, setIsMetricManagerOpen] = useState(false);
  const [editingCustomMetric, setEditingCustomMetric] = useState<CustomMetricFull | null>(null);

  const fetchMetaCustomMetrics = async () => {
    try {
      const accountParam = selectedAccountId ? `?ad_account_id=${selectedAccountId}` : '';
      const res = await apiFetch(`/api/meta-ads/custom-metrics${accountParam}`);
      if (res.ok) {
        const data = await res.json();
        setMetaCustomMetrics(data.metrics || []);
      }
    } catch (err) {
      console.error('[Meta Custom Metrics Fetch Error]:', err);
    }
  };

  useEffect(() => {
    fetchMetaCustomMetrics();
  }, [selectedAccountId, activePlatform]);

  const [newMetric, setNewMetric] = useState<Partial<CustomMetric>>({
      name: '',
      numerator: 'clicks',
      operator: '/',
      denominator: 'impressions',
      multiplier: 1,
      format: 'number',
      color: '#000000'
  });

  // Chart Customization State
  const [metricStyles, setMetricStyles] = useState(DEFAULT_METRIC_STYLES);

  // Mutation states (Google Ads)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [statusConfirmModal, setStatusConfirmModal] = useState<{ open: boolean, campaignId: string, campaignName: string, action: 'pause' | 'enable', customerId: string | null } | null>(null);
  
  const [metaStatusConfirmModal, setMetaStatusConfirmModal] = useState<{ open: boolean, campaignId: string, campaignName: string, action: 'pause' | 'enable' } | null>(null);
  const [metaBudgetModal, setMetaBudgetModal] = useState<{ open: boolean, adsetId: string, adsetName: string, currentBudget: number } | null>(null);
const [budgetModal, setBudgetModal] = useState<{ open: boolean, campaignId: string, budgetId: string, campaignName: string, currentBudget: number, customerId: string | null } | null>(null);
  const [newBudgetAmount, setNewBudgetAmount] = useState<string>('');
  const [activeStatusMenuCampaignId, setActiveStatusMenuCampaignId] = useState<string | null>(null);
  const [activeStatusMenuAdGroupId, setActiveStatusMenuAdGroupId] = useState<string | null>(null);
  const [activeStatusMenuKeywordId, setActiveStatusMenuKeywordId] = useState<string | null>(null);
  const [activeStatusMenuAdId, setActiveStatusMenuAdId] = useState<string | null>(null);

  // Update metric styles when custom metrics change
  useEffect(() => {
      const newStyles = { ...DEFAULT_METRIC_STYLES };
      customMetrics.forEach(m => {
          newStyles[m.id] = {
              label: m.name,
              color: m.color,
              axisId: m.format === 'percent' || m.numerator === 'impressions' ? 'right' : 'left',
              strokeDasharray: '0'
          };
      });
      setMetricStyles(newStyles);
      localStorage.setItem('googleAds_customMetrics', JSON.stringify(customMetrics));
  }, [customMetrics]);

  const lastFetchRef = useRef<{start: string, end: string, campaignId: string, compareStart?: string, compareEnd?: string, isCompare?: boolean} | null>(null);
  const isConnected = !!googleAdsToken;

  // --- ALERTS SYSTEM ---
  useEffect(() => {
      const fetchAlerts = async () => {
          if (!user || !googleAdsToken) return;
          try {
              const data = await checkGoogleAdsAlerts(user.id);
              if (data.alerts) {
                  const dismissed = JSON.parse(localStorage.getItem('dismissedAlerts') || '[]');
                  const newAlerts = data.alerts.filter((a: any) => !dismissed.includes(a.id));
                  setAlerts(newAlerts);
              }
          } catch (e) {
              console.error("Error fetching alerts", e);
          }
      };

      fetchAlerts();
      const interval = setInterval(fetchAlerts, 30 * 60 * 1000); // 30 mins
      return () => clearInterval(interval);
  }, [user]);

  const dismissAlert = (id: string) => {
      const dismissed = JSON.parse(localStorage.getItem('dismissedAlerts') || '[]');
      localStorage.setItem('dismissedAlerts', JSON.stringify([...dismissed, id]));
      setAlerts(prev => prev.filter(a => a.id !== id));
  };

  // --- METRIC CALCULATION ---
  const calculateMetricValue = (metric: CustomMetric, dataPoint: any) => {
      const num = Number(dataPoint[metric.numerator]) || 0;
      const den = Number(dataPoint[metric.denominator]) || 0;
      let result = 0;

      switch (metric.operator) {
          case '/': result = safeDivide(num, den); break;
          case '*': result = num * den; break;
          case '+': result = num + den; break;
          case '-': result = num - den; break;
      }

      if (metric.multiplier) result *= metric.multiplier;
      return isFinite(result) ? result : 0;
  };

  const formatMetricValue = (val: number, format: MetricFormat) => {
      if (format === 'currency') return `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      if (format === 'percent') return `${val.toFixed(2)}%`;
      return val.toLocaleString('pt-BR');
  };

  const handleSaveMetric = () => {
      if (!newMetric.name || !newMetric.numerator || !newMetric.denominator) return;
      
      const id = `custom_${Date.now()}`;
      const metric: CustomMetric = {
          id,
          name: newMetric.name!,
          numerator: newMetric.numerator!,
          operator: newMetric.operator as MetricOperator || '/',
          denominator: newMetric.denominator!,
          multiplier: newMetric.multiplier,
          format: newMetric.format as MetricFormat || 'number',
          color: newMetric.color || '#000000'
      };

      setCustomMetrics(prev => [...prev, metric]);
      setIsMetricModalOpen(false);
      setNewMetric({ name: '', numerator: 'clicks', operator: '/', denominator: 'impressions', multiplier: 1, format: 'number', color: '#000000' });
  };

  const handleDeleteMetric = (id: string) => {
      setCustomMetrics(prev => prev.filter(m => m.id !== id));
      setSelectedMetrics(prev => prev.filter(m => m !== id));
  };

  // --- BUDGET CALCULATION ---
  const getDaysDifference = (start: string, end: string) => {
      const startDate = new Date(start);
      const endDate = new Date(end);
      const timeDiff = Math.abs(endDate.getTime() - startDate.getTime());
      return Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1;
  };

  const daysInPeriod = useMemo(() => getDaysDifference(marketingDateFilter.start, marketingDateFilter.end), [marketingDateFilter]);
  
  const budgetMetrics = useMemo(() => {
      // Filter campaigns if global filter is active
      const campaignsToUse = activePlatform === 'meta' ? metaCampaigns : campaigns;
      const activeCampaigns = globalCampaignFilter 
          ? campaignsToUse.filter(c => c.id.toString() === globalCampaignFilter)
          : campaignsToUse;

      const totalDailyBudget = activeCampaigns.reduce((acc, c) => acc + (c.budget || 0), 0);
      const totalPeriodBudget = totalDailyBudget * daysInPeriod;
      
      // Calculate total spend from the campaigns data (which is already filtered by date in backend)
      const totalSpend = activeCampaigns.reduce((acc, c) => acc + (c.spend || 0), 0);
      
      const progress = totalPeriodBudget > 0 ? (totalSpend / totalPeriodBudget) * 100 : 0;
      
      return { totalPeriodBudget, totalSpend, progress };
  }, [campaigns, metaCampaigns, activePlatform, globalCampaignFilter, daysInPeriod]);

  // --- FETCH DATA ---
  const cacheRef = useRef<Record<string, any>>({});
  const apiCacheRef = useRef<Map<string, { data: any, timestamp: number }>>(new Map());
  const CACHE_DURATION = 30000; // 30 segundos

  const cachedApiCall = async (key: string, apiFn: () => Promise<any>) => {
      const cached = apiCacheRef.current.get(key);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
          return cached.data;
      }
      const data = await apiFn();
      apiCacheRef.current.set(key, { data, timestamp: Date.now() });
      return data;
  };

  // Clear cache when filters that affect all data change
  useEffect(() => {
      cacheRef.current = {};
  }, [marketingDateFilter.start, marketingDateFilter.end, isCompareEnabled, compareDateFilter.start, compareDateFilter.end, selectedAccountId, activePlatform]);

  useEffect(() => {
    const fetchData = async () => {
        if (!user || !marketingDateFilter.start || !marketingDateFilter.end) return;
        
        if (activePlatform === 'google') {
            const customerId = selectedAccountId || 'default';
            const compareKey = isCompareEnabled ? `${compareDateFilter.start}_${compareDateFilter.end}` : 'none';
            const baseCacheKey = `${marketingDateFilter.start}_${marketingDateFilter.end}_${customerId}_${compareKey}`;
            
            try {
                const promises = [];
                let overviewRes = cacheRef.current[`${baseCacheKey}_overview_${globalCampaignFilter || 'all'}`];
                let campaignsRes = cacheRef.current[`${baseCacheKey}_campaigns`];
                let adGroupsRes = cacheRef.current[`${baseCacheKey}_adgroups`];
                let keywordsRes = cacheRef.current[`${baseCacheKey}_keywords`];
                let adsRes = cacheRef.current[`${baseCacheKey}_ads`];
                let searchTermsRes = cacheRef.current[`${baseCacheKey}_searchterms`];
                let assetGroupsRes = globalCampaignFilter ? cacheRef.current[`${baseCacheKey}_assetgroups_${globalCampaignFilter}`] : [];
                let pmaxAssetsRes = globalCampaignFilter ? cacheRef.current[`${baseCacheKey}_pmaxassets_${globalCampaignFilter}`] : [];

                if (!overviewRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_overview_${globalCampaignFilter || 'all'}`,
                            () => getGoogleOverview(user.id, marketingDateFilter, globalCampaignFilter || undefined, isCompareEnabled ? compareDateFilter : undefined, selectedAccountId || undefined)
                        ).then(res => { overviewRes = res; cacheRef.current[`${baseCacheKey}_overview_${globalCampaignFilter || 'all'}`] = res; })
                    );
                }
                if (!campaignsRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_campaigns`,
                            () => getGoogleCampaigns(user.id, marketingDateFilter, isCompareEnabled ? compareDateFilter : undefined, selectedAccountId || undefined)
                        ).then(res => { campaignsRes = res; cacheRef.current[`${baseCacheKey}_campaigns`] = res; })
                    );
                }
                if (!adGroupsRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_adgroups`,
                            () => getGoogleAdGroups(user.id, marketingDateFilter, selectedAccountId || undefined)
                        ).then(res => { adGroupsRes = res; cacheRef.current[`${baseCacheKey}_adgroups`] = res; })
                    );
                }
                if (!keywordsRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_keywords`,
                            () => getGoogleKeywords(user.id, marketingDateFilter, selectedAccountId || undefined)
                        ).then(res => { keywordsRes = res; cacheRef.current[`${baseCacheKey}_keywords`] = res; })
                    );
                }
                if (!adsRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_ads`,
                            () => getGoogleAds(user.id, marketingDateFilter, selectedAccountId || undefined)
                        ).then(res => { adsRes = res; cacheRef.current[`${baseCacheKey}_ads`] = res; })
                    );
                }
                if (!searchTermsRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_searchterms`,
                            () => getGoogleSearchTerms(user.id, marketingDateFilter, selectedAccountId || undefined)
                        ).then(res => { searchTermsRes = res; cacheRef.current[`${baseCacheKey}_searchterms`] = res; })
                    );
                }
                if (globalCampaignFilter && !assetGroupsRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_assetgroups_${globalCampaignFilter}`,
                            () => getGoogleAssetGroups(user.id, marketingDateFilter, globalCampaignFilter, selectedAccountId || undefined)
                        ).then(res => { assetGroupsRes = res; cacheRef.current[`${baseCacheKey}_assetgroups_${globalCampaignFilter}`] = res; })
                    );
                }
                if (globalCampaignFilter && !pmaxAssetsRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_pmaxassets_${globalCampaignFilter}`,
                            () => getGooglePmaxAssets(user.id, globalCampaignFilter, selectedAccountId || undefined)
                        ).then(res => { pmaxAssetsRes = res; cacheRef.current[`${baseCacheKey}_pmaxassets_${globalCampaignFilter}`] = res; })
                    );
                }

                if (promises.length > 0) {
                    setLoading(true);
                    await Promise.all(promises);
                }

                // Set states
                if (overviewRes) {
                    if ('current' in overviewRes) {
                        setOverviewData([...overviewRes.current].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()));
                        setOverviewComparison([...(overviewRes.previous || [])].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()));
                    } else {
                        setOverviewData([...(Array.isArray(overviewRes) ? overviewRes : [])].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()));
                        setOverviewComparison([]);
                    }
                } else {
                    setOverviewData([]);
                    setOverviewComparison([]);
                }

                if (campaignsRes) {
                    if ('current' in campaignsRes) {
                        setCampaigns(campaignsRes.current);
                        setCampaignsComparison(campaignsRes.previous || []);
                    } else {
                        setCampaigns(Array.isArray(campaignsRes) ? campaignsRes : []);
                        setCampaignsComparison([]);
                    }
                } else {
                    setCampaigns([]);
                    setCampaignsComparison([]);
                }

                setAdGroups(adGroupsRes || []);
                setKeywords(keywordsRes || []);
                setAds(adsRes || []);
                setSearchTerms(searchTermsRes || []);
                setAssetGroups(globalCampaignFilter ? (assetGroupsRes || []) : []);
                setPmaxAssets(globalCampaignFilter ? (pmaxAssetsRes || []) : []);
                
            } catch (error) {
                console.error("Error fetching Google data:", error);
            } finally {
                setLoading(false);
            }
        } else if (activePlatform === 'meta') {
            const baseCacheKey = `${marketingDateFilter.start}_${marketingDateFilter.end}_meta`;
            try {
                const promises = [];
                let metaOverviewRes = cacheRef.current[`${baseCacheKey}_overview`];
                let metaCampaignsRes = cacheRef.current[`${baseCacheKey}_campaigns`];
                let metaAdGroupsRes = cacheRef.current[`${baseCacheKey}_adgroups`];
                let metaAdsRes = cacheRef.current[`${baseCacheKey}_ads`];
                let metaSearchTermsRes = [];

                if (!metaOverviewRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_overview`,
                            () => getMetaOverview(user.id, marketingDateFilter)
                        ).then(res => { metaOverviewRes = res; cacheRef.current[`${baseCacheKey}_overview`] = res; })
                    );
                }
                if (!metaCampaignsRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_campaigns`,
                            () => getMetaCampaigns(user.id, marketingDateFilter)
                        ).then(res => { metaCampaignsRes = res; cacheRef.current[`${baseCacheKey}_campaigns`] = res; })
                    );
                }
                if (!metaAdGroupsRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_adgroups`,
                            () => getMetaAdGroups(user.id, marketingDateFilter)
                        ).then(res => { metaAdGroupsRes = res; cacheRef.current[`${baseCacheKey}_adgroups`] = res; })
                    );
                }
                if (!metaAdsRes) {
                    promises.push(
                        cachedApiCall(
                            `${baseCacheKey}_ads`,
                            () => getMetaAds(user.id, marketingDateFilter)
                        ).then(res => { metaAdsRes = res; cacheRef.current[`${baseCacheKey}_ads`] = res; })
                    );
                }

                if (promises.length > 0) {
                    setLoading(true);
                    await Promise.all(promises);
                }

                setMetaOverviewData([...(Array.isArray(metaOverviewRes) ? metaOverviewRes : [])].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()));
                setMetaCampaigns(Array.isArray(metaCampaignsRes) ? metaCampaignsRes : []);
                setMetaAdGroups(Array.isArray(metaAdGroupsRes) ? metaAdGroupsRes : []);
                setMetaAds(Array.isArray(metaAdsRes) ? metaAdsRes : []);
                setMetaSearchTerms([]);

            } catch (error) {
                console.error("Error fetching Meta data:", error);
            } finally {
                setLoading(false);
            }
        }
    };

    fetchData();
  }, [user, marketingDateFilter, globalCampaignFilter, isCompareEnabled, compareDateFilter, selectedAccountId, activePlatform]);

  // MCC Check
  useEffect(() => {
      if (!googleAdsToken) return;
      if (user && marketingDateFilter.start && marketingDateFilter.end) {
          getGoogleMccOverview(user.id, marketingDateFilter).then(accounts => {
              if (accounts && accounts.length > 0) {
                  setMccAccounts(accounts);
                  setIsMccUser(true);
              }
          }).catch(err => console.error("MCC Check Error", err));
      }
  }, [user, marketingDateFilter]);

  
  const handleToggleMetaCampaign = async () => {
      if (!user || !metaStatusConfirmModal) return;
      setActionLoadingId(metaStatusConfirmModal.campaignId);
      try {
          await toggleMetaCampaignStatus(user.id, metaStatusConfirmModal.campaignId, metaStatusConfirmModal.action);
          alert(`Campanha ${metaStatusConfirmModal.action === 'pause' ? 'pausada' : 'ativada'} com sucesso!`);
          
          setMetaCampaigns(prev => prev.map(c => c.id === metaStatusConfirmModal.campaignId ? { ...c, status: metaStatusConfirmModal.action === 'pause' ? 'PAUSED' : 'ACTIVE' } : c));
      } catch (error: any) {
          alert(`Erro ao alterar status: ${error.message}`);
      } finally {
          setActionLoadingId(null);
          setMetaStatusConfirmModal(null);
      }
  };

  const handleUpdateMetaBudget = async () => {
      if (!user || !metaBudgetModal || !newBudgetAmount) return;
      const numAmount = parseFloat(newBudgetAmount);
      if (isNaN(numAmount) || numAmount <= 0) {
          alert('Insira um valor válido para o orçamento.');
          return;
      }
      setActionLoadingId(metaBudgetModal.adsetId);
      try {
          await updateMetaCampaignBudget(user.id, metaBudgetModal.adsetId, numAmount);
          alert(`Orçamento atualizado com sucesso!`);
          
          setMetaAdGroups(prev => prev.map(ag => ag.id === metaBudgetModal.adsetId ? { ...ag, spend: numAmount } : ag));
      } catch (error: any) {
          alert(`Erro ao atualizar orçamento: ${error.message}`);
      } finally {
          setActionLoadingId(null);
          setMetaBudgetModal(null);
          setNewBudgetAmount('');
      }
  };

  const handleToggleGoogleCampaign = async () => {
      if (!user || !statusConfirmModal) return;
      const campaignId = statusConfirmModal.campaignId;
      const newStatus = statusConfirmModal.action === 'pause' ? 'PAUSED' : 'ENABLED';
      setActionLoadingId(campaignId);
      try {
          await toggleGoogleCampaignStatus(user.id, statusConfirmModal.customerId!, campaignId, statusConfirmModal.action);

          // Atualização otimista: mudar status local imediatamente
          setCampaigns(prev => prev.map(c => 
            c.id === campaignId 
              ? { ...c, status: newStatus } 
              : c
          ));

          alert(`Campanha ${statusConfirmModal.action === 'pause' ? 'pausada' : 'ativada'} com sucesso!`);

          cacheRef.current = {};
          try {
            const campaignsRes = await getGoogleCampaigns(user.id, marketingDateFilter, isCompareEnabled ? compareDateFilter : undefined, selectedAccountId || undefined);
            if (campaignsRes) {
              if ('current' in campaignsRes) {
                setCampaigns(campaignsRes.current);
                setCampaignsComparison(campaignsRes.previous || []);
              } else {
                setCampaigns(Array.isArray(campaignsRes) ? campaignsRes : []);
              }
            }
          } catch (refetchErr) {
            console.error("Erro no re-fetch do Google Campaigns:", refetchErr);
          }
      } catch (error: any) {
          alert(`Erro ao alterar status: ${error.message}`);
      } finally {
          setActionLoadingId(null);
          setStatusConfirmModal(null);
      }
  };

  const handleUpdateGoogleBudget = async () => {
      if (!user || !budgetModal || !newBudgetAmount) return;
      const numAmount = parseFloat(newBudgetAmount);
      if (isNaN(numAmount) || numAmount <= 0) {
          alert("Digite um valor válido para o orçamento");
          return;
      }

      setActionLoadingId(budgetModal.campaignId);
      try {
          await updateGoogleCampaignBudget(user.id, budgetModal.customerId!, budgetModal.budgetId, numAmount);
          alert(`Orçamento atualizado para R$ ${numAmount.toFixed(2)} com sucesso!`);
          setCampaigns(prev => prev.map(c => c.id === budgetModal.campaignId ? { ...c, budget: numAmount } : c));
      } catch (error: any) {
          alert(`Erro ao atualizar orçamento: ${error.message}`);
      } finally {
          setActionLoadingId(null);
          setBudgetModal(null);
          setNewBudgetAmount('');
      }
  };

  // Check if we already have preloaded overview data from App context or state
  const hasPreloadedOverview = useMemo(() => {
      if (activePlatform === 'google') {
          return (adsData?.marketing?.googleOverview && adsData.marketing.googleOverview.length > 0) || overviewData.length > 0 || campaigns.length > 0;
      } else {
          return (adsData?.marketing?.metaOverview && adsData.marketing.metaOverview.length > 0) || metaOverviewData.length > 0 || metaCampaigns.length > 0;
      }
  }, [activePlatform, adsData?.marketing?.googleOverview, adsData?.marketing?.metaOverview, overviewData, metaOverviewData, campaigns, metaCampaigns]);

  // --- PLATFORM ADAPTERS ---
  const currentOverviewData = useMemo(() => {
      if (activePlatform === 'google' && adsData?.marketing?.googleOverview) {
          return adsData.marketing.googleOverview.map((row: any) => ({
              date: row.segments?.date,
              clicks: parseInt(row.metrics?.clicks) || 0,
              impressions: parseInt(row.metrics?.impressions) || 0,
              spend: (parseInt(row.metrics?.costMicros) || 0) / 1000000,
              conversions: parseFloat(row.metrics?.conversions) || 0,
              conversionsValue: parseFloat(row.metrics?.conversionsValue) || 0
          })).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      }
      if (activePlatform === 'meta' && adsData?.marketing?.metaOverview) {
          return adsData.marketing.metaOverview.map((row: any) => ({
              date: row.date,
              clicks: parseInt(row.clicks) || 0,
              impressions: parseInt(row.impressions) || 0,
              spend: parseFloat(row.spend) || 0,
              conversions: parseInt(row.conversions) || 0
          })).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      }
      return activePlatform === 'meta' ? metaOverviewData : overviewData;
  }, [activePlatform, metaOverviewData, overviewData, adsData?.marketing?.googleOverview, adsData?.marketing?.metaOverview]);

  const currentOverviewComparison = useMemo(() => {
      return activePlatform === 'meta' ? [] : overviewComparison;
  }, [activePlatform, overviewComparison]);

  const currentCampaigns = useMemo(() => {
      return activePlatform === 'meta' ? metaCampaigns : campaigns;
  }, [activePlatform, metaCampaigns, campaigns]);

  const currentAdGroups = useMemo(() => {
      return activePlatform === 'meta' ? metaAdGroups : adGroups;
  }, [activePlatform, metaAdGroups, adGroups]);

  const currentAds = useMemo(() => {
      return activePlatform === 'meta' ? metaAds : ads;
  }, [activePlatform, metaAds, ads]);

  const currentSearchTerms = useMemo(() => {
      return activePlatform === 'meta' ? metaSearchTerms : searchTerms;
  }, [activePlatform, metaSearchTerms, searchTerms]);

  // --- FILTERED DATA (FRONTEND) ---
  const selectedCampaign = currentCampaigns.find(c => c.id.toString() === globalCampaignFilter);
  const campaignType = selectedCampaign?.type || ''; // PERFORMANCE_MAX, SEARCH, DISPLAY, VIDEO, etc.

  const filteredCampaigns = globalCampaignFilter 
      ? currentCampaigns.filter(c => c.id.toString() === globalCampaignFilter)
      : currentCampaigns;

  const filteredAdGroups = useMemo(() => {
      let data = currentAdGroups;
      if (globalCampaignFilter) {
          const campName = currentCampaigns.find(c => c.id.toString() === globalCampaignFilter)?.name;
          if (campName) data = data.filter(ag => ag.campaignName === campName);
      }
      return data;
  }, [currentAdGroups, globalCampaignFilter, currentCampaigns]);

  const filteredKeywords = useMemo(() => {
      let data = keywords;
      if (globalCampaignFilter) {
          const campName = currentCampaigns.find(c => c.id.toString() === globalCampaignFilter)?.name;
          if (campName) data = data.filter(kw => kw.campaignName === campName);
      }
      return data;
  }, [keywords, globalCampaignFilter, currentCampaigns]);

  const filteredAds = useMemo(() => {
      let data = currentAds;
      if (globalCampaignFilter) {
          const campName = currentCampaigns.find(c => c.id.toString() === globalCampaignFilter)?.name;
          if (campName) data = data.filter(ad => ad.campaignName === campName);
      }
      return data;
  }, [currentAds, globalCampaignFilter, currentCampaigns]);

  // --- HELPER FUNCTIONS ---
  const formatCurrency = (val: number) => `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const formatNumber = (val: number) => val.toLocaleString('pt-BR');
  const formatPercent = (val: number) => `${val.toFixed(2)}%`;

  const toggleMetric = (metric: MetricType) => {
      setSelectedMetrics(prev => 
          prev.includes(metric) ? prev.filter(m => m !== metric) : [...prev, metric]
      );
  };

  const handleSort = (key: string) => {
      setSortConfig(current => {
          if (current?.key === key) {
              return current.direction === 'asc' ? { key, direction: 'desc' } : null;
          }
          return { key, direction: 'asc' };
      });
  };

  const updateMetricStyle = (metric: MetricType, field: 'color' | 'strokeDasharray', value: string) => {
      setMetricStyles(prev => ({
          ...prev,
          [metric]: { ...prev[metric], [field]: value }
      }));
  };

  const sortData = (data: any[]) => {
      if (!sortConfig) return data;
      return [...data].sort((a, b) => {
          let valA = a[sortConfig.key];
          let valB = b[sortConfig.key];
          
          if (sortConfig.key === 'ctr') {
              valA = (a.clicks / a.impressions) || 0;
              valB = (b.clicks / b.impressions) || 0;
          } else if (sortConfig.key === 'cpc') {
              valA = (a.spend / a.clicks) || 0;
              valB = (b.spend / b.clicks) || 0;
          } else if (sortConfig.key === 'convRate') {
              valA = (a.conversions / a.clicks) || 0;
              valB = (b.conversions / b.clicks) || 0;
          } else if (sortConfig.key === 'costPerConv') {
              valA = a.conversions > 0 ? (a.spend / a.conversions) : 0;
              valB = b.conversions > 0 ? (b.spend / b.conversions) : 0;
          }
          
          if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
          if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
      });
  };

  // --- RENDERERS ---
  const renderSortIcon = (key: string) => {
      if (sortConfig?.key !== key) return <div className="w-3 h-3 ml-1 opacity-20"><ChevronDown size={12}/></div>;
      return sortConfig.direction === 'asc' ? <ChevronUp size={12} className="ml-1 text-navy"/> : <ChevronDown size={12} className="ml-1 text-navy"/>;
  };

  const renderStatusBadge = (status: string, platform: 'meta' | 'google' = 'google') => {
      const s = (status || '').toUpperCase();
      if (platform === 'meta') {
          if (s === 'ACTIVE' || s === 'ENABLED') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-emerald-100 text-emerald-700">Ativo</span>;
          if (s === 'PAUSED' || s === 'CAMPAIGN_PAUSED' || s === 'ADSET_PAUSED') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-amber-100 text-amber-700">Pausado</span>;
          if (s === 'IN_REVIEW' || s === 'PENDING' || s === 'PENDING_REVIEW') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-blue-100 text-blue-700">Em revisão</span>;
          if (s === 'DISAPPROVED') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-red-100 text-red-700">Reprovado</span>;
          if (s === 'WITH_ISSUES') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-orange-100 text-orange-700">Com problemas</span>;
          if (s === 'SUSPENDED') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-rose-100 text-rose-700">Suspensa</span>;
          if (s === 'DELETED') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-red-200 text-red-800">Excluído</span>;
          if (s === 'ARCHIVED') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-slate-300 text-slate-700">Arquivado</span>;
          return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-slate-100 text-slate-500">{status || '—'}</span>;
      }
      // Google Ads
      if (s === 'ENABLED' || s === 'ACTIVE') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-emerald-100 text-emerald-700">Ativo</span>;
      if (s === 'PAUSED') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-amber-100 text-amber-700">Pausado</span>;
      if (s === 'REMOVED' || s === 'DELETED') return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-red-100 text-red-700">Removido</span>;
      return <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-slate-100 text-slate-500">{status || '—'}</span>;
  };

  const renderCampaignResults = (c: any) => {
      // Determine the result label based on the campaign objective or type
      const getObjectiveLabel = (obj: string) => {
          const o = (obj || '').toUpperCase();
          if (o.includes('CONVERSIONS') || o.includes('OUTCOME_SALES') || o.includes('SALES')) return 'Conversões (Compras)';
          if (o.includes('LEAD') || o.includes('OUTCOME_LEADS')) return 'Cadastros (Leads)';
          if (o.includes('TRAFFIC') || o.includes('OUTBOUND_CLICKS') || o.includes('LINK_CLICKS')) return 'Cliques no Link';
          if (o.includes('POST_ENGAGEMENT') || o.includes('ENGAGEMENT')) return 'Engajamento';
          if (o.includes('APP_INSTALLS') || o.includes('APP_PROMOTION')) return 'Instalações de App';
          if (o.includes('VIDEO_VIEWS')) return 'Visualizações de Vídeo';
          if (o.includes('MESSAGING') || o.includes('OUTCOME_TRAFFIC')) return 'Conversas por mensagem iniciadas';
          return 'Resultados';
      };

      const label = getObjectiveLabel(c.type || c.objective);
      const value = c.conversions || 0;

      return (
          <div className="flex flex-col items-end group/tooltip relative">
              <span className="font-bold text-indigo-600 bg-indigo-50/20 px-1.5 py-0.5 rounded">{formatNumber(value)}</span>
              <span className="text-[9px] text-slate-400 mt-0.5 cursor-help" title={label}>{label}</span>
          </div>
      );
  };

  // --- TOTALS CALCULATION ---
  const calculateTotals = (data: any[]) => {
      const totals = data.reduce((acc, curr) => ({
          impressions: acc.impressions + (curr.impressions || 0),
          clicks: acc.clicks + (curr.clicks || 0),
          spend: acc.spend + (curr.spend || 0),
          conversions: acc.conversions + (curr.conversions || 0),
          conversionsValue: acc.conversionsValue + (curr.conversionsValue || 0),
      }), { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionsValue: 0 });

      return {
          ...totals,
          ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
          cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
          costPerConv: totals.conversions > 0 ? totals.spend / totals.conversions : 0
      };
  };

  const processedOverviewData = useMemo(() => {
      return currentOverviewData.map((day: any) => {
          const enhancedDay = { ...day };
          customMetrics.forEach(metric => {
              enhancedDay[metric.id] = calculateMetricValue(metric, day);
          });
          return enhancedDay;
      });
  }, [currentOverviewData, customMetrics]);

  const processedComparisonData = useMemo(() => {
      return currentOverviewComparison.map((day: any) => {
          const enhancedDay = { ...day };
          customMetrics.forEach(metric => {
              enhancedDay[metric.id] = calculateMetricValue(metric, day);
          });
          return enhancedDay;
      });
  }, [currentOverviewComparison, customMetrics]);

  const periodTotals = useMemo(() => calculateTotals(currentOverviewData), [currentOverviewData]);
  const periodTotalsComparison = useMemo(() => calculateTotals(currentOverviewComparison), [currentOverviewComparison]);

  const chartData = useMemo(() => {
      if (!isCompareEnabled) return processedOverviewData;
      
      const merged = [];
      const maxLength = Math.max(processedOverviewData.length, processedComparisonData.length);
      
      for (let i = 0; i < maxLength; i++) {
          const current = processedOverviewData[i] || {};
          const previous = processedComparisonData[i] || {};
          
          const item: any = { ...current };
          
          // Add previous metrics with _prev suffix
          Object.keys(previous).forEach(key => {
              if (key !== 'date') {
                  item[`${key}_prev`] = previous[key];
              }
          });
          
          item.compareDate = previous.date;
          merged.push(item);
      }
      return merged;
  }, [processedOverviewData, processedComparisonData, isCompareEnabled]);

  const calculateVariation = (current: number, previous: number) => {
      if (!previous || previous === 0) return 0;
      return ((current - previous) / previous) * 100;
  };

  const renderVariation = (current: number, previous: number, inverse = false) => {
      if (!isCompareEnabled || !previous) return null;
      const variation = calculateVariation(current, previous);
      if (variation === 0) return <span className="text-[9px] text-slate-300 font-bold ml-1">-</span>;
      
      const isPositive = variation > 0;
      const isGood = inverse ? !isPositive : isPositive;
      
      const color = isGood ? 'text-emerald-600' : 'text-rose-600';
      const Icon = isPositive ? ChevronUp : ChevronDown;
      
      return (
          <div className={`flex items-center gap-0.5 ${color} text-[9px] font-bold mt-1`}>
              <Icon size={10} strokeWidth={3} />
              <span>{Math.abs(variation).toFixed(1)}%</span>
              <span className="text-slate-400 font-medium ml-1 hidden xl:inline">vs anterior</span>
          </div>
      );
  };

  const renderCellWithVariation = (value: number, previousValue: number | undefined, format: MetricFormat, inverse = false) => {
      const formatted = format === 'currency' ? formatCurrency(value) : format === 'percent' ? formatPercent(value) : formatNumber(value);
      
      if (!isCompareEnabled || previousValue === undefined) return formatted;
      
      const variation = calculateVariation(value, previousValue);
      if (variation === 0) return formatted;
      
      const isPositive = variation > 0;
      const isGood = inverse ? !isPositive : isPositive;
      const color = isGood ? 'text-emerald-600' : 'text-rose-600';
      const Icon = isPositive ? ChevronUp : ChevronDown;

      return (
          <div className="flex flex-col">
              <span>{formatted}</span>
              <div className={`flex items-center gap-0.5 ${color} text-[9px] font-bold`}>
                  <Icon size={8} strokeWidth={3} />
                  <span>{Math.abs(variation).toFixed(0)}%</span>
              </div>
          </div>
      );
  };

  const filteredCampaignsComparison = useMemo(() => {
      if (!globalCampaignFilter) return campaignsComparison;
      return campaignsComparison.filter(c => c.id.toString() === globalCampaignFilter);
  }, [campaignsComparison, globalCampaignFilter]);

  const getPrevCampaign = (id: string) => campaignsComparison.find(c => c.id === id);

  const handleExportReport = async () => {
      setIsGeneratingReport(true);
      try {
          // 1. Capture Chart Image
          let chartImage = '';
          if (chartRef.current) {
              const canvas = await html2canvas(chartRef.current, { scale: 2 });
              chartImage = canvas.toDataURL('image/png');
          }

          // 2. Prepare Data Payload
          const payload = {
              client_name: reportConfig.clientName,
              agency_name: reportConfig.agencyName,
              date_range: marketingDateFilter,
              logo_url: reportConfig.logoUrl,
              kpis: {
                  cost: formatCurrency(periodTotals.spend),
                  impressions: formatNumber(periodTotals.impressions),
                  clicks: formatNumber(periodTotals.clicks),
                  conversions: formatNumber(periodTotals.conversions),
                  ctr: formatPercent(periodTotals.ctr),
                  cpc: formatCurrency(periodTotals.cpc)
              },
              campaigns: campaigns.map(c => ({
                  name: c.name,
                  status: c.status,
                  impressions: c.impressions,
                  clicks: c.clicks,
                  cost: c.spend,
                  conversions: c.conversions
              })),
              chart_image: chartImage
          };

          // 3. Send to Backend
          const response = await apiFetch('/api/google-ads/generate-report', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
          });

          if (!response.ok) throw new Error('Falha ao gerar relatório');

          // 4. Download PDF
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          
          const hasGoogle = !!googleAdsToken;
          const hasMeta = !!metaAdsStatus;
          let platformLabel = 'Marketing';
          if (hasGoogle && hasMeta) {
              platformLabel = 'Google_e_Meta';
          } else if (hasGoogle) {
              platformLabel = 'GoogleAds';
          } else if (hasMeta) {
              platformLabel = 'MetaAds';
          }
          
          a.download = `Relatorio_${platformLabel}_${marketingDateFilter.start}_${marketingDateFilter.end}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);

          setIsReportModalOpen(false);
      } catch (error) {
          console.error("Erro ao exportar relatório:", error);
          alert("Erro ao gerar relatório. Tente novamente.");
      } finally {
          setIsGeneratingReport(false);
      }
  };

  const handleConnectSheets = async () => {
    try {
      await signInWithGoogleSheets();
    } catch (err: any) {
      alert("Erro ao conectar ao Google Sheets: " + err.message);
    }
  };

  const handleExportGoogleAdsToSheets = async () => {
    if (!exportSpreadsheetId.trim()) {
      setSheetsError('Por favor, informe o ID ou link da planilha.');
      return;
    }

    if (!exportCampaignIds.includes('all') && exportCampaignIds.length === 0) {
      setSheetsError('Por favor, selecione ao menos uma campanha para exportar, ou selecione "Exportar Todas".');
      return;
    }
    
    setIsExportingSheets(true);
    setSheetsError(null);
    setSheetsSuccess(null);
    
    try {
      localStorage.setItem('google_sheets_export_id', exportSpreadsheetId.trim());
      
      const res = await apiFetch('/api/google-sheets/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          spreadsheet_id: exportSpreadsheetId.trim(),
          data_type: 'google_ads',
          start_date: exportStartDate,
          end_date: exportEndDate,
          sheets_token: googleSheetsToken,
          campaign_ids: exportCampaignIds,
          aggregation: exportAggregation
        })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        if (res.status === 401 || data.code === 'UNAUTHENTICATED') {
          throw new Error('Autenticação expirada do Google Sheets. Por favor, reautorize sua conta clicando em conectar.');
        }
        throw new Error(data.error || 'Erro ao exportar dados para a planilha.');
      }
      
      setSheetsSuccess(data.message || 'Dados do Google Ads exportados com sucesso! Verifique sua planilha.');
    } catch (err: any) {
      console.error('[Google Ads Sheet Export Error]:', err);
      setSheetsError(err.message || 'Ocorreu um erro desconhecido ao exportar.');
    } finally {
      setIsExportingSheets(false);
    }
  };

  const isPlatformConnected = activePlatform === 'meta' ? !!metaAdsStatus : isConnected;

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-20">
      {/* HEADER */}
      <header className="flex flex-col gap-4 md:gap-6">
        <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-fit border border-slate-200/60 shadow-inner">
            <button
                onClick={() => {
                    setActivePlatform('google');
                    setActiveTab('overview');
                }}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs md:text-sm font-semibold tracking-wide transition-all ${
                    activePlatform === 'google' 
                        ? 'bg-white text-navy shadow-md scale-102 font-bold' 
                        : 'text-slate-500 hover:text-slate-800'
                }`}
            >
                <GoogleAdsLogo size={24} />
                <span>Google Ads</span>
            </button>
            <button
                onClick={() => {
                    setActivePlatform('meta');
                    setActiveTab('overview');
                }}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs md:text-sm font-semibold tracking-wide transition-all ${
                    activePlatform === 'meta' 
                        ? 'bg-white text-navy shadow-md scale-102 font-bold' 
                        : 'text-slate-500 hover:text-slate-800'
                }`}
            >
                <MetaAdsLogo size={24} />
                <span>Meta Ads</span>
            </button>
        </div>

        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div>
                <h2 className="text-xl md:text-2xl font-bold text-navy tracking-tight">{activePlatform === 'meta' ? 'Meta Ads' : 'Google Ads'}</h2>
                <div className="flex items-center gap-2 mt-1">
                    {isPlatformConnected ? (
                        <span className="bg-emerald-50 text-emerald-700 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-emerald-100 flex items-center gap-1"><Zap size={8} fill="currentColor"/> Conectado</span>
                    ) : (
                        <span className="bg-amber-50 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-amber-100 flex items-center gap-1"><AlertCircle size={8} /> Desconectado</span>
                    )}
                    {loading && hasPreloadedOverview && (
                        <span className="bg-blue-50 text-blue-700 text-[9px] font-bold px-2.5 py-0.5 rounded uppercase tracking-widest border border-blue-100 flex items-center gap-1 animate-pulse">
                            <Loader2 size={10} className="animate-spin text-blue-600" /> Sincronizando...
                        </span>
                    )}
                </div>
            </div>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
                <div className="flex items-center gap-2 justify-between sm:justify-start">
                    {/* EXPORT REPORT */}
                    <button 
                        onClick={() => setIsReportModalOpen(true)}
                        className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition-all hover:text-navy shadow-sm shrink-0"
                        title="Exportar Relatório PDF"
                    >
                        <FileUp size={18} />
                    </button>

                    {/* EXPORT GOOGLE SHEETS */}
                    {activePlatform === 'google' && (
                        <button 
                            onClick={() => {
                                setSheetsError(null);
                                setSheetsSuccess(null);
                                setIsSheetsModalOpen(true);
                            }}
                            className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-emerald-600 hover:text-emerald-700 transition-all shadow-sm shrink-0 flex items-center gap-1.5 font-semibold text-xs px-3"
                            title="Exportar para Google Sheets"
                        >
                            <FileSpreadsheet size={16} />
                            <span className="hidden sm:inline">Exportar para Sheets</span>
                        </button>
                    )}

                    {/* ALERTS */}
                    <div className="relative shrink-0">
                        <button 
                            onClick={() => setIsAlertOpen(!isAlertOpen)}
                            className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 relative shadow-sm transition-all hover:shadow-md"
                        >
                            <Bell size={18} className="text-slate-600" />
                            {alerts.length > 0 && (
                                <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center rounded-full border-2 border-white shadow-sm animate-pulse">
                                    {alerts.length}
                                </span>
                            )}
                        </button>

                        {isAlertOpen && (
                            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 backdrop-blur-sm">
                                    <h3 className="text-xs font-bold text-navy uppercase tracking-wider flex items-center gap-2">
                                        <Bell size={12} /> Notificações
                                    </h3>
                                    <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{alerts.length} novas</span>
                                </div>
                                <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                    {alerts.length === 0 ? (
                                        <div className="p-8 text-center flex flex-col items-center gap-2">
                                            <div className="w-8 h-8 bg-slate-50 rounded-full flex items-center justify-center text-slate-300">
                                                <Bell size={14} />
                                            </div>
                                            <p className="text-slate-400 text-xs font-medium">Tudo tranquilo por aqui.</p>
                                        </div>
                                    ) : (
                                        alerts.map(alert => (
                                            <div key={alert.id} className="p-3 border-b border-slate-50 hover:bg-slate-50 flex gap-3 group relative transition-colors">
                                                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 shadow-sm ${
                                                    alert.severity === 'high' ? 'bg-rose-500 shadow-rose-200' : 
                                                    alert.severity === 'medium' ? 'bg-amber-500 shadow-amber-200' : 'bg-blue-500 shadow-blue-200'
                                                }`} />
                                                <div className="flex-1 pr-4">
                                                    <p className="text-xs text-slate-600 leading-relaxed font-medium">{alert.message}</p>
                                                    <span className="text-[9px] text-slate-400 font-bold mt-1.5 block uppercase tracking-wider flex items-center gap-1">
                                                        {alert.type === 'budget_warning' && <DollarSign size={8} />}
                                                        {alert.type === 'cpl_warning' && <TrendingUp size={8} />}
                                                        {alert.type === 'status_change' && <AlertCircle size={8} />}
                                                        {alert.type === 'budget_warning' ? 'Orçamento' : 
                                                         alert.type === 'cpl_warning' ? 'Desempenho' : 'Status'}
                                                    </span>
                                                </div>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); dismissAlert(alert.id); }}
                                                    className="absolute top-2 right-2 p-1 hover:bg-slate-200 rounded-full text-slate-400 transition-all hover:text-rose-500"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* THE RESPONSIVE DATE PICKER */}
                <DateRangePicker value={dateRange} onChange={handleDateRangeChange} />
            </div>
        </div>

        {/* GLOBAL CAMPAIGN FILTER */}
        <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200 w-full md:w-fit shadow-sm mb-6">
            <div className="p-1.5 bg-slate-50 rounded-lg text-slate-400"><Filter size={14}/></div>
            <select 
                value={globalCampaignFilter}
                onChange={(e) => setGlobalCampaignFilter(e.target.value)}
                className="bg-transparent text-sm font-medium text-slate-700 focus:outline-none w-full md:w-auto md:min-w-[300px] cursor-pointer"
            >
                <option value="">Todas as Campanhas</option>
                {currentCampaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                ))}
            </select>
            {globalCampaignFilter && (
                <button onClick={() => setGlobalCampaignFilter('')} className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-rose-500 transition-colors">
                    <X size={14}/>
                </button>
            )}
        </div>
      </header>

      {/* TABS */}
      <div className="flex overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100 pb-2 gap-4 md:gap-6 border-b border-slate-200 mb-6 md:mb-8">
          {(activePlatform === 'meta' ? [
              { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard },
              { id: 'campaigns', label: 'Campanhas', icon: Layers },
              { id: 'adgroups', label: 'Conjuntos de Anúncios', icon: Grid },
              { id: 'ads', label: 'Anúncios', icon: MessageSquare }
          ] : [
              { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard },
              ...(isMccUser ? [{ id: 'accounts', label: 'Contas', icon: Users }] : []),
              { id: 'campaigns', label: 'Campanhas', icon: Layers },
              ...(campaignType === 'PERFORMANCE_MAX' ? [
                  { id: 'assetgroups', label: 'Grupos de Recursos', icon: Grid }
              ] : [
                  { id: 'adgroups', label: 'Grupos de Anúncios', icon: Grid },
                  { id: 'keywords', label: 'Palavras-chave', icon: Type },
                  { id: 'searchterms', label: 'Termos de Busca', icon: Search }
              ]),
              { id: 'ads', label: 'Anúncios', icon: MessageSquare },
          ]).map(tab => (
              <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 pb-3 text-sm font-medium transition-colors whitespace-nowrap relative ${activeTab === tab.id ? (activePlatform === 'meta' ? 'text-[#0866ff]' : 'text-blue-600') : 'text-slate-500 hover:text-slate-800'}`}
              >
                  <tab.icon size={16} className={activeTab === tab.id ? (activePlatform === 'meta' ? 'text-[#0866ff]' : 'text-blue-600') : 'text-slate-400'} />
                  {tab.label}
                  {activeTab === tab.id && (
                      <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${activePlatform === 'meta' ? 'bg-[#0866ff]' : 'bg-blue-600'} rounded-t-full`} />
                  )}
              </button>
          ))}
      </div>

      {loading && !hasPreloadedOverview ? (
        <div className="h-96 flex flex-col items-center justify-center gap-4 bg-white rounded-2xl border border-slate-200">
          <Loader2 size={32} className="text-navy animate-spin" />
          <p className="text-[10px] font-bold text-navy uppercase tracking-widest">Carregando dados do {activePlatform === 'meta' ? 'Meta' : 'Google'} Ads...</p>
        </div>
      ) : (
        <div className="space-y-6">
            {selectedAccountId && (
                <div className="bg-indigo-600 text-white px-4 py-3 rounded-xl shadow-md shadow-indigo-200 text-xs font-bold uppercase tracking-widest flex justify-between items-center animate-in fade-in slide-in-from-top-4">
                    <div className="flex items-center gap-2">
                        <Users size={16} />
                        <span>Visualizando conta: {selectedAccountName}</span>
                    </div>
                    <button 
                        onClick={() => { setSelectedAccountId(null); setSelectedAccountName(''); }} 
                        className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition-colors flex items-center gap-1"
                    >
                        <X size={12} /> Limpar Filtro
                    </button>
                </div>
            )}
            
            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
                <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2.5 md:gap-4">
                        {[
                            { label: 'Custo', value: formatCurrency(periodTotals.spend), icon: DollarSign, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.spend, periodTotalsComparison.spend, true) },
                            { label: 'Cliques', value: formatNumber(periodTotals.clicks), icon: MousePointer2, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.clicks, periodTotalsComparison.clicks) },
                            { label: 'Impressões', value: formatNumber(periodTotals.impressions), icon: Eye, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.impressions, periodTotalsComparison.impressions) },
                            { label: 'CTR', value: formatPercent(periodTotals.ctr), icon: Target, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.ctr, periodTotalsComparison.ctr) },
                            { label: 'CPC Médio', value: formatCurrency(periodTotals.cpc), icon: TrendingUp, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.cpc, periodTotalsComparison.cpc, true) },
                            { label: 'Conversões', value: formatNumber(periodTotals.conversions), icon: Zap, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.conversions, periodTotalsComparison.conversions) },
                            { label: 'Custo/Conv.', value: formatCurrency(periodTotals.costPerConv), icon: DollarSign, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.costPerConv, periodTotalsComparison.costPerConv, true) },
                        ].map((kpi, idx) => (
                            <div key={kpi.label} className="bg-white p-3 md:p-5 rounded-xl md:rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between h-[84px] md:h-28 hover:shadow-md transition-shadow">
                                <div className="flex justify-between items-start">
                                    <span className="text-[8px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate mr-1">{kpi.label}</span>
                                    <div className={`p-1 md:p-1.5 rounded-lg shrink-0 ${kpi.bg} ${kpi.color}`}><kpi.icon size={12} className="md:w-3.5 md:h-3.5" /></div>
                                </div>
                                <div className="mt-1 md:mt-2">
                                    <p className="text-sm md:text-xl font-black tracking-tight text-navy leading-none truncate">{kpi.value}</p>
                                    {kpi.variation}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* BUDGET PANEL */}
                    <div className={`bg-white p-4 md:p-6 rounded-xl md:rounded-2xl border shadow-sm mb-6 mt-6 ${budgetMetrics.progress > 95 ? 'border-rose-200 ring-1 ring-rose-100' : budgetMetrics.progress > 80 ? 'border-amber-200 ring-1 ring-amber-100' : 'border-slate-200'}`}>
                        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 md:gap-6">
                            <div className="flex items-center gap-3 md:gap-4">
                                <div className={`p-2.5 md:p-3 rounded-xl shrink-0 ${budgetMetrics.progress > 95 ? 'bg-rose-100 text-rose-600' : budgetMetrics.progress > 80 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>
                                    <DollarSign size={20} className="md:w-6 md:h-6" />
                                </div>
                                <div>
                                    <h3 className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Orçamento do Período</h3>
                                    <div className="flex items-baseline flex-wrap gap-1.5">
                                        <span className="text-lg md:text-3xl font-black text-navy leading-none">{formatCurrency(budgetMetrics.totalSpend)}</span>
                                        <span className="text-[10px] md:text-xs font-medium text-slate-400">de {formatCurrency(budgetMetrics.totalPeriodBudget)}</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex-1 w-full max-w-md">
                                <div className="flex justify-between text-[10px] md:text-xs font-medium mb-1.5">
                                    <span className={budgetMetrics.progress > 95 ? 'text-rose-600 font-bold' : 'text-slate-500'}>
                                        {formatPercent(budgetMetrics.progress)} consumido
                                    </span>
                                    {budgetMetrics.progress > 95 && <span className="text-rose-600 font-bold flex items-center gap-1 text-[9px] md:text-xs"><AlertCircle size={10} className="md:w-3.5 md:h-3.5"/> Limite</span>}
                                </div>
                                <div className="h-1.5 md:h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-500 ${budgetMetrics.progress > 95 ? 'bg-rose-500' : budgetMetrics.progress > 80 ? 'bg-amber-500' : 'bg-blue-500'}`}
                                        style={{ width: `${Math.min(budgetMetrics.progress, 100)}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CHART */}
                    <div ref={chartRef} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mt-6">
                        <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
                            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Desempenho no Período</h3>
                            <div className="flex flex-wrap gap-2 items-center">
                                {Object.entries(metricStyles).map(([key, style]) => (
                                    <div key={key} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all border ${selectedMetrics.includes(key as MetricType) ? 'bg-slate-50 border-slate-200 shadow-sm' : 'border-transparent opacity-50 hover:opacity-100 hover:bg-slate-50'}`}>
                                        <button 
                                            onClick={() => toggleMetric(key as MetricType)}
                                            className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${selectedMetrics.includes(key as MetricType) ? 'text-slate-800' : 'text-slate-500'}`}
                                        >
                                            {style.label}
                                        </button>
                                        
                                        {selectedMetrics.includes(key as MetricType) && (
                                            <div className="flex items-center gap-1 pl-1.5 border-l border-slate-200">
                                                <div className="relative w-2.5 h-2.5 rounded-full overflow-hidden cursor-pointer shadow-sm ring-1 ring-slate-200 hover:scale-110 transition-transform">
                                                    <input 
                                                        type="color" 
                                                        value={style.color}
                                                        onChange={(e) => updateMetricStyle(key as MetricType, 'color', e.target.value)}
                                                        className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] p-0 border-0 cursor-pointer"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {/* Delete button for custom metrics */}
                                        {customMetrics.some(m => m.id === key) && (
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDeleteMetric(key); }}
                                                className="ml-0.5 p-0.5 text-slate-400 hover:text-rose-500 rounded-full hover:bg-rose-50 transition-colors"
                                                title="Excluir métrica"
                                            >
                                                <Trash2 size={10} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                
                                <div className="flex items-center gap-1.5 border-l border-slate-200 pl-2">
                                    <button 
                                        onClick={() => { setEditingCustomMetric(null); setIsMetricBuilderOpen(true); }}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors text-[10px] font-bold uppercase tracking-wider"
                                    >
                                        <Plus size={12} /> Criar Métrica
                                    </button>
                                    <button 
                                        onClick={() => setIsMetricManagerOpen(true)}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors text-[10px] font-bold uppercase tracking-wider"
                                    >
                                        <Calculator size={12} /> Gerenciar Métricas ({metaCustomMetrics.length})
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="h-64 md:h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                                    <XAxis 
                                        dataKey="date" 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fontSize: 10, fill: '#64748b', fontWeight: 500 }} 
                                        tickFormatter={(val) => new Date(val).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                        minTickGap={30}
                                        dy={10}
                                    />
                                    <YAxis yAxisId="left" orientation="left" hide />
                                    <YAxis yAxisId="right" orientation="right" hide />
                                    <Tooltip 
                                        content={({ active, payload, label }) => {
                                            if (active && payload && payload.length) {
                                                const currentItem = payload[0].payload;
                                                return (
                                                    <div className="bg-white p-4 rounded-xl shadow-lg border border-slate-100 min-w-[200px]">
                                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 pb-2 border-b border-slate-100">
                                                            {new Date(label).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}
                                                            {isCompareEnabled && currentItem.compareDate && (
                                                                <span className="ml-1 text-slate-400 font-medium">vs {new Date(currentItem.compareDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span>
                                                            )}
                                                        </p>
                                                        <div className="space-y-2">
                                                            {payload.map((entry: any, index: number) => {
                                                                if (entry.dataKey.endsWith('_prev')) return null;
                                                                
                                                                const key = Object.keys(metricStyles).find(k => metricStyles[k].label === entry.name);
                                                                const customMetric = key ? customMetrics.find(m => m.id === key) : null;
                                                                
                                                                const formatVal = (val: number) => customMetric 
                                                                    ? formatMetricValue(val, customMetric.format)
                                                                    : (key === 'spend' || key === 'conversionsValue' ? formatCurrency(val) : formatNumber(val));

                                                                const currentVal = entry.value;
                                                                const prevVal = currentItem[`${key}_prev`];
                                                                
                                                                return (
                                                                    <div key={`tooltip-${entry.name || index}`} className="flex items-center justify-between gap-6 text-sm">
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                                                            <span className="text-slate-600 font-medium">{entry.name}</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-2 text-right">
                                                                            <span className="text-slate-900 font-bold">{formatVal(currentVal)}</span>
                                                                            {isCompareEnabled && prevVal !== undefined && (
                                                                                <span className="text-slate-400 text-xs font-medium">({formatVal(prevVal)})</span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    {selectedMetrics.map(metric => (
                                        <React.Fragment key={metric}>
                                            <Line
                                                yAxisId={metricStyles[metric].axisId}
                                                type="monotone"
                                                dataKey={metric}
                                                name={metricStyles[metric].label}
                                                stroke={metricStyles[metric].color}
                                                strokeWidth={2}
                                                strokeDasharray={metricStyles[metric].strokeDasharray}
                                                dot={false}
                                                activeDot={{ r: 5, strokeWidth: 0, fill: metricStyles[metric].color }}
                                            />
                                            {isCompareEnabled && (
                                                <Line
                                                    yAxisId={metricStyles[metric].axisId}
                                                    type="monotone"
                                                    dataKey={`${metric}_prev`}
                                                    name={`${metricStyles[metric].label} (Anterior)`}
                                                    stroke={metricStyles[metric].color}
                                                    strokeWidth={2}
                                                    strokeDasharray="4 4"
                                                    strokeOpacity={0.4}
                                                    dot={false}
                                                    activeDot={false}
                                                />
                                            )}
                                        </React.Fragment>
                                    ))}
                                    <Brush dataKey="date" height={24} stroke="#cbd5e1" fill="#f8fafc" tickFormatter={() => ''} className="mt-4" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </>
            )}

            {/* CAMPAIGNS TAB */}
            {activeTab === 'campaigns' && (
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                    {loading && filteredCampaigns.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-white">
                            <Loader2 className="animate-spin text-blue-600 mb-3" size={32} />
                            <span className="text-sm font-medium text-slate-500">Carregando campanhas...</span>
                        </div>
                    ) : activePlatform === 'meta' ? (
                        <>
                            <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
                                <table className="w-full min-w-[800px] text-left border-collapse">
                                    <thead className="sticky top-0 bg-[#f8f9fa] border-b border-slate-250 z-20">
                                        <tr className="divide-x divide-slate-200 h-9 md:h-10 text-slate-600">
                                            <th className="w-10 px-2 text-center border-r border-slate-200">
                                                <input 
                                                    type="checkbox" 
                                                    className="rounded border-slate-300 text-[#0866ff] focus:ring-[#0866ff] w-3 h-3 md:w-3.5 md:h-3.5 cursor-pointer" 
                                                    checked={sortData(filteredCampaigns).length > 0 && sortData(filteredCampaigns).every(c => selectedCampaignIds.has(c.id.toString()))}
                                                    onChange={() => toggleAllCampaigns(sortData(filteredCampaigns))}
                                                />
                                            </th>
                                            <th className="w-32 px-2 text-center border-r border-slate-200 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-slate-500">Veiculação</th>
                                            {[
                                                { k: 'name', l: 'Campanha', align: 'left' },
                                                { k: 'budget', l: 'Orçamento', align: 'right' },
                                                { k: 'type', l: 'Objetivo', align: 'left' },
                                                { k: 'impressions', l: 'Alcance', align: 'right' },
                                                { k: 'clicks', l: 'Cliques no Link', align: 'right' },
                                                { k: 'ctr', l: 'CTR (todos)', align: 'right' },
                                                { k: 'averageCpc', l: 'CPC Méd.', align: 'right' },
                                                { k: 'spend', l: 'Valor Gasto', align: 'right' },
                                                { k: 'conversions', l: 'Resultados', align: 'right' },
                                                { k: 'costPerConv', l: 'Custo por Result.', align: 'right' }
                                            ].map(h => (
                                                <th 
                                                    key={h.k} 
                                                    onClick={() => handleSort(h.k)} 
                                                    className={`px-2 md:px-4 py-1.5 md:py-2 text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-normal whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 text-${h.align}`}
                                                >
                                                    <div className={`flex items-center gap-1 ${h.align === 'right' ? 'justify-end' : 'justify-start'}`}>
                                                        <span>{h.l}</span>
                                                        {renderSortIcon(h.k)}
                                                    </div>
                                                </th>
                                            ))}
                                            {metaCustomMetrics.map(m => (
                                                <th 
                                                    key={m.id || m.name} 
                                                    className="px-2 md:px-4 py-1.5 md:py-2 text-[9px] md:text-[10px] font-bold text-indigo-700 uppercase tracking-normal whitespace-nowrap border-r border-slate-200 text-right bg-indigo-50/50"
                                                >
                                                    <div className="flex items-center gap-1 justify-end" title={m.formula}>
                                                        <Calculator size={11} className="text-indigo-500" />
                                                        <span>{m.name}</span>
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 text-slate-700">
                                        {sortData(filteredCampaigns).map((c, i) => {
                                            const isExpanded = expandedCampaigns.has(c.id.toString());
                                            const childAdSets = metaAdGroups.filter(ag => 
                                                (ag.campaign_id || ag.campaignId || ag.campaign_id?.toString()) == c.id?.toString()
                                            );

                                            return (
                                                <React.Fragment key={`meta-camp-${c.id}`}>
                                                    {/* Level 1: Campaign Row */}
                                                    <tr id={`campaign-row-${c.id}`} className="group hover:bg-[#f2f4f7]/40 transition-colors duration-150 h-10 md:h-12 divide-x divide-slate-200">
                                                        <td className="px-2 py-1.5 text-center w-10 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                            <input 
                                                                type="checkbox" 
                                                                className="rounded border-slate-300 text-[#0866ff] focus:ring-[#0866ff] w-3 h-3 md:w-3.5 md:h-3.5 cursor-pointer" 
                                                                checked={selectedCampaignIds.has(c.id.toString())}
                                                                onChange={() => toggleCampaignSelection(c.id.toString())}
                                                            />
                                                        </td>
                                                        <td className="px-2 py-1.5 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                            <div className="flex items-center justify-between gap-2 px-1 min-w-[120px]">
                                                                {renderStatusBadge(c.effective_status || c.status, 'meta')}
                                                                <label className="relative inline-flex items-center cursor-pointer">
                                                                    <input 
                                                                        type="checkbox" 
                                                                        checked={c.status === 'ENABLED' || c.status === 'ACTIVE'} 
                                                                        onChange={() => {
                                                                            const newStatus = (c.status === 'ENABLED' || c.status === 'ACTIVE') ? 'PAUSED' : 'ENABLED';
                                                                            setCampaigns(prev => prev.map(item => item.id === c.id ? { ...item, status: newStatus } : item));
                                                                        }}
                                                                        className="sr-only peer" 
                                                                    />
                                                                    <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3.5 after:transition-all peer-checked:bg-[#0866ff]"></div>
                                                                </label>
                                                            </div>
                                                        </td>
                                                        <td className="px-2 md:px-4 py-1.5 md:py-2 font-normal">
                                                            <div className="flex items-center gap-1.5 overflow-hidden">
                                                                <button 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        toggleCampaignExpand(c.id.toString());
                                                                    }}
                                                                    className="p-1 hover:bg-slate-200/70 rounded text-slate-500 hover:text-slate-900 transition-colors shrink-0"
                                                                    title={isExpanded ? "Recolher Conjuntos" : "Expandir Conjuntos"}
                                                                >
                                                                    {isExpanded ? <ChevronDown size={14} className="text-[#0866ff] font-bold" /> : <ChevronRight size={14} />}
                                                                </button>
                                                                <div className="w-4 h-4 md:w-5 md:h-5 bg-[#0866ff]/10 border border-[#0866ff]/20 rounded flex items-center justify-center shrink-0">
                                                                    <Instagram size={10} className="text-[#0866ff]" />
                                                                </div>
                                                                <span 
                                                                    onClick={(e) => { e.stopPropagation(); toggleCampaignExpand(c.id.toString()); }}
                                                                    className="text-[#0866ff] hover:underline font-semibold cursor-pointer truncate text-xs md:text-sm"
                                                                    title={c.name}
                                                                >
                                                                    {c.name}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-2 md:px-4 py-1.5 md:py-2 text-right text-[11px] md:text-xs font-medium text-slate-800">
                                                            <div>
                                                                <p className="font-semibold">{formatCurrency(c.budget || 0)}</p>
                                                                <p className="text-[8px] md:text-[9px] text-slate-400 font-normal">Diário</p>
                                                            </div>
                                                        </td>
                                                        <td className="px-2 md:px-4 py-1.5 md:py-2 text-left text-[11px] md:text-xs font-normal text-slate-500 uppercase tracking-wider">
                                                            <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[9px] md:text-[10px] font-semibold">{c.type?.replace(/_/g, ' ')}</span>
                                                        </td>
                                                        <td className="px-2 md:px-4 py-1.5 md:py-2 text-right text-[11px] md:text-xs font-normal text-slate-800">
                                                            {formatNumber(c.impressions)}
                                                        </td>
                                                        <td className="px-2 md:px-4 py-1.5 md:py-2 text-right text-[11px] md:text-xs font-normal text-slate-800">
                                                            {formatNumber(c.clicks)}
                                                        </td>
                                                        <td className="px-2 md:px-4 py-1.5 md:py-2 text-right text-[11px] md:text-xs font-normal text-slate-800">
                                                            {formatPercent(c.ctr * 100 || 0)}
                                                        </td>
                                                        <td className="px-2 md:px-4 py-1.5 md:py-2 text-right text-[11px] md:text-xs font-normal text-slate-800">
                                                            {formatCurrency(c.averageCpc || 0)}
                                                        </td>
                                                        <td className="px-2 md:px-4 py-1.5 md:py-2 text-right text-[11px] md:text-xs font-bold text-slate-800">
                                                            {formatCurrency(c.spend)}
                                                        </td>
                                                        <td className="px-2 md:px-4 py-1.5 md:py-2 text-right text-[11px] md:text-xs font-bold text-indigo-600 bg-indigo-50/20">
                                                            {renderCampaignResults(c)}
                                                        </td>
                                                        <td className="px-2 md:px-4 py-1.5 md:py-2 text-right text-[11px] md:text-xs font-semibold text-slate-800">
                                                            {formatCurrency(c.conversions > 0 ? c.spend / c.conversions : 0)}
                                                        </td>
                                                        {metaCustomMetrics.map(m => (
                                                            <td key={m.id || m.name} className="px-2 md:px-4 py-1.5 md:py-2 text-right text-[11px] md:text-xs font-semibold text-indigo-700 bg-indigo-50/10 border-r border-slate-200">
                                                                {formatValue(evaluateFormula(m.formula, c), m.format)}
                                                            </td>
                                                        ))}
                                                    </tr>

                                                    {/* Level 2: AdSets for Expanded Campaign */}
                                                    {isExpanded && childAdSets.map((ag) => {
                                                        const isAdSetExpanded = expandedAdSets.has(ag.id.toString());
                                                        const childAds = metaAds.filter(ad => 
                                                            (ad.adset_id || ad.ad_group_id || ad.adSetId || ad.ad_group_id?.toString()) == ag.id?.toString() ||
                                                            ad.campaign_id == c.id
                                                        );

                                                        return (
                                                            <React.Fragment key={`meta-ag-${ag.id}`}>
                                                                <tr className="bg-slate-50/80 hover:bg-slate-100/80 transition-colors h-10 divide-x divide-slate-200 text-slate-700 border-l-4 border-l-blue-500">
                                                                    <td className="px-2 py-1.5 text-center w-10 border-r border-slate-200">
                                                                        <input 
                                                                            type="checkbox" 
                                                                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-600 w-3 h-3 cursor-pointer"
                                                                            checked={selectedAdGroupIds.has(ag.id.toString())}
                                                                            onChange={() => toggleAdGroupSelection?.(ag.id.toString())}
                                                                        />
                                                                    </td>
                                                                    <td className="px-2 py-1.5 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                                        <div className="flex items-center justify-between gap-2 px-1 min-w-[120px]">
                                                                            {renderStatusBadge(ag.effective_status || ag.status || 'ENABLED', 'meta')}
                                                                            <label className="relative inline-flex items-center cursor-pointer">
                                                                                <input 
                                                                                    type="checkbox" 
                                                                                    checked={ag.status === 'ENABLED' || ag.status === 'ACTIVE'} 
                                                                                    onChange={() => {
                                                                                        setMetaAdGroups(prev => prev.map(item => item.id === ag.id ? { ...item, status: (ag.status === 'ENABLED' || ag.status === 'ACTIVE') ? 'PAUSED' : 'ENABLED' } : item));
                                                                                    }}
                                                                                    className="sr-only peer" 
                                                                                />
                                                                                <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3.5 after:transition-all peer-checked:bg-[#0866ff]"></div>
                                                                            </label>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-2 md:px-4 py-1.5 font-normal pl-8">
                                                                        <div className="flex items-center gap-1.5 overflow-hidden">
                                                                            <button 
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    toggleAdSetExpand(ag.id.toString());
                                                                                }}
                                                                                className="p-1 hover:bg-slate-200/70 rounded text-slate-500 hover:text-slate-900 transition-colors shrink-0"
                                                                                title={isAdSetExpanded ? "Recolher Anúncios" : "Expandir Anúncios"}
                                                                            >
                                                                                {isAdSetExpanded ? <ChevronDown size={13} className="text-indigo-600 font-bold" /> : <ChevronRight size={13} />}
                                                                            </button>
                                                                            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[9px] font-bold uppercase shrink-0">Conjunto</span>
                                                                            <span onClick={(e) => { e.stopPropagation(); toggleAdSetExpand(ag.id.toString()); }} className="font-semibold text-slate-800 text-xs truncate cursor-pointer hover:text-blue-600 hover:underline" title={ag.name}>{ag.name}</span>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-2 md:px-4 py-1.5 text-right text-xs font-medium text-slate-700">{formatCurrency(ag.budget || ag.daily_budget || 0)}</td>
                                                                    <td className="px-2 md:px-4 py-1.5 text-left text-xs text-slate-500 uppercase">{ag.type || ag.optimization_goal || 'Conjunto'}</td>
                                                                    <td className="px-2 md:px-4 py-1.5 text-right text-xs">{formatNumber(ag.impressions || 0)}</td>
                                                                    <td className="px-2 md:px-4 py-1.5 text-right text-xs">{formatNumber(ag.clicks || 0)}</td>
                                                                    <td className="px-2 md:px-4 py-1.5 text-right text-xs">{formatPercent((ag.ctr || 0) * 100)}</td>
                                                                    <td className="px-2 md:px-4 py-1.5 text-right text-xs">{formatCurrency(ag.cpc || ag.averageCpc || 0)}</td>
                                                                    <td className="px-2 md:px-4 py-1.5 text-right text-xs font-semibold">{formatCurrency(ag.spend || 0)}</td>
                                                                    <td className="px-2 md:px-4 py-1.5 text-right text-xs font-semibold text-indigo-600">{formatNumber(ag.conversions || 0)}</td>
                                                                    <td className="px-2 md:px-4 py-1.5 text-right text-xs">{formatCurrency(ag.conversions > 0 ? (ag.spend || 0) / ag.conversions : 0)}</td>
                                                                    {metaCustomMetrics.map(m => (
                                                                        <td key={m.id || m.name} className="px-2 md:px-4 py-1.5 text-right text-xs text-indigo-700 bg-indigo-50/10 border-r border-slate-200">
                                                                            {formatValue(evaluateFormula(m.formula, ag), m.format)}
                                                                        </td>
                                                                    ))}
                                                                </tr>

                                                                {/* Level 3: Ads inside AdSet */}
                                                                {isAdSetExpanded && childAds.map((ad) => (
                                                                    <tr 
                                                                        key={`meta-ad-${ad.id}`}
                                                                        id={'ad-row-' + ad.id}
                                                                        ref={selectedAdForPreview?.id === ad.id ? selectedAdRowRef : null}
                                                                        onClick={() => handleAdClick(ad)}
                                                                        className={`transition-colors h-9 divide-x divide-slate-200 text-slate-700 cursor-pointer border-l-4 border-l-indigo-600 ${selectedAdForPreview?.id === ad.id ? 'bg-blue-50 ring-2 ring-blue-200' : 'bg-indigo-50/30 hover:bg-indigo-100/60'}`}
                                                                    >
                                                                        <td className="px-2 py-1 text-center w-10 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                                            <input 
                                                                                type="checkbox" 
                                                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 w-3 h-3 cursor-pointer"
                                                                                checked={selectedAdIds.has(ad.id.toString())}
                                                                                onChange={() => toggleAdSelection?.(ad.id.toString())}
                                                                            />
                                                                        </td>
                                                                        <td className="px-2 py-1 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                                            <div className="flex items-center justify-between gap-2 px-1 min-w-[120px]">
                                                                                {renderStatusBadge(ad.effective_status || ad.status || 'ENABLED', 'meta')}
                                                                                <label className="relative inline-flex items-center cursor-pointer">
                                                                                    <input 
                                                                                        type="checkbox" 
                                                                                        checked={ad.status === 'ENABLED' || ad.status === 'ACTIVE'} 
                                                                                        onChange={() => {
                                                                                            setMetaAds(prev => prev.map(item => item.id === ad.id ? { ...item, status: (ad.status === 'ENABLED' || ad.status === 'ACTIVE') ? 'PAUSED' : 'ENABLED' } : item));
                                                                                        }}
                                                                                        className="sr-only peer" 
                                                                                    />
                                                                                    <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3.5 after:transition-all peer-checked:bg-[#0866ff]"></div>
                                                                                </label>
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-2 md:px-4 py-1 font-normal pl-16">
                                                                            <div className="flex items-center gap-2 overflow-hidden">
                                                                                <button 
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        handleAdClick(ad);
                                                                                    }}
                                                                                    className="p-1 text-indigo-600 hover:text-indigo-900 bg-indigo-100 rounded hover:bg-indigo-200 transition-colors shrink-0"
                                                                                    title="Ver Preview do Anúncio"
                                                                                >
                                                                                    <Eye size={12} />
                                                                                </button>
                                                                                <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-900 text-[9px] font-bold uppercase shrink-0">Anúncio</span>
                                                                                <span className="font-semibold text-slate-900 text-xs truncate" title={ad.name}>{ad.name}</span>
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-2 md:px-4 py-1 text-right text-xs text-slate-400">-</td>
                                                                        <td className="px-2 md:px-4 py-1 text-left text-xs text-slate-500 uppercase">{ad.creative?.type || 'Anúncio'}</td>
                                                                        <td className="px-2 md:px-4 py-1 text-right text-xs">{formatNumber(ad.impressions || 0)}</td>
                                                                        <td className="px-2 md:px-4 py-1 text-right text-xs">{formatNumber(ad.clicks || 0)}</td>
                                                                        <td className="px-2 md:px-4 py-1 text-right text-xs">{formatPercent((ad.ctr || 0) * 100)}</td>
                                                                        <td className="px-2 md:px-4 py-1 text-right text-xs">{formatCurrency(ad.cpc || ad.averageCpc || 0)}</td>
                                                                        <td className="px-2 md:px-4 py-1 text-right text-xs font-semibold text-slate-900">{formatCurrency(ad.spend || 0)}</td>
                                                                        <td className="px-2 md:px-4 py-1 text-right text-xs font-semibold text-indigo-600">{formatNumber(ad.conversions || 0)}</td>
                                                                        <td className="px-2 md:px-4 py-1 text-right text-xs">{formatCurrency(ad.conversions > 0 ? (ad.spend || 0) / ad.conversions : 0)}</td>
                                                                        {metaCustomMetrics.map(m => (
                                                                            <td key={m.id || m.name} className="px-2 md:px-4 py-1 text-right text-xs text-indigo-700 bg-indigo-50/10 border-r border-slate-200">
                                                                                {formatValue(evaluateFormula(m.formula, ad), m.format)}
                                                                            </td>
                                                                        ))}
                                                                    </tr>
                                                                ))}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                                        <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-[11px] md:text-xs h-10 md:h-11 bg-slate-100/50">
                                            <td className="px-2 py-1.5 text-center border-r border-slate-200"></td>
                                            <td className="px-2 py-1.5 text-center border-r border-slate-200"></td>
                                            <td className="px-2 md:px-4 py-1.5 md:py-2 border-r border-slate-200 text-slate-700 italic flex items-center gap-1 whitespace-nowrap h-10 md:h-11" colSpan={3}>
                                                Resultados Totais (Meta)
                                            </td>
                                            <td className="px-2 md:px-4 py-1.5 md:py-2 border-r border-slate-200 text-right font-bold">
                                                {formatNumber(calculateTotals(filteredCampaigns).impressions)}
                                            </td>
                                            <td className="px-2 md:px-4 py-1.5 md:py-2 border-r border-slate-200 text-right font-bold">
                                                {formatNumber(calculateTotals(filteredCampaigns).clicks)}
                                            </td>
                                            <td className="px-2 md:px-4 py-1.5 md:py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(filteredCampaigns).ctr)}
                                            </td>
                                            <td className="px-2 md:px-4 py-1.5 md:py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredCampaigns).cpc)}
                                            </td>
                                            <td className="px-2 md:px-4 py-1.5 md:py-2 border-r border-slate-200 text-right font-bold text-[#0866ff] bg-[#0866ff]/5">
                                                {formatCurrency(calculateTotals(filteredCampaigns).spend)}
                                            </td>
                                            <td className="px-2 md:px-4 py-1.5 md:py-2 border-r border-slate-200 text-right font-bold text-indigo-600">
                                                {formatNumber(calculateTotals(filteredCampaigns).conversions)}
                                            </td>
                                            <td className="px-2 md:px-4 py-1.5 md:py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredCampaigns).conversions > 0 ? calculateTotals(filteredCampaigns).spend / calculateTotals(filteredCampaigns).conversions : 0)}
                                            </td>
                                            {metaCustomMetrics.map(m => (
                                                <td key={m.id || m.name} className="px-2 md:px-4 py-1.5 md:py-2 text-right font-bold text-indigo-700 border-r border-slate-200">
                                                    -
                                                </td>
                                            ))}
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            {/* Mobile Meta Campaigns */}
                            <div className="hidden space-y-2 p-2 bg-slate-50">
                                {sortData(filteredCampaigns).map((c, i) => {
                                    return (
                                        <div key={`mobile-campaign-${c.id}`} className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
                                            <div className="flex items-start justify-between gap-2.5">
                                                <div className="flex items-start gap-2.5 min-w-0">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={selectedCampaignIds.has(String(c.id))} 
                                                        onChange={(e) => { e.stopPropagation(); toggleCampaignSelection(String(c.id)); }} 
                                                        className="rounded border-slate-300 text-[#0866ff] focus:ring-[#0866ff] w-4 h-4 mt-0.5 shrink-0 cursor-pointer" 
                                                    />
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            
                                                            <label className="relative inline-flex items-center cursor-pointer">
                                                                <input 
                                                                    type="checkbox" 
                                                                    checked={c.status === 'ENABLED' || c.status === 'ACTIVE'} 
                                                                    onChange={() => {
                                                                        const newStatus = (c.status === 'ENABLED' || c.status === 'ACTIVE') ? 'PAUSED' : 'ENABLED';
                                                                        setCampaigns(prev => prev.map(item => item.id === c.id ? { ...item, status: newStatus } : item));
                                                                    }}
                                                                    className="sr-only peer" 
                                                                />
                                                                <div className="w-7 h-3.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-2.5 after:w-3 after:transition-all peer-checked:bg-[#0866ff]"></div>
                                                            </label>

                                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{c.type || 'Meta Campaign'}</span>
                                                        </div>
                                                        <h4 
                                                            onClick={() => setGlobalCampaignFilter(c.id.toString())}
                                                            className="font-bold text-[#0866ff] hover:underline text-sm mt-1 cursor-pointer break-words"
                                                        >
                                                            {c.name}
                                                        </h4>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                                                <span>Orçamento:</span>
                                                <span className="text-slate-800">{formatCurrency(c.budget || 0)}/dia</span>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100">
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Alcance</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(c.impressions)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Cliques</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(c.clicks)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Gasto</span>
                                                    <span className="text-[#0866ff] font-bold">{formatCurrency(c.spend)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Resultados</span>
                                                    <span className="text-[#0f9d58] font-bold">{formatNumber(c.conversions)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    ) : (
                        <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
                            <div className="hidden md:block">
                                <table className="w-full min-w-[800px] text-left border-collapse">
                                    <thead className="sticky top-0 bg-[#f8f9fa] border-b border-slate-250 z-20">
                                        <tr className="divide-x divide-slate-200">
                                            <th className="px-3 py-3 w-10 text-center border-r border-slate-200">
                                                <input 
                                                    type="checkbox" 
                                                    className="rounded border-slate-300 text-[#1a73e8] focus:ring-[#1a73e8] w-3.5 h-3.5 cursor-pointer" 
                                                    checked={sortData(filteredCampaigns).length > 0 && sortData(filteredCampaigns).every(c => selectedCampaignIds.has(c.id.toString()))}
                                                    onChange={() => toggleAllCampaigns(sortData(filteredCampaigns))}
                                                />
                                            </th>
                                            <th className="px-3 py-3 w-32 text-center border-r border-slate-200 text-slate-500 font-bold text-xs uppercase tracking-wider">Veiculação</th>
                                            <th onClick={() => handleSort('name')} className="px-4 py-3 text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                <div className="flex items-center gap-1">Campanha {renderSortIcon('name')}</div>
                                            </th>
                                            <th onClick={() => handleSort('budget')} className="px-4 py-3 text-xs font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1">Orçamento {renderSortIcon('budget')}</div>
                                            </th>
                                            <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right border-r border-slate-200 whitespace-nowrap">Optimization score</th>
                                            <th onClick={() => handleSort('type')} className="px-4 py-3 text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                <div className="flex items-center gap-1">Tipo de campanha {renderSortIcon('type')}</div>
                                            </th>
                                            <th onClick={() => handleSort('impressions')} className="px-4 py-3 text-xs font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1">Impr. {renderSortIcon('impressions')}</div>
                                            </th>
                                            <th onClick={() => handleSort('clicks')} className="px-4 py-3 text-xs font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1">↓ Interações {renderSortIcon('clicks')}</div>
                                            </th>
                                            <th onClick={() => handleSort('ctr')} className="px-4 py-3 text-xs font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1">Taxa de interação {renderSortIcon('ctr')}</div>
                                            </th>
                                            <th onClick={() => handleSort('cpc')} className="px-4 py-3 text-xs font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1">Custo médio {renderSortIcon('cpc')}</div>
                                            </th>
                                            <th onClick={() => handleSort('spend')} className="px-4 py-3 text-xs font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1">Custo {renderSortIcon('spend')}</div>
                                            </th>
                                            <th className="px-4 py-3 text-xs font-semibold text-slate-500 border-r border-slate-200 whitespace-nowrap">Bid strategy type</th>
                                            <th onClick={() => handleSort('convRate')} className="px-4 py-3 text-xs font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1">Taxa de conv. {renderSortIcon('convRate')}</div>
                                            </th>
                                            <th onClick={() => handleSort('conversions')} className="px-4 py-3 text-xs font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1">Conversões {renderSortIcon('conversions')}</div>
                                            </th>
                                            <th onClick={() => handleSort('costPerConv')} className="px-4 py-3 text-xs font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1">Custo / conv. {renderSortIcon('costPerConv')}</div>
                                            </th>
                                            {customMetrics.map(m => (
                                                <th key={m.id} onClick={() => handleSort(m.id)} className="px-4 py-3 text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 whitespace-nowrap">
                                                    <div className="flex items-center gap-1 justify-end">
                                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                                                        {m.name} {renderSortIcon(m.id)}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                        {/* DRAFTS ROW */}
                                        <tr className="bg-[#e6f4ea]/30 text-xs text-slate-700 h-10 border-b border-slate-200 divide-x divide-slate-200/80">
                                            <td className="px-3 py-2 text-center w-10">
                                                <ChevronDown size={14} className="inline text-slate-500 cursor-pointer" />
                                            </td>
                                            <td className="px-3 py-2 text-center w-10">
                                                <Folder size={14} className="inline text-slate-450" />
                                            </td>
                                            <td className="px-4 py-2 font-medium" colSpan={13 + customMetrics.length}>
                                                <span className="text-slate-700 text-xs font-medium">Rascunhos em andamento: 0</span>
                                            </td>
                                        </tr>

                                        {/* REAL CAMPAIGN ROWS */}
                                        {sortData(filteredCampaigns).map((c, i) => {
                                            const prev = getPrevCampaign(c.id);
                                            const isPMax = c.type?.includes('PERFORMANCE_MAX');
                                            return (
                                                <tr key={`row-google-${c.id}`} id={`campaign-row-${c.id}`} className="hover:bg-[#f8f9fa] transition-colors group divide-x divide-slate-200 border-b border-slate-200 text-slate-700 h-14">
                                                    {/* Checkbox */}
                                                    <td className="px-3 py-2 text-center w-10" onClick={(e) => e.stopPropagation()}>
                                                        <input 
                                                            type="checkbox" 
                                                            className="rounded border-slate-300 text-[#1a73e8] focus:ring-[#1a73e8] w-3.5 h-3.5 cursor-pointer" 
                                                            checked={selectedCampaignIds.has(c.id.toString())}
                                                            onChange={() => toggleCampaignSelection(c.id.toString())}
                                                        />
                                                    </td>

                                                    {/* Interactive Status Badge & Dot */}
                                                    <td className="px-2 py-1.5 border-r border-slate-200 relative" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex items-center justify-between gap-1.5 px-1 min-w-[120px]">
                                                            {renderStatusBadge(c.status, 'google')}
                                                            <div className="cursor-pointer hover:scale-110 transition-transform p-1 rounded hover:bg-slate-100" onClick={() => setActiveStatusMenuCampaignId(activeStatusMenuCampaignId === c.id.toString() ? null : c.id.toString())}>
                                                                {c.status === 'ENABLED' ? (
                                                                    <div className="w-2.5 h-2.5 rounded-full bg-[#0f9d58]" title="Ativo" />
                                                                ) : c.status === 'PAUSED' ? (
                                                                    <div className="w-3.5 h-3.5 rounded bg-slate-300 flex items-center justify-center text-slate-600 text-[8px] font-bold" title="Pausado">||</div>
                                                                ) : (
                                                                    <div className="w-3.5 h-3.5 rounded bg-rose-100 flex items-center justify-center text-rose-600 text-[8px] font-bold" title="Removido">X</div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Status Selector Dropdown */}
                                                        {activeStatusMenuCampaignId === c.id.toString() && (
                                                            <div className="absolute left-full top-2 ml-2 bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 z-50 min-w-[130px] text-left text-xs font-medium text-slate-700 divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100">
                                                                <div className="p-1">
                                                                    <button 
                                                                        onClick={() => {
                                                                            setActiveStatusMenuCampaignId(null);
                                                                            setStatusConfirmModal({ 
                                                                                open: true, 
                                                                                campaignId: c.id.toString(), 
                                                                                campaignName: c.name, 
                                                                                action: 'enable', 
                                                                                customerId: selectedAccountId || null 
                                                                            });
                                                                        }}
                                                                        className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 rounded-lg"
                                                                    >
                                                                        <div className="w-2.5 h-2.5 rounded-full bg-[#0f9d58]" />
                                                                        Ativar
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => {
                                                                            setActiveStatusMenuCampaignId(null);
                                                                            setStatusConfirmModal({ 
                                                                                open: true, 
                                                                                campaignId: c.id.toString(), 
                                                                                campaignName: c.name, 
                                                                                action: 'pause', 
                                                                                customerId: selectedAccountId || null 
                                                                            });
                                                                        }}
                                                                        className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 rounded-lg"
                                                                    >
                                                                        <div className="w-2.5 h-2.5 rounded bg-slate-400 flex items-center justify-center text-[7px] text-white font-bold">||</div>
                                                                        Pausar
                                                                    </button>
                                                                </div>
                                                                <div className="p-1">
                                                                    <button 
                                                                        onClick={() => {
                                                                            setActiveStatusMenuCampaignId(null);
                                                                            alert("A remoção de campanhas deve ser feita diretamente no painel do Google Ads por motivos de segurança.");
                                                                        }}
                                                                        className="w-full text-left px-3 py-2 hover:bg-rose-50 text-rose-600 flex items-center gap-2 rounded-lg"
                                                                    >
                                                                        <div className="w-2.5 h-2.5 rounded bg-rose-600 flex items-center justify-center text-[7px] text-white font-bold">X</div>
                                                                        Remover
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>

                                                    {/* Campaign Name & Network Icon */}
                                                    <td className="px-4 py-2 font-normal">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="flex items-center gap-2 overflow-hidden">
                                                                <div className="w-6 h-6 bg-slate-100 border border-slate-200 rounded flex items-center justify-center text-slate-500 shrink-0">
                                                                    {isPMax ? <TrendingUp size={13} className="text-blue-500" /> : <Search size={13} className="text-slate-500" />}
                                                                </div>
                                                                <span 
                                                                    onClick={(e) => { e.stopPropagation(); toggleCampaignExpand(c.id.toString()); }}
                                                                    className="text-[#1a73e8] hover:text-[#1557b0] hover:underline font-medium cursor-pointer truncate text-sm"
                                                                    title={c.name}
                                                                >
                                                                    {c.name}
                                                                </span>
                                                            </div>
                                                            
                                                            {/* Inline Hover Action Tools */}
                                                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity duration-150 shrink-0" onClick={(e) => e.stopPropagation()}>
                                                                <button 
                                                                    onClick={() => {
                                                                        setNewBudgetAmount(c.budget?.toString() || '0');
                                                                        setBudgetModal({ 
                                                                            open: true, 
                                                                            campaignId: c.id.toString(), 
                                                                            budgetId: c.budgetId?.toString() || '', 
                                                                            campaignName: c.name, 
                                                                            currentBudget: c.budget, 
                                                                            customerId: selectedAccountId || null 
                                                                        });
                                                                    }}
                                                                    className="p-1 hover:bg-slate-150 rounded text-slate-400 hover:text-slate-600 transition-colors"
                                                                    title="Editar"
                                                                >
                                                                    <Pencil size={12} />
                                                                </button>
                                                                <button className="p-1 hover:bg-slate-150 rounded text-slate-400 hover:text-slate-600 transition-colors" title="Configurações">
                                                                    <Settings size={12} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </td>

                                                    {/* Budget Column */}
                                                    <td className="px-4 py-2 text-right font-normal group/budget" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex items-center justify-end gap-1">
                                                            <span className="text-slate-800 text-xs font-medium">{formatCurrency(c.budget || 0)}/dia</span>
                                                            <button 
                                                                onClick={() => {
                                                                    setNewBudgetAmount(c.budget?.toString() || '0');
                                                                    setBudgetModal({ 
                                                                        open: true, 
                                                                        campaignId: c.id.toString(), 
                                                                        budgetId: c.budgetId?.toString() || '', 
                                                                        campaignName: c.name, 
                                                                        currentBudget: c.budget, 
                                                                        customerId: selectedAccountId || null 
                                                                    });
                                                                }}
                                                                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-600 rounded transition-opacity"
                                                            >
                                                                <Pencil size={11} />
                                                            </button>
                                                        </div>
                                                    </td>

                                                    {/* Optimization Score */}
                                                    <td className="px-4 py-2 text-right font-normal text-slate-400">-</td>

                                                    {/* Tipo de campanha */}
                                                    <td className="px-4 py-2 text-left font-normal text-slate-500 text-xs whitespace-nowrap">
                                                        {isPMax ? 'Performance Max' : 'Pesquisa'}
                                                    </td>

                                                    {/* Impr. */}
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {renderCellWithVariation(c.impressions, prev?.impressions, 'number')}
                                                    </td>

                                                    {/* Interações */}
                                                    <td className="px-4 py-2 text-right font-normal text-slate-800">
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-xs">{renderCellWithVariation(c.clicks, prev?.clicks, 'number')}</span>
                                                            <span className="text-[9px] text-slate-400 text-right leading-tight mt-0.5">
                                                                cliques, <br/> engajamentos
                                                            </span>
                                                        </div>
                                                    </td>

                                                    {/* Taxa de interação */}
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {renderCellWithVariation((c.clicks / c.impressions) * 100 || 0, (prev?.clicks / prev?.impressions) * 100 || 0, 'percent')}
                                                    </td>

                                                    {/* Custo médio */}
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {renderCellWithVariation(c.spend / c.clicks || 0, prev?.spend / prev?.clicks || 0, 'currency', true)}
                                                    </td>

                                                    {/* Custo */}
                                                    <td className="px-4 py-2 text-right text-xs font-medium text-slate-800">
                                                        {renderCellWithVariation(c.spend, prev?.spend, 'currency', true)}
                                                    </td>

                                                    {/* Bid strategy type */}
                                                    <td className="px-4 py-2 text-left font-normal text-xs whitespace-nowrap">
                                                        <span className="text-[#1a73e8] hover:underline cursor-pointer">Maximizar conversões</span>
                                                    </td>

                                                    {/* Taxa de conv. */}
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {renderCellWithVariation((c.conversions / c.clicks) * 100 || 0, (prev?.conversions / prev?.clicks) * 100 || 0, 'percent')}
                                                    </td>

                                                    {/* Conversões */}
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {c.conversions.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>

                                                    {/* Custo / conv. */}
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {renderCellWithVariation(c.conversions > 0 ? c.spend / c.conversions : 0, prev?.conversions > 0 ? prev?.spend / prev?.conversions : 0, 'currency', true)}
                                                    </td>

                                                    {/* Custom metrics */}
                                                    {customMetrics.map(m => (
                                                        <td key={m.id} className="px-4 py-2 text-right text-xs font-medium text-slate-800 border-l border-slate-200">
                                                            {renderCellWithVariation(calculateMetricValue(m, c), calculateMetricValue(m, prev || {}), m.format)}
                                                        </td>
                                                    ))}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-[#f8f9fa] border-t-2 border-slate-300 divide-y divide-slate-200">
                                        {/* Total Row 1: All but removed campaigns */}
                                        <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-xs h-11 bg-slate-50">
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-slate-700 italic flex items-center gap-1 whitespace-nowrap h-11">
                                                Total: All but removed campaigns in your current view
                                                <HelpCircle size={13} className="text-slate-400 inline cursor-pointer" />
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right text-slate-400">-</td>
                                            <td className="px-4 py-2 border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).impressions, calculateTotals(filteredCampaignsComparison).impressions, 'number')}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).clicks, calculateTotals(filteredCampaignsComparison).clicks, 'number')}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).ctr, calculateTotals(filteredCampaignsComparison).ctr, 'percent')}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).cpc, calculateTotals(filteredCampaignsComparison).cpc, 'currency', true)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#1a73e8] bg-[#e8f0fe]/20">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).spend, calculateTotals(filteredCampaignsComparison).spend, 'currency', true)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).clicks > 0 ? (calculateTotals(filteredCampaigns).conversions / calculateTotals(filteredCampaigns).clicks) * 100 : 0, calculateTotals(filteredCampaignsComparison).clicks > 0 ? (calculateTotals(filteredCampaignsComparison).conversions / calculateTotals(filteredCampaignsComparison).clicks) * 100 : 0, 'percent')}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {calculateTotals(filteredCampaigns).conversions.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).costPerConv, calculateTotals(filteredCampaignsComparison).costPerConv, 'currency', true)}
                                            </td>
                                            {customMetrics.map(m => (
                                                <td key={m.id} className="px-4 py-2 text-right font-bold border-r border-slate-200">
                                                    {renderCellWithVariation(calculateMetricValue(m, calculateTotals(filteredCampaigns)), calculateMetricValue(m, calculateTotals(filteredCampaignsComparison)), m.format)}
                                                </td>
                                            ))}
                                        </tr>

                                        {/* Total Row 2: Total: conta */}
                                        <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-xs h-11 bg-[#f1f3f4]">
                                            <td className="px-3 py-2 text-center border-r border-slate-200">
                                                <ChevronDown size={14} className="inline text-slate-600 cursor-pointer" />
                                            </td>
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-slate-800 font-bold flex items-center gap-1 whitespace-nowrap h-11">
                                                Total: conta
                                                <HelpCircle size={13} className="text-slate-400 inline cursor-pointer" />
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-medium text-slate-600">R$ 0,00/dia</td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right text-slate-400">-</td>
                                            <td className="px-4 py-2 border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).impressions, calculateTotals(filteredCampaignsComparison).impressions, 'number')}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).clicks, calculateTotals(filteredCampaignsComparison).clicks, 'number')}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).ctr, calculateTotals(filteredCampaignsComparison).ctr, 'percent')}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).cpc, calculateTotals(filteredCampaignsComparison).cpc, 'currency', true)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#1a73e8] bg-[#e8f0fe]/20">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).spend, calculateTotals(filteredCampaignsComparison).spend, 'currency', true)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).clicks > 0 ? (calculateTotals(filteredCampaigns).conversions / calculateTotals(filteredCampaigns).clicks) * 100 : 0, calculateTotals(filteredCampaignsComparison).clicks > 0 ? (calculateTotals(filteredCampaignsComparison).conversions / calculateTotals(filteredCampaignsComparison).clicks) * 100 : 0, 'percent')}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {calculateTotals(filteredCampaigns).conversions.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {renderCellWithVariation(calculateTotals(filteredCampaigns).costPerConv, calculateTotals(filteredCampaignsComparison).costPerConv, 'currency', true)}
                                            </td>
                                            {customMetrics.map(m => (
                                                <td key={m.id} className="px-4 py-2 text-right font-bold border-r border-slate-200">
                                                    {renderCellWithVariation(calculateMetricValue(m, calculateTotals(filteredCampaigns)), calculateMetricValue(m, calculateTotals(filteredCampaignsComparison)), m.format)}
                                                </td>
                                            ))}
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            {/* Mobile Google Campaigns */}
                            <div className="block md:hidden space-y-2 p-2 bg-slate-50">
                                {sortData(filteredCampaigns).map((c, i) => {
                                    const isPMax = c.type?.includes('PERFORMANCE_MAX');
                                    return (
                                        <div key={`mobile-google-${c.id}`} className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
                                            <div className="flex items-start justify-between gap-2.5">
                                                <div className="flex items-start gap-2.5 min-w-0">
                                                    <input type="checkbox" className="rounded border-slate-300 text-[#1a73e8] focus:ring-[#1a73e8] w-4 h-4 mt-0.5 shrink-0" />
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <div className="flex items-center justify-center cursor-pointer h-full" onClick={() => setActiveStatusMenuCampaignId(activeStatusMenuCampaignId === c.id.toString() ? null : c.id.toString())}>
                                                                {c.status === 'ENABLED' ? (
                                                                    <div className="w-2.5 h-2.5 rounded-full bg-[#0f9d58]" title="Ativo" />
                                                                ) : c.status === 'PAUSED' ? (
                                                                    <div className="w-4 h-4 rounded-full bg-slate-300 flex items-center justify-center text-slate-600 text-[8px] font-bold" title="Pausado">||</div>
                                                                ) : (
                                                                    <div className="w-4 h-4 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 text-[8px] font-bold" title="Removido">X</div>
                                                                )}
                                                            </div>
                                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{isPMax ? 'Performance Max' : 'Search'}</span>
                                                        </div>
                                                        <h4 
                                                            onClick={() => setGlobalCampaignFilter(c.id.toString())}
                                                            className="font-bold text-[#1a73e8] hover:underline text-sm mt-1 cursor-pointer break-words"
                                                        >
                                                            {c.name}
                                                        </h4>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                                                <span>Orçamento:</span>
                                                <span className="text-slate-800">{formatCurrency(c.budget || 0)}/dia</span>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100">
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Impr.</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(c.impressions)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Interações</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(c.clicks)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo</span>
                                                    <span className="text-[#1a73e8] font-bold">{formatCurrency(c.spend)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Conversões</span>
                                                    <span className="text-[#0f9d58] font-bold">{formatNumber(c.conversions)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ASSET GROUPS TAB */}
            {activeTab === 'assetgroups' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="hidden md:block max-h-[600px] overflow-auto rounded-lg border border-slate-200 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
                        <table className="w-full min-w-[800px] text-left">
                            <thead className="sticky top-0 z-20 bg-[#f8f9fa] shadow-sm border-b border-slate-200">
                                <tr>
                                    {[
                                        { k: 'name', l: 'Grupo de Recursos' }, { k: 'status', l: 'Status' },
                                        { k: 'impressions', l: 'Impr.' }, { k: 'clicks', l: 'Cliques' }, { k: 'ctr', l: 'CTR' },
                                        { k: 'cpc', l: 'CPC Méd.' }, { k: 'spend', l: 'Custo' }, { k: 'conversions', l: 'Conv.' },
                                        { k: 'convRate', l: 'Taxa Conv.' }, { k: 'costPerConv', l: 'Custo/Conv.' }
                                    ].map(h => (
                                        <th key={h.k} onClick={() => handleSort(h.k)} className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-blue-600 transition-colors bg-[#f8f9fa]">
                                            <div className="flex items-center gap-1">{h.l} {renderSortIcon(h.k)}</div>
                                        </th>
                                    ))}
                                    {customMetrics.map(m => (
                                        <th key={m.id} onClick={() => handleSort(m.id)} className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-blue-600 transition-colors border-l border-slate-200 bg-[#f8f9fa]">
                                            <div className="flex items-center gap-1">
                                                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                                                {m.name} {renderSortIcon(m.id)}
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sortData(assetGroups).map((ag, i) => (
                                    <tr key={`ag-${ag.id || ag.name}`} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 text-sm font-medium text-slate-900">{ag.name}</td>
                                        <td className="px-6 py-4">{renderStatusBadge(ag.status)}</td>
                                        <td className="px-6 py-4 text-sm text-slate-600">{formatNumber(ag.impressions)}</td>
                                        <td className="px-6 py-4 text-sm text-slate-600">{formatNumber(ag.clicks)}</td>
                                        <td className="px-6 py-4 text-sm text-slate-600">{formatPercent((ag.clicks / ag.impressions) * 100 || 0)}</td>
                                        <td className="px-6 py-4 text-sm text-slate-600">{formatCurrency(ag.clicks > 0 ? ag.spend / ag.clicks : 0)}</td>
                                        <td className="px-6 py-4 text-sm font-medium text-slate-900">{formatCurrency(ag.spend)}</td>
                                        <td className="px-6 py-4 text-sm font-medium text-slate-900">{formatNumber(ag.conversions)}</td>
                                        <td className="px-6 py-4 text-sm text-slate-600">{formatPercent((ag.conversions / ag.clicks) * 100 || 0)}</td>
                                        <td className="px-6 py-4 text-sm text-slate-600">{formatCurrency(ag.conversions > 0 ? ag.spend / ag.conversions : 0)}</td>
                                        {customMetrics.map(m => (
                                            <td key={m.id} className="px-6 py-4 text-sm font-medium text-slate-900 border-l border-slate-100">
                                                {formatMetricValue(calculateMetricValue(m, ag), m.format)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="sticky bottom-0 z-20 bg-[#f8f9fa] shadow-[0_-2px_4px_rgba(0,0,0,0.05)] border-t border-slate-200">
                                <tr>
                                    <td className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider" colSpan={2}>Totais</td>
                                    <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatNumber(calculateTotals(assetGroups).impressions)}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatNumber(calculateTotals(assetGroups).clicks)}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatPercent(calculateTotals(assetGroups).ctr)}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatCurrency(calculateTotals(assetGroups).cpc)}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatCurrency(calculateTotals(assetGroups).spend)}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatNumber(calculateTotals(assetGroups).conversions)}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatPercent(calculateTotals(assetGroups).clicks > 0 ? (calculateTotals(assetGroups).conversions / calculateTotals(assetGroups).clicks) * 100 : 0)}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatCurrency(calculateTotals(assetGroups).costPerConv)}</td>
                                    {customMetrics.map(m => (
                                        <td key={m.id} className="px-6 py-4 text-sm font-bold text-slate-900 border-l border-slate-200">
                                            {formatMetricValue(calculateMetricValue(m, calculateTotals(assetGroups)), m.format)}
                                        </td>
                                    ))}
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Mobile Asset Groups */}
                    <div className="block md:hidden space-y-2 p-2 bg-slate-50">
                        {sortData(assetGroups).map((ag, i) => (
                            <div key={`mobile-ag-${ag.id || ag.name}`} className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
                                <div className="flex items-start justify-between gap-2.5">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            {renderStatusBadge(ag.status)}
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Grupo de Recursos</span>
                                        </div>
                                        <h4 className="font-bold text-slate-800 text-sm mt-1 break-words">
                                            {ag.name}
                                        </h4>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100">
                                    <div>
                                        <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Impr.</span>
                                        <span className="text-slate-800 font-semibold">{formatNumber(ag.impressions)}</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Cliques</span>
                                        <span className="text-slate-800 font-semibold">{formatNumber(ag.clicks)}</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">CTR</span>
                                        <span className="text-slate-800 font-semibold">{formatPercent((ag.clicks / ag.impressions) * 100 || 0)}</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo</span>
                                        <span className="text-[#1a73e8] font-bold">{formatCurrency(ag.spend)}</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Resultados</span>
                                        <span className="text-[#0f9d58] font-bold">{formatNumber(ag.conversions)}</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo/Result.</span>
                                        <span className="text-slate-800 font-semibold">{formatCurrency(ag.conversions > 0 ? ag.spend / ag.conversions : 0)}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* AD GROUPS TAB */}
            {activeTab === 'adgroups' && (
                <>
                    {campaignType === 'PERFORMANCE_MAX' ? (
                        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-8 text-center">
                            <InfoMessage title="Campanha Performance Max" message="Campanhas P-MAX utilizam 'Grupos de Recursos' em vez de grupos de anúncios tradicionais. A API atual foca na visão consolidada." />
                        </div>
                    ) : activePlatform === 'meta' ? (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
                                <table className="w-full min-w-[800px] text-left border-collapse">
                                    <thead className="sticky top-0 bg-[#f8f9fa] border-b border-slate-300 z-20">
                                        <tr className="divide-x divide-slate-200 h-10">
                                            <th className="w-12 px-3 text-center border-r border-slate-200">
                                                <input 
                                                    type="checkbox" 
                                                    className="rounded border-slate-300 text-[#0866ff] focus:ring-[#0866ff] w-3.5 h-3.5 cursor-pointer" 
                                                    checked={sortData(metaAdGroups).length > 0 && sortData(metaAdGroups).every(ag => selectedAdGroupIds.has(ag.id.toString()))}
                                                    onChange={() => toggleAllAdGroups(sortData(metaAdGroups))}
                                                />
                                            </th>
                                            <th className="w-32 px-3 text-center border-r border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">Veiculação</th>
                                            {[
                                                { k: 'name', l: 'Conjunto de Anúncios', align: 'left' },
                                                { k: 'campaignName', l: 'Campanha', align: 'left' },
                                                { k: 'budget', l: 'Orçamento', align: 'right' },
                                                { k: 'impressions', l: 'Impressões', align: 'right' },
                                                { k: 'clicks', l: 'Cliques no Link', align: 'right' },
                                                { k: 'ctr', l: 'CTR', align: 'right' },
                                                { k: 'cpc', l: 'CPC Méd.', align: 'right' },
                                                { k: 'spend', l: 'Valor Gasto', align: 'right' },
                                                { k: 'conversions', l: 'Resultados', align: 'right' },
                                                { k: 'costPerConv', l: 'Custo por Result.', align: 'right' }
                                            ].map(h => (
                                                <th 
                                                    key={h.k} 
                                                    onClick={() => handleSort(h.k)} 
                                                    className={`px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-normal whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 text-${h.align}`}
                                                >
                                                    <div className={`flex items-center gap-1 ${h.align === 'right' ? 'justify-end' : 'justify-start'}`}>
                                                        <span>{h.l}</span>
                                                        {renderSortIcon(h.k)}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 text-slate-700">
                                        {sortData(metaAdGroups).map((ag, i) => {
                                            const agCtr = ag.impressions > 0 ? (ag.clicks / ag.impressions) * 100 : 0;
                                            const agCpc = ag.clicks > 0 ? ag.spend / ag.clicks : 0;
                                            const agCostPerConv = ag.conversions > 0 ? ag.spend / ag.conversions : 0;
                                            return (
                                                <tr key={ag.id} className="group hover:bg-[#f2f4f7]/40 transition-colors duration-150 h-12 divide-x divide-slate-200">
                                                    <td className="px-3 py-2 text-center w-12 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                        <input 
                                                            type="checkbox" 
                                                            className="rounded border-slate-300 text-[#0866ff] focus:ring-[#0866ff] w-3.5 h-3.5 cursor-pointer" 
                                                            checked={selectedAdGroupIds.has(ag.id.toString())}
                                                            onChange={() => toggleAdGroupSelection(ag.id.toString())}
                                                        />
                                                    </td>
                                                    {/* Unified Status and Toggle Switch */}
                                                    <td className="px-2 py-1.5 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex items-center justify-between gap-2 px-1 min-w-[120px]">
                                                            {renderStatusBadge(ag.effective_status || ag.status, 'meta')}
                                                            <label className="relative inline-flex items-center cursor-pointer">
                                                                <input 
                                                                    type="checkbox" 
                                                                    checked={ag.status === 'ENABLED' || ag.status === 'ACTIVE'} 
                                                                    onChange={() => {
                                                                        setMetaAdGroups(prev => prev.map((item, idx) => (item.id === ag.id || idx === i) ? { ...item, status: (ag.status === 'ENABLED' || ag.status === 'ACTIVE') ? 'PAUSED' : 'ENABLED' } : item));
                                                                    }}
                                                                    className="sr-only peer" 
                                                                />
                                                                <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3.5 after:transition-all peer-checked:bg-[#0866ff]"></div>
                                                            </label>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 font-normal">
                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                            <div className="w-5 h-5 bg-[#0866ff]/5 border border-[#0866ff]/10 rounded flex items-center justify-center shrink-0 text-[#0866ff]">
                                                                <Grid size={11} />
                                                            </div>
                                                            <span className="text-[#0866ff] hover:underline font-medium cursor-pointer truncate text-sm" title={ag.name}>
                                                                {ag.name}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-left font-normal text-slate-500 text-xs">
                                                        {ag.campaignName}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-normal">
                                                        <div className="flex items-center justify-end gap-2 group/edit">
                                                            <div>
                                                                <p className="font-semibold text-slate-800 text-xs">{formatCurrency(ag.budget || 0)}</p>
                                                                <p className="text-[9px] text-slate-400 font-normal">Diário</p>
                                                            </div>
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setMetaBudgetModal({
                                                                        open: true,
                                                                        adsetId: ag.id,
                                                                        adsetName: ag.name,
                                                                        currentBudget: ag.budget || 0
                                                                    });
                                                                }}
                                                                className="p-1 text-slate-400 hover:text-[#0866ff] hover:bg-[#0866ff]/10 rounded opacity-0 group-hover/edit:opacity-100 transition-all"
                                                                title="Editar Orçamento"
                                                            >
                                                                <Edit2 size={12} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatNumber(ag.impressions)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatNumber(ag.clicks)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatPercent(agCtr)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatCurrency(agCpc)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-bold text-slate-800">
                                                        {formatCurrency(ag.spend)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-bold text-indigo-600 bg-indigo-50/20">
                                                        {formatNumber(ag.conversions)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-semibold text-slate-800">
                                                        {formatCurrency(agCostPerConv)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                                        <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-xs h-11 bg-slate-100/50">
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-slate-700 italic flex items-center gap-1 whitespace-nowrap h-11" colSpan={3}>
                                                Totais dos Conjuntos de Anúncios (Meta)
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatNumber(calculateTotals(metaAdGroups).impressions)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatNumber(calculateTotals(metaAdGroups).clicks)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(metaAdGroups).ctr)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(metaAdGroups).cpc)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-[#0866ff] bg-[#0866ff]/5">
                                                {formatCurrency(calculateTotals(metaAdGroups).spend)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-indigo-600">
                                                {formatNumber(calculateTotals(metaAdGroups).conversions)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(metaAdGroups).costPerConv)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            {/* Mobile Meta Ad Groups */}
                            <div className="hidden space-y-2 p-2 bg-slate-50">
                                {sortData(metaAdGroups).map((ag, i) => {
                                    const agCtr = ag.impressions > 0 ? (ag.clicks / ag.impressions) * 100 : 0;
                                    const agCpc = ag.clicks > 0 ? ag.spend / ag.clicks : 0;
                                    const agCostPerConv = ag.conversions > 0 ? ag.spend / ag.conversions : 0;
                                    return (
                                        <div key={`mobile-meta-adgroup-${ag.id}`} className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
                                            <div className="flex items-start justify-between gap-2.5">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <label className="relative inline-flex items-center cursor-pointer">
                                                            <input 
                                                                type="checkbox" 
                                                                checked={ag.status === 'ENABLED' || ag.status === 'ACTIVE'} 
                                                                onChange={() => {
                                                                    setMetaAdGroups(prev => prev.map((item, idx) => (item.id === ag.id || idx === i) ? { ...item, status: (ag.status === 'ENABLED' || ag.status === 'ACTIVE') ? 'PAUSED' : 'ENABLED' } : item));
                                                                }}
                                                                className="sr-only peer" 
                                                            />
                                                            <div className="w-7 h-3.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-2.5 after:w-3 after:transition-all peer-checked:bg-[#0866ff]"></div>
                                                        </label>
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Conjunto de Anúncios</span>
                                                    </div>
                                                    <h4 className="font-bold text-[#0866ff] hover:underline text-sm mt-1 cursor-pointer break-words">
                                                        {ag.name}
                                                    </h4>
                                                    <span className="text-[11px] text-slate-400 block mt-0.5">Campanha: {ag.campaignName}</span>
                                                    <div className="flex items-center gap-2 mt-1.5 bg-slate-100/50 p-1.5 rounded-lg border border-slate-200/50 w-fit">
                                                        <div>
                                                            <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Orçamento</span>
                                                            <span className="text-slate-800 font-semibold text-xs">{formatCurrency(ag.budget || 0)}</span>
                                                        </div>
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setMetaBudgetModal({
                                                                    open: true,
                                                                    adsetId: ag.id,
                                                                    adsetName: ag.name,
                                                                    currentBudget: ag.budget || 0
                                                                });
                                                            }}
                                                            className="p-1.5 bg-white text-slate-500 hover:text-[#0866ff] hover:bg-[#0866ff]/10 rounded border border-slate-200 transition-all shadow-sm ml-2"
                                                        >
                                                            <Edit2 size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100">
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Impressões</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(ag.impressions)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Cliques</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(ag.clicks)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">CTR</span>
                                                    <span className="text-slate-800 font-semibold">{formatPercent(agCtr)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo</span>
                                                    <span className="text-[#0866ff] font-bold">{formatCurrency(ag.spend)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Resultados</span>
                                                    <span className="text-[#0f9d58] font-bold">{formatNumber(ag.conversions)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo/Result.</span>
                                                    <span className="text-slate-800 font-semibold">{formatCurrency(agCostPerConv)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
                                <table className="w-full min-w-[800px] text-left border-collapse">
                                    <thead className="sticky top-0 bg-[#f8f9fa] border-b border-slate-300 z-20">
                                        <tr className="divide-x divide-slate-200 h-10">
                                            <th className="w-12 px-3 text-center border-r border-slate-200">
                                                <input 
                                                    type="checkbox" 
                                                    className="rounded border-slate-350 text-[#1a73e8] focus:ring-[#1a73e8] w-3.5 h-3.5 cursor-pointer" 
                                                    checked={sortData(filteredAdGroups).length > 0 && sortData(filteredAdGroups).every(ag => selectedAdGroupIds.has(ag.id.toString()))}
                                                    onChange={() => toggleAllAdGroups(sortData(filteredAdGroups))}
                                                />
                                            </th>
                                            <th className="w-32 px-3 text-center border-r border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">Veiculação</th>
                                            {[
                                                { k: 'name', l: 'Grupo de Anúncios', align: 'left' },
                                                { k: 'campaignName', l: 'Campanha', align: 'left' },
                                                { k: 'budget', l: 'Orçamento', align: 'right' },
                                                { k: 'impressions', l: 'Impr.', align: 'right' },
                                                { k: 'clicks', l: 'Cliques', align: 'right' },
                                                { k: 'ctr', l: 'CTR', align: 'right' },
                                                { k: 'cpc', l: 'CPC Méd.', align: 'right' },
                                                { k: 'spend', l: 'Custo', align: 'right' },
                                                { k: 'conversions', l: 'Conv.', align: 'right' },
                                                { k: 'convRate', l: 'Taxa Conv.', align: 'right' },
                                                { k: 'costPerConv', l: 'Custo/Conv.', align: 'right' }
                                            ].map(h => (
                                                <th 
                                                    key={h.k} 
                                                    onClick={() => handleSort(h.k)} 
                                                    className={`px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-normal whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 text-${h.align}`}
                                                >
                                                    <div className={`flex items-center gap-1 ${h.align === 'right' ? 'justify-end' : 'justify-start'}`}>
                                                        <span>{h.l}</span>
                                                        {renderSortIcon(h.k)}
                                                    </div>
                                                </th>
                                            ))}
                                            {customMetrics.map(m => (
                                                <th 
                                                    key={m.id} 
                                                    onClick={() => handleSort(m.id)} 
                                                    className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-normal whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 text-right"
                                                >
                                                    <div className="flex items-center gap-1 justify-end">
                                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                                                        <span>{m.name}</span>
                                                        {renderSortIcon(m.id)}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 text-slate-700">
                                        {sortData(filteredAdGroups).map((ag, i) => {
                                            return (
                                                <tr key={ag.id} className="group hover:bg-[#f1f3f4]/60 transition-colors duration-150 h-10 divide-x divide-slate-200">
                                                    <td className="px-3 py-2 text-center w-12 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                        <input 
                                                            type="checkbox" 
                                                            className="rounded border-slate-350 text-[#1a73e8] focus:ring-[#1a73e8] w-3.5 h-3.5 cursor-pointer" 
                                                            checked={selectedAdGroupIds.has(ag.id.toString())}
                                                            onChange={() => toggleAdGroupSelection(ag.id.toString())}
                                                        />
                                                    </td>
                                                    {/* Unified Status and Action Dot */}
                                                    <td className="px-2 py-1.5 border-r border-slate-200 relative" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex items-center justify-between gap-1.5 px-1 min-w-[120px]">
                                                            {renderStatusBadge(ag.status, 'google')}
                                                            <div className="cursor-pointer hover:scale-110 transition-transform p-1 rounded hover:bg-slate-100 flex items-center justify-center" onClick={() => setActiveStatusMenuAdGroupId(activeStatusMenuAdGroupId === (ag.id?.toString() || i.toString()) ? null : (ag.id?.toString() || i.toString()))}>
                                                                {ag.status === 'ENABLED' ? (
                                                                    <div className="w-2.5 h-2.5 rounded-full bg-[#0f9d58]" title="Ativo" />
                                                                ) : ag.status === 'PAUSED' ? (
                                                                    <div className="w-3.5 h-3.5 rounded bg-slate-300 flex items-center justify-center text-slate-600 text-[8px] font-bold" title="Pausado">||</div>
                                                                ) : (
                                                                    <div className="w-3.5 h-3.5 rounded bg-rose-100 flex items-center justify-center text-rose-600 text-[8px] font-bold" title="Removido">X</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {activeStatusMenuAdGroupId === (ag.id?.toString() || i.toString()) && (
                                                            <div className="absolute left-full top-2 ml-2 bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 z-50 min-w-[130px] text-left text-xs font-medium text-slate-700 divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100">
                                                                <div className="p-1">
                                                                    <button 
                                                                        onClick={() => {
                                                                            setActiveStatusMenuAdGroupId(null);
                                                                            setAdGroups(prev => prev.map((item, idx) => (item.id === ag.id || idx === i) ? { ...item, status: 'ENABLED' } : item));
                                                                            alert(`Grupo de Anúncios "${ag.name}" ativado com sucesso!`);
                                                                        }}
                                                                        className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 rounded-lg"
                                                                    >
                                                                        <div className="w-2.5 h-2.5 rounded-full bg-[#0f9d58]" />
                                                                        Ativar
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => {
                                                                            setActiveStatusMenuAdGroupId(null);
                                                                            setAdGroups(prev => prev.map((item, idx) => (item.id === ag.id || idx === i) ? { ...item, status: 'PAUSED' } : item));
                                                                            alert(`Grupo de Anúncios "${ag.name}" pausado com sucesso!`);
                                                                        }}
                                                                        className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 rounded-lg"
                                                                    >
                                                                        <div className="w-2.5 h-2.5 rounded bg-slate-400 flex items-center justify-center text-[7px] text-white font-bold">||</div>
                                                                        Pausar
                                                                    </button>
                                                                </div>
                                                                <div className="p-1">
                                                                    <button 
                                                                        onClick={() => {
                                                                            setActiveStatusMenuAdGroupId(null);
                                                                            alert("A remoção de grupos de anúncios deve ser feita diretamente no painel do Google Ads por motivos de segurança.");
                                                                        }}
                                                                        className="w-full text-left px-3 py-2 hover:bg-rose-50 text-rose-600 flex items-center gap-2 rounded-lg"
                                                                    >
                                                                        <div className="w-2.5 h-2.5 rounded bg-rose-600 flex items-center justify-center text-[7px] text-white font-bold">X</div>
                                                                        Remover
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2 font-normal">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="flex items-center gap-2 overflow-hidden">
                                                                <div className="w-5 h-5 bg-blue-50 border border-blue-100 rounded flex items-center justify-center text-[#1a73e8] shrink-0">
                                                                    <Folder size={11} />
                                                                </div>
                                                                <span onClick={(e) => { e.stopPropagation(); toggleAdSetExpand(ag.id.toString()); }} className="text-[#1a73e8] hover:underline font-medium cursor-pointer truncate text-sm" title={ag.name}>
                                                                    {ag.name}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-left font-normal text-slate-500 text-xs">
                                                        {ag.campaignName}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-normal">
                                                        <div className="flex items-center justify-end gap-2 group/edit">
                                                            <div>
                                                                <p className="font-semibold text-slate-800 text-xs">{formatCurrency(ag.budget || 0)}</p>
                                                                <p className="text-[9px] text-slate-400 font-normal">Diário</p>
                                                            </div>
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setMetaBudgetModal({
                                                                        open: true,
                                                                        adsetId: ag.id,
                                                                        adsetName: ag.name,
                                                                        currentBudget: ag.budget || 0
                                                                    });
                                                                }}
                                                                className="p-1 text-slate-400 hover:text-[#0866ff] hover:bg-[#0866ff]/10 rounded opacity-0 group-hover/edit:opacity-100 transition-all"
                                                                title="Editar Orçamento"
                                                            >
                                                                <Edit2 size={12} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatNumber(ag.impressions)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-normal text-slate-800">
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-xs">{formatNumber(ag.clicks)}</span>
                                                            <span className="text-[9px] text-slate-400 text-right mt-0.5 leading-tight">cliques</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatPercent((ag.clicks / ag.impressions) * 100 || 0)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatCurrency(ag.clicks > 0 ? ag.spend / ag.clicks : 0)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-medium text-slate-800">
                                                        {formatCurrency(ag.spend)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {ag.conversions.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatPercent((ag.conversions / ag.clicks) * 100 || 0)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatCurrency(ag.conversions > 0 ? ag.spend / ag.conversions : 0)}
                                                    </td>
                                                    {customMetrics.map(m => (
                                                        <td key={m.id} className="px-4 py-2 text-right text-xs font-medium text-slate-800">
                                                            {formatMetricValue(calculateMetricValue(m, ag), m.format)}
                                                        </td>
                                                    ))}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-[#f8f9fa] border-t-2 border-slate-300 divide-y divide-slate-200">
                                        <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-xs h-11 bg-slate-50">
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-slate-700 italic flex items-center gap-1 whitespace-nowrap h-11" colSpan={3}>
                                                Total: All but removed ad groups in your current view
                                                <HelpCircle size={13} className="text-slate-400 inline cursor-pointer" />
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {formatNumber(calculateTotals(filteredAdGroups).impressions)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatNumber(calculateTotals(filteredAdGroups).clicks)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(filteredAdGroups).ctr)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredAdGroups).cpc)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#1a73e8] bg-[#e8f0fe]/20">
                                                {formatCurrency(calculateTotals(filteredAdGroups).spend)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {calculateTotals(filteredAdGroups).conversions.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(filteredAdGroups).clicks > 0 ? (calculateTotals(filteredAdGroups).conversions / calculateTotals(filteredAdGroups).clicks) * 100 : 0)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredAdGroups).costPerConv)}
                                            </td>
                                            {customMetrics.map(m => (
                                                <td key={m.id} className="px-4 py-2 text-right font-bold border-r border-slate-200">
                                                    {formatMetricValue(calculateMetricValue(m, calculateTotals(filteredAdGroups)), m.format)}
                                                </td>
                                            ))}
                                        </tr>
                                        <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-xs h-11 bg-[#f1f3f4]">
                                            <td className="px-3 py-2 text-center border-r border-slate-200">
                                                <ChevronDown size={14} className="inline text-slate-600 cursor-pointer" />
                                            </td>
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-slate-800 font-bold flex items-center gap-1 whitespace-nowrap h-11" colSpan={3}>
                                                Total: conta
                                                <HelpCircle size={13} className="text-slate-400 inline cursor-pointer" />
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {formatNumber(calculateTotals(filteredAdGroups).impressions)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatNumber(calculateTotals(filteredAdGroups).clicks)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(filteredAdGroups).ctr)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredAdGroups).cpc)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#1a73e8] bg-[#e8f0fe]/20">
                                                {formatCurrency(calculateTotals(filteredAdGroups).spend)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {calculateTotals(filteredAdGroups).conversions.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(filteredAdGroups).clicks > 0 ? (calculateTotals(filteredAdGroups).conversions / calculateTotals(filteredAdGroups).clicks) * 100 : 0)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredAdGroups).costPerConv)}
                                            </td>
                                            {customMetrics.map(m => (
                                                <td key={m.id} className="px-4 py-2 text-right font-bold border-r border-slate-200">
                                                    {formatMetricValue(calculateMetricValue(m, calculateTotals(filteredAdGroups)), m.format)}
                                                </td>
                                            ))}
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            {/* Mobile Google Ad Groups */}
                            <div className="block md:hidden space-y-2 p-2 bg-slate-50">
                                {sortData(filteredAdGroups).map((ag, i) => {
                                    return (
                                        <div key={`mobile-google-adgroup-${ag.id}`} className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
                                            <div className="flex items-start justify-between gap-2.5">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <div className="flex items-center justify-center cursor-pointer h-full" onClick={() => setActiveStatusMenuAdGroupId(activeStatusMenuAdGroupId === (ag.id?.toString() || i.toString()) ? null : (ag.id?.toString() || i.toString()))}>
                                                            {ag.status === 'ENABLED' ? (
                                                                <div className="w-2.5 h-2.5 rounded-full bg-[#0f9d58]" title="Ativo" />
                                                            ) : ag.status === 'PAUSED' ? (
                                                                <div className="w-4 h-4 rounded-full bg-slate-300 flex items-center justify-center text-slate-600 text-[8px] font-bold" title="Pausado">||</div>
                                                            ) : (
                                                                <div className="w-4 h-4 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 text-[8px] font-bold" title="Removido">X</div>
                                                            )}
                                                        </div>
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Grupo de Anúncios</span>
                                                    </div>
                                                    <h4 className="font-bold text-[#1a73e8] hover:underline text-sm mt-1 cursor-pointer break-words">
                                                        {ag.name}
                                                    </h4>
                                                    <span className="text-[11px] text-slate-400 block mt-0.5">Campanha: {ag.campaignName}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100">
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Impressões</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(ag.impressions)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Cliques</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(ag.clicks)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">CTR</span>
                                                    <span className="text-slate-800 font-semibold">{formatPercent((ag.clicks / ag.impressions) * 100 || 0)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo</span>
                                                    <span className="text-[#1a73e8] font-bold">{formatCurrency(ag.spend)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Conversões</span>
                                                    <span className="text-[#0f9d58] font-bold">{formatNumber(ag.conversions)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo/Conv.</span>
                                                    <span className="text-slate-800 font-semibold">{formatCurrency(ag.conversions > 0 ? ag.spend / ag.conversions : 0)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* KEYWORDS TAB */}
            {activeTab === 'keywords' && (
                <>
                    {campaignType === 'PERFORMANCE_MAX' ? (
                         <div className="bg-blue-50 border border-blue-100 rounded-2xl p-8 text-center">
                            <InfoMessage title="Sinais de Audiência" message="Campanhas P-MAX utilizam sinais de audiência e aprendizado de máquina, não palavras-chave manuais." />
                        </div>
                    ) : campaignType === 'DISPLAY' || campaignType === 'VIDEO' ? (
                        <div className="bg-purple-50 border border-purple-100 rounded-2xl p-8 text-center">
                            <InfoMessage title="Segmentação por Audiência" message="Campanhas de Display e Vídeo focam em segmentos de público-alvo, tópicos e canais." />
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="hidden md:block max-h-[600px] overflow-auto rounded-lg border border-slate-200 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
                                <table className="w-full min-w-[800px] text-left border-collapse">
                                    <thead className="sticky top-0 z-20 bg-[#f8f9fa] shadow-sm border-b border-slate-300">
                                        <tr className="divide-x divide-slate-200 h-10">
                                            <th className="w-10 px-3 text-center border-r border-slate-200 bg-[#f8f9fa]" onClick={(e) => e.stopPropagation()}>
                                                <input 
                                                    type="checkbox" 
                                                    className="rounded border-slate-350 text-[#1a73e8] focus:ring-[#1a73e8] w-3.5 h-3.5 cursor-pointer" 
                                                    checked={filteredKeywords.length > 0 && filteredKeywords.every(k => selectedKeywordIds.has(String(k.id)))} 
                                                    onChange={() => toggleAllKeywords(filteredKeywords.map(k => String(k.id)))} 
                                                />
                                            </th>
                                            <th className="w-10 px-3 text-center border-r border-slate-200 bg-[#f8f9fa]"></th>
                                            {[
                                                { k: 'text', l: 'Palavra-chave', align: 'left' },
                                                { k: 'matchType', l: 'Tipo de correspondência', align: 'left' },
                                                { k: 'status', l: 'Status da palavra-chave', align: 'left' },
                                                { k: 'qualityScore', l: 'Índice de Qualidade', align: 'right' },
                                                { k: 'impressions', l: 'Impr.', align: 'right' },
                                                { k: 'clicks', l: 'Cliques', align: 'right' },
                                                { k: 'ctr', l: 'CTR', align: 'right' },
                                                { k: 'cpc', l: 'CPC Méd.', align: 'right' },
                                                { k: 'spend', l: 'Custo', align: 'right' },
                                                { k: 'conversions', l: 'Conv.', align: 'right' },
                                                { k: 'convRate', l: 'Taxa Conv.', align: 'right' },
                                                { k: 'costPerConv', l: 'Custo/Conv.', align: 'right' }
                                            ].map(h => (
                                                <th 
                                                    key={h.k} 
                                                    onClick={() => handleSort(h.k)} 
                                                    className={`px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-normal whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 text-${h.align} bg-[#f8f9fa]`}
                                                >
                                                    <div className={`flex items-center gap-1 ${h.align === 'right' ? 'justify-end' : 'justify-start'}`}>
                                                        <span>{h.l}</span>
                                                        {renderSortIcon(h.k)}
                                                    </div>
                                                </th>
                                            ))}
                                            {customMetrics.map(m => (
                                                <th 
                                                    key={m.id} 
                                                    onClick={() => handleSort(m.id)} 
                                                    className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-normal whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 text-right bg-[#f8f9fa]"
                                                >
                                                    <div className="flex items-center gap-1 justify-end">
                                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                                                        <span>{m.name}</span>
                                                        {renderSortIcon(m.id)}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 text-slate-700">
                                        {sortData(filteredKeywords).map((kw, i) => {
                                            return (
                                                <tr key={kw.id} className="group hover:bg-[#f1f3f4]/60 transition-colors duration-150 h-10 divide-x divide-slate-200">
                                                    <td className="px-3 py-2 text-center w-10 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                        <input 
                                                            type="checkbox" 
                                                            className="rounded border-slate-350 text-[#1a73e8] focus:ring-[#1a73e8] w-3.5 h-3.5 cursor-pointer" 
                                                            checked={selectedKeywordIds.has(String(kw.id))} 
                                                            onChange={() => toggleKeywordSelection(String(kw.id))} 
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2 text-center w-10 relative" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex items-center justify-center cursor-pointer h-full" onClick={() => setActiveStatusMenuKeywordId(activeStatusMenuKeywordId === (kw.id?.toString() || i.toString()) ? null : (kw.id?.toString() || i.toString()))}>
                                                            {kw.status === 'ENABLED' ? (
                                                                <div className="w-2.5 h-2.5 rounded-full bg-[#0f9d58] hover:scale-110 transition-transform" title="Ativo" />
                                                            ) : kw.status === 'PAUSED' ? (
                                                                <div className="w-4 h-4 rounded-full bg-slate-300 flex items-center justify-center hover:scale-110 transition-transform text-slate-600 text-[8px] font-bold" title="Pausado">||</div>
                                                            ) : (
                                                                <div className="w-4 h-4 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 text-[8px] font-bold" title="Removido">X</div>
                                                            )}
                                                        </div>
                                                        {activeStatusMenuKeywordId === (kw.id?.toString() || i.toString()) && (
                                                            <div className="absolute left-full top-2 ml-2 bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 z-50 min-w-[130px] text-left text-xs font-medium text-slate-700 divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100">
                                                                <div className="p-1">
                                                                    <button 
                                                                        onClick={() => {
                                                                            setActiveStatusMenuKeywordId(null);
                                                                            setKeywords(prev => prev.map((item, idx) => (item.text === kw.text || idx === i) ? { ...item, status: 'ENABLED' } : item));
                                                                            alert(`Palavra-chave "${kw.text}" ativada com sucesso!`);
                                                                        }}
                                                                        className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 rounded-lg"
                                                                    >
                                                                        <div className="w-2.5 h-2.5 rounded-full bg-[#0f9d58]" />
                                                                        Ativar
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => {
                                                                            setActiveStatusMenuKeywordId(null);
                                                                            setKeywords(prev => prev.map((item, idx) => (item.text === kw.text || idx === i) ? { ...item, status: 'PAUSED' } : item));
                                                                            alert(`Palavra-chave "${kw.text}" pausada com sucesso!`);
                                                                        }}
                                                                        className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 rounded-lg"
                                                                    >
                                                                        <div className="w-2.5 h-2.5 rounded-full bg-slate-400 flex items-center justify-center text-[7px] text-white font-bold">||</div>
                                                                        Pausar
                                                                    </button>
                                                                </div>
                                                                <div className="p-1">
                                                                    <button 
                                                                        onClick={() => {
                                                                            setActiveStatusMenuKeywordId(null);
                                                                            alert("A remoção de palavras-chave deve ser feita diretamente no painel do Google Ads por motivos de segurança.");
                                                                        }}
                                                                        className="w-full text-left px-3 py-2 hover:bg-rose-50 text-rose-600 flex items-center gap-2 rounded-lg"
                                                                    >
                                                                        <div className="w-2.5 h-2.5 rounded-full bg-rose-600 flex items-center justify-center text-[7px] text-white font-bold">X</div>
                                                                        Remover
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2 font-semibold text-slate-900">
                                                        <span className="hover:underline cursor-pointer text-[#1a73e8]" title={kw.text}>
                                                            {kw.matchType === 'PHRASE' ? `"${kw.text}"` : kw.matchType === 'EXACT' ? `[${kw.text}]` : kw.text}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 text-left font-normal text-slate-500 text-xs">
                                                        {kw.matchType === 'EXACT' ? 'Correspondência exata' : kw.matchType === 'PHRASE' ? 'Correspondência de frase' : 'Correspondência ampla'}
                                                    </td>
                                                    <td className="px-4 py-2 text-left font-normal">
                                                        <div className="flex flex-col">
                                                            <span className={`text-xs font-semibold ${kw.status === 'ENABLED' ? 'text-slate-800' : 'text-slate-400'}`}>
                                                                {kw.status === 'ENABLED' ? 'Ativo' : 'Pausado'}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400 font-normal mt-0.5">
                                                                {kw.status === 'ENABLED' ? 'Qualificada' : 'Pausada'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        <span className="font-medium">{kw.qualityScore}/10</span>
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatNumber(kw.impressions)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-normal text-slate-800">
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-xs">{formatNumber(kw.clicks)}</span>
                                                            <span className="text-[9px] text-slate-400 text-right mt-0.5 leading-tight">cliques</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatPercent((kw.clicks / kw.impressions) * 100 || 0)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatCurrency(kw.clicks > 0 ? kw.spend / kw.clicks : 0)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-medium text-slate-800">
                                                        {formatCurrency(kw.spend)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {kw.conversions.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatPercent((kw.conversions / kw.clicks) * 100 || 0)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatCurrency(kw.conversions > 0 ? kw.spend / kw.conversions : 0)}
                                                    </td>
                                                    {customMetrics.map(m => (
                                                        <td key={m.id} className="px-4 py-2 text-right text-xs font-medium text-slate-800">
                                                            {formatMetricValue(calculateMetricValue(m, kw), m.format)}
                                                        </td>
                                                    ))}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="sticky bottom-0 z-20 bg-[#f8f9fa] shadow-[0_-2px_4px_rgba(0,0,0,0.05)] border-t-2 border-slate-300 divide-y divide-slate-200">
                                        <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-xs h-11 bg-slate-50">
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-slate-700 italic flex items-center gap-1 whitespace-nowrap h-11" colSpan={4}>
                                                Total: All but removed keywords in your current view
                                                <HelpCircle size={13} className="text-slate-400 inline cursor-pointer" />
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {formatNumber(calculateTotals(filteredKeywords).impressions)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatNumber(calculateTotals(filteredKeywords).clicks)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(filteredKeywords).ctr)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredKeywords).cpc)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#1a73e8] bg-[#e8f0fe]/20">
                                                {formatCurrency(calculateTotals(filteredKeywords).spend)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {calculateTotals(filteredKeywords).conversions.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(filteredKeywords).clicks > 0 ? (calculateTotals(filteredKeywords).conversions / calculateTotals(filteredKeywords).clicks) * 100 : 0)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredKeywords).costPerConv)}
                                            </td>
                                            {customMetrics.map(m => (
                                                <td key={m.id} className="px-4 py-2 text-right font-bold border-r border-slate-200">
                                                    {formatMetricValue(calculateMetricValue(m, calculateTotals(filteredKeywords)), m.format)}
                                                </td>
                                            ))}
                                        </tr>
                                        <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-xs h-11 bg-[#f1f3f4]">
                                            <td className="px-3 py-2 text-center border-r border-slate-200">
                                                <ChevronDown size={14} className="inline text-slate-600 cursor-pointer" />
                                            </td>
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-slate-800 font-bold flex items-center gap-1 whitespace-nowrap h-11" colSpan={4}>
                                                Total: conta
                                                <HelpCircle size={13} className="text-slate-400 inline cursor-pointer" />
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {formatNumber(calculateTotals(filteredKeywords).impressions)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatNumber(calculateTotals(filteredKeywords).clicks)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(filteredKeywords).ctr)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredKeywords).cpc)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#1a73e8] bg-[#e8f0fe]/20">
                                                {formatCurrency(calculateTotals(filteredKeywords).spend)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {calculateTotals(filteredKeywords).conversions.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(filteredKeywords).clicks > 0 ? (calculateTotals(filteredKeywords).conversions / calculateTotals(filteredKeywords).clicks) * 100 : 0)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredKeywords).costPerConv)}
                                            </td>
                                            {customMetrics.map(m => (
                                                <td key={m.id} className="px-4 py-2 text-right font-bold border-r border-slate-200">
                                                    {formatMetricValue(calculateMetricValue(m, calculateTotals(filteredKeywords)), m.format)}
                                                </td>
                                            ))}
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            {/* Mobile Keywords */}
                            <div className="block md:hidden space-y-2 p-2 bg-slate-50">
                                {sortData(filteredKeywords).map((kw, i) => {
                                    return (
                                        <div key={`mobile-keyword-${kw.id}`} className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
                                            <div className="flex items-start justify-between gap-2.5">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <div className="flex items-center justify-center cursor-pointer h-full" onClick={() => setActiveStatusMenuKeywordId(activeStatusMenuKeywordId === (kw.id?.toString() || i.toString()) ? null : (kw.id?.toString() || i.toString()))}>
                                                            {kw.status === 'ENABLED' ? (
                                                                <div className="w-2.5 h-2.5 rounded-full bg-[#0f9d58]" title="Ativo" />
                                                            ) : kw.status === 'PAUSED' ? (
                                                                <div className="w-4 h-4 rounded-full bg-slate-300 flex items-center justify-center text-slate-600 text-[8px] font-bold" title="Pausado">||</div>
                                                            ) : (
                                                                <div className="w-4 h-4 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 text-[8px] font-bold" title="Removido">X</div>
                                                            )}
                                                        </div>
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                                            {kw.matchType === 'EXACT' ? 'Exata' : kw.matchType === 'PHRASE' ? 'Frase' : 'Ampla'}
                                                        </span>
                                                    </div>
                                                    <h4 className="font-bold text-[#1a73e8] hover:underline text-sm mt-1 cursor-pointer break-words">
                                                        {kw.matchType === 'PHRASE' ? `"${kw.text}"` : kw.matchType === 'EXACT' ? `[${kw.text}]` : kw.text}
                                                    </h4>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100">
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Qualidade</span>
                                                    <span className="text-slate-800 font-semibold">{kw.qualityScore}/10</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Impr.</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(kw.impressions)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Cliques</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(kw.clicks)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo</span>
                                                    <span className="text-[#1a73e8] font-bold">{formatCurrency(kw.spend)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Conv.</span>
                                                    <span className="text-[#0f9d58] font-bold">{formatNumber(kw.conversions)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo/Conv.</span>
                                                    <span className="text-slate-800 font-semibold">{formatCurrency(kw.conversions > 0 ? kw.spend / kw.conversions : 0)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ADS TAB */}
            {activeTab === 'ads' && (
                <>
                    {activePlatform === 'meta' ? (
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                            {/* LEFT PANEL: TABLE OF META ADS */}
                            <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col order-2 xl:order-1">
                                <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <Instagram size={18} className="text-[#0866ff]" />
                                        <h3 className="font-bold text-slate-800 text-sm">Gerenciador de Anúncios (Meta Ads)</h3>
                                    </div>
                                    <span className="text-xs bg-indigo-50 text-[#0866ff] font-semibold px-2.5 py-1 rounded-full border border-indigo-100">
                                        {metaAds.length} Anúncios Ativos
                                    </span>
                                </div>
                                
                                {selectedAdIds.size > 0 && (
                                    <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-indigo-900 animate-in fade-in duration-150">
                                        <div className="flex items-center gap-2">
                                            <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-full text-[10px] font-bold">{selectedAdIds.size}</span>
                                            <span>selecionados</span>
                                        </div>
                                        <button 
                                            onClick={() => setSelectedAdIds(new Set())}
                                            className="text-[#0866ff] hover:text-blue-800 hover:underline transition-colors font-medium"
                                        >
                                            Desmarcar todos
                                        </button>
                                    </div>
                                )}
                                
                                <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
                                    <table className="w-full min-w-[800px] text-left border-collapse">
                                        <thead className="sticky top-0 bg-[#f8f9fa] border-b border-slate-250 z-20">
                                            <tr className="divide-x divide-slate-200 text-slate-500">
                                                <th className="w-10 px-2 py-3 text-center border-r border-slate-200">
                                                    <input 
                                                        type="checkbox" 
                                                        className="rounded border-slate-300 text-[#0866ff] focus:ring-[#0866ff] w-3.5 h-3.5 cursor-pointer" 
                                                        checked={metaAds.length > 0 && metaAds.every(ad => selectedAdIds.has(ad.id.toString()))}
                                                        onChange={() => toggleAllAds(metaAds)}
                                                    />
                                                </th>
                                                <th className="w-32 px-2 py-3 text-center border-r border-slate-200 text-[10px] font-bold uppercase tracking-wider">Veiculação</th>
                                                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider border-r border-slate-200">Criativo / Nome do Anúncio</th>
                                                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider border-r border-slate-200 text-right">Resultados</th>
                                                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider border-r border-slate-200 text-right">Alcance</th>
                                                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider border-r border-slate-200 text-right">Cliques (Link)</th>
                                                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider border-r border-slate-200 text-right">Custo (Gasto)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 text-slate-700">
                                            {metaAds.map((ad, idx) => {
                                                const isSelectedForPreview = selectedMetaAdIdForPreview !== null && ad.id?.toString() === selectedMetaAdIdForPreview;
                                                const isChecked = selectedAdIds.has(ad.id.toString());
                                                return (
                                                    <tr 
                                                        key={ad.id || idx} 
                                                        id={'ad-row-' + ad.id}
                                                        ref={selectedAdForPreview?.id === ad.id ? selectedAdRowRef : null}
                                                        onClick={() => {
                                                            handleSelectMetaAd(ad.id?.toString());
                                                            handleAdClick(ad);
                                                        }}
                                                        className={`group cursor-pointer transition-all h-14 divide-x divide-slate-200 ${selectedAdForPreview?.id === ad.id ? 'bg-blue-50 ring-2 ring-blue-200' : isSelectedForPreview ? 'bg-indigo-50/40 border-l-4 border-l-[#0866ff]' : 'hover:bg-[#f2f4f7]/40'}`}
                                                    >
                                                        <td className="px-2 py-2 text-center w-10 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                            <input 
                                                                type="checkbox" 
                                                                className="rounded border-slate-300 text-[#0866ff] focus:ring-[#0866ff] w-3.5 h-3.5 cursor-pointer" 
                                                                checked={isChecked}
                                                                onChange={() => toggleAdSelection(ad.id.toString())}
                                                            />
                                                        </td>
                                                        <td className="px-2 py-2 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                            <div className="flex items-center justify-between gap-2 px-1 min-w-[120px]">
                                                                {renderStatusBadge(ad.effective_status || ad.status, 'meta')}
                                                                <label className="relative inline-flex items-center cursor-pointer">
                                                                    <input 
                                                                        type="checkbox" 
                                                                        checked={ad.status === 'ENABLED' || ad.status === 'ACTIVE'} 
                                                                        onChange={() => {
                                                                            setMetaAds(prev => prev.map((item, idx2) => (item.id === ad.id || idx2 === idx) ? { ...item, status: (ad.status === 'ENABLED' || ad.status === 'ACTIVE') ? 'PAUSED' : 'ENABLED' } : item));
                                                                        }}
                                                                        className="sr-only peer" 
                                                                    />
                                                                    <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3.5 after:transition-all peer-checked:bg-[#0866ff]"></div>
                                                                </label>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2">
                                                            <div className="flex items-center gap-3">
                                                                {/* Image Thumbnail preview */}
                                                                <div className="w-10 h-10 shrink-0 rounded bg-slate-100 border border-slate-200 overflow-hidden relative flex items-center justify-center">
                                                                    {ad.imageUrl ? (
                                                                        <img src={ad.imageUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                                    ) : ad.videoId ? (
                                                                        <div className="absolute inset-0 bg-slate-950 flex items-center justify-center">
                                                                            <Play size={14} className="text-white fill-white" />
                                                                        </div>
                                                                    ) : (
                                                                        <ImageIcon size={14} className="text-slate-400" />
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="font-semibold text-slate-800 text-xs truncate max-w-[180px]" title={ad.headlines || ad.title}>
                                                                        {ad.headlines || ad.title || `Anúncio #${ad.id}`}
                                                                    </p>
                                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                                        <span className="text-[9px] text-slate-400 font-normal block truncate max-w-[100px]" title={ad.campaignName}>
                                                                            C: {ad.campaignName}
                                                                        </span>
                                                                        <span className="text-[10px] text-slate-300 shrink-0">|</span>
                                                                        <span className="text-[9px] text-slate-400 font-normal block truncate max-w-[100px]" title={ad.adGroupName}>
                                                                            CJ: {ad.adGroupName}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2 text-right text-xs font-semibold text-indigo-600">
                                                            {formatNumber(ad.conversions || 0)}
                                                        </td>
                                                        <td className="px-4 py-2 text-right text-xs text-slate-600">
                                                            {formatNumber(ad.impressions || 0)}
                                                        </td>
                                                        <td className="px-4 py-2 text-right text-xs text-slate-600">
                                                            {formatNumber(ad.clicks || 0)}
                                                        </td>
                                                        <td className="px-4 py-2 text-right text-xs font-bold text-slate-900 bg-slate-50/30">
                                                            {formatCurrency(ad.spend || 0)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot className="bg-slate-50 border-t border-slate-200 sticky bottom-0 z-10">
                                            <tr className="divide-x divide-slate-200 font-bold text-slate-800 text-xs h-10">
                                                <td colSpan={3} className="px-4 py-2 text-slate-600">Total de Anúncios</td>
                                                <td className="px-4 py-2 text-right text-indigo-600">{formatNumber(calculateTotals(metaAds).conversions)}</td>
                                                <td className="px-4 py-2 text-right">{formatNumber(calculateTotals(metaAds).impressions)}</td>
                                                <td className="px-4 py-2 text-right">{formatNumber(calculateTotals(metaAds).clicks)}</td>
                                                <td className="px-4 py-2 text-right text-[#0866ff] bg-[#0866ff]/5">{formatCurrency(calculateTotals(metaAds).spend)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                                {/* Mobile Meta Ads */}
                                <div className="hidden space-y-2 p-2 bg-slate-50 border-t border-slate-200">
                                    {metaAds.map((ad, i) => {
                                        return (
                                            <div 
                                                key={ad.id?.toString() || `meta-ad-${i}`} 
                                                onClick={() => setSelectedMetaAdIdForPreview(ad.id?.toString())}
                                                className={`bg-white p-2.5 rounded-xl border transition-all shadow-sm space-y-2 cursor-pointer ${selectedMetaAdIdForPreview === ad.id?.toString() ? 'border-[#0866ff] ring-2 ring-[#0866ff]/10' : 'border-slate-200 hover:border-slate-300'}`}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <Instagram size={14} className="text-[#0866ff]" />
                                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Meta Ad</span>
                                                        </div>
                                                        <h4 className="font-bold text-slate-900 text-sm mt-1 truncate" title={ad.name}>
                                                            {ad.name}
                                                        </h4>
                                                    </div>
                                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 ${ad.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                                                        {ad.status === 'ACTIVE' ? 'Ativo' : ad.status}
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100">
                                                    <div>
                                                        <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Impressões</span>
                                                        <span className="text-slate-800 font-semibold">{formatNumber(ad.impressions || 0)}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Cliques</span>
                                                        <span className="text-slate-800 font-semibold">{formatNumber(ad.clicks || 0)}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Resultados</span>
                                                        <span className="text-[#0f9d58] font-bold">{formatNumber(ad.conversions || 0)}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo</span>
                                                        <span className="text-[#0866ff] font-bold">{formatCurrency(ad.spend || 0)}</span>
                                                    </div>
                                                </div>
                                                <div className="text-[10px] text-slate-450 font-medium text-center bg-slate-50 py-1 rounded-md border border-slate-100">
                                                    Toque para ver prévia interativa
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* RIGHT PANEL: INTERACTIVE PREVIEW */}
                            <div ref={metaPreviewRef} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-5 order-1 xl:order-2">
                                <div className="border-b border-slate-100 pb-4 mb-4">
                                    <div className="flex justify-between items-center gap-2">
                                        <h4 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                                            <Eye size={16} className="text-[#0866ff]" />
                                            Visualização do Anúncio (Meta Mockup)
                                        </h4>
                                        {selectedMetaAdIdForPreview !== null && (
                                            <button 
                                                onClick={() => setSelectedMetaAdIdForPreview(null)}
                                                className="text-[10px] text-red-600 hover:text-red-750 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded-lg transition-colors font-bold uppercase tracking-wider"
                                            >
                                                Limpar seleção
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-slate-400 font-medium mt-1.5 uppercase tracking-wider">Selecione uma plataforma abaixo para ver a prévia:</p>
                                    
                                    {/* Mockup Platforms Tabs selector */}
                                    <div className="grid grid-cols-3 gap-1.5 mt-3 bg-slate-100 p-1 rounded-xl">
                                        {[
                                            { id: 'facebook', label: 'FB Feed' },
                                            { id: 'instagram', label: 'IG Feed' },
                                            { id: 'stories', label: 'IG Stories' }
                                        ].map(plat => (
                                            <button
                                                key={plat.id}
                                                onClick={() => setMetaPreviewPlatform(plat.id as any)}
                                                className={`py-1.5 px-2 rounded-lg text-[10px] font-bold uppercase transition-all ${metaPreviewPlatform === plat.id ? 'bg-white text-[#0866ff] shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                                            >
                                                {plat.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {(metaAds.find(a => a.id?.toString() === selectedMetaAdIdForPreview) || metaAds[0]) ? (
                                    (() => {
                                        const activePreviewAd = metaAds.find(a => a.id?.toString() === selectedMetaAdIdForPreview) || metaAds[0];
                                        return (
                                            <div className="flex-1 flex flex-col items-center justify-center py-2">
                                                {/* FB FEED MOCKUP */}
                                                {metaPreviewPlatform === 'facebook' && (
                                                    <div className="w-full max-w-[340px] border border-slate-200 rounded-xl bg-white shadow-md overflow-hidden flex flex-col text-slate-900">
                                                        {/* Header */}
                                                        <div className="p-3 flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-9 h-9 rounded-full bg-[#0866ff] flex items-center justify-center text-white font-extrabold text-sm shadow-sm select-none">
                                                                    AX
                                                                </div>
                                                                <div>
                                                                    <h5 className="text-xs font-bold hover:underline cursor-pointer">Axis AI Gestão</h5>
                                                                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium mt-0.5">
                                                                        <span>Patrocinado</span>
                                                                        <span>•</span>
                                                                        <span className="w-3 h-3 flex items-center justify-center text-[8px] font-bold bg-slate-100 border border-slate-200 rounded-full">🌐</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <button className="text-slate-400 hover:text-slate-600 font-bold px-1 text-sm">•••</button>
                                                        </div>

                                                        {/* Caption / Primary Text */}
                                                        <div className="px-3 pb-3 text-xs text-slate-800 leading-normal font-normal">
                                                            {activePreviewAd.body || "Acelere a gestão da sua empresa com inteligência artificial de ponta. Automatize processos e aumente seus lucros com o Axis AI Gestão!"}
                                                        </div>

                                                        {/* Creative Media */}
                                                        <div className="aspect-[1.91/1] w-full bg-slate-100 border-y border-slate-150 overflow-hidden relative flex items-center justify-center">
                                                            {activePreviewAd.imageUrl ? (
                                                                <img src={activePreviewAd.imageUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                            ) : activePreviewAd.videoId ? (
                                                                <div className="absolute inset-0 bg-black flex flex-col items-center justify-center text-white">
                                                                    <Play size={32} className="fill-white" />
                                                                    <span className="text-[10px] uppercase font-bold tracking-wider mt-2">Vídeo do Anúncio</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex flex-col items-center justify-center text-slate-400">
                                                                    <ImageIcon size={32} className="stroke-1.5" />
                                                                    <span className="text-[10px] font-semibold mt-1">Sem imagem</span>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Headline & CTA Link block */}
                                                        <div className="bg-[#f2f3f5] p-3 flex items-center justify-between gap-2 border-b border-slate-150">
                                                            <div className="min-w-0">
                                                                <span className="text-[10px] text-slate-500 uppercase tracking-wide font-medium block truncate">axisgestao.com</span>
                                                                <span className="text-xs font-bold text-slate-800 block truncate mt-0.5" title={activePreviewAd.title}>
                                                                    {activePreviewAd.title || "Transforme sua Operação"}
                                                                </span>
                                                            </div>
                                                            <button className="bg-white hover:bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-xs font-bold text-slate-800 shrink-0 shadow-sm transition-all">
                                                                Saiba mais
                                                            </button>
                                                        </div>

                                                        {/* Social Feedback Bar */}
                                                        <div className="p-2.5 flex items-center justify-between border-b border-slate-100 text-slate-500 text-[11px] font-medium px-4">
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-xs">👍❤️😮</span>
                                                                <span>148</span>
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <span>12 coment.</span>
                                                                <span>•</span>
                                                                <span>8 compart.</span>
                                                            </div>
                                                        </div>
                                                        
                                                        <div className="grid grid-cols-3 text-slate-500 text-xs font-semibold py-1.5 border-t border-slate-100 bg-slate-50/40 text-center">
                                                            <button className="hover:bg-slate-100 py-1 rounded flex items-center justify-center gap-1.5 transition-colors">👍 Curtir</button>
                                                            <button className="hover:bg-slate-100 py-1 rounded flex items-center justify-center gap-1.5 transition-colors">💬 Comentar</button>
                                                            <button className="hover:bg-slate-100 py-1 rounded flex items-center justify-center gap-1.5 transition-colors">↩️ Compartilhar</button>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* IG FEED MOCKUP */}
                                                {metaPreviewPlatform === 'instagram' && (
                                                    <div className="w-full max-w-[340px] border border-slate-200 rounded-xl bg-white shadow-md overflow-hidden flex flex-col text-slate-900 font-sans">
                                                        {/* Header */}
                                                        <div className="p-3 flex items-center justify-between border-b border-slate-100">
                                                            <div className="flex items-center gap-2">
                                                                {/* Avatar with circle gradient border */}
                                                                <div className="p-[1.5px] rounded-full bg-gradient-to-tr from-yellow-500 via-red-500 to-purple-600">
                                                                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center p-[2px]">
                                                                        <div className="w-full h-full rounded-full bg-[#0866ff] flex items-center justify-center text-white text-[11px] font-bold shadow-sm select-none">
                                                                            AX
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <h5 className="text-[11px] font-bold hover:underline cursor-pointer leading-tight">axis.ai.gestao</h5>
                                                                    <span className="text-[9px] text-slate-500 block leading-none font-medium mt-0.5">Patrocinado</span>
                                                                </div>
                                                            </div>
                                                            <button className="text-slate-400 hover:text-slate-600 font-bold px-1 text-sm">•••</button>
                                                        </div>

                                                        {/* Creative Square Media */}
                                                        <div className="aspect-square w-full bg-slate-50 overflow-hidden relative flex items-center justify-center">
                                                            {activePreviewAd.imageUrl ? (
                                                                <img src={activePreviewAd.imageUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                            ) : activePreviewAd.videoId ? (
                                                                <div className="absolute inset-0 bg-black flex flex-col items-center justify-center text-white">
                                                                    <Play size={40} className="fill-white" />
                                                                    <span className="text-[10px] uppercase font-bold tracking-wider mt-2">Vídeo no Instagram</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex flex-col items-center justify-center text-slate-400">
                                                                    <ImageIcon size={32} className="stroke-1.5" />
                                                                    <span className="text-[10px] font-semibold mt-1">Sem imagem</span>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Call To Action Banner */}
                                                        <div className="bg-[#0866ff] hover:bg-[#0855d0] text-white px-4 py-2.5 flex items-center justify-between text-xs font-bold transition-colors cursor-pointer">
                                                            <span>Saiba mais</span>
                                                            <span>➔</span>
                                                        </div>

                                                        {/* Icons actions bar */}
                                                        <div className="p-3 flex items-center justify-between text-slate-700">
                                                            <div className="flex items-center gap-3">
                                                                <button className="hover:scale-110 transition-transform">❤️</button>
                                                                <button className="hover:scale-110 transition-transform">💬</button>
                                                                <button className="hover:scale-110 transition-transform">✈️</button>
                                                            </div>
                                                            <button className="hover:scale-110 transition-transform">🔖</button>
                                                        </div>

                                                        {/* Caption block */}
                                                        <div className="px-3 pb-4 text-[11px] text-slate-800 leading-relaxed font-normal">
                                                            <span className="font-bold mr-1.5">axis.ai.gestao</span>
                                                            {activePreviewAd.body || "Automatize seus processos hoje com nossa tecnologia avançada."}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* STORIES MOCKUP */}
                                                {metaPreviewPlatform === 'stories' && (
                                                    <div className="w-full max-w-[260px] aspect-[9/16] border border-slate-700 rounded-2xl bg-slate-950 shadow-2xl overflow-hidden relative flex flex-col text-white font-sans">
                                                        {/* Top Status Bar Mock */}
                                                        <div className="absolute top-0 inset-x-0 h-1 bg-white/20 z-10 m-2 flex gap-1 rounded-full overflow-hidden">
                                                            <div className="flex-1 bg-white rounded-full"></div>
                                                        </div>

                                                        {/* Header info */}
                                                        <div className="absolute top-3 inset-x-0 p-3 flex items-center justify-between z-10 bg-gradient-to-b from-black/40 to-transparent">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-7 h-7 rounded-full bg-[#0866ff] flex items-center justify-center text-white text-[9px] font-bold shadow-md select-none border border-white/20">
                                                                    AX
                                                                </div>
                                                                <div>
                                                                    <h5 className="text-[10px] font-bold drop-shadow">axis.ai.gestao</h5>
                                                                    <span className="text-[8px] text-white/80 block leading-none font-medium mt-0.5 drop-shadow">Patrocinado</span>
                                                                </div>
                                                            </div>
                                                            <button className="text-white hover:text-white/80 font-bold px-1 text-xs drop-shadow">✕</button>
                                                        </div>

                                                        {/* Main Stories Creative background */}
                                                        <div className="absolute inset-0 z-0 bg-slate-900 flex items-center justify-center">
                                                            {activePreviewAd.imageUrl ? (
                                                                <img src={activePreviewAd.imageUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                            ) : activePreviewAd.videoId ? (
                                                                <div className="flex flex-col items-center justify-center text-white/70">
                                                                    <Play size={40} className="fill-white/80" />
                                                                    <span className="text-[9px] uppercase font-bold tracking-widest mt-2">Vídeo Stories</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex flex-col items-center justify-center text-slate-500">
                                                                    <ImageIcon size={40} className="stroke-1" />
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Bottom Stories Swiper / Swipe-up bar overlay */}
                                                        <div className="absolute bottom-0 inset-x-0 p-4 z-10 bg-gradient-to-t from-black/60 via-black/20 to-transparent flex flex-col items-center justify-end gap-1 text-center">
                                                            {/* Headline overlay */}
                                                            <p className="text-xs font-bold drop-shadow text-white/90 truncate max-w-full px-2">
                                                                {activePreviewAd.title || "Axis AI Gestão Inteligente"}
                                                            </p>
                                                            
                                                            <div className="animate-bounce text-[10px] mt-2 text-white/90">▲</div>
                                                            <span className="bg-white/20 backdrop-blur-md border border-white/30 rounded-full px-4 py-1.5 text-[9px] font-extrabold uppercase tracking-widest hover:bg-white/35 transition-all text-white select-none cursor-pointer">
                                                                Saiba mais
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center text-center py-20 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                        <p className="text-xs text-slate-400 font-medium">Nenhum anúncio selecionado para prévia.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : campaignType === 'PERFORMANCE_MAX' ? (
                        <div className="space-y-8">
                            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-8 text-center">
                                <InfoMessage title="Recursos Performance Max" message="Campanhas P-MAX não possuem anúncios tradicionais. O Google combina os recursos abaixo para criar anúncios dinâmicos em todas as redes." />
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {[
                                    { title: 'Títulos', filter: (a: any) => a.fieldType?.includes('HEADLINE') },
                                    { title: 'Descrições', filter: (a: any) => a.fieldType?.includes('DESCRIPTION') },
                                    { title: 'Imagens', filter: (a: any) => a.type === 'IMAGE' || a.fieldType?.includes('IMAGE') || a.fieldType?.includes('LOGO') },
                                    { title: 'Vídeos', filter: (a: any) => a.type === 'YOUTUBE_VIDEO' || a.fieldType?.includes('VIDEO') }
                                ].map(category => {
                                    const assets = pmaxAssets.filter(category.filter);
                                    return (
                                        <div key={category.title} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                            <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2 uppercase tracking-wider">
                                                {category.title} <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{assets.length}</span>
                                            </h3>
                                            <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                                                {assets.length === 0 ? (
                                                    <p className="text-sm text-slate-400 italic">Nenhum recurso encontrado.</p>
                                                ) : (
                                                    assets.map((asset, i) => (
                                                        <div key={`pmax-asset-${asset.id || asset.name || i}`} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-4 hover:bg-slate-100/50 transition-colors">
                                                            {category.title === 'Imagens' && asset.imageUrl && (
                                                                <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-slate-200 border border-slate-200">
                                                                    <img src={asset.imageUrl} alt={asset.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                                </div>
                                                            )}
                                                            {category.title === 'Vídeos' && asset.videoId && (
                                                                <div className="w-24 h-16 shrink-0 rounded-lg overflow-hidden bg-slate-200 border border-slate-200 relative group">
                                                                    <img src={`https://img.youtube.com/vi/${asset.videoId}/mqdefault.jpg`} alt={asset.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                        <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center">
                                                                            <div className="w-0 h-0 border-t-4 border-t-transparent border-l-6 border-l-white border-b-4 border-b-transparent ml-1"></div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm font-medium text-slate-900 truncate" title={asset.text || asset.name}>{asset.text || asset.name}</p>
                                                                <div className="flex items-center gap-2 mt-1.5">
                                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{asset.fieldType?.replace(/_/g, ' ')}</span>
                                                                    {asset.status && (
                                                                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${asset.status === 'ENABLED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                                                                            {asset.status}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            {selectedAdIds.size > 0 && (
                                <div className="bg-blue-50 border-b border-blue-100 px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-blue-900 animate-in fade-in duration-150">
                                    <div className="flex items-center gap-2">
                                        <span className="bg-blue-600 text-white px-2 py-0.5 rounded-full text-[10px] font-bold">{selectedAdIds.size}</span>
                                        <span>selecionados</span>
                                    </div>
                                    <button 
                                        onClick={() => setSelectedAdIds(new Set())}
                                        className="text-blue-600 hover:text-blue-800 hover:underline transition-colors font-medium"
                                    >
                                        Desmarcar todos
                                    </button>
                                </div>
                            )}

                            <div className="hidden md:block max-h-[600px] overflow-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
                                <table className="w-full min-w-[800px] text-left border-collapse">
                                    <thead className="sticky top-0 bg-[#f8f9fa] border-b border-slate-300 z-20">
                                        <tr className="divide-x divide-slate-200 h-10">
                                            <th className="w-10 px-3 text-center border-r border-slate-200">
                                                <input 
                                                    type="checkbox" 
                                                    className="rounded border-slate-350 text-[#1a73e8] focus:ring-[#1a73e8] w-3.5 h-3.5 cursor-pointer" 
                                                    checked={filteredAds.length > 0 && filteredAds.every(ad => selectedAdIds.has(ad.id.toString()))}
                                                    onChange={() => toggleAllAds(filteredAds)}
                                                />
                                            </th>
                                            <th className="w-36 px-3 text-center border-r border-slate-200 text-[10px] font-bold uppercase tracking-wider">Veiculação</th>
                                            {[
                                                { k: 'headlines', l: 'Anúncio (Títulos)', align: 'left' },
                                                { k: 'campaignName', l: 'Campanha', align: 'left' },
                                                { k: 'adGroupName', l: 'Grupo de anúncios', align: 'left' },
                                                { k: 'impressions', l: 'Impr.', align: 'right' },
                                                { k: 'clicks', l: 'Cliques', align: 'right' },
                                                { k: 'ctr', l: 'CTR', align: 'right' },
                                                { k: 'cpc', l: 'CPC Méd.', align: 'right' },
                                                { k: 'spend', l: 'Custo', align: 'right' }
                                            ].map(h => (
                                                <th 
                                                    key={h.k} 
                                                    onClick={() => handleSort(h.k)} 
                                                    className={`px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-normal whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 text-${h.align}`}
                                                >
                                                    <div className={`flex items-center gap-1 ${h.align === 'right' ? 'justify-end' : 'justify-start'}`}>
                                                        <span>{h.l}</span>
                                                        {renderSortIcon(h.k)}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 text-slate-700">
                                        {sortData(filteredAds).map((ad, i) => {
                                            const isChecked = selectedAdIds.has(ad.id.toString());
                                            return (
                                                <tr 
                                                    key={ad.id?.toString() || `ad-row-${i}`} 
                                                    id={'ad-row-' + ad.id}
                                                    ref={selectedAdForPreview?.id === ad.id ? selectedAdRowRef : null}
                                                    onClick={() => handleAdClick(ad)}
                                                    className={`group hover:bg-[#f1f3f4]/60 transition-colors duration-150 h-11 divide-x divide-slate-200 cursor-pointer ${selectedAdForPreview?.id === ad.id ? 'bg-blue-50 ring-2 ring-blue-200' : ''}`}
                                                >
                                                    <td className="px-3 py-2 text-center w-10 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                        <input 
                                                            type="checkbox" 
                                                            className="rounded border-slate-350 text-[#1a73e8] focus:ring-[#1a73e8] w-3.5 h-3.5 cursor-pointer" 
                                                            checked={isChecked}
                                                            onChange={() => toggleAdSelection(ad.id.toString())}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex items-center justify-between gap-1.5 px-1 min-w-[130px]">
                                                            {renderStatusBadge(ad.status, 'google')}
                                                            <button 
                                                                onClick={() => {
                                                                    const nextStatus = ad.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
                                                                    setAds(prev => prev.map((item, idx) => (item.id === ad.id || idx === i) ? { ...item, status: nextStatus } : item));
                                                                }}
                                                                className={`p-1 rounded transition-colors ${
                                                                    ad.status === 'ENABLED' 
                                                                        ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' 
                                                                        : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                                                                }`}
                                                            >
                                                                {ad.status === 'ENABLED' ? <Pause size={12} /> : <Play size={12} />}
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 font-normal max-w-md">
                                                        <div className="flex flex-col gap-1">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">RSA</span>
                                                                <span className="text-[#1a73e8] hover:underline font-medium cursor-pointer text-sm truncate" title={ad.headlines}>
                                                                    {ad.headlines?.split(' | ')[0] || 'Anúncio responsivo de pesquisa'}
                                                                </span>
                                                            </div>
                                                            {ad.headlines?.split(' | ').length > 1 && (
                                                                <p className="text-[10.5px] text-slate-500 font-normal truncate">
                                                                    {ad.headlines?.split(' | ').slice(1).join(' • ')}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-left font-normal text-slate-500 text-xs">
                                                        {ad.campaignName}
                                                    </td>
                                                    <td className="px-4 py-2 text-left font-normal text-slate-500 text-xs">
                                                        {ad.adGroupName}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatNumber(ad.impressions)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-normal text-slate-800">
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-xs">{formatNumber(ad.clicks)}</span>
                                                            <span className="text-[9px] text-slate-400 text-right mt-0.5 leading-tight">cliques</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatPercent((ad.clicks / ad.impressions) * 100 || 0)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatCurrency(ad.clicks > 0 ? ad.spend / ad.clicks : 0)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-medium text-slate-800">
                                                        {formatCurrency(ad.spend)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-[#f8f9fa] border-t-2 border-slate-300 divide-y divide-slate-200 sticky bottom-0 z-10">
                                        <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-xs h-11 bg-slate-50">
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-slate-700 italic flex items-center gap-1 whitespace-nowrap h-11" colSpan={3}>
                                                Total: All but removed ads in your current view
                                                <HelpCircle size={13} className="text-slate-400 inline cursor-pointer" />
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {formatNumber(calculateTotals(filteredAds).impressions)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatNumber(calculateTotals(filteredAds).clicks)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(filteredAds).ctr)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredAds).cpc)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#1a73e8] bg-[#e8f0fe]/20">
                                                {formatCurrency(calculateTotals(filteredAds).spend)}
                                            </td>
                                        </tr>
                                        <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-xs h-11 bg-[#f1f3f4]">
                                            <td className="px-3 py-2 text-center border-r border-slate-200">
                                                <ChevronDown size={14} className="inline text-slate-600 cursor-pointer" />
                                            </td>
                                            <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-slate-800 font-bold flex items-center gap-1 whitespace-nowrap h-11" colSpan={3}>
                                                Total: conta
                                                <HelpCircle size={13} className="text-slate-400 inline cursor-pointer" />
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-[#0f9d58] bg-[#e6f4ea]/20">
                                                {formatNumber(calculateTotals(filteredAds).impressions)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatNumber(calculateTotals(filteredAds).clicks)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatPercent(calculateTotals(filteredAds).ctr)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                {formatCurrency(calculateTotals(filteredAds).cpc)}
                                            </td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#1a73e8] bg-[#e8f0fe]/20">
                                                {formatCurrency(calculateTotals(filteredAds).spend)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            {/* Mobile Google Search Ads (RSA) */}
                            <div className="block md:hidden space-y-2 p-2 bg-slate-50">
                                {sortData(filteredAds).map((ad, i) => {
                                    return (
                                        <div key={`ad-mob-${ad.id?.toString() || i}`} className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">RSA</span>
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Google Ad</span>
                                                    </div>
                                                    <h4 className="font-bold text-[#1a73e8] text-sm mt-1 cursor-pointer hover:underline break-words">
                                                        {ad.headlines?.split(' | ')[0] || 'Anúncio responsivo de pesquisa'}
                                                    </h4>
                                                    {ad.headlines?.split(' | ').length > 1 && (
                                                        <p className="text-[11px] text-slate-500 font-normal mt-1 break-words">
                                                            {ad.headlines?.split(' | ').slice(1).join(' • ')}
                                                        </p>
                                                    )}
                                                    <span className="text-[11px] text-slate-400 block mt-1.5">Campanha: {ad.campaignName}</span>
                                                    <span className="text-[11px] text-slate-400 block mt-0.5">Grupo: {ad.adGroupName}</span>
                                                </div>
                                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 ${ad.status === 'ENABLED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                                                    {ad.status === 'ENABLED' ? 'Ativo' : 'Pausado'}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100">
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Impressões</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(ad.impressions)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Cliques</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(ad.clicks)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">CTR</span>
                                                    <span className="text-slate-800 font-semibold">{formatPercent((ad.clicks / ad.impressions) * 100 || 0)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider font-bold">Custo</span>
                                                    <span className="text-[#1a73e8] font-bold">{formatCurrency(ad.spend)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">CPC Médio</span>
                                                    <span className="text-slate-800 font-semibold">{formatCurrency(ad.clicks > 0 ? ad.spend / ad.clicks : 0)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </>
            )}

        </div>
      )}
      {/* REPORT MODAL */}
      {isReportModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 text-blue-600 rounded-xl"><FileUp size={20} /></div>
                          <h3 className="text-lg font-bold text-slate-900">Exportar Relatório PDF</h3>
                      </div>
                      <button onClick={() => setIsReportModalOpen(false)} className="text-slate-400 hover:text-slate-900 transition-colors"><X size={20} /></button>
                  </div>
                  
                  <div className="p-6 space-y-6">
                      <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Nome do Cliente</label>
                          <input 
                              type="text" 
                              value={reportConfig.clientName}
                              onChange={(e) => setReportConfig({...reportConfig, clientName: e.target.value})}
                              placeholder="Ex: Clínica Sorriso"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                          />
                      </div>
                      <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Nome da Agência (Opcional)</label>
                          <input 
                              type="text" 
                              value={reportConfig.agencyName}
                              onChange={(e) => setReportConfig({...reportConfig, agencyName: e.target.value})}
                              placeholder="Ex: Minha Agência"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                          />
                      </div>
                      <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Logo URL (Opcional)</label>
                          <input 
                              type="text" 
                              value={reportConfig.logoUrl}
                              onChange={(e) => setReportConfig({...reportConfig, logoUrl: e.target.value})}
                              placeholder="https://..."
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                          />
                      </div>
                      
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                          <h4 className="text-[10px] font-bold text-slate-900 uppercase tracking-wider mb-2">Resumo do Relatório</h4>
                          <div className="text-xs text-slate-500 space-y-1.5 font-medium">
                              <p>• Período: <span className="font-bold text-slate-900">{new Date(marketingDateFilter.start).toLocaleDateString('pt-BR')} a {new Date(marketingDateFilter.end).toLocaleDateString('pt-BR')}</span></p>
                              <p>• Campanhas: <span className="font-bold text-slate-900">{campaigns.length}</span></p>
                              <p>• Gráfico de Evolução: <span className="font-bold text-slate-900">Incluído</span></p>
                          </div>
                      </div>
                  </div>

                  <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                      <button 
                          onClick={() => setIsReportModalOpen(false)}
                          className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-900 uppercase tracking-wider transition-colors"
                          disabled={isGeneratingReport}
                      >
                          Cancelar
                      </button>
                      <button 
                          onClick={handleExportReport}
                          disabled={isGeneratingReport}
                          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                      >
                          {isGeneratingReport ? (
                              <><Loader2 size={16} className="animate-spin" /> Gerando...</>
                          ) : (
                              <><Download size={16} /> Baixar PDF</>
                          )}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* GOOGLE SHEETS EXPORT MODAL */}
      {isSheetsModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-emerald-100 text-emerald-600 rounded-xl"><FileSpreadsheet size={20} /></div>
                          <h3 className="text-lg font-bold text-slate-900">Exportar para Google Sheets</h3>
                      </div>
                      <button onClick={() => setIsSheetsModalOpen(false)} className="text-slate-400 hover:text-slate-900 transition-colors"><X size={20} /></button>
                  </div>
                  
                  <div className="p-6 space-y-6 overflow-y-auto flex-1">
                      {/* Connection Status */}
                      <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                          <div>
                              <p className="text-xs font-bold text-slate-900">Google Sheets Integration</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                  {googleSheetsToken ? "Conectado e pronto para exportar" : "Requer conexão para autorizar exportação"}
                              </p>
                          </div>
                          {googleSheetsToken ? (
                              <button 
                                  onClick={handleConnectSheets} 
                                  className="px-3 py-1.5 border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase rounded-lg hover:bg-emerald-100 transition-all"
                              >
                                  Reautorizar
                              </button>
                          ) : (
                              <button 
                                  onClick={handleConnectSheets} 
                                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase rounded-lg shadow-sm hover:shadow-md transition-all"
                              >
                                  Conectar
                              </button>
                          )}
                      </div>

                      {/* Spreadsheet Link / ID */}
                      <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Link ou ID da Planilha</label>
                          <input 
                              type="text" 
                              value={exportSpreadsheetId}
                              onChange={(e) => setExportSpreadsheetId(e.target.value)}
                              placeholder="Ex: https://docs.google.com/spreadsheets/d/..."
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-slate-400"
                              disabled={isExportingSheets}
                          />
                          <p className="text-[10px] text-slate-400 mt-1.5">
                              Insira o link completo da sua planilha ou o ID correspondente.
                          </p>
                      </div>

                      {/* Custom Dates for Export */}
                      <div className="grid grid-cols-2 gap-3 bg-slate-50/50 p-3 rounded-2xl border border-slate-150">
                          <div>
                              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Data Início</label>
                              <input 
                                  type="date"
                                  value={exportStartDate}
                                  onChange={(e) => setExportStartDate(e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:border-emerald-500"
                                  disabled={isExportingSheets}
                              />
                          </div>
                          <div>
                              <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Data Fim</label>
                              <input 
                                  type="date"
                                  value={exportEndDate}
                                  onChange={(e) => setExportEndDate(e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:border-emerald-500"
                                  disabled={isExportingSheets}
                              />
                          </div>
                      </div>

                      {/* Aggregation Level */}
                      <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                              Visualização de Campanhas (Agregação)
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                              <button
                                  type="button"
                                  onClick={() => setExportAggregation('total')}
                                  className={`px-3 py-2 text-[11px] font-bold rounded-xl border transition-all ${
                                      exportAggregation === 'total'
                                          ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-sm'
                                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                              >
                                  Total Acumulado
                              </button>
                              <button
                                  type="button"
                                  onClick={() => setExportAggregation('daily')}
                                  className={`px-3 py-2 text-[11px] font-bold rounded-xl border transition-all ${
                                      exportAggregation === 'daily'
                                          ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-sm'
                                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                              >
                                  Por Dia
                              </button>
                              <button
                                  type="button"
                                  onClick={() => setExportAggregation('monthly')}
                                  className={`px-3 py-2 text-[11px] font-bold rounded-xl border transition-all ${
                                      exportAggregation === 'monthly'
                                          ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-sm'
                                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                              >
                                  Por Mês
                              </button>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                              {exportAggregation === 'daily' && "📅 Cada linha na planilha representará o resultado de uma campanha em um dia específico (dia a dia)."}
                              {exportAggregation === 'monthly' && "🗓️ Cada linha representará os resultados consolidados de uma campanha por mês (mês a mês)."}
                              {exportAggregation === 'total' && "📊 Mostrará uma única linha por campanha com o total acumulado do período selecionado."}
                          </p>
                      </div>

                      {/* Campaign Selection Option */}
                      <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                              Campanhas para Exportar
                          </label>
                          <select
                              value={exportCampaignIds.includes('all') ? 'all' : 'select'}
                              onChange={(e) => {
                                  if (e.target.value === 'all') {
                                      setExportCampaignIds(['all']);
                                  } else {
                                      setExportCampaignIds([]);
                                  }
                              }}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-500"
                          >
                              <option value="all">Exportar Todas as Campanhas ({campaigns.length})</option>
                              <option value="select">Selecionar Campanhas Específicas</option>
                          </select>

                          {/* Scrollable Campaign Checkbox List */}
                          {!exportCampaignIds.includes('all') && (
                              <div className="mt-2 border border-slate-200 bg-white rounded-xl p-2 max-h-36 overflow-y-auto space-y-1 animate-in fade-in duration-200 shadow-inner">
                                  {campaigns.length === 0 ? (
                                      <p className="text-[10px] text-slate-400 p-2 text-center">Nenhuma campanha carregada nesta conta.</p>
                                  ) : (
                                      campaigns.map((camp: any) => {
                                          const isChecked = exportCampaignIds.includes(String(camp.id));
                                          return (
                                              <label 
                                                  key={camp.id} 
                                                  className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-slate-50 rounded-lg cursor-pointer text-xs font-medium text-slate-800 transition-colors"
                                              >
                                                  <input 
                                                      type="checkbox"
                                                      checked={isChecked}
                                                      onChange={() => {
                                                          if (isChecked) {
                                                              setExportCampaignIds(prev => prev.filter(id => id !== String(camp.id)));
                                                          } else {
                                                              setExportCampaignIds(prev => [...prev.filter(id => id !== 'all'), String(camp.id)]);
                                                          }
                                                      }}
                                                      className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4 border-slate-300"
                                                  />
                                                  <span className="truncate">{camp.name || camp.id}</span>
                                              </label>
                                          );
                                      })
                                  )}
                              </div>
                          )}
                          {!exportCampaignIds.includes('all') && exportCampaignIds.length > 0 && (
                              <p className="text-[10px] text-emerald-600 font-bold mt-1.5">
                                  ✨ {exportCampaignIds.length} campanha(s) selecionada(s).
                              </p>
                          )}
                      </div>

                      {/* Information */}
                      <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 shrink-0">
                          <h4 className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider mb-1 flex items-center gap-1">📋 Relatório Inteligente Multi-Abas</h4>
                          <p className="text-[10px] text-slate-600 leading-relaxed">
                              Esta exportação gravará 3 abas na planilha com métricas estendidas (Gasto, Impressões, Cliques, CTR, CPC, Conversões, CPA, ROAS, Receita):
                          </p>
                          <ul className="text-[10px] text-slate-600 font-bold mt-1.5 list-disc pl-4 space-y-1">
                              <li>Google Ads - Campanhas ({exportAggregation === 'daily' ? 'Diário' : exportAggregation === 'monthly' ? 'Mensal' : 'Acumulado'})</li>
                              <li>Google Ads - Palavras-Chave</li>
                              <li>Google Ads - Termos de Pesquisa</li>
                          </ul>
                      </div>

                      {/* Status Notifications */}
                      {sheetsError && (
                          <div className="p-3.5 bg-rose-50 border border-rose-100 text-rose-700 text-xs rounded-xl font-medium shrink-0">
                              ⚠️ {sheetsError}
                          </div>
                      )}
                      {sheetsSuccess && (
                          <div className="p-3.5 bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs rounded-xl font-medium shrink-0">
                              ✅ {sheetsSuccess}
                          </div>
                      )}
                  </div>

                  <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                      <button 
                          onClick={() => setIsSheetsModalOpen(false)}
                          className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-900 uppercase tracking-wider transition-colors"
                          disabled={isExportingSheets}
                      >
                          Fechar
                      </button>
                      <button 
                          onClick={handleExportGoogleAdsToSheets}
                          disabled={isExportingSheets || !googleSheetsToken}
                          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                      >
                          {isExportingSheets ? (
                              <><Loader2 size={16} className="animate-spin" /> Exportando...</>
                          ) : (
                              <><FileSpreadsheet size={16} /> Exportar para Sheets</>
                          )}
                      </button>
                  </div>
              </div>
          </div>
      )}

            {/* ACCOUNTS TAB (MCC) */}
            {activeTab === 'accounts' && (
                <div className="space-y-6">
                    {/* Consolidated KPIs */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm">
                            <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Custo</span>
                            <p className="text-base md:text-2xl font-black text-navy mt-1 md:mt-2">{formatCurrency(mccAccounts.reduce((acc, curr) => acc + curr.cost, 0))}</p>
                        </div>
                        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm">
                            <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Cliques</span>
                            <p className="text-base md:text-2xl font-black text-navy mt-1 md:mt-2">{formatNumber(mccAccounts.reduce((acc, curr) => acc + curr.clicks, 0))}</p>
                        </div>
                        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm">
                            <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Conversões</span>
                            <p className="text-base md:text-2xl font-black text-navy mt-1 md:mt-2">{formatNumber(mccAccounts.reduce((acc, curr) => acc + curr.conversions, 0))}</p>
                        </div>
                        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-200 shadow-sm">
                            <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider">Contas Ativas</span>
                            <p className="text-base md:text-2xl font-black text-navy mt-1 md:mt-2">{mccAccounts.length}</p>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-slate-200 bg-slate-50">
                             <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Contas Gerenciadas</h3>
                        </div>
                        <div className="max-h-[600px] overflow-auto rounded-lg border border-slate-200 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
                            <table className="w-full min-w-[800px] text-left border-collapse">
                                <thead className="sticky top-0 z-20 bg-[#f8f9fa] shadow-sm border-b border-slate-200">
                                    <tr className="bg-[#f8f9fa] border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                        <th className="p-4 px-6 bg-[#f8f9fa]">Conta</th>
                                        <th className="p-4 px-6 text-right bg-[#f8f9fa]">Custo</th>
                                        <th className="p-4 px-6 text-right bg-[#f8f9fa]">Cliques</th>
                                        <th className="p-4 px-6 text-right bg-[#f8f9fa]">Impressões</th>
                                        <th className="p-4 px-6 text-right bg-[#f8f9fa]">Conversões</th>
                                        <th className="p-4 px-6 text-right bg-[#f8f9fa]">CPL</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm font-medium text-slate-600 divide-y divide-slate-100">
                                    {mccAccounts.map(acc => (
                                        <tr 
                                            key={acc.customer_id} 
                                            onClick={() => {
                                                setSelectedAccountId(acc.customer_id);
                                                setSelectedAccountName(acc.account_name);
                                                setActiveTab('overview');
                                            }}
                                            className={`hover:bg-blue-50 transition-colors cursor-pointer ${selectedAccountId === acc.customer_id ? 'bg-blue-50/50' : ''}`}
                                        >
                                            <td className="p-4 px-6 font-bold text-slate-900">{acc.account_name}</td>
                                            <td className="p-4 px-6 text-right">{formatCurrency(acc.cost)}</td>
                                            <td className="p-4 px-6 text-right">{formatNumber(acc.clicks)}</td>
                                            <td className="p-4 px-6 text-right">{formatNumber(acc.impressions)}</td>
                                            <td className="p-4 px-6 text-right">{formatNumber(acc.conversions)}</td>
                                            <td className="p-4 px-6 text-right">{acc.conversions > 0 ? formatCurrency(acc.cost / acc.conversions) : '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* SEARCH TERMS TAB */}
            {activeTab === 'searchterms' && (
                <div className="space-y-6">
                    {/* Filters */}
                    <div className="flex items-center gap-4 bg-white p-2 rounded-xl border border-slate-200 w-full md:w-fit shadow-sm">
                        <div className="p-2 bg-slate-50 rounded-lg text-slate-400"><Search size={16}/></div>
                        <input 
                            type="text" 
                            placeholder="Filtrar termos..." 
                            value={searchTermFilter}
                            onChange={(e) => setSearchTermFilter(e.target.value)}
                            className="bg-transparent text-sm font-medium text-slate-900 focus:outline-none w-full md:min-w-[300px] placeholder:text-slate-400"
                        />
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="hidden md:block max-h-[600px] overflow-auto rounded-lg border border-slate-200 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
                            <table className="w-full min-w-[800px] text-left border-collapse">
                                <thead className="sticky top-0 z-20 bg-[#f8f9fa] shadow-sm border-b border-slate-300">
                                    <tr className="divide-x divide-slate-200 h-10">
                                        <th className="w-10 px-3 text-center border-r border-slate-200 bg-[#f8f9fa]" onClick={(e) => e.stopPropagation()}>
                                            <input 
                                                type="checkbox" 
                                                className="rounded border-slate-350 text-[#1a73e8] focus:ring-[#1a73e8] w-3.5 h-3.5 cursor-pointer" 
                                                checked={currentSearchTerms.length > 0 && currentSearchTerms.every(t => selectedSearchTermIds.has(t.searchTerm || String(t.id)))} 
                                                onChange={() => toggleAllSearchTerms(currentSearchTerms.map(t => t.searchTerm || String(t.id)))} 
                                            />
                                        </th>
                                        <th className="w-10 px-3 text-center border-r border-slate-200 bg-[#f8f9fa]"></th>
                                        {[
                                            { k: 'searchTerm', l: 'Termo de Busca', align: 'left' },
                                            { k: 'campaignName', l: 'Campanha / Grupo', align: 'left' },
                                            { k: 'impressions', l: 'Impr.', align: 'right' },
                                            { k: 'clicks', l: 'Cliques', align: 'right' },
                                            { k: 'ctr', l: 'CTR', align: 'right' },
                                            { k: 'spend', l: 'Custo', align: 'right' },
                                            { k: 'conversions', l: 'Conv.', align: 'right' },
                                            { k: 'status', l: 'Insight do Termo', align: 'center' }
                                        ].map(h => (
                                            <th 
                                                key={h.k} 
                                                className={`px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-normal whitespace-nowrap border-r border-slate-200 text-${h.align} bg-[#f8f9fa]`}
                                            >
                                                <span>{h.l}</span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 text-slate-700">
                                    {currentSearchTerms
                                        .filter(term => term.searchTerm.toLowerCase().includes(searchTermFilter.toLowerCase()))
                                        .map((term, i) => {
                                            return (
                                                <tr key={term.searchTerm || `term-${i}`} className="group hover:bg-[#f1f3f4]/60 transition-colors duration-150 h-10 divide-x divide-slate-200">
                                                    <td className="px-3 py-2 text-center w-10 border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                        <input 
                                                            type="checkbox" 
                                                            className="rounded border-slate-350 text-[#1a73e8] focus:ring-[#1a73e8] w-3.5 h-3.5 cursor-pointer" 
                                                            checked={selectedSearchTermIds.has(term.searchTerm || String(term.id))} 
                                                            onChange={() => toggleSearchTermSelection(term.searchTerm || String(term.id))} 
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2 text-center w-10 text-slate-400">
                                                        <Search size={14} className="mx-auto" />
                                                    </td>
                                                    <td className="px-4 py-2 font-semibold text-[#1a73e8] hover:underline cursor-pointer">
                                                        {term.searchTerm}
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        <div className="flex flex-col text-xs font-medium text-slate-800">
                                                            <span>{term.campaignName}</span>
                                                            <span className="text-[10px] text-slate-400 font-normal mt-0.5 uppercase tracking-wider">{term.adGroupName}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatNumber(term.impressions)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-normal text-slate-800">
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-xs font-medium">{formatNumber(term.clicks)}</span>
                                                            <span className="text-[9px] text-slate-400 text-right mt-0.5 leading-tight">cliques</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {formatPercent(term.ctr)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-medium text-slate-800">
                                                        {formatCurrency(term.spend)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-xs font-normal text-slate-800">
                                                        {term.conversions.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-2 text-center">
                                                        {term.conversions > 0 ? (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black bg-[#e6f4ea] text-[#137333] uppercase tracking-wider">Convertido</span>
                                                        ) : term.spend > 50 ? (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black bg-rose-50 text-rose-700 uppercase tracking-wider">Potencial Negativa</span>
                                                        ) : (
                                                            <span className="text-slate-400 text-xs font-normal">-</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                </tbody>
                                <tfoot className="sticky bottom-0 z-20 bg-[#f8f9fa] shadow-[0_-2px_4px_rgba(0,0,0,0.05)] border-t-2 border-slate-300 divide-y divide-slate-200">
                                    {(() => {
                                        const visible = currentSearchTerms.filter(term => term.searchTerm.toLowerCase().includes(searchTermFilter.toLowerCase()));
                                        const totalImpr = visible.reduce((acc, t) => acc + (t.impressions || 0), 0);
                                        const totalClicks = visible.reduce((acc, t) => acc + (t.clicks || 0), 0);
                                        const totalSpend = visible.reduce((acc, t) => acc + (t.spend || 0), 0);
                                        const totalConvs = visible.reduce((acc, t) => acc + (t.conversions || 0), 0);
                                        const totalCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
                                        return (
                                            <>
                                                <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-xs h-11 bg-slate-50">
                                                    <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                                    <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-slate-700 italic flex items-center gap-1 whitespace-nowrap h-11" colSpan={2}>
                                                        Total: All matching search terms in current view
                                                        <HelpCircle size={13} className="text-slate-400 inline cursor-pointer" />
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-[#0f9d58] bg-[#e6f4ea]/20">
                                                        {formatNumber(totalImpr)}
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                        {formatNumber(totalClicks)}
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                        {formatPercent(totalCtr)}
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#1a73e8] bg-[#e8f0fe]/20">
                                                        {formatCurrency(totalSpend)}
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#0f9d58] bg-[#e6f4ea]/20">
                                                        {totalConvs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-center"></td>
                                                </tr>
                                                <tr className="divide-x divide-slate-200 font-semibold text-slate-800 text-xs h-11 bg-[#f1f3f4]">
                                                    <td className="px-3 py-2 text-center border-r border-slate-200">
                                                        <ChevronDown size={14} className="inline text-slate-600 cursor-pointer" />
                                                    </td>
                                                    <td className="px-3 py-2 text-center border-r border-slate-200"></td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-slate-800 font-bold flex items-center gap-1 whitespace-nowrap h-11" colSpan={2}>
                                                        Total: conta
                                                        <HelpCircle size={13} className="text-slate-400 inline cursor-pointer" />
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-right font-bold text-[#0f9d58] bg-[#e6f4ea]/20">
                                                        {formatNumber(totalImpr)}
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                        {formatNumber(totalClicks)}
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-right font-bold">
                                                        {formatPercent(totalCtr)}
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#1a73e8] bg-[#e8f0fe]/20">
                                                        {formatCurrency(totalSpend)}
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-right font-black text-[#0f9d58] bg-[#e6f4ea]/20">
                                                        {totalConvs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-200 text-center"></td>
                                                </tr>
                                            </>
                                        );
                                    })()}
                                </tfoot>
                            </table>
                        </div>

                        {/* Mobile Search Terms */}
                        <div className="block md:hidden space-y-2 p-2 bg-slate-50">
                            {currentSearchTerms
                                .filter(term => term.searchTerm.toLowerCase().includes(searchTermFilter.toLowerCase()))
                                .map((term, i) => {
                                    return (
                                        <div key={`term-mob-${term.searchTerm || i}`} className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
                                            <div className="flex items-start justify-between gap-2.5">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <Search size={14} className="text-slate-400" />
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Termo de Busca</span>
                                                    </div>
                                                    <h4 className="font-bold text-[#1a73e8] hover:underline text-sm mt-1 cursor-pointer break-words">
                                                        {term.searchTerm}
                                                    </h4>
                                                    <span className="text-[11px] text-slate-400 block mt-0.5">Campanha: {term.campaignName}</span>
                                                    <span className="text-[11px] text-slate-400 block mt-0.5">Grupo: {term.adGroupName}</span>
                                                </div>
                                                <div className="shrink-0">
                                                    {term.conversions > 0 ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black bg-[#e6f4ea] text-[#137333] uppercase tracking-wider">Convertido</span>
                                                    ) : term.spend > 50 ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black bg-rose-50 text-rose-700 uppercase tracking-wider">Potencial Negativa</span>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100">
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Impressões</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(term.impressions)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Cliques</span>
                                                    <span className="text-slate-800 font-semibold">{formatNumber(term.clicks)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">CTR</span>
                                                    <span className="text-slate-800 font-semibold">{formatPercent(term.ctr)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo</span>
                                                    <span className="text-[#1a73e8] font-bold">{formatCurrency(term.spend)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Conversões</span>
                                                    <span className="text-[#0f9d58] font-bold">{formatNumber(term.conversions)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Custo/Conv.</span>
                                                    <span className="text-slate-800 font-semibold">{formatCurrency(term.conversions > 0 ? term.spend / term.conversions : 0)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    </div>
                </div>
            )}

      {/* CUSTOM METRICS BUILDER AND MANAGER */}
      <CustomMetricBuilder 
          isOpen={isMetricBuilderOpen}
          onClose={() => { setIsMetricBuilderOpen(false); setEditingCustomMetric(null); }}
          onSuccess={() => {
              fetchMetaCustomMetrics();
          }}
          initialMetric={editingCustomMetric}
          adAccountId={selectedAccountId || undefined}
          sampleData={metaCampaigns.length > 0 ? metaCampaigns : metaAds}
      />

      <CustomMetricsManager 
          isOpen={isMetricManagerOpen}
          onClose={() => setIsMetricManagerOpen(false)}
          metrics={metaCustomMetrics}
          onOpenBuilder={(metricToEdit) => {
              setEditingCustomMetric(metricToEdit || null);
              setIsMetricBuilderOpen(true);
          }}
          onRefreshList={() => {
              fetchMetaCustomMetrics();
          }}
      />

      
      {/* META STATUS CONFIRM MODAL */}
      {metaStatusConfirmModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                  <div className="p-6">
                      <div className="flex items-center gap-3 mb-4">
                          <div className={`p-2 rounded-xl ${metaStatusConfirmModal.action === 'pause' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                              {metaStatusConfirmModal.action === 'pause' ? <Pause size={24} /> : <Play size={24} />}
                          </div>
                          <div>
                              <h3 className="text-lg font-black text-slate-900 tracking-tight">Confirmar Ação</h3>
                          </div>
                      </div>
                      <p className="text-sm text-slate-600 mb-6">
                          Tem certeza que deseja <strong className="uppercase">{metaStatusConfirmModal.action === 'pause' ? 'pausar' : 'ativar'}</strong> a campanha "{metaStatusConfirmModal.campaignName}" no Meta Ads?
                          <br/><br/>
                          Esta ação afeta seus anúncios em produção.
                      </p>
                      <div className="flex justify-end gap-3">
                          <button 
                              onClick={() => setMetaStatusConfirmModal(null)}
                              className="px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-100 transition-colors"
                          >
                              Cancelar
                          </button>
                          <button 
                              onClick={handleToggleMetaCampaign}
                              disabled={actionLoadingId !== null}
                              className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg flex items-center gap-2 transition-all disabled:opacity-50 text-white ${metaStatusConfirmModal.action === 'pause' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200'}`}
                          >
                              {actionLoadingId !== null ? <Loader2 size={16} className="animate-spin" /> : null}
                              Confirmar {metaStatusConfirmModal.action === 'pause' ? 'Pausar' : 'Ativar'}
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* META BUDGET MODAL */}
      {metaBudgetModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                  <div className="p-6">
                      <div className="flex items-center gap-3 mb-6">
                          <div className="p-2 rounded-xl bg-[#0866ff]/10 text-[#0866ff]">
                              <DollarSign size={24} />
                          </div>
                          <div>
                              <h3 className="text-lg font-black text-slate-900 tracking-tight">Editar Orçamento</h3>
                              <p className="text-xs text-slate-500">{metaBudgetModal.adsetName}</p>
                          </div>
                      </div>
                      <div className="space-y-4 mb-6">
                          <div>
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Orçamento Diário Atual</label>
                              <div className="text-sm font-semibold text-slate-600">
                                  {formatCurrency(metaBudgetModal.currentBudget)}
                              </div>
                          </div>
                          <div>
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Novo Orçamento Diário (R$)</label>
                              <div className="relative">
                                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                      <span className="text-slate-500 sm:text-sm">R$</span>
                                  </div>
                                  <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={newBudgetAmount}
                                      onChange={(e) => setNewBudgetAmount(e.target.value)}
                                      className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-xl focus:ring-[#0866ff] focus:border-[#0866ff] sm:text-sm transition-colors"
                                      placeholder="0.00"
                                  />
                              </div>
                          </div>
                      </div>
                      <div className="flex justify-end gap-3">
                          <button 
                              onClick={() => { setMetaBudgetModal(null); setNewBudgetAmount(''); }}
                              className="px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-100 transition-colors"
                          >
                              Cancelar
                          </button>
                          <button 
                              onClick={handleUpdateMetaBudget}
                              disabled={actionLoadingId !== null || !newBudgetAmount}
                              className="px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg flex items-center gap-2 transition-all disabled:opacity-50 text-white bg-[#0866ff] hover:bg-[#0756db] shadow-[#0866ff]/20"
                          >
                              {actionLoadingId !== null ? <Loader2 size={16} className="animate-spin" /> : null}
                              Salvar Orçamento
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* STATUS CONFIRM MODAL */}
      {statusConfirmModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                  <div className="p-6">
                      <div className="flex items-center gap-3 mb-4">
                          <div className={`p-2 rounded-xl ${statusConfirmModal.action === 'pause' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                              {statusConfirmModal.action === 'pause' ? <Pause size={24} /> : <Play size={24} />}
                          </div>
                          <div>
                              <h3 className="text-lg font-black text-slate-900 tracking-tight">Confirmar Ação</h3>
                          </div>
                      </div>
                      <p className="text-sm text-slate-600 mb-6">
                          Tem certeza que deseja <strong className="uppercase">{statusConfirmModal.action === 'pause' ? 'pausar' : 'ativar'}</strong> a campanha "{statusConfirmModal.campaignName}"?
                          <br/><br/>
                          Esta ação afeta seus anúncios em produção no Google Ads.
                      </p>
                      <div className="flex justify-end gap-3">
                          <button 
                              onClick={() => setStatusConfirmModal(null)}
                              disabled={actionLoadingId !== null}
                              className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-900 uppercase tracking-wider transition-colors disabled:opacity-50"
                          >
                              Cancelar
                          </button>
                          <button 
                              onClick={handleToggleGoogleCampaign}
                              disabled={actionLoadingId !== null}
                              className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg flex items-center gap-2 transition-all disabled:opacity-50 text-white ${statusConfirmModal.action === 'pause' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200'}`}
                          >
                              {actionLoadingId !== null ? <Loader2 size={16} className="animate-spin" /> : null}
                              Confirmar {statusConfirmModal.action === 'pause' ? 'Pausar' : 'Ativar'}
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* BUDGET MODAL */}
      {budgetModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 text-blue-600 rounded-xl"><DollarSign size={20} /></div>
                          <div>
                              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Editar Orçamento</h3>
                              <p className="text-[10px] text-slate-500 font-medium truncate w-48">{budgetModal.campaignName}</p>
                          </div>
                      </div>
                      <button onClick={() => setBudgetModal(null)} className="text-slate-400 hover:text-slate-600 bg-white p-1.5 rounded-lg shadow-sm border border-slate-200">
                          <X size={18} />
                      </button>
                  </div>
                  <div className="p-6">
                      <div className="mb-4">
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                              Orçamento Diário Atual: R$ {budgetModal.currentBudget.toFixed(2)}
                          </label>
                          <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium">R$</span>
                              <input 
                                  type="number"
                                  value={newBudgetAmount}
                                  onChange={(e) => setNewBudgetAmount(e.target.value)}
                                  placeholder="0.00"
                                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                              />
                          </div>
                      </div>
                      <div className="flex justify-end gap-3 mt-6">
                          <button 
                              onClick={() => setBudgetModal(null)}
                              disabled={actionLoadingId !== null}
                              className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-900 uppercase tracking-wider transition-colors disabled:opacity-50"
                          >
                              Cancelar
                          </button>
                          <button 
                              onClick={handleUpdateGoogleBudget}
                              disabled={!newBudgetAmount || actionLoadingId !== null}
                              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                          >
                              {actionLoadingId !== null ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                              Salvar
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* AD PREVIEW DRAWER */}
      <AdPreviewDrawer 
        isOpen={isPreviewDrawerOpen} 
        onClose={() => setIsPreviewDrawerOpen(false)} 
        ad={selectedAdForPreview} 
      />

    </div>
  );
};

const InfoMessage = ({ title, message }: { title: string, message: string }) => (
    <div className="flex flex-col items-center gap-2">
        <div className="p-3 bg-white rounded-full shadow-sm text-blue-500 mb-2">
            <Bot size={24} />
        </div>
        <h4 className="text-sm font-bold text-navy uppercase tracking-wide">{title}</h4>
        <p className="text-xs text-slate-500 max-w-md">{message}</p>
    </div>
);

export default Marketing;
