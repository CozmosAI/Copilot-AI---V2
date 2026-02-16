
'use client';

import { useState, useRef, useEffect } from 'react';
import ParticleCanvas from './_components/ParticleCanvas';
import SphereCore from './_components/SphereCore';
import Controls from './_components/Controls';
import { AxisSpeechRecognizer } from '@/lib/axis/speech-recognition';
import { AxisMode } from '@/lib/axis/particle-engine';

export default function AxisPage() {
  const [isActive, setIsActive] = useState(false);
  const [mode, setMode] = useState<AxisMode>('idle');
  const [transcript, setTranscript] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recognizerRef = useRef<AxisSpeechRecognizer | null>(null);

  // Sintetizador de Voz (Text-to-Speech)
  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      // Cancela falas anteriores
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 1.1; // Um pouco mais dinâmico
      
      // Tenta encontrar uma voz feminina pt-BR
      const voices = window.speechSynthesis.getVoices();
      const ptVoice = voices.find(v => v.lang === 'pt-BR' && (v.name.includes('Female') || v.name.includes('Luciana')));
      if (ptVoice) utterance.voice = ptVoice;

      utterance.onstart = () => {
        setMode('speaking');
        // Pausa reconhecimento enquanto fala para não ouvir a si mesma
        if (recognizerRef.current) recognizerRef.current.stop();
      };

      utterance.onend = () => {
        setMode('listening');
        // Volta a ouvir se não estiver pausado ou mutado
        if (recognizerRef.current && !isMuted && !isPaused && !errorMsg) recognizerRef.current.start();
      };

      window.speechSynthesis.speak(utterance);
    }
  };

  // Processamento com Backend
  const handleProcessIntent = async (userMessage: string) => {
    setMode('processing');
    
    try {
      const res = await fetch('/api/axis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          clinicId: 'demo-clinic', // Pegar do contexto de auth real
          context: {
            currentDate: new Date().toISOString(),
          }
        })
      });

      const data = await res.json();
      
      if (data.response) {
        speak(data.response);
      } else {
        speak("Não consegui processar sua solicitação.");
        setMode('listening');
      }

    } catch (err) {
      console.error(err);
      speak("Ocorreu um erro de conexão.");
      setMode('listening');
    }
  };

  // Inicialização
  const handleActivate = () => {
    setIsActive(true);
    setMode('listening');
    setErrorMsg(null);

    // Inicializa Reconhecimento
    recognizerRef.current = new AxisSpeechRecognizer(
      (text, isFinal) => {
        setTranscript(text);
      },
      (isListening) => {
        // Callback de status do microfone (opcional para debug)
      },
      (finalText) => {
        // Silêncio detectado -> Enviar para API
        if (finalText.trim()) {
          handleProcessIntent(finalText);
        }
      },
      (error) => {
        console.error("Axis Speech Error:", error);
        if (error === 'not-allowed' || error === 'service-not-allowed') {
            setErrorMsg("Acesso ao microfone negado. Verifique as permissões.");
            setIsActive(false); // Retorna para a tela inicial
            setMode('idle');
        } else if (error === 'browser-not-supported') {
            setErrorMsg("Seu navegador não suporta reconhecimento de voz.");
        }
      }
    );

    // Pequeno delay para garantir que o usuário está pronto
    setTimeout(() => {
      try {
        recognizerRef.current?.start();
        speak("Sistema Axis ativado. Como posso ajudar sua clínica hoje?");
      } catch (e) {
        console.error(e);
      }
    }, 500);
  };

  const handleStop = () => {
    setIsActive(false);
    setMode('idle');
    window.speechSynthesis.cancel();
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    setErrorMsg(null);
  };

  // Toggle Logic
  useEffect(() => {
    if (!recognizerRef.current) return;
    
    if (isMuted || isPaused || errorMsg) {
      recognizerRef.current.stop();
    } else if (isActive && mode === 'listening') {
      try {
        recognizerRef.current.start();
      } catch (e) {
        // Ignora erros de start se já estiver rodando
      }
    }
  }, [isMuted, isPaused, isActive, mode, errorMsg]);

  return (
    <div className="fixed inset-0 w-full h-full bg-[#080c14] overflow-hidden flex flex-col items-center justify-center font-sans">
      
      {!isActive ? (
        /* TELA INICIAL (IDLE) */
        <div className="z-10 flex flex-col items-center gap-8 animate-in fade-in zoom-in duration-700">
          <div className="relative group cursor-pointer" onClick={handleActivate}>
            <div className="absolute inset-0 bg-[#247AAE] rounded-full blur-xl opacity-40 group-hover:opacity-60 transition-opacity animate-pulse"></div>
            <button className="relative w-40 h-40 rounded-full border-2 border-[#247AAE]/50 flex items-center justify-center bg-[#0f172a] group-hover:scale-105 transition-transform duration-300">
              <div className="absolute inset-0 rounded-full border border-[#247AAE]/30 animate-ping-slow"></div>
              <div className="absolute inset-2 rounded-full border border-[#247AAE]/20 animate-ping-slower"></div>
              <span className="text-[#247AAE] font-bold text-lg tracking-[0.2em] group-hover:text-white transition-colors">ATIVAR</span>
            </button>
          </div>
          <h1 className="text-slate-500 text-sm font-medium tracking-widest uppercase">Axis AI • Gestão Inteligente</h1>
          
          {errorMsg && (
            <div className="px-4 py-2 bg-red-900/30 border border-red-800 text-red-300 text-xs rounded-lg max-w-sm text-center">
                {errorMsg}
            </div>
          )}
        </div>
      ) : (
        /* TELA ATIVA */
        <>
          {/* Fundo Canvas */}
          <ParticleCanvas mode={mode} />

          {/* Núcleo Central */}
          <SphereCore mode={mode} />

          {/* Transcrição em Tempo Real */}
          <div className="absolute top-1/4 w-full max-w-2xl px-6 text-center z-20">
            <p className={`text-lg md:text-2xl font-light leading-relaxed transition-colors duration-500 ${mode === 'speaking' ? 'text-amber-100/80' : 'text-blue-100/80'}`}>
              "{transcript || '...'}"
            </p>
          </div>

          {/* Controles */}
          <Controls 
            isMuted={isMuted}
            isPaused={isPaused}
            onToggleMute={() => setIsMuted(!isMuted)}
            onTogglePause={() => setIsPaused(!isPaused)}
            onStop={handleStop}
          />
        </>
      )}
    </div>
  );
}
