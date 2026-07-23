import React, { useState, useEffect, useRef } from 'react';
import { 
  Calculator, 
  Check, 
  X, 
  AlertCircle, 
  Plus, 
  Info, 
  HelpCircle,
  ChevronDown
} from 'lucide-react';
import { 
  CustomMetric, 
  AVAILABLE_FIELDS, 
  validateFormula, 
  evaluateFormula, 
  formatValue 
} from '../utils/customMetrics';

interface CustomMetricBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (metric: CustomMetric) => void;
  initialMetric?: CustomMetric | null;
  adAccountId?: string;
  sampleData?: any[];
}

export const CustomMetricBuilder: React.FC<CustomMetricBuilderProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMetric,
  adAccountId,
  sampleData = []
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<'numeric' | 'percentage' | 'currency'>('numeric');
  const [isShared, setIsShared] = useState(false);
  const [formula, setFormula] = useState('');
  
  const [validation, setValidation] = useState<{ isValid: boolean; error?: string }>({ isValid: false });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const formulaInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialMetric) {
      setName(initialMetric.name || '');
      setDescription(initialMetric.description || '');
      setFormat(initialMetric.format || 'numeric');
      setIsShared(!!initialMetric.is_shared);
      setFormula(initialMetric.formula || '');
    } else {
      setName('');
      setDescription('');
      setFormat('numeric');
      setIsShared(false);
      setFormula('');
    }
    setSaveError(null);
  }, [initialMetric, isOpen]);

  useEffect(() => {
    if (formula) {
      setValidation(validateFormula(formula));
    } else {
      setValidation({ isValid: false, error: 'Digite uma fórmula' });
    }
  }, [formula]);

  if (!isOpen) return null;

  const handleInsertField = (fieldKey: string) => {
    const placeholder = `{{${fieldKey}}}`;
    const textarea = formulaInputRef.current;
    
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newFormula = formula.substring(0, start) + placeholder + formula.substring(end);
      setFormula(newFormula);
      
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + placeholder.length, start + placeholder.length);
      }, 50);
    } else {
      setFormula(prev => prev + placeholder);
    }
    setIsDropdownOpen(false);
  };

  const categories = ['Todos', 'Básicos', 'Conversão', 'Custos Derivados', 'Engajamento', 'Vídeo', 'Diagnóstico', 'Mensageria'];

  const filteredFields = selectedCategory === 'Todos' 
    ? AVAILABLE_FIELDS 
    : AVAILABLE_FIELDS.filter(f => f.category === selectedCategory);

  const handleSave = async () => {
    if (!name.trim()) {
      setSaveError('O nome da métrica é obrigatório');
      return;
    }
    if (!validation.isValid) {
      setSaveError(validation.error || 'A fórmula é inválida');
      return;
    }

    setSaving(true);
    setSaveError(null);

    const payload = {
      ad_account_id: adAccountId,
      name: name.trim(),
      description: description.trim(),
      formula: formula.trim(),
      format,
      is_shared: isShared
    };

    try {
      const url = initialMetric?.id 
        ? `/api/meta-ads/custom-metrics/${initialMetric.id}`
        : `/api/meta-ads/custom-metrics`;
      
      const method = initialMetric?.id ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Erro ao salvar métrica personalizada');
      }

      onSuccess(data.metric || { ...payload, id: initialMetric?.id });
      onClose();
    } catch (err: any) {
      setSaveError(err.message || 'Falha ao salvar métrica');
    } finally {
      setSaving(false);
    }
  };

  // Preview data (max 5 rows)
  const previewRows = sampleData && sampleData.length > 0 
    ? sampleData.slice(0, 5) 
    : [
        { name: 'Campanha Conversões - Vendas', spend: 450.50, impressions: 12500, clicks: 320, conversions: 18, purchase_conversion_value: 2350.00 },
        { name: 'Campanha Reengajamento - Leads', spend: 200.00, impressions: 8400, clicks: 190, conversions: 24, purchase_conversion_value: 0.00 },
        { name: 'Campanha Tráfego Site', spend: 120.80, impressions: 6100, clicks: 240, conversions: 5, purchase_conversion_value: 450.00 }
      ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl overflow-hidden my-8">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-300">
              <Calculator size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold">
                {initialMetric ? 'Editar Métrica Personalizada' : 'Criar Métrica Personalizada'}
              </h2>
              <p className="text-xs text-slate-300">
                Crie fórmulas customizadas usando qualquer métrica do Meta Ads
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[calc(85vh-130px)] overflow-y-auto">
          {saveError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs font-semibold text-rose-700">
              <AlertCircle size={16} className="shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          {/* Form Top Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nome da Métrica <span className="text-rose-500">*</span>
              </label>
              <input 
                type="text"
                placeholder="Ex: ROAS Real E-commerce"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Formato de Exibição <span className="text-rose-500">*</span>
              </label>
              <select 
                value={format}
                onChange={(e: any) => setFormat(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all bg-white"
              >
                <option value="numeric">Numérico (12,34)</option>
                <option value="percentage">Porcentagem (12,34%)</option>
                <option value="currency">Moeda (R$ 12,34)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Descrição (opcional)
            </label>
            <textarea 
              placeholder="Descreva o objetivo desta métrica personalizada para a equipe..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all resize-none"
            />
          </div>

          {/* Formula Builder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-700">
                Fórmula Matemática <span className="text-rose-500">*</span>
              </label>
              
              {/* Insert Field Dropdown */}
              <div className="relative">
                <button 
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border border-indigo-200"
                >
                  <Plus size={14} />
                  <span>Inserir campo</span>
                  <ChevronDown size={14} />
                </button>

                {isDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 p-2 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center gap-1 overflow-x-auto pb-2 border-b border-slate-100 scrollbar-none">
                      {categories.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setSelectedCategory(cat)}
                          className={`px-2 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap transition-colors ${
                            selectedCategory === cat 
                              ? 'bg-indigo-600 text-white' 
                              : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>

                    <div className="max-h-56 overflow-y-auto mt-2 space-y-1 scrollbar-thin">
                      {filteredFields.map(field => (
                        <button
                          key={field.key}
                          type="button"
                          onClick={() => handleInsertField(field.key)}
                          className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 rounded-lg text-xs flex items-center justify-between text-slate-700 group transition-colors"
                        >
                          <span className="font-medium group-hover:text-indigo-700">{field.label}</span>
                          <span className="text-[10px] text-slate-400 font-mono group-hover:text-indigo-500">
                            {`{{${field.key}}}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <textarea 
              ref={formulaInputRef}
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="Ex: ({{purchase_conversion_value}} - {{spend}}) / {{spend}}"
              rows={3}
              className="w-full px-3 py-2 text-xs font-mono bg-slate-900 text-emerald-400 rounded-xl border border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none shadow-inner"
            />

            {/* Validation Feedback */}
            <div className="flex items-center justify-between text-xs font-medium pt-0.5">
              <div className="flex items-center gap-1.5">
                {formula ? (
                  validation.isValid ? (
                    <span className="text-emerald-600 flex items-center gap-1 font-semibold">
                      <Check size={15} /> Fórmula válida
                    </span>
                  ) : (
                    <span className="text-rose-600 flex items-center gap-1 font-semibold">
                      <X size={15} /> {validation.error}
                    </span>
                  )
                ) : (
                  <span className="text-slate-400 flex items-center gap-1">
                    <Info size={14} /> Digite a fórmula usando a sintaxe &#123;&#123;campo&#125;&#125;
                  </span>
                )}
              </div>

              <div className="text-[11px] text-slate-400">
                Dica: use funções como min(a,b), max(a,b), round(x), sqrt(x), log10(x), if(cond, a, b)
              </div>
            </div>
          </div>

          {/* Share Option */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input 
                type="checkbox"
                id="isSharedCheck"
                checked={isShared}
                onChange={(e) => setIsShared(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
              />
              <label htmlFor="isSharedCheck" className="text-xs font-semibold text-slate-700 cursor-pointer">
                Compartilhar esta métrica com a equipe
              </label>
            </div>
            <span className="text-[11px] text-slate-500">
              Outros usuários poderão ver esta coluna em relatórios
            </span>
          </div>

          {/* Live Preview */}
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <span>Preview ao Vivo (Exemplo)</span>
              </h3>
              <span className="text-[11px] text-slate-400">Calculado sobre amostragem atual</span>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
              <table className="w-full text-left">
                <thead className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Item / Campanha</th>
                    <th className="px-3 py-2 text-right">Resultado Calculado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {previewRows.map((row, idx) => {
                    const calcVal = evaluateFormula(formula, row);
                    const formattedRes = formatValue(calcVal, format);
                    return (
                      <tr key={idx} className="hover:bg-slate-50/80">
                        <td className="px-3 py-2 truncate max-w-xs">{row.name || `Item #${idx + 1}`}</td>
                        <td className="px-3 py-2 text-right font-bold text-indigo-600 font-mono">
                          {formattedRes}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 p-4 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !validation.isValid || !name.trim()}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-indigo-500/20 flex items-center gap-2"
          >
            {saving ? 'Salvando...' : 'Salvar Métrica'}
          </button>
        </div>
      </div>
    </div>
  );
};
