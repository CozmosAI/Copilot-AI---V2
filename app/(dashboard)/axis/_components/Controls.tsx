
'use client';

import { Mic, MicOff, Pause, Play, X } from 'lucide-react';

interface ControlsProps {
  isMuted: boolean;
  isPaused: boolean;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onStop: () => void;
}

export default function Controls({ isMuted, isPaused, onToggleMute, onTogglePause, onStop }: ControlsProps) {
  return (
    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-6 z-20">
      
      {/* Botão Pausar/Retomar */}
      <button 
        onClick={onTogglePause}
        className="w-12 h-12 rounded-full bg-white/5 backdrop-blur-md border border-white/10 flex items-center justify-center text-slate-300 hover:bg-white/10 hover:text-white transition-all"
        title={isPaused ? "Retomar Sessão" : "Pausar Sessão"}
      >
        {isPaused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
      </button>

      {/* Botão Microfone (Principal) */}
      <button 
        onClick={onToggleMute}
        className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg ${
          isMuted 
            ? 'bg-rose-500/20 border border-rose-500 text-rose-500 hover:bg-rose-500 hover:text-white shadow-rose-900/20' 
            : 'bg-blue-500/20 border border-blue-500 text-blue-400 hover:bg-blue-500 hover:text-white shadow-blue-900/20'
        }`}
        title={isMuted ? "Ativar Microfone" : "Silenciar Microfone"}
      >
        {isMuted ? <MicOff size={28} /> : <Mic size={28} />}
      </button>

      {/* Botão Parar */}
      <button 
        onClick={onStop}
        className="w-12 h-12 rounded-full bg-white/5 backdrop-blur-md border border-white/10 flex items-center justify-center text-slate-300 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50 transition-all"
        title="Encerrar Sessão"
      >
        <X size={20} />
      </button>

    </div>
  );
}
