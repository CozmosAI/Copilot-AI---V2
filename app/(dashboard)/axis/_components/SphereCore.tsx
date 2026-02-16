
'use client';

import { AxisMode } from '@/lib/axis/particle-engine';

interface SphereCoreProps {
  mode: AxisMode;
}

export default function SphereCore({ mode }: SphereCoreProps) {
  const getSphereStyles = () => {
    switch (mode) {
      case 'listening':
        return 'shadow-[0_0_60px_rgba(36,122,174,0.6)] bg-gradient-to-br from-blue-500 via-[#247AAE] to-black animate-pulse-slow';
      case 'speaking':
        return 'shadow-[0_0_80px_rgba(245,158,11,0.7)] bg-gradient-to-br from-amber-400 via-amber-600 to-black animate-pulse-fast scale-110';
      case 'processing':
        return 'shadow-[0_0_40px_rgba(255,255,255,0.4)] bg-white animate-spin-slow opacity-80 scale-90';
      default:
        return 'shadow-[0_0_0px_rgba(0,0,0,0)] bg-gray-900';
    }
  };

  const getLabelColor = () => {
    switch (mode) {
      case 'listening': return 'text-blue-400';
      case 'speaking': return 'text-amber-400';
      default: return 'text-slate-500';
    }
  };

  return (
    <div className="relative z-10 flex flex-col items-center justify-center transition-all duration-700 ease-in-out">
      {/* Esfera Principal */}
      <div 
        className={`w-32 h-32 rounded-full transition-all duration-1000 ease-in-out ${getSphereStyles()}`}
      >
        {/* Brilho interno para dar volume */}
        <div className="absolute top-2 left-4 w-8 h-8 bg-white opacity-20 rounded-full blur-md"></div>
      </div>

      {/* Label de Status */}
      <div className={`mt-8 text-xs font-bold tracking-[0.3em] uppercase transition-colors duration-500 ${getLabelColor()}`}>
        {mode === 'listening' && 'Ouvindo Você...'}
        {mode === 'speaking' && 'AXIS AI Falando...'}
        {mode === 'processing' && 'Processando Dados...'}
      </div>
    </div>
  );
}
