
import React from 'react';
import { Bot, Sparkles, Zap } from 'lucide-react';

const LoadingScreen: React.FC = () => {
  return (
    <div className="fixed inset-0 bg-[#0f172a] flex flex-col items-center justify-center z-[9999] overflow-hidden font-sans">
      {/* Abstract Background Elements */}
      <div className="absolute w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[100px] animate-pulse top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
      
      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center p-8 animate-in fade-in zoom-in-95 duration-1000">
        
        {/* Logo Container with Glow */}
        <div className="relative mb-12 group">
          <div className="absolute inset-0 bg-blue-500/20 rounded-3xl blur-2xl group-hover:bg-blue-500/30 transition-all duration-1000"></div>
          <div className="w-24 h-24 bg-white/5 backdrop-blur-2xl rounded-3xl border border-white/10 flex items-center justify-center shadow-2xl relative overflow-hidden">
             <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent opacity-50"></div>
             <Bot size={40} className="text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] relative z-10" />
             
             {/* Scanning Effect - Slower, smoother */}
             <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-400/20 to-transparent translate-y-[-100%] animate-[scan_2.5s_ease-in-out_infinite]"></div>
          </div>
        </div>

        {/* Text Animations */}
        <div className="space-y-8">
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-white via-slate-200 to-slate-400 tracking-tight">
            COPILOT AI
          </h1>
          
          <div className="flex flex-col items-center gap-4">
             <div className="h-1 w-64 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-600 w-1/3 rounded-full animate-[loading_2s_ease-in-out_infinite] shadow-[0_0_15px_rgba(59,130,246,0.8)]"></div>
             </div>
             <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em] animate-pulse">
                  Carregando Sistema
                </p>
             </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes loading {
          0% { transform: translateX(-150%); width: 20%; }
          50% { width: 50%; }
          100% { transform: translateX(250%); width: 20%; }
        }
        @keyframes scan {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(200%); }
        }
      `}</style>
    </div>
  );
};

export default LoadingScreen;
