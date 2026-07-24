import React, { useState } from 'react';
import { apiFetch } from '../services/apiClient';
import { 
  Calculator, 
  Plus, 
  Edit, 
  Trash2, 
  Copy, 
  X, 
  Globe, 
  User, 
  Search,
  AlertCircle
} from 'lucide-react';
import { CustomMetric } from '../utils/customMetrics';

interface CustomMetricsManagerProps {
  isOpen: boolean;
  onClose: () => void;
  metrics: CustomMetric[];
  onOpenBuilder: (metricToEdit?: CustomMetric | null) => void;
  onRefreshList: () => void;
}

export const CustomMetricsManager: React.FC<CustomMetricsManagerProps> = ({
  isOpen,
  onClose,
  metrics = [],
  onOpenBuilder,
  onRefreshList
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const filteredMetrics = metrics.filter(m => 
    m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (m.description && m.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
    m.formula.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta métrica personalizada?')) return;

    setDeletingId(id);
    setErrorMsg(null);

    try {
      const res = await apiFetch(`/api/meta-ads/custom-metrics/${id}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao excluir métrica');
      }

      onRefreshList();
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao excluir métrica');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDuplicate = (metric: CustomMetric) => {
    const duplicatedMetric: CustomMetric = {
      ...metric,
      id: undefined,
      name: `${metric.name} (Cópia)`
    };
    onOpenBuilder(duplicatedMetric);
  };

  const getFormatLabel = (fmt: string) => {
    if (fmt === 'percentage') return 'Porcentagem (%)';
    if (fmt === 'currency') return 'Moeda (R$)';
    return 'Numérico';
  };

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
              <h2 className="text-lg font-bold">Gerenciar Métricas Personalizadas</h2>
              <p className="text-xs text-slate-300">
                Visualize, edite e organize suas fórmulas customizadas do Meta Ads
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

        {/* Toolbar */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
            <input 
              type="text"
              placeholder="Buscar métrica por nome ou fórmula..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
            />
          </div>

          <button
            onClick={() => onOpenBuilder(null)}
            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md shadow-indigo-500/20"
          >
            <Plus size={15} />
            <span>Criar Nova Métrica</span>
          </button>
        </div>

        {/* Body / List */}
        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-3">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs font-semibold text-rose-700">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {filteredMetrics.length === 0 ? (
            <div className="text-center py-12 px-4 border-2 border-dashed border-slate-200 rounded-2xl">
              <Calculator size={36} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-700">Nenhuma métrica personalizada encontrada</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 mb-4">
                {searchTerm 
                  ? 'Nenhum resultado corresponde à sua busca.' 
                  : 'Crie sua primeira métrica customizada para analisar indicadores específicos do seu negócio.'}
              </p>
              <button
                onClick={() => onOpenBuilder(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors"
              >
                <Plus size={14} />
                <span>Criar Métrica</span>
              </button>
            </div>
          ) : (
            filteredMetrics.map((metric) => (
              <div 
                key={metric.id || metric.name} 
                className="bg-white border border-slate-200 hover:border-indigo-300 rounded-2xl p-4 transition-all hover:shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-800">{metric.name}</h3>
                    
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {getFormatLabel(metric.format)}
                    </span>

                    {metric.is_shared ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center gap-1">
                        <Globe size={11} /> Compartilhada
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 flex items-center gap-1">
                        <User size={11} /> Pessoal
                      </span>
                    )}
                  </div>

                  {metric.description && (
                    <p className="text-xs text-slate-500 line-clamp-1">{metric.description}</p>
                  )}

                  <div className="text-[11px] font-mono text-emerald-700 bg-slate-900/90 px-2.5 py-1 rounded-lg inline-block max-w-full truncate border border-slate-800">
                    {metric.formula}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                  <button
                    onClick={() => onOpenBuilder(metric)}
                    className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Editar Métrica"
                  >
                    <Edit size={16} />
                  </button>

                  <button
                    onClick={() => handleDuplicate(metric)}
                    className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Duplicar Métrica"
                  >
                    <Copy size={16} />
                  </button>

                  {metric.id && (
                    <button
                      onClick={() => handleDelete(metric.id!)}
                      disabled={deletingId === metric.id}
                      className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title="Excluir Métrica"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 p-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
