
import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Pause, Play, X, Sparkles, Loader2, Lock } from 'lucide-react';
import { ParticleEngine, AxisSpeechRecognizer, AxisMode } from '../services/axisLayer';
import { useApp } from '../App';
import { GoogleGenAI, Modality } from "@google/genai";

// --- SUBCOMPONENTS ---

const SphereCore = ({ mode }: { mode: AxisMode }) => {
  const getSphereStyles = () => {
    switch (mode) {
      case 'listening': return 'shadow-[0_0_60px_rgba(36,122,174,0.6)] bg-gradient-to-br from-blue-500 via-[#247AAE] to-black animate-pulse';
      case 'speaking': return 'shadow-[0_0_80px_rgba(245,158,11,0.7)] bg-gradient-to-br from-amber-400 via-amber-600 to-black scale-110';
      case 'processing': return 'shadow-[0_0_40px_rgba(255,255,255,0.4)] bg-white animate-spin opacity-80 scale-90';
      default: return 'bg-gray-900';
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
      <div className={`w-32 h-32 rounded-full transition-all duration-1000 ease-in-out ${getSphereStyles()}`}>
        <div className="absolute top-2 left-4 w-8 h-8 bg-white opacity-20 rounded-full blur-md"></div>
      </div>
      <div className={`mt-8 text-xs font-bold tracking-[0.3em] uppercase transition-colors duration-500 ${getLabelColor()}`}>
        {mode === 'listening' && 'Ouvindo Você...'}
        {mode === 'speaking' && 'AXIS Falando...'}
        {mode === 'processing' && 'Processando...'}
      </div>
    </div>
  );
};

const Controls = ({ isMuted, isPaused, onToggleMute, onTogglePause, onStop }: any) => (
  <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-6 z-20">
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
const playGeminiAudio = async (base64Audio: string, onStart: () => void, onEnd: () => void) => {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContext({ sampleRate: 24000 });
        
        // Garante que o contexto está rodando (browsers bloqueiam autoplay)
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
        onEnd();
    }
};

// --- MAIN MODULE ---

const AxisModule: React.FC = () => {
  const { user } = useApp();
  const [isActive, setIsActive] = useState(false);
  const [mode, setMode] = useState<AxisMode>('idle');
  const [transcript, setTranscript] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ParticleEngine | null>(null);
  const recognizerRef = useRef<AxisSpeechRecognizer | null>(null);

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

  const speak = async (text: string) => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' }, 
                    },
                },
            },
        });

        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (audioData) {
            recognizerRef.current?.stop();
            playGeminiAudio(
                audioData,
                () => setMode('speaking'),
                () => {
                    setMode('listening');
                    if (!isMuted && !isPaused) recognizerRef.current?.start();
                }
            );
        } else {
            console.warn("Sem áudio gerado.");
            setMode('listening');
        }

    } catch (e) {
        console.error("Erro TTS:", e);
        setMode('listening');
        if (!isMuted && !isPaused) recognizerRef.current?.start();
    }
  };

  const handleProcessIntent = async (userMessage: string) => {
    setMode('processing');
    setTranscript('Pensando...'); // Feedback imediato visual
    try {
        const res = await fetch('/api/axis/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage })
        });
        const data = await res.json();
        if (data.response) {
            setTranscript(data.response);
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

  const handleActivate = () => {
    setErrorMsg(null);
    setIsActive(true);
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
                setErrorMsg("Microfone bloqueado. Permita o acesso.");
                setIsActive(false); 
                setMode('idle');
            }
        }
    );

    recognizerRef.current = recognizer;
    
    try {
        recognizer.start();
        speak("Axis online.");
    } catch (e) {
        setErrorMsg("Erro ao iniciar.");
        setIsActive(false);
    }
  };

  const handleStop = () => {
    setIsActive(false);
    setMode('idle');
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    engineRef.current?.stop();
    engineRef.current = null;
  };

  useEffect(() => {
      if (!recognizerRef.current) return;
      if (isMuted || isPaused) {
          recognizerRef.current.stop();
      } else if (isActive && mode === 'listening') {
          try { recognizerRef.current.start(); } catch {}
      }
  }, [isMuted, isPaused, isActive, mode]);

  if (!isActive) {
      return (
        <div className="fixed inset-0 z-50 bg-[#080c14] flex flex-col items-center justify-center animate-in fade-in duration-500">
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
    <div className="fixed inset-0 z-50 bg-[#080c14] overflow-hidden flex flex-col items-center justify-center">
       <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
       <SphereCore mode={mode} />
       <div className="absolute top-1/4 w-full max-w-2xl px-6 text-center z-20">
          <p className={`text-lg md:text-2xl font-light leading-relaxed transition-colors duration-500 ${mode === 'speaking' ? 'text-amber-100/80' : 'text-blue-100/80'}`}>
             "{transcript || '...'}"
          </p>
       </div>
       <Controls isMuted={isMuted} isPaused={isPaused} onToggleMute={() => setIsMuted(!isMuted)} onTogglePause={() => setIsPaused(!isPaused)} onStop={handleStop} />
    </div>
  );
};

export default AxisModule;
