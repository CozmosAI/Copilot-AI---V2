import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Pause, Play, X, Sparkles, Loader2, Lock, VolumeX, MessageSquare, Trash2, Send, Bot } from 'lucide-react';
import { ParticleEngine, AxisSpeechRecognizer, AxisMode } from '../services/axisLayer';
import { useApp } from '../App';
import { apiFetch, safeJsonResponse } from '../services/apiClient';

// --- SUBCOMPONENTS ---

const SphereCore = ({ mode, audioError, size = 'large' }: { mode: AxisMode, audioError?: boolean, size?: 'small' | 'large' }) => {
  const getSphereStyles = () => {
    switch (mode) {
      case 'listening': return 'shadow-[0_0_60px_rgba(36,122,174,0.6)] bg-gradient-to-br from-blue-500 via-[#247AAE] to-black animate-pulse';
      case 'speaking': return 'shadow-[0_0_80px_rgba(245,158,11,0.7)] bg-gradient-to-br from-amber-400 via-amber-600 to-black animate-speaking-pulse';
      case 'processing': return 'shadow-[0_0_40px_rgba(255,255,255,0.4)] bg-white animate-spin opacity-40 scale-90';
      default: return 'shadow-[0_0_40px_rgba(36,122,174,0.35)] bg-gradient-to-br from-[#122A3F] via-[#0A1926] to-[#020508] border border-blue-500/10';
    }
  };

  const getLabelColor = () => {
    switch (mode) {
      case 'listening': return 'text-blue-400';
      case 'speaking': return 'text-amber-400';
      case 'processing': return 'text-slate-400';
      default: return 'text-slate-500';
    }
  };

  const sizeClass = size === 'small' ? 'w-24 h-24' : 'w-32 h-32';

  return (
    <div className="relative z-10 flex flex-col items-center justify-center transition-all duration-700 ease-in-out">
      <div className="relative">
        <div className={`rounded-full transition-all duration-1000 ease-in-out ${sizeClass} ${getSphereStyles()}`}>
          <div className="absolute top-2 left-4 w-8 h-8 bg-white opacity-20 rounded-full blur-md"></div>
        </div>
        {audioError && mode === 'speaking' && (
          <div className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-2 shadow-lg animate-bounce border border-slate-950 flex items-center justify-center" title="Áudio indisponível">
            <VolumeX size={14} />
          </div>
        )}
      </div>
      <div className={`mt-6 text-[10px] font-bold tracking-[0.3em] uppercase transition-colors duration-500 text-center ${getLabelColor()}`}>
        {mode === 'listening' && 'Ouvindo Você...'}
        {mode === 'speaking' && 'AXIS Falando...'}
        {mode === 'processing' && 'Processando...'}
        {mode === 'idle' && 'AXIS Pronta'}
      </div>
      {audioError && mode === 'speaking' && (
        <span className="text-[10px] text-rose-400 font-medium mt-2 tracking-wide text-center bg-rose-950/40 border border-rose-900/30 px-2.5 py-1 rounded-full flex items-center justify-center gap-1.5 animate-pulse">
          <VolumeX size={11}/> Modo de Leitura (Sem Áudio)
        </span>
      )}
    </div>
  );
};

