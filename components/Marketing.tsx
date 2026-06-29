
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Instagram, DollarSign, TrendingUp, Bot, Users, Target, MousePointer2, Eye,
  Filter, Loader2, Zap, AlertCircle, LayoutDashboard, Layers, Grid, Type, MessageSquare,
  ArrowUpRight, ArrowDownRight, Search, ChevronDown, ChevronUp, X, Plus, Trash2, Calculator, Save, Bell,
  FileUp, Download, Image as ImageIcon, Play, Pause
} from 'lucide-react';
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
  getMetaOverview, getMetaCampaigns, getMetaAdGroups, getMetaAds, getMetaSearchTerms
} from '../services/metaAdsService';

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
  const { dateFilter, setCustomDateRange, googleAdsToken, metrics, user, metaAdsStatus } = useApp();
  const [loading, setLoading] = useState(false);
  const [activePlatform, setActivePlatform] = useState<'google' | 'meta'>('google');
  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'adgroups' | 'keywords' | 'ads' | 'assetgroups' | 'searchterms' | 'accounts'>('overview');
  
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

  // Filters & UI State
  const [selectedMetrics, setSelectedMetrics] = useState<MetricType[]>(['clicks', 'spend']);
  const [globalCampaignFilter, setGlobalCampaignFilter] = useState<string>(''); // ID da campanha
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  
  // Custom Metrics State
  const [customMetrics, setCustomMetrics] = useState<CustomMetric[]>(() => {
      const saved = localStorage.getItem('googleAds_customMetrics');
      return saved ? JSON.parse(saved) : PREBUILT_METRICS;
  });
  const [isMetricModalOpen, setIsMetricModalOpen] = useState(false);
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
  const [statusConfirmModal, setStatusConfirmModal] = useState<{ open: boolean, campaignId: string, campaignName: string, action: 'pause' | 'enable', customerId: string } | null>(null);
  const [budgetModal, setBudgetModal] = useState<{ open: boolean, campaignId: string, budgetId: string, campaignName: string, currentBudget: number, customerId: string } | null>(null);
  const [newBudgetAmount, setNewBudgetAmount] = useState<string>('');

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
      const num = dataPoint[metric.numerator] || 0;
      const den = dataPoint[metric.denominator] || 0;
      let result = 0;

      switch (metric.operator) {
          case '/': result = den !== 0 ? num / den : 0; break;
          case '*': result = num * den; break;
          case '+': result = num + den; break;
          case '-': result = num - den; break;
      }

      if (metric.multiplier) result *= metric.multiplier;
      return result;
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

  const daysInPeriod = useMemo(() => getDaysDifference(dateFilter.start, dateFilter.end), [dateFilter]);
  
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

  // Clear cache when filters that affect all data change
  useEffect(() => {
      cacheRef.current = {};
  }, [dateFilter.start, dateFilter.end, isCompareEnabled, compareDateFilter.start, compareDateFilter.end, selectedAccountId, activePlatform]);

  useEffect(() => {
    const fetchData = async () => {
        if (!user || !dateFilter.start || !dateFilter.end) return;
        
        if (activePlatform === 'google') {
            const customerId = selectedAccountId || 'default';
            const compareKey = isCompareEnabled ? `${compareDateFilter.start}_${compareDateFilter.end}` : 'none';
            const baseCacheKey = `${dateFilter.start}_${dateFilter.end}_${customerId}_${compareKey}`;
            
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
                    promises.push(getGoogleOverview(user.id, dateFilter, globalCampaignFilter || undefined, isCompareEnabled ? compareDateFilter : undefined, selectedAccountId || undefined).then(res => { overviewRes = res; cacheRef.current[`${baseCacheKey}_overview_${globalCampaignFilter || 'all'}`] = res; }));
                }
                if (!campaignsRes) {
                    promises.push(getGoogleCampaigns(user.id, dateFilter, isCompareEnabled ? compareDateFilter : undefined, selectedAccountId || undefined).then(res => { campaignsRes = res; cacheRef.current[`${baseCacheKey}_campaigns`] = res; }));
                }
                if (!adGroupsRes) {
                    promises.push(getGoogleAdGroups(user.id, dateFilter, selectedAccountId || undefined).then(res => { adGroupsRes = res; cacheRef.current[`${baseCacheKey}_adgroups`] = res; }));
                }
                if (!keywordsRes) {
                    promises.push(getGoogleKeywords(user.id, dateFilter, selectedAccountId || undefined).then(res => { keywordsRes = res; cacheRef.current[`${baseCacheKey}_keywords`] = res; }));
                }
                if (!adsRes) {
                    promises.push(getGoogleAds(user.id, dateFilter, selectedAccountId || undefined).then(res => { adsRes = res; cacheRef.current[`${baseCacheKey}_ads`] = res; }));
                }
                if (!searchTermsRes) {
                    promises.push(getGoogleSearchTerms(user.id, dateFilter, selectedAccountId || undefined).then(res => { searchTermsRes = res; cacheRef.current[`${baseCacheKey}_searchterms`] = res; }));
                }
                if (globalCampaignFilter && !assetGroupsRes) {
                    promises.push(getGoogleAssetGroups(user.id, dateFilter, globalCampaignFilter, selectedAccountId || undefined).then(res => { assetGroupsRes = res; cacheRef.current[`${baseCacheKey}_assetgroups_${globalCampaignFilter}`] = res; }));
                }
                if (globalCampaignFilter && !pmaxAssetsRes) {
                    promises.push(getGooglePmaxAssets(user.id, globalCampaignFilter, selectedAccountId || undefined).then(res => { pmaxAssetsRes = res; cacheRef.current[`${baseCacheKey}_pmaxassets_${globalCampaignFilter}`] = res; }));
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
            const baseCacheKey = `${dateFilter.start}_${dateFilter.end}_meta`;
            try {
                const promises = [];
                let metaOverviewRes = cacheRef.current[`${baseCacheKey}_overview`];
                let metaCampaignsRes = cacheRef.current[`${baseCacheKey}_campaigns`];
                let metaAdGroupsRes = cacheRef.current[`${baseCacheKey}_adgroups`];
                let metaAdsRes = cacheRef.current[`${baseCacheKey}_ads`];
                let metaSearchTermsRes = [];

                if (!metaOverviewRes) {
                    promises.push(getMetaOverview(user.id, dateFilter).then(res => { metaOverviewRes = res; cacheRef.current[`${baseCacheKey}_overview`] = res; }));
                }
                if (!metaCampaignsRes) {
                    promises.push(getMetaCampaigns(user.id, dateFilter).then(res => { metaCampaignsRes = res; cacheRef.current[`${baseCacheKey}_campaigns`] = res; }));
                }
                if (!metaAdGroupsRes) {
                    promises.push(getMetaAdGroups(user.id, dateFilter).then(res => { metaAdGroupsRes = res; cacheRef.current[`${baseCacheKey}_adgroups`] = res; }));
                }
                if (!metaAdsRes) {
                    promises.push(getMetaAds(user.id, dateFilter).then(res => { metaAdsRes = res; cacheRef.current[`${baseCacheKey}_ads`] = res; }));
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
  }, [user, dateFilter, globalCampaignFilter, isCompareEnabled, compareDateFilter, selectedAccountId, activePlatform]);

  // MCC Check
  useEffect(() => {
      if (!googleAdsToken) return;
      if (user && dateFilter.start && dateFilter.end) {
          getGoogleMccOverview(user.id, dateFilter).then(accounts => {
              if (accounts && accounts.length > 0) {
                  setMccAccounts(accounts);
                  setIsMccUser(true);
              }
          }).catch(err => console.error("MCC Check Error", err));
      }
  }, [user, dateFilter]);

  const handleToggleGoogleCampaign = async () => {
      if (!user || !statusConfirmModal) return;
      setActionLoadingId(statusConfirmModal.campaignId);
      try {
          await toggleGoogleCampaignStatus(user.id, statusConfirmModal.customerId, statusConfirmModal.campaignId, statusConfirmModal.action);
          // Toast should be here, but marketing.tsx uses an alert or toast internally. Wait, Marketing.tsx does not have showToast. 
          // I will use alert for simplicity or check if there is a toast.
          alert(`Campanha ${statusConfirmModal.action === 'pause' ? 'pausada' : 'ativada'} com sucesso!`);
          
          setCampaigns(prev => prev.map(c => c.id === statusConfirmModal.campaignId ? { ...c, status: statusConfirmModal.action === 'pause' ? 'PAUSED' : 'ENABLED' } : c));
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
          await updateGoogleCampaignBudget(user.id, budgetModal.customerId, budgetModal.budgetId, numAmount);
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

  // --- PLATFORM ADAPTERS ---
  const currentOverviewData = useMemo(() => {
      return activePlatform === 'meta' ? metaOverviewData : overviewData;
  }, [activePlatform, metaOverviewData, overviewData]);

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
          if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
          if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
      });
  };

  // --- RENDERERS ---
  const renderSortIcon = (key: string) => {
      if (sortConfig?.key !== key) return <div className="w-3 h-3 ml-1 opacity-20"><ChevronDown size={12}/></div>;
      return sortConfig.direction === 'asc' ? <ChevronUp size={12} className="ml-1 text-navy"/> : <ChevronDown size={12} className="ml-1 text-navy"/>;
  };

  const renderStatusBadge = (status: string) => {
      const config: any = {
          'ENABLED': { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Ativo' },
          'PAUSED': { bg: 'bg-amber-50', text: 'text-amber-600', label: 'Pausado' },
          'REMOVED': { bg: 'bg-rose-50', text: 'text-rose-600', label: 'Removido' }
      };
      const style = config[status] || { bg: 'bg-slate-100', text: 'text-slate-500', label: status };
      return <span className={`text-[9px] font-bold px-2 py-1 rounded-full uppercase ${style.bg} ${style.text}`}>{style.label}</span>;
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
      return currentOverviewData.map(day => {
          const enhancedDay = { ...day };
          customMetrics.forEach(metric => {
              enhancedDay[metric.id] = calculateMetricValue(metric, day);
          });
          return enhancedDay;
      });
  }, [currentOverviewData, customMetrics]);

  const processedComparisonData = useMemo(() => {
      return currentOverviewComparison.map(day => {
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
              date_range: dateFilter,
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
          const response = await fetch('/api/google-ads/generate-report', {
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
          a.download = `Relatorio_GoogleAds_${dateFilter.start}_${dateFilter.end}.pdf`;
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

  const isPlatformConnected = activePlatform === 'meta' ? !!metaAdsStatus : isConnected;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {/* HEADER */}
      <header className="flex flex-col gap-6">
        {metaAdsStatus && (
            <div className="flex bg-slate-100 p-1.5 rounded-2xl w-fit border border-slate-200/60 shadow-inner">
                <button
                    onClick={() => {
                        setActivePlatform('google');
                        setActiveTab('overview');
                    }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold tracking-wide transition-all ${
                        activePlatform === 'google' 
                            ? 'bg-white text-navy shadow-md scale-102 font-bold' 
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                    <Grid size={16} />
                    <span>Google Ads</span>
                </button>
                <button
                    onClick={() => {
                        setActivePlatform('meta');
                        setActiveTab('overview');
                    }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold tracking-wide transition-all ${
                        activePlatform === 'meta' 
                            ? 'bg-white text-navy shadow-md scale-102 font-bold' 
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                    <Instagram size={16} />
                    <span>Meta Ads</span>
                </button>
            </div>
        )}

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
            <h2 className="text-2xl font-semibold text-navy tracking-tight">{activePlatform === 'meta' ? 'Meta Ads' : 'Google Ads'}</h2>
            <div className="flex items-center gap-2 mt-1">
                {isPlatformConnected ? (
                <span className="bg-emerald-50 text-emerald-700 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-emerald-100 flex items-center gap-1"><Zap size={8} fill="currentColor"/> Conectado</span>
                ) : (
                    <span className="bg-amber-50 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-amber-100 flex items-center gap-1"><AlertCircle size={8} /> Desconectado</span>
                )}
            </div>
            </div>
            
            <div className="flex items-center gap-4">
                {/* EXPORT REPORT */}
                <button 
                    onClick={() => setIsReportModalOpen(true)}
                    className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition-all hover:text-navy shadow-sm"
                    title="Exportar Relatório PDF"
                >
                    <FileUp size={18} />
                </button>

                {/* ALERTS */}
                <div className="relative">
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
                                                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 rounded-full text-slate-400 transition-all hover:text-rose-500"
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

                <div className="flex items-center space-x-2 bg-white p-1.5 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-2 px-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:inline">Período:</span>
                    <input 
                        type="date" 
                        value={dateFilter.start} 
                        onChange={(e) => setCustomDateRange(e.target.value, dateFilter.end)}
                        className="text-[10px] font-bold text-navy bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-navy transition-colors cursor-pointer"
                    />
                    <span className="text-[10px] text-slate-300 font-bold">-</span>
                    <input 
                        type="date" 
                        value={dateFilter.end} 
                        onChange={(e) => setCustomDateRange(dateFilter.start, e.target.value)}
                        className="text-[10px] font-bold text-navy bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-navy transition-colors cursor-pointer"
                    />
                </div>

                {/* Comparison Toggle */}
                <div className="h-4 w-px bg-slate-200 mx-1" />
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <div className="relative">
                        <input 
                            type="checkbox" 
                            checked={isCompareEnabled}
                            onChange={(e) => setIsCompareEnabled(e.target.checked)}
                            className="sr-only peer"
                        />
                        <div className="w-7 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:inline">Comparar</span>
                </label>

                {/* Comparison Date Picker */}
                {isCompareEnabled && (
                    <div className="flex items-center gap-2 px-2 border-l border-slate-200 ml-1 animate-in fade-in slide-in-from-right-4 duration-300">
                        <input 
                            type="date" 
                            value={compareDateFilter.start} 
                            onChange={(e) => setCompareDateFilter({...compareDateFilter, start: e.target.value})}
                            className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-300 transition-colors cursor-pointer"
                        />
                        <span className="text-[10px] text-slate-300 font-bold">-</span>
                        <input 
                            type="date" 
                            value={compareDateFilter.end} 
                            onChange={(e) => setCompareDateFilter({...compareDateFilter, end: e.target.value})}
                            className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-300 transition-colors cursor-pointer"
                        />
                    </div>
                )}
            </div>
            </div>
        </div>

        {/* GLOBAL CAMPAIGN FILTER */}
        <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200 w-full md:w-fit shadow-sm mb-6">
            <div className="p-1.5 bg-slate-50 rounded-lg text-slate-400"><Filter size={14}/></div>
            <select 
                value={globalCampaignFilter}
                onChange={(e) => setGlobalCampaignFilter(e.target.value)}
                className="bg-transparent text-sm font-medium text-slate-700 focus:outline-none w-full md:min-w-[300px] cursor-pointer"
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
      <div className="flex overflow-x-auto pb-px gap-6 border-b border-slate-200 mb-8">
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
                  className={`flex items-center gap-2 pb-3 text-sm font-medium transition-colors whitespace-nowrap relative ${activeTab === tab.id ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
              >
                  <tab.icon size={16} className={activeTab === tab.id ? 'text-blue-600' : 'text-slate-400'} />
                  {tab.label}
                  {activeTab === tab.id && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full" />
                  )}
              </button>
          ))}
      </div>

      {loading ? (
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
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                        {[
                            { label: 'Custo', value: formatCurrency(periodTotals.spend), icon: DollarSign, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.spend, periodTotalsComparison.spend, true) },
                            { label: 'Cliques', value: formatNumber(periodTotals.clicks), icon: MousePointer2, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.clicks, periodTotalsComparison.clicks) },
                            { label: 'Impressões', value: formatNumber(periodTotals.impressions), icon: Eye, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.impressions, periodTotalsComparison.impressions) },
                            { label: 'CTR', value: formatPercent(periodTotals.ctr), icon: Target, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.ctr, periodTotalsComparison.ctr) },
                            { label: 'CPC Médio', value: formatCurrency(periodTotals.cpc), icon: TrendingUp, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.cpc, periodTotalsComparison.cpc, true) },
                            { label: 'Conversões', value: formatNumber(periodTotals.conversions), icon: Zap, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.conversions, periodTotalsComparison.conversions) },
                            { label: 'Custo/Conv.', value: formatCurrency(periodTotals.costPerConv), icon: DollarSign, color: 'text-slate-600', bg: 'bg-slate-100', variation: renderVariation(periodTotals.costPerConv, periodTotalsComparison.costPerConv, true) },
                        ].map((kpi, idx) => (
                            <div key={idx} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between h-28 hover:shadow-md transition-shadow">
                                <div className="flex justify-between items-start">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{kpi.label}</span>
                                    <div className={`p-1.5 rounded-lg ${kpi.bg} ${kpi.color}`}><kpi.icon size={14} /></div>
                                </div>
                                <div>
                                    <p className="text-xl font-light tracking-tight text-slate-900">{kpi.value}</p>
                                    {kpi.variation}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* BUDGET PANEL */}
                    <div className={`bg-white p-6 rounded-2xl border shadow-sm mb-6 mt-6 ${budgetMetrics.progress > 95 ? 'border-rose-200 ring-1 ring-rose-100' : budgetMetrics.progress > 80 ? 'border-amber-200 ring-1 ring-amber-100' : 'border-slate-200'}`}>
                        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-xl ${budgetMetrics.progress > 95 ? 'bg-rose-100 text-rose-600' : budgetMetrics.progress > 80 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>
                                    <DollarSign size={24} />
                                </div>
                                <div>
                                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Orçamento do Período</h3>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-3xl font-light tracking-tight text-slate-900">{formatCurrency(budgetMetrics.totalSpend)}</span>
                                        <span className="text-xs font-medium text-slate-400">de {formatCurrency(budgetMetrics.totalPeriodBudget)} previstos</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex-1 w-full max-w-md">
                                <div className="flex justify-between text-xs font-medium mb-2">
                                    <span className={budgetMetrics.progress > 95 ? 'text-rose-600 font-bold' : 'text-slate-500'}>
                                        {formatPercent(budgetMetrics.progress)} consumido
                                    </span>
                                    {budgetMetrics.progress > 95 && <span className="text-rose-600 font-bold flex items-center gap-1"><AlertCircle size={12}/> Orçamento quase esgotado</span>}
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
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
                                
                                <button 
                                    onClick={() => setIsMetricModalOpen(true)}
                                    className="flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:text-blue-600 hover:border-blue-600 hover:bg-blue-50 transition-colors text-[10px] font-bold uppercase tracking-wider"
                                >
                                    <Plus size={12} /> Criar
                                </button>
                            </div>
                        </div>
                        <div className="h-[300px]">
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
                                                                    <div key={index} className="flex items-center justify-between gap-6 text-sm">
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
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {[
                                        { k: 'name', l: 'Campanha' }, { k: 'status', l: 'Status' }, { k: 'type', l: 'Tipo' },
                                        { k: 'impressions', l: 'Impr.' }, { k: 'clicks', l: 'Cliques' }, { k: 'ctr', l: 'CTR' },
                                        { k: 'cpc', l: 'CPC Méd.' }, { k: 'spend', l: 'Custo' }, { k: 'conversions', l: 'Conv.' },
                                        { k: 'convRate', l: 'Taxa Conv.' }, { k: 'costPerConv', l: 'Custo/Conv.' },
                                        { k: 'actions', l: 'Ações' }
                                    ].map(h => (
                                        <th key={h.k} onClick={() => h.k !== 'actions' ? handleSort(h.k) : undefined} className={`px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap ${h.k !== 'actions' ? 'cursor-pointer hover:text-blue-600 transition-colors' : ''}`}>
                                            <div className="flex items-center gap-1">{h.l} {h.k !== 'actions' && renderSortIcon(h.k)}</div>
                                        </th>
                                    ))}
                                    {customMetrics.map(m => (
                                        <th key={m.id} onClick={() => handleSort(m.id)} className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-blue-600 transition-colors border-l border-slate-200">
                                            <div className="flex items-center gap-1">
                                                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                                                {m.name} {renderSortIcon(m.id)}
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sortData(filteredCampaigns).map((c, i) => {
                                    const prev = getPrevCampaign(c.id);
                                    return (
                                        <tr key={i} className="hover:bg-slate-50 transition-colors group cursor-pointer" onClick={() => setGlobalCampaignFilter(c.id.toString())}>
                                            <td className="px-6 py-4 text-sm font-medium text-slate-900 group-hover:text-blue-600 transition-colors">{c.name}</td>
                                            <td className="px-6 py-4">{renderStatusBadge(c.status)}</td>
                                            <td className="px-6 py-4 text-[10px] font-medium text-slate-500 uppercase tracking-wider">{c.type?.replace('PERFORMANCE_MAX', 'P-MAX')}</td>
                                            <td className="px-6 py-4 text-sm text-slate-600">{renderCellWithVariation(c.impressions, prev?.impressions, 'number')}</td>
                                            <td className="px-6 py-4 text-sm text-slate-600">{renderCellWithVariation(c.clicks, prev?.clicks, 'number')}</td>
                                            <td className="px-6 py-4 text-sm text-slate-600">{renderCellWithVariation((c.clicks / c.impressions) * 100 || 0, (prev?.clicks / prev?.impressions) * 100 || 0, 'percent')}</td>
                                            <td className="px-6 py-4 text-sm text-slate-600">{renderCellWithVariation(c.spend / c.clicks || 0, prev?.spend / prev?.clicks || 0, 'currency', true)}</td>
                                            <td className="px-6 py-4 text-sm font-medium text-slate-900">{renderCellWithVariation(c.spend, prev?.spend, 'currency', true)}</td>
                                            <td className="px-6 py-4 text-sm font-medium text-slate-900">{renderCellWithVariation(c.conversions, prev?.conversions, 'number')}</td>
                                            <td className="px-6 py-4 text-sm text-slate-600">{renderCellWithVariation((c.conversions / c.clicks) * 100 || 0, (prev?.conversions / prev?.clicks) * 100 || 0, 'percent')}</td>
                                            <td className="px-6 py-4 text-sm text-slate-600">{renderCellWithVariation(c.conversions > 0 ? c.spend / c.conversions : 0, prev?.conversions > 0 ? prev?.spend / prev?.conversions : 0, 'currency', true)}</td>
                                            <td className="px-6 py-4 text-sm font-medium text-slate-900" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center gap-2">
                                                    {c.status === 'ENABLED' || c.status === 'PAUSED' ? (
                                                        <button 
                                                            onClick={() => setStatusConfirmModal({ open: true, campaignId: c.id.toString(), campaignName: c.name, action: c.status === 'ENABLED' ? 'pause' : 'enable', customerId: selectedAccountId || '' })}
                                                            disabled={actionLoadingId === c.id.toString()}
                                                            className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors disabled:opacity-50"
                                                            title={c.status === 'ENABLED' ? 'Pausar' : 'Ativar'}
                                                        >
                                                            {actionLoadingId === c.id.toString() ? <Loader2 size={16} className="animate-spin" /> : c.status === 'ENABLED' ? <Pause size={16} /> : <Play size={16} />}
                                                        </button>
                                                    ) : null}
                                                    {c.budgetId && (
                                                        <button 
                                                            onClick={() => { setNewBudgetAmount(c.budget?.toString() || '0'); setBudgetModal({ open: true, campaignId: c.id.toString(), budgetId: c.budgetId.toString(), campaignName: c.name, currentBudget: c.budget, customerId: selectedAccountId || '' }); }}
                                                            disabled={actionLoadingId === c.id.toString()}
                                                            className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors disabled:opacity-50"
                                                            title="Editar Orçamento"
                                                        >
                                                            {actionLoadingId === c.id.toString() ? <Loader2 size={16} className="animate-spin" /> : <DollarSign size={16} />}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                            {customMetrics.map(m => (
                                                <td key={m.id} className="px-6 py-4 text-sm font-medium text-slate-900 border-l border-slate-100">
                                                    {renderCellWithVariation(calculateMetricValue(m, c), calculateMetricValue(m, prev || {}), m.format)}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot className="bg-slate-50 border-t border-slate-100">
                                <tr>
                                    <td className="px-6 py-4 text-xs font-black text-navy uppercase" colSpan={3}>Totais</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{renderCellWithVariation(calculateTotals(filteredCampaigns).impressions, calculateTotals(filteredCampaignsComparison).impressions, 'number')}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{renderCellWithVariation(calculateTotals(filteredCampaigns).clicks, calculateTotals(filteredCampaignsComparison).clicks, 'number')}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{renderCellWithVariation(calculateTotals(filteredCampaigns).ctr, calculateTotals(filteredCampaignsComparison).ctr, 'percent')}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{renderCellWithVariation(calculateTotals(filteredCampaigns).cpc, calculateTotals(filteredCampaignsComparison).cpc, 'currency', true)}</td>
                                    <td className="px-6 py-4 text-xs font-black text-navy">{renderCellWithVariation(calculateTotals(filteredCampaigns).spend, calculateTotals(filteredCampaignsComparison).spend, 'currency', true)}</td>
                                    <td className="px-6 py-4 text-xs font-black text-navy">{renderCellWithVariation(calculateTotals(filteredCampaigns).conversions, calculateTotals(filteredCampaignsComparison).conversions, 'number')}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{renderCellWithVariation(calculateTotals(filteredCampaigns).clicks > 0 ? (calculateTotals(filteredCampaigns).conversions / calculateTotals(filteredCampaigns).clicks) * 100 : 0, calculateTotals(filteredCampaignsComparison).clicks > 0 ? (calculateTotals(filteredCampaignsComparison).conversions / calculateTotals(filteredCampaignsComparison).clicks) * 100 : 0, 'percent')}</td>
                                    <td className="px-6 py-4 text-xs font-bold text-navy">{renderCellWithVariation(calculateTotals(filteredCampaigns).costPerConv, calculateTotals(filteredCampaignsComparison).costPerConv, 'currency', true)}</td>
                                    <td className="px-6 py-4"></td>
                                    {customMetrics.map(m => (
                                        <td key={m.id} className="px-6 py-4 text-xs font-black text-navy border-l border-slate-100">
                                            {renderCellWithVariation(calculateMetricValue(m, calculateTotals(filteredCampaigns)), calculateMetricValue(m, calculateTotals(filteredCampaignsComparison)), m.format)}
                                        </td>
                                    ))}
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* ASSET GROUPS TAB */}
            {activeTab === 'assetgroups' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {[
                                        { k: 'name', l: 'Grupo de Recursos' }, { k: 'status', l: 'Status' },
                                        { k: 'impressions', l: 'Impr.' }, { k: 'clicks', l: 'Cliques' }, { k: 'ctr', l: 'CTR' },
                                        { k: 'cpc', l: 'CPC Méd.' }, { k: 'spend', l: 'Custo' }, { k: 'conversions', l: 'Conv.' },
                                        { k: 'convRate', l: 'Taxa Conv.' }, { k: 'costPerConv', l: 'Custo/Conv.' }
                                    ].map(h => (
                                        <th key={h.k} onClick={() => handleSort(h.k)} className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-blue-600 transition-colors">
                                            <div className="flex items-center gap-1">{h.l} {renderSortIcon(h.k)}</div>
                                        </th>
                                    ))}
                                    {customMetrics.map(m => (
                                        <th key={m.id} onClick={() => handleSort(m.id)} className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-blue-600 transition-colors border-l border-slate-200">
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
                                    <tr key={i} className="hover:bg-slate-50 transition-colors">
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
                            <tfoot className="bg-slate-50 border-t border-slate-200">
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
                </div>
            )}

            {/* AD GROUPS TAB */}
            {activeTab === 'adgroups' && (
                <>
                    {campaignType === 'PERFORMANCE_MAX' ? (
                        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-8 text-center">
                            <InfoMessage title="Campanha Performance Max" message="Campanhas P-MAX utilizam 'Grupos de Recursos' em vez de grupos de anúncios tradicionais. A API atual foca na visão consolidada." />
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            {[
                                                { k: 'name', l: 'Grupo de Anúncios' }, { k: 'campaignName', l: 'Campanha' }, { k: 'status', l: 'Status' },
                                                { k: 'impressions', l: 'Impr.' }, { k: 'clicks', l: 'Cliques' }, { k: 'ctr', l: 'CTR' },
                                                { k: 'cpc', l: 'CPC Méd.' }, { k: 'spend', l: 'Custo' }, { k: 'conversions', l: 'Conv.' },
                                                { k: 'convRate', l: 'Taxa Conv.' }, { k: 'costPerConv', l: 'Custo/Conv.' }
                                            ].map(h => (
                                                <th key={h.k} onClick={() => handleSort(h.k)} className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-blue-600 transition-colors">
                                                    <div className="flex items-center gap-1">{h.l} {renderSortIcon(h.k)}</div>
                                                </th>
                                            ))}
                                            {customMetrics.map(m => (
                                                <th key={m.id} onClick={() => handleSort(m.id)} className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-blue-600 transition-colors border-l border-slate-200">
                                                    <div className="flex items-center gap-1">
                                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                                                        {m.name} {renderSortIcon(m.id)}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {sortData(filteredAdGroups).map((ag, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-4 text-sm font-medium text-slate-900">{ag.name}</td>
                                                <td className="px-6 py-4 text-[10px] font-medium text-slate-500 uppercase tracking-wider">{ag.campaignName}</td>
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
                                    <tfoot className="bg-slate-50 border-t border-slate-200">
                                        <tr>
                                            <td className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider" colSpan={3}>Totais</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatNumber(calculateTotals(filteredAdGroups).impressions)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatNumber(calculateTotals(filteredAdGroups).clicks)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatPercent(calculateTotals(filteredAdGroups).ctr)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatCurrency(calculateTotals(filteredAdGroups).cpc)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatCurrency(calculateTotals(filteredAdGroups).spend)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatNumber(calculateTotals(filteredAdGroups).conversions)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatPercent(calculateTotals(filteredAdGroups).clicks > 0 ? (calculateTotals(filteredAdGroups).conversions / calculateTotals(filteredAdGroups).clicks) * 100 : 0)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatCurrency(calculateTotals(filteredAdGroups).costPerConv)}</td>
                                            {customMetrics.map(m => (
                                                <td key={m.id} className="px-6 py-4 text-sm font-bold text-slate-900 border-l border-slate-200">
                                                    {formatMetricValue(calculateMetricValue(m, calculateTotals(filteredAdGroups)), m.format)}
                                                </td>
                                            ))}
                                        </tr>
                                    </tfoot>
                                </table>
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
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            {[
                                                { k: 'text', l: 'Palavra-chave' }, { k: 'matchType', l: 'Tipo' }, { k: 'status', l: 'Status' },
                                                { k: 'qualityScore', l: 'Qualidade' }, { k: 'impressions', l: 'Impr.' }, { k: 'clicks', l: 'Cliques' },
                                                { k: 'ctr', l: 'CTR' }, { k: 'cpc', l: 'CPC Méd.' }, { k: 'spend', l: 'Custo' }, { k: 'conversions', l: 'Conv.' },
                                                { k: 'convRate', l: 'Taxa Conv.' }, { k: 'costPerConv', l: 'Custo/Conv.' }
                                            ].map(h => (
                                                <th key={h.k} onClick={() => handleSort(h.k)} className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-blue-600 transition-colors">
                                                    <div className="flex items-center gap-1">{h.l} {renderSortIcon(h.k)}</div>
                                                </th>
                                            ))}
                                            {customMetrics.map(m => (
                                                <th key={m.id} onClick={() => handleSort(m.id)} className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-blue-600 transition-colors border-l border-slate-200">
                                                    <div className="flex items-center gap-1">
                                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                                                        {m.name} {renderSortIcon(m.id)}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {sortData(filteredKeywords).map((kw, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-4 text-sm font-medium text-slate-900">{kw.text}</td>
                                                <td className="px-6 py-4 text-[10px] font-medium text-slate-500 uppercase tracking-wider">{kw.matchType}</td>
                                                <td className="px-6 py-4">{renderStatusBadge(kw.status)}</td>
                                                <td className="px-6 py-4 text-sm text-slate-600">{kw.qualityScore}</td>
                                                <td className="px-6 py-4 text-sm text-slate-600">{formatNumber(kw.impressions)}</td>
                                                <td className="px-6 py-4 text-sm text-slate-600">{formatNumber(kw.clicks)}</td>
                                                <td className="px-6 py-4 text-sm text-slate-600">{formatPercent((kw.clicks / kw.impressions) * 100 || 0)}</td>
                                                <td className="px-6 py-4 text-sm text-slate-600">{formatCurrency(kw.clicks > 0 ? kw.spend / kw.clicks : 0)}</td>
                                                <td className="px-6 py-4 text-sm font-medium text-slate-900">{formatCurrency(kw.spend)}</td>
                                                <td className="px-6 py-4 text-sm font-medium text-slate-900">{formatNumber(kw.conversions)}</td>
                                                <td className="px-6 py-4 text-sm text-slate-600">{formatPercent((kw.conversions / kw.clicks) * 100 || 0)}</td>
                                                <td className="px-6 py-4 text-sm text-slate-600">{formatCurrency(kw.conversions > 0 ? kw.spend / kw.conversions : 0)}</td>
                                                {customMetrics.map(m => (
                                                    <td key={m.id} className="px-6 py-4 text-sm font-medium text-slate-900 border-l border-slate-100">
                                                        {formatMetricValue(calculateMetricValue(m, kw), m.format)}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-slate-50 border-t border-slate-200">
                                        <tr>
                                            <td className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider" colSpan={4}>Totais</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatNumber(calculateTotals(filteredKeywords).impressions)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatNumber(calculateTotals(filteredKeywords).clicks)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatPercent(calculateTotals(filteredKeywords).ctr)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatCurrency(calculateTotals(filteredKeywords).cpc)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatCurrency(calculateTotals(filteredKeywords).spend)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatNumber(calculateTotals(filteredKeywords).conversions)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatPercent(calculateTotals(filteredKeywords).clicks > 0 ? (calculateTotals(filteredKeywords).conversions / calculateTotals(filteredKeywords).clicks) * 100 : 0)}</td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatCurrency(calculateTotals(filteredKeywords).costPerConv)}</td>
                                            {customMetrics.map(m => (
                                                <td key={m.id} className="px-6 py-4 text-sm font-bold text-slate-900 border-l border-slate-200">
                                                    {formatMetricValue(calculateMetricValue(m, calculateTotals(filteredKeywords)), m.format)}
                                                </td>
                                            ))}
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ADS TAB */}
            {activeTab === 'ads' && (
                <>
                    {campaignType === 'PERFORMANCE_MAX' ? (
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
                                                        <div key={i} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-4 hover:bg-slate-100/50 transition-colors">
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
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            {[
                                                ...(activePlatform === 'meta' ? [{ k: 'preview', l: 'Preview' }] : []),
                                                { k: 'headlines', l: 'Anúncio (Títulos)' }, { k: 'campaignName', l: 'Campanha' }, { k: 'adGroupName', l: 'Grupo' },
                                                { k: 'status', l: 'Status' }, { k: 'impressions', l: 'Impr.' }, { k: 'clicks', l: 'Cliques' }, { k: 'ctr', l: 'CTR' }
                                            ].map(h => (
                                                <th key={h.k} onClick={() => h.k !== 'preview' ? handleSort(h.k) : undefined} className={`px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap ${h.k !== 'preview' ? 'cursor-pointer hover:text-blue-600 transition-colors' : ''}`}>
                                                    <div className="flex items-center gap-1">{h.l} {h.k !== 'preview' && renderSortIcon(h.k)}</div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {sortData(filteredAds).map((ad, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                {activePlatform === 'meta' && (
                                                    <td className="px-6 py-4">
                                                        {ad.imageUrl ? (
                                                            <img src={ad.imageUrl} alt={ad.headlines || 'Ad Preview'} className="w-12 h-12 rounded object-cover border border-slate-200" />
                                                        ) : (
                                                            <div className="w-12 h-12 rounded bg-slate-100 flex items-center justify-center border border-slate-200 text-slate-400">
                                                                <ImageIcon size={20} />
                                                            </div>
                                                        )}
                                                    </td>
                                                )}
                                                <td className="px-6 py-4 text-sm font-medium text-slate-900 max-w-xs truncate" title={ad.headlines}>{ad.headlines}</td>
                                                <td className="px-6 py-4 text-[10px] font-medium text-slate-500 uppercase tracking-wider">{ad.campaignName}</td>
                                                <td className="px-6 py-4 text-[10px] font-medium text-slate-500 uppercase tracking-wider">{ad.adGroupName}</td>
                                                <td className="px-6 py-4">{renderStatusBadge(ad.status)}</td>
                                                <td className="px-6 py-4 text-sm text-slate-600">{formatNumber(ad.impressions)}</td>
                                                <td className="px-6 py-4 text-sm text-slate-600">{formatNumber(ad.clicks)}</td>
                                                <td className="px-6 py-4 text-sm text-slate-600">{formatPercent((ad.clicks / ad.impressions) * 100 || 0)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
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
                              <p>• Período: <span className="font-bold text-slate-900">{new Date(dateFilter.start).toLocaleDateString('pt-BR')} a {new Date(dateFilter.end).toLocaleDateString('pt-BR')}</span></p>
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

            {/* ACCOUNTS TAB (MCC) */}
            {activeTab === 'accounts' && (
                <div className="space-y-6">
                    {/* Consolidated KPIs */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Custo</span>
                            <p className="text-2xl font-black text-slate-900 mt-2">{formatCurrency(mccAccounts.reduce((acc, curr) => acc + curr.cost, 0))}</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Cliques</span>
                            <p className="text-2xl font-black text-slate-900 mt-2">{formatNumber(mccAccounts.reduce((acc, curr) => acc + curr.clicks, 0))}</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Conversões</span>
                            <p className="text-2xl font-black text-slate-900 mt-2">{formatNumber(mccAccounts.reduce((acc, curr) => acc + curr.conversions, 0))}</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Contas Ativas</span>
                            <p className="text-2xl font-black text-slate-900 mt-2">{mccAccounts.length}</p>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-slate-200 bg-slate-50">
                             <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Contas Gerenciadas</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                        <th className="p-4 px-6">Conta</th>
                                        <th className="p-4 px-6 text-right">Custo</th>
                                        <th className="p-4 px-6 text-right">Cliques</th>
                                        <th className="p-4 px-6 text-right">Impressões</th>
                                        <th className="p-4 px-6 text-right">Conversões</th>
                                        <th className="p-4 px-6 text-right">CPL</th>
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
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                        <th className="p-4 px-6">Termo de Busca</th>
                                        <th className="p-4 px-6">Campanha / Grupo</th>
                                        <th className="p-4 px-6 text-right">Cliques</th>
                                        <th className="p-4 px-6 text-right">Impr.</th>
                                        <th className="p-4 px-6 text-right">Custo</th>
                                        <th className="p-4 px-6 text-right">Conv.</th>
                                        <th className="p-4 px-6 text-right">CTR</th>
                                        <th className="p-4 px-6 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm font-medium text-slate-600 divide-y divide-slate-100">
                                    {currentSearchTerms
                                        .filter(term => term.searchTerm.toLowerCase().includes(searchTermFilter.toLowerCase()))
                                        .map((term, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                            <td className="p-4 px-6 font-bold text-slate-900">{term.searchTerm}</td>
                                            <td className="p-4 px-6">
                                                <div className="text-slate-900">{term.campaignName}</div>
                                                <div className="text-[10px] text-slate-500 uppercase tracking-wider">{term.adGroupName}</div>
                                            </td>
                                            <td className="p-4 px-6 text-right">{formatNumber(term.clicks)}</td>
                                            <td className="p-4 px-6 text-right">{formatNumber(term.impressions)}</td>
                                            <td className="p-4 px-6 text-right">{formatCurrency(term.spend)}</td>
                                            <td className="p-4 px-6 text-right">{formatNumber(term.conversions)}</td>
                                            <td className="p-4 px-6 text-right">{formatPercent(term.ctr)}</td>
                                            <td className="p-4 px-6 text-center">
                                                {term.conversions > 0 ? (
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase tracking-wider">Convertido</span>
                                                ) : term.spend > 50 ? ( // Threshold for potential negative
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 uppercase tracking-wider">Potencial Negativa</span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 uppercase tracking-wider">-</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

      {/* METRIC CREATOR MODAL */}
      {isMetricModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-300 border border-slate-200">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 text-blue-600 rounded-xl"><Calculator size={20} /></div>
                          <h3 className="text-lg font-bold text-slate-900">Criar Métrica Personalizada</h3>
                      </div>
                      <button onClick={() => setIsMetricModalOpen(false)} className="text-slate-400 hover:text-slate-900 transition-colors"><X size={20} /></button>
                  </div>
                  
                  <div className="p-6 space-y-6">
                      {/* Name */}
                      <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Nome da Métrica</label>
                          <input 
                              type="text" 
                              value={newMetric.name}
                              onChange={(e) => setNewMetric({...newMetric, name: e.target.value})}
                              placeholder="Ex: Meu ROAS"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                          />
                      </div>

                      {/* Formula Builder */}
                      <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-5">
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fórmula</label>
                          <div className="flex items-center gap-2">
                              <select 
                                  value={newMetric.numerator}
                                  onChange={(e) => setNewMetric({...newMetric, numerator: e.target.value as BaseMetricType})}
                                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                              >
                                  <option value="clicks">Cliques</option>
                                  <option value="impressions">Impressões</option>
                                  <option value="spend">Custo</option>
                                  <option value="conversions">Conversões</option>
                                  <option value="conversionsValue">Valor Conv.</option>
                              </select>

                              <select 
                                  value={newMetric.operator}
                                  onChange={(e) => setNewMetric({...newMetric, operator: e.target.value as MetricOperator})}
                                  className="w-16 bg-white border border-slate-200 rounded-xl px-2 py-2.5 text-sm font-bold text-center text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                              >
                                  <option value="/">÷</option>
                                  <option value="*">×</option>
                                  <option value="+">+</option>
                                  <option value="-">−</option>
                              </select>

                              <select 
                                  value={newMetric.denominator}
                                  onChange={(e) => setNewMetric({...newMetric, denominator: e.target.value as BaseMetricType})}
                                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                              >
                                  <option value="clicks">Cliques</option>
                                  <option value="impressions">Impressões</option>
                                  <option value="spend">Custo</option>
                                  <option value="conversions">Conversões</option>
                                  <option value="conversionsValue">Valor Conv.</option>
                              </select>
                          </div>
                          
                          <div className="flex items-center gap-4">
                              <div className="flex-1">
                                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Multiplicador (Opcional)</label>
                                  <input 
                                      type="number" 
                                      value={newMetric.multiplier}
                                      onChange={(e) => setNewMetric({...newMetric, multiplier: parseFloat(e.target.value)})}
                                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                  />
                              </div>
                              <div className="flex-1">
                                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Formato</label>
                                  <select 
                                      value={newMetric.format}
                                      onChange={(e) => setNewMetric({...newMetric, format: e.target.value as MetricFormat})}
                                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                  >
                                      <option value="number">Número (1.234)</option>
                                      <option value="currency">Moeda (R$)</option>
                                      <option value="percent">Percentual (%)</option>
                                  </select>
                              </div>
                          </div>
                      </div>

                      {/* Color & Preview */}
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Cor da Linha</label>
                              <div className="flex items-center gap-3">
                                  <input 
                                      type="color" 
                                      value={newMetric.color}
                                      onChange={(e) => setNewMetric({...newMetric, color: e.target.value})}
                                      className="h-10 w-20 rounded-lg cursor-pointer border-0 p-0"
                                  />
                                  <span className="text-xs font-mono text-slate-500 bg-slate-50 px-2 py-1 rounded-md border border-slate-200">{newMetric.color}</span>
                              </div>
                          </div>
                          <div className="bg-slate-900 rounded-2xl p-5 text-white shadow-inner">
                              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Preview (Total do Período)</label>
                              <div className="text-2xl font-black tracking-tight">
                                  {formatMetricValue(calculateMetricValue(newMetric as CustomMetric, periodTotals), newMetric.format as MetricFormat)}
                              </div>
                          </div>
                      </div>
                  </div>

                  <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                      <button 
                          onClick={() => setIsMetricModalOpen(false)}
                          className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-900 uppercase tracking-wider transition-colors"
                      >
                          Cancelar
                      </button>
                      <button 
                          onClick={handleSaveMetric}
                          disabled={!newMetric.name}
                          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                      >
                          <Save size={16} /> Salvar Métrica
                      </button>
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
