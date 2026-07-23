export interface CustomMetric {
  id?: string;
  user_id?: string;
  ad_account_id?: string;
  name: string;
  description?: string;
  formula: string;
  format: 'numeric' | 'percentage' | 'currency';
  is_shared?: boolean;
  is_archived?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface MetricField {
  key: string;
  label: string;
  category: 'Básicos' | 'Conversão' | 'Engajamento' | 'Vídeo' | 'Diagnóstico' | 'Mensageria';
}

export const AVAILABLE_FIELDS: MetricField[] = [
  // Básicos
  { key: 'spend', label: 'Investimento (Spend)', category: 'Básicos' },
  { key: 'impressions', label: 'Impressões', category: 'Básicos' },
  { key: 'clicks', label: 'Cliques', category: 'Básicos' },
  { key: 'reach', label: 'Alcance', category: 'Básicos' },
  { key: 'frequency', label: 'Frequência', category: 'Básicos' },
  { key: 'ctr', label: 'CTR (%)', category: 'Básicos' },
  { key: 'cpc', label: 'CPC', category: 'Básicos' },
  { key: 'cpm', label: 'CPM', category: 'Básicos' },
  { key: 'cpp', label: 'CPP', category: 'Básicos' },

  // Conversão
  { key: 'actions', label: 'Ações Totais', category: 'Conversão' },
  { key: 'action_values', label: 'Valor de Ações', category: 'Conversão' },
  { key: 'conversions', label: 'Conversões', category: 'Conversão' },
  { key: 'conversion_values', label: 'Valor de Conversões', category: 'Conversão' },
  { key: 'total_conversion_value', label: 'Valor Total de Conversão', category: 'Conversão' },
  { key: 'website_purchase_roas', label: 'ROAS de Compras no Site', category: 'Conversão' },
  { key: 'purchase_roas', label: 'ROAS de Compras', category: 'Conversão' },
  { key: 'cost_per_action_type', label: 'Custo por Tipo de Ação', category: 'Conversão' },
  { key: 'cost_per_conversion', label: 'Custo por Conversão', category: 'Conversão' },
  { key: 'cost_per_purchase', label: 'Custo por Compra', category: 'Conversão' },
  { key: 'cost_per_lead', label: 'Custo por Lead', category: 'Conversão' },
  { key: 'cost_per_app_install', label: 'Custo por Instalação de App', category: 'Conversão' },
  { key: 'cost_per_add_to_cart', label: 'Custo por Adição ao Carrinho', category: 'Conversão' },
  { key: 'cost_per_initiate_checkout', label: 'Custo por Início de Checkout', category: 'Conversão' },
  { key: 'cost_per_view_content', label: 'Custo por Visualização de Conteúdo', category: 'Conversão' },

  // Engajamento
  { key: 'post_engagement', label: 'Engajamento com Publicação', category: 'Engajamento' },
  { key: 'post_reactions', label: 'Reações', category: 'Engajamento' },
  { key: 'comment_count', label: 'Comentários', category: 'Engajamento' },
  { key: 'share_count', label: 'Compartilhamentos', category: 'Engajamento' },
  { key: 'engagement_rate', label: 'Taxa de Engajamento', category: 'Engajamento' },
  { key: 'landing_page_views', label: 'Visualizações de Página de Destino', category: 'Engajamento' },
  { key: 'outbound_clicks', label: 'Cliques de Saída', category: 'Engajamento' },
  { key: 'outbound_ctr', label: 'CTR de Saída', category: 'Engajamento' },
  { key: 'unique_clicks', label: 'Cliques Únicos', category: 'Engajamento' },
  { key: 'unique_ctr', label: 'CTR Único', category: 'Engajamento' },
  { key: 'unique_link_clicks', label: 'Cliques em Links Únicos', category: 'Engajamento' },

  // Vídeo
  { key: 'video_play_actions', label: 'Reproduções de Vídeo', category: 'Vídeo' },
  { key: 'video_30_sec_watched_actions', label: 'Vídeo 30s Assistidos', category: 'Vídeo' },
  { key: 'video_p25_watched_actions', label: 'Vídeo 25% Assistidos', category: 'Vídeo' },
  { key: 'video_p50_watched_actions', label: 'Vídeo 50% Assistidos', category: 'Vídeo' },
  { key: 'video_p75_watched_actions', label: 'Vídeo 75% Assistidos', category: 'Vídeo' },
  { key: 'video_p95_watched_actions', label: 'Vídeo 95% Assistidos', category: 'Vídeo' },
  { key: 'video_p100_watched_actions', label: 'Vídeo 100% Assistidos', category: 'Vídeo' },
  { key: 'video_thruplay_watched_actions', label: 'ThruPlays Assistidos', category: 'Vídeo' },
  { key: 'video_avg_time_watched', label: 'Tempo Médio Assistido', category: 'Vídeo' },
  { key: 'cost_per_video_thruplay', label: 'Custo por ThruPlay', category: 'Vídeo' },

  // Diagnóstico
  { key: 'quality_ranking', label: 'Classificação de Qualidade', category: 'Diagnóstico' },
  { key: 'engagement_rate_ranking', label: 'Classificação de Engajamento', category: 'Diagnóstico' },
  { key: 'conversion_rate_ranking', label: 'Classificação de Conversão', category: 'Diagnóstico' },

  // Mensageria
  { key: 'messaging_conversations_started', label: 'Conversas Iniciadas', category: 'Mensageria' },
  { key: 'cost_per_messaging_conversation_start', label: 'Custo por Conversa', category: 'Mensageria' },
  { key: 'messaging_replies', label: 'Respostas de Mensagem', category: 'Mensageria' }
];

export const VALID_KEYS_SET = new Set(AVAILABLE_FIELDS.map(f => f.key));

/**
 * Validates formula syntax, checking placeholders, parenthesis balance, and valid expression structure
 */
export function validateFormula(formula: string): { isValid: boolean; error?: string } {
  if (!formula || !formula.trim()) {
    return { isValid: false, error: 'A fórmula não pode estar vazia' };
  }

  // 1. Check placeholders
  const placeholderRegex = /\{\{([a-zA-Z0-9_]+)\}\}/g;
  let match;
  const foundKeys: string[] = [];
  while ((match = placeholderRegex.exec(formula)) !== null) {
    const key = match[1];
    foundKeys.push(key);
    if (!VALID_KEYS_SET.has(key)) {
      return { isValid: false, error: `Campo desconhecido: {{${key}}}` };
    }
  }

  // 2. Check balanced parenthesis
  let openCount = 0;
  for (let char of formula) {
    if (char === '(') openCount++;
    if (char === ')') openCount--;
    if (openCount < 0) {
      return { isValid: false, error: 'Parênteses desalinhados (fechamento sem abertura)' };
    }
  }
  if (openCount !== 0) {
    return { isValid: false, error: 'Parênteses desalinhados (abertura sem fechamento)' };
  }

  // 3. Test evaluation replacing placeholders with mock numbers
  try {
    const replaced = formula.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, '1');
    
    // Whitelist check
    // Allowed characters: numbers, operators, parens, whitespace, and math functions (min, max, abs, round, sqrt, log10, if)
    const sanitized = replaced
      .replace(/\b(min|max|abs|round|sqrt|log10|if)\b/g, '')
      .replace(/[\d\s+\-*/%^().,]/g, '');

    if (sanitized.trim().length > 0) {
      return { isValid: false, error: `Símbolos ou funções não permitidos na fórmula` };
    }

    // Try evaluating mock
    const evalRes = evaluateMathExpression(replaced);
    if (typeof evalRes !== 'number' && evalRes !== null) {
      return { isValid: false, error: 'Erro de sintaxe na expressão matemática' };
    }

    return { isValid: true };
  } catch (err: any) {
    return { isValid: false, error: err.message || 'Fórmula matemática inválida' };
  }
}