const Controls = ({ isMuted, isPaused, onToggleMute, onTogglePause, onStop }: any) => (
  <div className="flex items-center gap-6 z-20">
    <button onClick={onTogglePause} className="w-12 h-12 rounded-full bg-white/5 backdrop-blur-md border border-white/10 flex items-center justify-center text-slate-300 hover:bg-white/10 hover:text-white transition-all">
      {isPaused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
    </button>
    <button onClick={onToggleMute} className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg ${isMuted ? 'bg-rose-500/20 border border-rose-500 text-rose-500 hover:bg-rose-500 hover:text-white shadow-rose-900/20' : 'bg-blue-500/20 border border-blue-500 text-blue-400 hover:bg-blue-500 hover:text-white shadow-blue-900/20'}`}>
      {isMuted ? <MicOff size={28} /> : <Mic size={28} />}
    </button>
    <button onClick={onStop} className="w-12 h-12 rounded-full bg-white/5 backdrop-blur-md border border-white/10 flex items-center justify-center text-slate-300 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50 transition-all">
      <X size={20} />
    </button>
  </div>
);

// --- HELPER: AUDIO DECODER & PLAYER (Gemini TTS) ---
const playGeminiAudio = async (base64Audio: string, onStart: () => void, onEnd: () => void, onError: (err: any) => void) => {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContext({ sampleRate: 24000 });
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const dataInt16 = new Int16Array(bytes.buffer);
        const buffer = audioContext.createBuffer(1, dataInt16.length, 24000);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < dataInt16.length; i++) {
            channelData[i] = dataInt16[i] / 32768.0;
        }

        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        
        source.onended = () => {
            onEnd();
            audioContext.close();
        };

        onStart();
        source.start();

    } catch (e) {
        console.error("Erro ao reproduzir áudio:", e);
        onError(e);
        onEnd();
    }
};

// --- MAIN MODULE ---

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

const AxisModule: React.FC = () => {
  const { user, navigateToSection } = useApp();
  const [isActive, setIsActive] = useState(false);
  const [mode, setMode] = useState<AxisMode>('idle');
  const [transcript, setTranscript] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [audioError, setAudioError] = useState(false);

  // Text Mode States
  const [isTextMode, setIsTextMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('axis_is_text_mode');
    return saved === 'true';
  });

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem('axis_chat_history');
    return saved ? JSON.parse(saved) : [];
  });

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ParticleEngine | null>(null);
  const recognizerRef = useRef<AxisSpeechRecognizer | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const speakNative = (text: string, onStart: () => void, onEnd: () => void) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'pt-BR';
        
        // Tentativa de selecionar voz feminina pt-BR
        const voices = window.speechSynthesis.getVoices();
        const ptVoices = voices.filter(v => v.lang.startsWith('pt'));
        const femaleVoice = ptVoices.find(v => 
          v.name.toLowerCase().includes('female') || 
          v.name.toLowerCase().includes('feminina') || 
          v.name.toLowerCase().includes('luciana') || 
          v.name.toLowerCase().includes('vitoria') || 
          v.name.includes('Google português')
        );
        if (femaleVoice) {
          utterance.voice = femaleVoice;
        } else if (ptVoices.length > 0) {
          utterance.voice = ptVoices[0];
        }

        utterance.onstart = () => {
          onStart();
        };
        utterance.onend = () => {
          onEnd();
        };
        utterance.onerror = (e) => {
          console.error("Native speechSynthesis error event:", e);
          setAudioError(true);
          onEnd();
        };
        window.speechSynthesis.speak(utterance);
        return true;
      } catch (err) {
        console.error("Erro ao chamar window.speechSynthesis.speak:", err);
        return false;
      }
    }
    return false;
  };

  useEffect(() => {
    if (isActive && canvasRef.current && !engineRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            engineRef.current = new ParticleEngine(ctx, window.innerWidth, window.innerHeight);
            engineRef.current.setMode(mode);
            engineRef.current.start();
        }
    }
    const handleResize = () => {
        if (canvasRef.current && engineRef.current) {
            canvasRef.current.width = window.innerWidth;
            canvasRef.current.height = window.innerHeight;
            engineRef.current.updateDimensions(window.innerWidth, window.innerHeight);
        }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isActive]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.setMode(mode);
  }, [mode]);

  // Sync isTextMode with local storage & stop/start recognizer
  useEffect(() => {
    localStorage.setItem('axis_is_text_mode', String(isTextMode));
    if (isTextMode) {
      if (recognizerRef.current) {
        try { recognizerRef.current.stop(); } catch (e) {}
      }
    } else {
      if (isActive && mode === 'listening' && !isMuted && !isPaused) {
        try { recognizerRef.current?.start(); } catch (e) {}
      }
    }
  }, [isTextMode, isActive, mode, isMuted, isPaused]);

  // Sync chatHistory with local storage
  useEffect(() => {
    localStorage.setItem('axis_chat_history', JSON.stringify(chatHistory));
  }, [chatHistory]);

  // Auto-scroll to bottom of chat
  const scrollToBottom = () => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, isSending]);

  const speak = async (text: string) => {
    setAudioError(false);

    const handleFallbackAndTextOnly = () => {
      const nativeSuccess = speakNative(
        text,
        () => setMode('speaking'),
        () => {
          setMode(isTextMode ? 'idle' : 'listening');
          setTimeout(() => {
            if (!isTextMode && recognizerRef.current && !isMuted && !isPaused) {
              try { recognizerRef.current.start(); } catch {}
            }
          }, 100);
        }
      );

      if (!nativeSuccess) {
        setAudioError(true);
        setMode('speaking');
        
        const wordCount = text.split(/\s+/).length;
        const readDuration = Math.min(Math.max(wordCount * 220, 3500), 8000);
        
        setTimeout(() => {
          setMode(isTextMode ? 'idle' : 'listening');
          setTimeout(() => {
            if (!isTextMode && recognizerRef.current && !isMuted && !isPaused) {
              try { recognizerRef.current.start(); } catch {}
            }
          }, 100);
        }, readDuration);
      }
    };

    try {
      const response = await apiFetch('/api/gemini/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      
      if (!response.ok) {
        throw new Error("TTS API returned status " + response.status);
      }

      const data = await safeJsonResponse(response);
      if (data.audio && !data.fallback) {
        recognizerRef.current?.stop();
        playGeminiAudio(
          data.audio,
          () => setMode('speaking'),
          () => {
            setMode(isTextMode ? 'idle' : 'listening');
            setTimeout(() => {
              if (!isTextMode && recognizerRef.current && !isMuted && !isPaused) {
                try { recognizerRef.current.start(); } catch {}
              }
            }, 100);
          },
          (err) => {
            console.error("playGeminiAudio falhou:", err);
            handleFallbackAndTextOnly();
          }
        );
      } else {
        console.warn("Sem áudio retornado pela API ou fallback ativo. Usando fallback...");
        handleFallbackAndTextOnly();
      }
    } catch (e) {
      console.error("Erro no fluxo do Gemini TTS:", e);
      handleFallbackAndTextOnly();
    }
  };

  const handleProcessIntent = async (userMessage: string) => {
    setMode('processing');
    setTranscript('Pensando...');

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: userMessage,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };
    setChatHistory(prev => [...prev, userMsg]);

    try {
        const res = await apiFetch('/api/axis/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage })
        });
        const data = await res.json();
        if (data.response) {
            setTranscript(data.response);
            
            const assistantMsg: ChatMessage = {
              id: crypto.randomUUID(),
              sender: 'assistant',
              text: data.response,
              timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            };
            setChatHistory(prev => [...prev, assistantMsg]);

            await speak(data.response);
        } else { 
            speak("Não entendi."); 
            setMode('listening'); 
        }
    } catch (e) {
        console.error(e);
        speak("Erro ao conectar.");
        setMode('listening');
    }
  };

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || isSending) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    setChatHistory(prev => [...prev, userMsg]);
    setInputText('');
    setIsSending(true);
    setMode('processing');

    try {
      const res = await apiFetch('/api/axis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: textToSend.trim() })
      });
      const data = await res.json();
      
      const assistantText = data.response || "Desculpe, não consegui processar sua solicitação.";
      
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: assistantText,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };
      
      setChatHistory(prev => [...prev, assistantMsg]);
      setMode('idle');
    } catch (e) {
      console.error(e);
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: "Ocorreu um erro ao conectar ao servidor. Por favor, tente novamente.",
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };
      setChatHistory(prev => [...prev, errorMsg]);
      setMode('idle');
    } finally {
      setIsSending(false);
    }
  };

  const handleClearHistory = () => {
    if (confirm("Deseja limpar todo o histórico da conversa?")) {
      setChatHistory([]);
    }
  };

  const handleActivate = () => {
    setErrorMsg(null);
    setIsActive(true);
    
    if (isTextMode) {
      setMode('idle');
    } else {
      setMode('listening');
      
      const recognizer = new AxisSpeechRecognizer(
          (text, isFinal) => { 
              setTranscript(text); 
          },
          (isListening) => { }, 
          (finalText) => { 
              if(finalText.trim()) handleProcessIntent(finalText); 
          },
          (error) => {
              if (error === 'not-allowed' || error === 'service-not-allowed') {
                  setIsTextMode(true);
                  setMode('idle');
                  setErrorMsg("Microfone não disponível. Modo texto ativado automaticamente.");
                  setTimeout(() => setErrorMsg(null), 5000);
              }
          }
      );

      recognizerRef.current = recognizer;
      
      try {
          recognizer.start();
          if (!isTextMode) {
              speak("Axis online.").catch(e => {
                  console.warn('TTS falhou, continuando sem voz', e);
              });
          }
      } catch (e) {
          setErrorMsg("Erro ao iniciar.");
          setIsActive(false);
      }
    }
  };

  const toggleToVoiceMode = () => {
    setIsTextMode(false);
    
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    if (isActive && !recognizerRef.current) {
      setMode('listening');
      const recognizer = new AxisSpeechRecognizer(
          (text, isFinal) => { 
              setTranscript(text); 
          },
          (isListening) => { }, 
          (finalText) => { 
              if(finalText.trim()) handleProcessIntent(finalText); 
          },
          (error) => {
              if (error === 'not-allowed' || error === 'service-not-allowed') {
                  setIsTextMode(true);
                  setMode('idle');
                  setErrorMsg("Microfone não disponível. Modo texto ativado automaticamente.");
                  setTimeout(() => setErrorMsg(null), 5000);
              }
          }
      );
      recognizerRef.current = recognizer;
      try {
        recognizer.start();
        speak("Axis online.");
      } catch (e) {
        console.error("Erro ao iniciar recognizer no toggle:", e);
      }
    } else if (isActive && recognizerRef.current) {
      setMode('listening');
      try {
        recognizerRef.current.start();
      } catch (e) {}
    }
  };

  const toggleToTextMode = () => {
    setIsTextMode(true);
    setMode('idle');
    
    if (recognizerRef.current) {
      try {
        recognizerRef.current.stop();
      } catch (e) {}
    }
    
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleStop = () => {
    setIsActive(false);
    setMode('idle');
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    engineRef.current?.stop();
    engineRef.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  useEffect(() => {
      if (!recognizerRef.current || isTextMode) return;
      if (isMuted || isPaused) {
          recognizerRef.current.stop();
      } else if (isActive && mode === 'listening') {
          try { recognizerRef.current.start(); } catch {}
      }
  }, [isMuted, isPaused, isActive, mode, isTextMode]);

  const quickPrompts = [
    "Quantos leads eu tenho?",
    "Qual meu ROI?",
    "Quanto gastei no Meta?",
    "Quais leads estão parados?"
  ];

  if (!isActive) {
      return (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex flex-col items-center justify-center animate-in fade-in duration-500" style={{ zIndex: 10 }}>
            <button
              onClick={() => navigateToSection('dashboard' as any)}
              className="absolute top-4 left-4 z-20 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
              Voltar
            </button>
            <div className="relative group cursor-pointer" onClick={handleActivate}>
                <div className="absolute inset-0 bg-[#247AAE] rounded-full blur-xl opacity-40 group-hover:opacity-60 transition-opacity animate-pulse"></div>
                <button className="relative w-40 h-40 rounded-full border-2 border-[#247AAE]/50 flex items-center justify-center bg-[#0f172a] group-hover:scale-105 transition-transform duration-300">
                    <div className="absolute inset-0 rounded-full border border-[#247AAE]/30 animate-ping"></div>
                    <span className="text-[#247AAE] font-bold text-lg tracking-[0.2em] group-hover:text-white transition-colors">ATIVAR</span>
                </button>
            </div>
            <h1 className="text-slate-500 text-sm font-medium tracking-widest uppercase mt-8 flex items-center gap-2"><Sparkles size={14}/> Axis AI • Gestão Inteligente</h1>
            
            {errorMsg && (
                <div className="mt-6 p-4 bg-red-900/40 border border-red-800/50 rounded-xl text-red-200 text-xs flex flex-col items-center gap-2 max-w-md text-center animate-in slide-in-from-bottom-2">
                    <div className="flex items-center gap-2 font-bold text-red-100 uppercase tracking-wider mb-1">
                        <Lock size={14} /> Permissão Necessária
                    </div>
                    <p>{errorMsg}</p>
                </div>
            )}
        </div>
      );
  }

  return (
    <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 overflow-hidden flex flex-col items-center justify-center" style={{ zIndex: 10 }}>
       <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
       
       {/* New Header */}
       <div className="absolute top-0 left-0 right-0 h-16 border-b border-white/5 bg-slate-950/60 backdrop-blur-md flex items-center justify-between px-6 z-30">
         {/* Left: Voltar */}
         <button
           onClick={() => {
             if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
               window.speechSynthesis.cancel();
             }
             handleStop();
             navigateToSection('dashboard' as any);
           }}
           className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white transition-colors flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider active:scale-95"
         >
           <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
             <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
           </svg>
           Voltar
         </button>

         {/* Center: Toggle Voz / Texto & Status Dot */}
         <div className="flex items-center gap-4">
           {/* Status Indicator */}
           <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-400 tracking-wider uppercase select-none">
             <span className="relative flex h-1.5 w-1.5">
               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
               <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
             </span>
             AXIS ONLINE
           </div>

           {/* Mode Toggle */}
           <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
             <button
               onClick={toggleToVoiceMode}
               className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${!isTextMode ? 'bg-[#247AAE] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:text-slate-200'}`}
             >
               <Mic size={14} />
               <span className="hidden sm:inline">Voz</span>
             </button>
             <button
               onClick={toggleToTextMode}
               className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isTextMode ? 'bg-[#247AAE] text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:text-slate-200'}`}
             >
               <MessageSquare size={14} />
               <span className="hidden sm:inline">Texto</span>
             </button>
           </div>
         </div>

         {/* Right: Limpar Conversa */}
         <button
           onClick={handleClearHistory}
           disabled={chatHistory.length === 0}
           className="p-2 rounded-lg bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 border border-white/5 hover:border-red-500/20 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 disabled:hover:border-white/5 active:scale-95"
           title="Limpar Conversa"
         >
           <Trash2 size={16} />
         </button>
       </div>

       {/* Layout Container */}
       <div className="flex-1 w-full h-full pt-16 flex flex-col z-20">
         {isTextMode ? (
           /* TEXT CHAT LAYOUT */
           <div className="flex flex-col lg:flex-row h-full w-full overflow-hidden">
             {/* Left Column (Sphere Visualizer in Text Mode) */}
             <div className="hidden lg:flex lg:w-80 xl:w-96 flex-col items-center justify-center border-r border-white/5 bg-slate-950/20 p-8 relative">
               <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(36,122,174,0.05)_0%,transparent_70%)] pointer-events-none"></div>
               <SphereCore mode={mode} audioError={audioError} size="large" />
               
               <div className="mt-8 text-center max-w-[240px]">
                 <p className="text-slate-500 text-[11px] leading-relaxed">
                   A Axis IA está integrada aos seus dados de leads, ROI, gastos de marketing e vendas.
                 </p>
               </div>
             </div>

             {/* Right Column (Chat Room) */}
             <div className="flex-1 flex flex-col h-full overflow-hidden relative">
               {/* Small Sphere for Mobile/Tablet only */}
               <div className="lg:hidden flex items-center justify-center p-3 border-b border-white/5 bg-slate-950/30 gap-4">
                 <SphereCore mode={mode} audioError={audioError} size="small" />
               </div>

               {/* Message Viewport */}
               <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                 {chatHistory.length === 0 ? (
                   <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                     <Bot size={40} className="text-blue-500/50 mb-3 animate-pulse" />
                     <h3 className="font-bold text-slate-300 text-sm tracking-wider uppercase mb-1">Inicie uma conversa</h3>
                     <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
                       Pergunte sobre seus leads, conversões, ROI ou desempenho de anúncios. A Axis irá analisar os dados em tempo real.
                     </p>
                   </div>
                 ) : (
                   chatHistory.map((msg) => (
                     <div
                       key={msg.id}
                       className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${msg.sender === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                     >
                       <div
                         className={`p-4 rounded-2xl text-sm leading-relaxed shadow-lg ${
                           msg.sender === 'user'
                             ? 'bg-blue-600 text-white rounded-br-none shadow-blue-500/10'
                             : 'bg-white/5 border border-white/10 text-slate-200 rounded-bl-none'
                         }`}
                       >
                         {msg.text}
                       </div>
                       <span className="text-[10px] text-slate-500 font-medium mt-1.5 px-1 select-none">
                         {msg.timestamp}
                       </span>
                     </div>
                   ))
                 )}
                 
                 {/* Loading bubble when processing */}
                 {isSending && (
                   <div className="flex flex-col max-w-[75%] mr-auto items-start animate-pulse">
                     <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-slate-400 rounded-bl-none flex items-center gap-2">
                       <Loader2 size={14} className="animate-spin text-blue-400" />
                       <span>Analisando dados do Supabase...</span>
                     </div>
                   </div>
                 )}
                 
                 <div ref={chatEndRef} />
               </div>

               {/* Bottom Area: Suggestions & Input Form */}
               <div className="p-4 md:p-6 border-t border-white/5 bg-slate-950/40 backdrop-blur-sm">
                 {/* Suggestions */}
                 <div className="flex flex-wrap gap-2 mb-4 max-h-[80px] overflow-y-auto bg-slate-900/10 p-2 rounded-xl">
                   {quickPrompts.map((promptText, idx) => (
                     <button
                       key={idx}
                       onClick={() => handleSendMessage(promptText)}
                       disabled={isSending}
                       className="text-xs bg-white/5 hover:bg-blue-500/15 text-slate-300 hover:text-blue-400 px-3.5 py-1.5 rounded-full border border-white/10 hover:border-blue-500/20 transition-all text-left whitespace-nowrap active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                     >
                       {promptText}
                     </button>
                   ))}
                 </div>

                 {/* Input Form */}
                 <form
                   onSubmit={(e) => {
                     e.preventDefault();
                     handleSendMessage(inputText);
                   }}
                   className="flex items-center gap-2 relative bg-white/5 border border-white/10 focus-within:border-[#247AAE]/50 rounded-2xl p-1.5 transition-all"
                 >
                   <input
                     type="text"
                     value={inputText}
                     onChange={(e) => setInputText(e.target.value)}
                     disabled={isSending}
                     placeholder="Envie sua mensagem para a Axis..."
                     className="flex-1 bg-transparent border-0 outline-none text-slate-200 placeholder-slate-500 text-sm px-3 py-2 disabled:opacity-50"
                   />
                   <button
                     type="submit"
                     disabled={!inputText.trim() || isSending}
                     className="p-3 bg-[#247AAE] hover:bg-blue-600 disabled:bg-white/5 text-white disabled:text-slate-600 rounded-xl transition-all shadow-lg active:scale-95"
                   >
                     <Send size={16} />
                   </button>
                 </form>
               </div>
             </div>
           </div>
         ) : (
           /* VOICE MODE LAYOUT (IMMERSIVE) */
           <div className="flex-1 flex flex-col items-center justify-center relative p-6">
             <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(36,122,174,0.05)_0%,transparent_70%)] pointer-events-none"></div>
             
             {/* Sphere Visualizer */}
             <SphereCore mode={mode} audioError={audioError} size="large" />

             {/* Live Transcript Bubble */}
             <div className="w-full max-w-2xl px-6 text-center mt-12 mb-24 min-h-[80px] flex items-center justify-center z-20">
               <p className={`text-lg md:text-2xl font-light leading-relaxed transition-all duration-500 max-w-xl ${mode === 'speaking' ? 'text-amber-100/80 font-medium' : 'text-blue-100/80'}`}>
                 {transcript ? `"${transcript}"` : 'Fale algo para a Axis analisar...'}
               </p>
             </div>

             {/* Controls */}
             <Controls
               isMuted={isMuted}
               isPaused={isPaused}
               onToggleMute={() => setIsMuted(!isMuted)}
               onTogglePause={() => setIsPaused(!isPaused)}
               onStop={handleStop}
             />
           </div>
         )}
       </div>
    </div>
  );
};

export default AxisModule;
