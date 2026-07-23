import React from 'react';
import { 
  Heart, 
  MessageCircle, 
  Share2, 
  Bookmark, 
  MoreHorizontal, 
  Globe, 
  ThumbsUp, 
  ExternalLink,
  Music,
  X,
  Instagram,
  Facebook
} from 'lucide-react';

interface MetaMockupProps {
  platform: 'facebook' | 'instagram' | 'stories' | 'reels';
  ad: any;
}

export const MetaMockup: React.FC<MetaMockupProps> = ({ platform, ad }) => {
  if (!ad) return null;

  const creative = ad.adcreatives?.[0] || ad.creative || {};
  const title = creative.title || ad.headline || ad.name || 'Título do Anúncio';
  const body = creative.body || ad.body || ad.text || 'Texto e copy principal do seu anúncio configurado na campanha.';
  const imageUrl = creative.image_url || creative.thumbnail_url || ad.image_url || ad.imageUrl || null;
  const linkUrl = creative.link_url || ad.link_url || ad.destination_url || 'https://suaempresa.com.br';
  const callToAction = creative.call_to_action_type || ad.call_to_action || 'SAIBA MAIS';
  const pageName = ad.page_name || ad.account_name || 'Sua Marca / Página';

  // 1. FACEBOOK FEED MOCKUP
  if (platform === 'facebook') {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-md overflow-hidden max-w-md mx-auto my-2 text-slate-800 font-sans">
        {/* Header */}
        <div className="p-3.5 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm shadow-sm">
              <Facebook size={20} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 leading-tight">{pageName}</h4>
              <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                <span>Patrocinado</span>
                <span>•</span>
                <Globe size={11} className="text-slate-400" />
              </div>
            </div>
          </div>
          <button className="text-slate-400 hover:text-slate-600 p-1">
            <MoreHorizontal size={18} />
          </button>
        </div>

        {/* Text Body */}
        <div className="p-3.5 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
          {body}
        </div>

        {/* Media Container */}
        <div className="bg-slate-900 aspect-video w-full overflow-hidden flex items-center justify-center relative">
          {imageUrl ? (
            <img 
              src={imageUrl} 
              alt={title} 
              className="w-full h-full object-cover" 
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="text-center p-6 text-slate-400">
              <Facebook size={40} className="mx-auto mb-2 opacity-40 text-blue-400" />
              <p className="text-xs font-medium">Anúncio em Imagem / Vídeo</p>
            </div>
          )}
        </div>

        {/* Link / CTA Bar */}
        <div className="bg-slate-50 p-3 border-t border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold truncate">
              {linkUrl.replace(/^https?:\/\//, '').split('/')[0]}
            </span>
            <h5 className="text-xs font-bold text-slate-900 truncate mt-0.5">{title}</h5>
          </div>
          <a 
            href={linkUrl} 
            target="_blank" 
            rel="noreferrer" 
            className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-bold whitespace-nowrap transition-colors shrink-0 flex items-center gap-1"
          >
            <span>{callToAction.replace(/_/g, ' ')}</span>
            <ExternalLink size={12} />
          </a>
        </div>

        {/* Reaction Bar */}
        <div className="px-4 py-2.5 flex items-center justify-between text-slate-500 text-xs font-semibold border-t border-slate-100 bg-white">
          <button className="flex items-center gap-1.5 hover:text-blue-600 transition-colors py-1 px-2 rounded-md hover:bg-slate-50">
            <ThumbsUp size={16} />
            <span>Curtir</span>
          </button>
          <button className="flex items-center gap-1.5 hover:text-slate-800 transition-colors py-1 px-2 rounded-md hover:bg-slate-50">
            <MessageCircle size={16} />
            <span>Comentar</span>
          </button>
          <button className="flex items-center gap-1.5 hover:text-slate-800 transition-colors py-1 px-2 rounded-md hover:bg-slate-50">
            <Share2 size={16} />
            <span>Compartilhar</span>
          </button>
        </div>
      </div>
    );
  }

  // 2. INSTAGRAM FEED MOCKUP
  if (platform === 'instagram') {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-md overflow-hidden max-w-md mx-auto my-2 text-slate-800 font-sans">
        {/* Header */}
        <div className="p-3 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-[2px] shadow-sm">
              <div className="w-full h-full bg-white rounded-full p-[1px]">
                <div className="w-full h-full bg-slate-900 rounded-full flex items-center justify-center text-white">
                  <Instagram size={14} />
                </div>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 leading-tight">
                {pageName.toLowerCase().replace(/\s+/g, '_')}
              </h4>
              <span className="text-[10px] text-slate-400">Patrocinado</span>
            </div>
          </div>
          <MoreHorizontal size={18} className="text-slate-400" />
        </div>

        {/* Media Container (Square 1:1) */}
        <div className="bg-slate-900 aspect-square w-full overflow-hidden flex items-center justify-center relative">
          {imageUrl ? (
            <img 
              src={imageUrl} 
              alt={title} 
              className="w-full h-full object-cover" 
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="text-center p-6 text-slate-400">
              <Instagram size={40} className="mx-auto mb-2 opacity-40 text-pink-500" />
              <p className="text-xs font-medium">Preview de Anúncio Instagram</p>
            </div>
          )}
        </div>

        {/* Action Button Strip */}
        <div className="bg-indigo-600 text-white p-2.5 flex items-center justify-between text-xs font-bold px-4">
          <span>{callToAction.replace(/_/g, ' ')}</span>
          <ExternalLink size={14} />
        </div>

        {/* Icons Bar */}
        <div className="p-3 flex items-center justify-between text-slate-700">
          <div className="flex items-center gap-4">
            <Heart size={20} className="hover:text-rose-500 cursor-pointer transition-colors" />
            <MessageCircle size={20} className="hover:text-slate-900 cursor-pointer transition-colors" />
            <Share2 size={20} className="hover:text-slate-900 cursor-pointer transition-colors" />
          </div>
          <Bookmark size={20} className="hover:text-slate-900 cursor-pointer transition-colors" />
        </div>

        {/* Caption */}
        <div className="px-3 pb-4 text-xs space-y-1">
          <p className="text-slate-800">
            <span className="font-bold mr-1">{pageName.toLowerCase().replace(/\s+/g, '_')}</span>
            {body}
          </p>
          <span className="text-[10px] text-slate-400 block pt-1">Ver todos os comentários</span>
        </div>
      </div>
    );
  }

  // 3. STORIES MOCKUP (9:16)
  if (platform === 'stories') {
    return (
      <div className="relative bg-slate-900 text-white rounded-3xl overflow-hidden aspect-[9/16] max-w-[300px] mx-auto my-2 shadow-2xl border border-slate-800 flex flex-col justify-between p-4">
        {/* Background image / overlay */}
        {imageUrl ? (
          <img 
            src={imageUrl} 
            alt={title} 
            className="absolute inset-0 w-full h-full object-cover opacity-90"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-purple-900 via-indigo-950 to-slate-900 flex items-center justify-center p-6 text-center">
            <Instagram size={48} className="text-pink-400/40 mb-2" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80 pointer-events-none" />

        {/* Stories Top Bar */}
        <div className="relative z-10 space-y-2">
          {/* Progress Indicator */}
          <div className="w-full h-1 bg-white/30 rounded-full overflow-hidden">
            <div className="w-2/3 h-full bg-white rounded-full" />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-pink-500 p-[1.5px]">
                <div className="w-full h-full bg-slate-900 rounded-full flex items-center justify-center text-xs font-bold">
                  {pageName.substring(0, 1)}
                </div>
              </div>
              <div>
                <h5 className="text-xs font-bold leading-tight">{pageName}</h5>
                <span className="text-[9px] text-slate-300">Patrocinado</span>
              </div>
            </div>
            <X size={18} className="text-white/80 cursor-pointer" />
          </div>
        </div>

        {/* Stories Content Overlay */}
        <div className="relative z-10 text-center space-y-3 mb-2">
          <div className="bg-black/60 backdrop-blur-md p-3 rounded-2xl border border-white/10 text-xs text-slate-100 max-h-28 overflow-y-auto">
            <p className="font-semibold text-xs mb-1">{title}</p>
            <p className="text-[11px] text-slate-300 line-clamp-3">{body}</p>
          </div>

          {/* Swipe Up CTA */}
          <div className="pt-2">
            <a 
              href={linkUrl} 
              target="_blank" 
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-white text-slate-900 hover:bg-slate-100 rounded-full text-xs font-extrabold uppercase tracking-wider shadow-lg transition-transform hover:scale-105"
            >
              <span>{callToAction.replace(/_/g, ' ')}</span>
              <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>
    );
  }

  // 4. REELS MOCKUP (9:16)
  return (
    <div className="relative bg-slate-950 text-white rounded-3xl overflow-hidden aspect-[9/16] max-w-[300px] mx-auto my-2 shadow-2xl border border-slate-800 flex flex-col justify-between p-4">
      {/* Background Media */}
      {imageUrl ? (
        <img 
          src={imageUrl} 
          alt={title} 
          className="absolute inset-0 w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950 via-slate-900 to-black flex items-center justify-center">
          <Instagram size={48} className="text-pink-500/40" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/40 pointer-events-none" />

      {/* Top Header */}
      <div className="relative z-10 flex items-center justify-between text-xs font-bold">
        <span className="bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px]">Reels</span>
        <CameraIcon />
      </div>

      {/* Bottom Content & Side Buttons */}
      <div className="relative z-10 flex items-end justify-between gap-3">
        {/* Left Side: Caption & Info */}
        <div className="space-y-2 max-w-[200px]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-pink-600 text-white font-bold flex items-center justify-center text-xs">
              {pageName.substring(0, 1)}
            </div>
            <span className="text-xs font-bold truncate">{pageName}</span>
            <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded-md text-slate-200">Patrocinado</span>
          </div>

          <p className="text-xs text-slate-200 line-clamp-2">{body}</p>

          <a 
            href={linkUrl} 
            target="_blank" 
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg transition-colors"
          >
            <span>{callToAction.replace(/_/g, ' ')}</span>
            <ExternalLink size={11} />
          </a>

          <div className="flex items-center gap-1.5 text-[10px] text-slate-300">
            <Music size={12} className="animate-spin duration-3000" />
            <span className="truncate">Áudio original - {pageName}</span>
          </div>
        </div>

        {/* Right Side: Action Icons */}
        <div className="flex flex-col items-center gap-4 text-xs font-medium shrink-0">
          <div className="flex flex-col items-center gap-1">
            <Heart size={22} className="text-white hover:text-rose-500 cursor-pointer" />
            <span className="text-[10px]">1.2k</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <MessageCircle size={22} className="text-white hover:text-slate-200 cursor-pointer" />
            <span className="text-[10px]">84</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Share2 size={22} className="text-white hover:text-slate-200 cursor-pointer" />
          </div>
          <div className="w-6 h-6 rounded-md border-2 border-white overflow-hidden bg-slate-800 flex items-center justify-center">
            <Music size={12} />
          </div>
        </div>
      </div>
    </div>
  );
};

const CameraIcon = () => (
  <svg className="w-5 h-5 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
