import React, { useState } from 'react';
import { X, Eye, ExternalLink, Tag, DollarSign, Target, MousePointer, Copy, Check } from 'lucide-react';
import { MetaMockup } from './MetaMockup';

interface AdPreviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  ad: any;
}

export const AdPreviewDrawer: React.FC<AdPreviewDrawerProps> = ({
  isOpen,
  onClose,
  ad
}) => {
  const [activeTab, setActiveTab] = useState<'facebook' | 'instagram' | 'stories' | 'reels'>('facebook');
  const [copied, setCopied] = useState(false);

  if (!isOpen || !ad) return null;

  const creative = ad.adcreatives?.[0] || ad.creative || {};
  const title = creative.title || ad.headline || ad.name || 'Sem Título';
  const body = creative.body || ad.body || ad.text || 'Sem copy configurada.';
  const linkUrl = creative.link_url || ad.link_url || ad.destination_url || '';

  const handleCopyLink = () => {
    if (linkUrl) {
      navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md md:max-w-lg bg-white shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-300">
          
          {/* Drawer Header */}
          <div className="p-4 md:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl shrink-0">
                <Eye size={18} />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 block">
                  Preview do Anúncio
                </span>
                <h3 className="text-sm md:text-base font-bold text-slate-900 truncate" title={ad.name}>
                  {ad.name}
                </h3>
              </div>
            </div>

            <button 
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            
            {/* Tabs for platform formats */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Formato de Exibição
              </label>
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl">
                {[
                  { id: 'facebook', label: 'Facebook' },
                  { id: 'instagram', label: 'Instagram' },
                  { id: 'stories', label: 'Stories' },
                  { id: 'reels', label: 'Reels' }
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id as any)}
                    className={`py-2 text-xs font-bold rounded-lg transition-all ${
                      activeTab === t.id
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mockup Preview Area */}
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 flex justify-center items-center">
              <MetaMockup platform={activeTab} ad={ad} />
            </div>

            {/* Ad Metrics Summary Cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Gasto</span>
                <p className="text-sm font-extrabold text-slate-900 mt-0.5">{formatCurrency(ad.spend)}</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Cliques</span>
                <p className="text-sm font-extrabold text-blue-600 mt-0.5">{ad.clicks || 0}</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Resultados</span>
                <p className="text-sm font-extrabold text-emerald-600 mt-0.5">{ad.conversions || 0}</p>
              </div>
            </div>

            {/* Creative Details Section */}
            <div className="space-y-4 pt-2 border-t border-slate-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <Tag size={14} className="text-indigo-600" /> Detalhes do Criativo
              </h4>

              {/* Title */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <h5 className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Título</h5>
                <p className="text-xs font-semibold text-slate-800">{title}</p>
              </div>

              {/* Body / Copy */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <h5 className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Copy / Texto Principal</h5>
                <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{body}</p>
              </div>

              {/* Destination Link */}
              {linkUrl && (
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between mb-1">
                    <h5 className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Link de Destino</h5>
                    <button 
                      onClick={handleCopyLink}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                    >
                      {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                      <span>{copied ? 'Copiado!' : 'Copiar'}</span>
                    </button>
                  </div>
                  <a 
                    href={linkUrl} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-xs text-indigo-600 hover:underline break-all font-medium flex items-center gap-1"
                  >
                    <span>{linkUrl}</span>
                    <ExternalLink size={12} className="shrink-0" />
                  </a>
                </div>
              )}
            </div>

          </div>

          {/* Drawer Footer */}
          <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors"
            >
              Fechar Preview
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