/**
 * Evaluates a formula for a given row of data
 */
export function evaluateFormula(formula: string, rowData: any): number | null {
  if (!formula || !formula.trim()) return null;

  try {
    const replaced = formula.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
      const val = extractFieldValue(rowData, key);
      return String(val);
    });

    return evaluateMathExpression(replaced);
  } catch (err) {
    return null;
  }
}

/**
 * Extracts numeric value for a field key from row data
 */
function extractFieldValue(rowData: any, key: string): number {
  if (!rowData) return 0;

  // Direct property check
  if (typeof rowData[key] === 'number') return rowData[key];
  if (typeof rowData[key] === 'string' && !isNaN(Number(rowData[key]))) return Number(rowData[key]);

  // Nested insights check
  const insights = rowData.insights || rowData;
  if (typeof insights[key] === 'number') return insights[key];
  if (typeof insights[key] === 'string' && !isNaN(Number(insights[key]))) return Number(insights[key]);

  // Actions or action_values array check (Meta Ads Graph API format)
  if (Array.isArray(insights.actions)) {
    const act = insights.actions.find((a: any) => a.action_type === key);
    if (act && act.value !== undefined) return Number(act.value) || 0;
  }
  if (Array.isArray(insights.action_values)) {
    const actVal = insights.action_values.find((a: any) => a.action_type === key);
    if (actVal && actVal.value !== undefined) return Number(actVal.value) || 0;
  }

  // Calculated shortcuts
  if (key === 'ctr' && insights.clicks && insights.impressions) {
    return (Number(insights.clicks) / Number(insights.impressions)) * 100;
  }
  if (key === 'cpc' && insights.spend && insights.clicks) {
    return Number(insights.spend) / Number(insights.clicks);
  }
  if (key === 'cpm' && insights.spend && insights.impressions) {
    return (Number(insights.spend) / Number(insights.impressions)) * 1000;
  }

  return 0;
}

/**
 * Evaluates math expression string safely
 */
function evaluateMathExpression(expr: string): number | null {
  // Convert power ^ to **
  let formatted = expr.replace(/\^/g, '**');

  // Replace math functions with Math object methods
  // min, max, abs, round, sqrt, log10
  formatted = formatted.replace(/\bmin\b/g, 'Math.min');
  formatted = formatted.replace(/\bmax\b/g, 'Math.max');
  formatted = formatted.replace(/\babs\b/g, 'Math.abs');
  formatted = formatted.replace(/\bround\b/g, 'Math.round');
  formatted = formatted.replace(/\bsqrt\b/g, 'Math.sqrt');
  formatted = formatted.replace(/\blog10\b/g, 'Math.log10');

  // Implement simple ternary if(cond, a, b) => (cond ? a : b)
  // Handles if(cond, a, b)
  formatted = formatted.replace(/\bif\s*\(([^,]+),([^,]+),([^)]+)\)/g, '(($1) ? ($2) : ($3))');

  try {
    // Evaluates in isolated scope using Function constructor
    const result = new Function(`"use strict"; return (${formatted});`)();
    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      return result;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Formats a metric value according to its format type
 */
export function formatValue(
  value: number | null | undefined,
  format: 'numeric' | 'percentage' | 'currency'
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '-';
  }

  if (format === 'percentage') {
    return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  if (format === 'currency') {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // Numeric
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
