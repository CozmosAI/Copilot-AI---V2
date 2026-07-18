
import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, Square, Play, Save, Trash2, FileText, 
  Clock, Search, Download, Bot,
  Loader2, Copy, Check, User, Edit3, Sparkles, AlertCircle
} from 'lucide-react';
import { useApp } from '../App';
import { ConsultationRecording } from '../types';
import { generateSOAPFromTranscript } from '../services/geminiService';
import { supabase } from '../lib/supabase';
import { apiFetch, safeJsonResponse } from '../services/apiClient';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const Recorder: React.FC = () => {
  const { user, recordings, addRecording, updateRecording, deleteRecording } = useApp();
  
  // State: Recording Logic
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [permissionError, setPermissionError] = useState(false);
  
  // State: Transcription (Real-time)
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const finalTranscriptRef = useRef(''); 

  // State: Processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingText, setProcessingText] = useState('');
  const [activeRecording, setActiveRecording] = useState<ConsultationRecording | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Form State
  const [soapData, setSoapData] = useState({ s: '', o: '', a: '', p: '' });
  const [patientName, setPatientName] = useState('');
  
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // --- RECORDING TIMER ---
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  useEffect(() => {
    if (recordingTime >= 300 && isRecording) {
      stopRecording();
      alert("Limite de 5 minutos atingido. Parando gravação...");
    }
  }, [recordingTime, isRecording]);

  // Cleanup on unmount
  useEffect(() => {
      return () => {
          if (recognitionRef.current) {
              try { recognitionRef.current.abort(); } catch {}
          }
      };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopy = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const handleCopyFullReport = () => {
    if (!activeRecording) return;
    const text = `PACIENTE: ${patientName}\nDATA: ${activeRecording.date}\n\n=== TRANSCRIÇÃO ===\n${transcript}\n\n=== SOAP ===\n[S] SUBJETIVO:\n${soapData.s}\n\n[O] OBJETIVO:\n${soapData.o}\n\n[A] AVALIAÇÃO:\n${soapData.a}\n\n[P] PLANO:\n${soapData.p}`;
    handleCopy(text, 'full');
  };

  // --- RECORDING HANDLERS ---
  // Refs to avoid stale closures in recognition callbacks
  const isRecordingRef = useRef(false);
  const permissionErrorRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { permissionErrorRef.current = permissionError; }, [permissionError]);

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const startRecording = async () => {
    try {
      // 1. Pedir permissão de microfone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Reset States
      setPermissionError(false);
      setTranscript('');
      finalTranscriptRef.current = ''; 
      setRecordingTime(0);
      setActiveRecording(null); 
      setSoapData({ s: '', o: '', a: '', p: '' }); 
      setPatientName(patientName || 'Paciente Novo');
      setAudioChunks([]);
      audioChunksRef.current = [];

      // 2. Criar MediaRecorder com mimeType 'audio/webm' ou fallback
      let options = { mimeType: 'audio/webm' };
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/ogg' };
      }
      
      const recorder = new MediaRecorder(stream, options);
      setMediaRecorder(recorder);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          setAudioChunks(prev => {
            const updated = [...prev, event.data];
            audioChunksRef.current = updated;
            return updated;
          });
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        stream.getTracks().forEach(track => track.stop());
        await processRecording(audioBlob);
      };

      // Iniciar MediaRecorder
      recorder.start(1000);
      setIsRecording(true);

      // Iniciar SpeechRecognition em paralelo para suporte offline/fallback e tempo real
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        if (recognitionRef.current) {
          try { recognitionRef.current.abort(); } catch {}
          recognitionRef.current = null;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true; 
        recognition.interimResults = true;
        recognition.lang = 'pt-BR'; 

        recognition.onstart = () => {
            console.log("SpeechRecognition ao vivo iniciado");
        };

        recognition.onresult = (event: any) => {
          let interimTranscript = '';
          let newFinalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              newFinalTranscript += event.results[i][0].transcript + ' ';
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          if (newFinalTranscript) {
              finalTranscriptRef.current += newFinalTranscript;
          }
          setTranscript(finalTranscriptRef.current + interimTranscript);
        };

        recognition.onerror = (event: any) => {
          console.error("Erro na transcrição ao vivo:", event.error);
        };

        recognition.onend = () => {
          if (isRecordingRef.current) {
            try { recognition.start(); } catch {}
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      }

    } catch (err) {
      console.error("Erro de microfone:", err);
      setPermissionError(true);
      alert("Não foi possível acessar o microfone. Verifique as permissões do seu navegador.");
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.error("Erro ao parar gravador:", e);
      }
    }
    
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
  };

  const processRecording = async (blob: Blob) => {
    setIsProcessing(true);
    setProcessingText('Fazendo upload do áudio...');

    let audioUrl = '';
    const userId = user?.id || 'default_user';
    const timestamp = Date.now();
    const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
    const filePath = `${userId}/${timestamp}.${ext}`;

    try {
      // Upload do áudio pro bucket "recordings" no Supabase
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('recordings')
        .upload(filePath, blob, {
          contentType: blob.type,
          cacheControl: '3600',
          upsert: true
        });

      if (uploadErr) {
        console.error("Erro no upload do Supabase Storage:", uploadErr);
      } else {
        console.log("Upload realizado com sucesso:", uploadData);
        // Tenta obter signed URL ( bucket privado )
        try {
          const { data: signedData } = await supabase.storage
            .from('recordings')
            .createSignedUrl(filePath, 60 * 60 * 24 * 365); // 1 ano de validade
          if (signedData?.signedUrl) {
            audioUrl = signedData.signedUrl;
          }
        } catch (signedErr) {
          console.error("Erro ao gerar signed URL:", signedErr);
        }

        // Se não conseguir signed URL, tenta publicUrl
        if (!audioUrl) {
          const { data: publicUrlData } = supabase.storage
            .from('recordings')
            .getPublicUrl(filePath);
          audioUrl = publicUrlData?.publicUrl || '';
        }
      }
    } catch (err) {
      console.error("Falha geral no upload de áudio:", err);
    }

    // Transcrição com Gemini
    setProcessingText('Transcrevendo áudio...');
    let transcribedText = '';

    try {
      const base64Audio = await blobToBase64(blob);

      // Tenta chamar /api/gemini/transcribe se houver
      try {
        const response = await apiFetch('/api/gemini/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64Audio, mimeType: blob.type })
        });
        if (response.ok) {
          const result = await safeJsonResponse(response);
          if (result.text) {
            transcribedText = result.text;
          }
        }
      } catch (e) {
        console.log("Endpoint /api/gemini/transcribe não disponível, tentando SOAP direto com áudio.");
      }

      // Se não transcreveu por /api/gemini/transcribe, tenta SOAP direto com áudio
      if (!transcribedText) {
        try {
          const response = await apiFetch('/api/gemini/soap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio: base64Audio, mimeType: blob.type, transcript: '' })
          });
          if (response.ok) {
            const result = await safeJsonResponse(response);
            if (result.s || result.o || result.a || result.p) {
              setProcessingText('Gerando SOAP...');
              const soapResult = {
                s: result.s || '',
                o: result.o || '',
                a: result.a || '',
                p: result.p || ''
              };

              const newRecording: ConsultationRecording = {
                id: crypto.randomUUID(),
                patientName: patientName || `Consulta ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`,
                date: new Date().toISOString().split('T')[0],
                duration: formatTime(recordingTime),
                transcript: transcript || 'Áudio enviado para processamento.',
                soap: soapResult,
                audioUrl: audioUrl || undefined
              };

              addRecording(newRecording);
              setActiveRecording(newRecording);
              setSoapData(soapResult);
              setPatientName(newRecording.patientName);
              setIsProcessing(false);
              return;
            }
          }
        } catch (e) {
          console.log("Falha na chamada direta SOAP com áudio:", e);
        }
      }

    } catch (err) {
      console.error("Erro ao converter ou enviar áudio:", err);
    }

    // Fallback para transcrição local obtida pelo SpeechRecognition
    if (!transcribedText) {
      transcribedText = transcript || finalTranscriptRef.current;
    }

    if (!transcribedText.trim()) {
      setIsProcessing(false);
      alert("Erro ao transcrever áudio. Certifique-se de que o microfone está captando som.");
      return;
    }

    setTranscript(transcribedText);

    // Gerar SOAP
    setProcessingText('Gerando SOAP...');
    try {
      const soapResult = await generateSOAPFromTranscript(transcribedText);

      // Salvar gravação no estado
      const newRecording: ConsultationRecording = {
        id: crypto.randomUUID(),
        patientName: patientName || `Consulta ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`,
        date: new Date().toISOString().split('T')[0],
        duration: formatTime(recordingTime),
        transcript: transcribedText,
        soap: soapResult,
        audioUrl: audioUrl || undefined
      };

      addRecording(newRecording);
      setActiveRecording(newRecording);
      setSoapData(soapResult);
      setPatientName(newRecording.patientName);

    } catch (e) {
      console.error("Erro ao gerar SOAP:", e);
      alert("Erro ao gerar SOAP");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNewRecording = () => {
    setActiveRecording(null);
    setSoapData({ s: '', o: '', a: '', p: '' });
    setTranscript('');
    setPatientName('');
    setRecordingTime(0);
  };

  const handleDelete = (id: string) => {
      if (confirm('Excluir esta gravação?')) {
          deleteRecording(id);
          if (activeRecording?.id === id) setActiveRecording(null);
      }
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-navy flex items-center gap-2">
             Gravador de Consultas <span className="bg-blue-100 text-blue-700 text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider font-black">IA Beta</span>
          </h2>
          <p className="text-slate-500 text-sm mt-1">Transcreva áudio e gere prontuários SOAP automaticamente.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* LEFT COLUMN: RECORDER & TRANSCRIPT */}
        <div className="space-y-6">
            
            {/* RECORDER CARD */}
            <div className={`bg-white rounded-3xl p-8 text-center border transition-all shadow-sm ${isRecording ? 'border-red-200 shadow-red-100' : 'border-slate-200'}`}>
                
                {permissionError && (
                    <div className="mb-6 p-3 bg-red-50 border border-red-100 rounded-xl flex items-center justify-center gap-2 text-red-600 text-xs font-bold">
                        <AlertCircle size={16}/> Acesso ao microfone negado pelo navegador.
                    </div>
                )}

                <div className="mb-8 relative inline-block">
                    {isRecording && (
                        <span className="absolute -top-2 -right-2 flex h-4 w-4">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500"></span>
                        </span>
                    )}
                    <div className={`w-24 h-24 rounded-[30px] flex items-center justify-center transition-all duration-500 ${isRecording ? 'bg-red-50 text-red-500 scale-110 shadow-xl shadow-red-100' : 'bg-slate-50 text-slate-400'}`}>
                        <Mic size={40} className={isRecording ? 'animate-pulse text-red-500' : ''} />
                    </div>
                </div>

                <div className="text-4xl font-black text-navy font-mono mb-2 tracking-widest">
                    {formatTime(recordingTime)}
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em] mb-8">
                    {isRecording ? `Gravando... (${recordingTime}s)` : 'Pronto para Iniciar'}
                </p>

                {!isRecording ? (
                    <button 
                        onClick={startRecording}
                        className="w-full bg-red-500 hover:bg-red-600 text-white py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all shadow-xl shadow-red-100 flex items-center justify-center gap-3 active:scale-95"
                    >
                        <Play size={16} fill="currentColor" className="text-white" /> Iniciar Gravação
                    </button>
                ) : (
                    <button 
                        onClick={stopRecording}
                        className="w-full bg-red-600 text-white py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-red-700 transition-all shadow-xl shadow-red-200 flex items-center justify-center gap-3 active:scale-95 animate-pulse"
                    >
                        <Square size={16} fill="currentColor" /> Parar & Processar
                    </button>
                )}
            </div>

            {/* LIVE TRANSCRIPT */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm flex flex-col h-[400px] overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 className="text-xs font-bold text-navy uppercase tracking-widest flex items-center gap-2">
                        <FileText size={14} className="text-blue-500"/> Transcrição
                    </h3>
                    {isRecording && <span className="text-[9px] font-bold text-red-500 animate-pulse">● Ao Vivo</span>}
                </div>
                <div className="flex-1 p-6 overflow-y-auto custom-scrollbar bg-slate-50/30">
                    {transcript ? (
                        <p className="text-sm text-slate-600 leading-loose font-medium whitespace-pre-wrap">
                            {transcript}
                        </p>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-50">
                            <Bot size={32} className="mb-2"/>
                            <p className="text-xs font-bold uppercase tracking-widest">Aguardando fala...</p>
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* RIGHT COLUMN: HISTORY & SOAP */}
        <div className="space-y-6">
            
            {/* HISTORY LIST (Compact) */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 max-h-[300px] flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xs font-bold text-navy uppercase tracking-widest flex items-center gap-2"><Clock size={14}/> Histórico</h3>
                    <div className="bg-slate-100 rounded-lg px-2 py-1 flex items-center gap-2 w-40">
                        <Search size={12} className="text-slate-400"/>
                        <input className="bg-transparent text-[10px] w-full outline-none font-medium" placeholder="Buscar paciente..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                    {recordings.length === 0 ? (
                        <div className="text-center py-8 text-slate-300">
                            <FileText size={24} className="mx-auto mb-2 opacity-50"/>
                            <p className="text-[9px] font-bold uppercase">Nenhuma gravação</p>
                        </div>
                    ) : (
                        recordings.filter(r => r.patientName.toLowerCase().includes(searchTerm.toLowerCase())).map(rec => (
                            <div key={rec.id} onClick={() => { setActiveRecording(rec); setSoapData(rec.soap); setTranscript(rec.transcript || ''); setPatientName(rec.patientName); }} 
                                 className={`p-3 rounded-xl border cursor-pointer transition-all flex justify-between items-center group ${activeRecording?.id === rec.id ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-100' : 'bg-slate-50 border-slate-100 hover:border-blue-200'}`}>
                                <div>
                                    <p className="text-xs font-bold text-navy">{rec.patientName}</p>
                                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">{rec.date} • {rec.duration}</p>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); handleDelete(rec.id); }} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={12}/></button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* SOAP RESULT CARD / LOADER */}
            {(activeRecording || isProcessing) ? (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden animate-in slide-in-from-bottom-4 relative">
                    {isProcessing && (
                        <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-20 flex flex-col items-center justify-center min-h-[400px]">
                            <Loader2 size={36} className="text-blue-600 animate-spin mb-4"/>
                            <p className="text-sm font-bold text-slate-800 uppercase tracking-widest animate-pulse">{processingText}</p>
                        </div>
                    )}

                    <div className="bg-gradient-to-r from-[#0f172a] to-[#1e293b] p-6 text-white flex justify-between items-start">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <Sparkles size={14} className="text-yellow-400"/>
                                <span className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">Prontuário Inteligente</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <input 
                                    value={patientName} 
                                    onChange={(e) => setPatientName(e.target.value)} 
                                    className="bg-transparent border-b border-white/20 text-xl font-bold text-white focus:outline-none focus:border-white w-48 placeholder-white/50" 
                                    placeholder="Nome do Paciente"
                                />
                                <button onClick={() => activeRecording && updateRecording({...activeRecording, patientName})} className="text-white/50 hover:text-white"><Edit3 size={14}/></button>
                            </div>
                        </div>
                        <button onClick={handleCopyFullReport} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white" title="Copiar Tudo">
                            {copiedSection === 'full' ? <Check size={16}/> : <Copy size={16}/>}
                        </button>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Audio Player if audioUrl is available */}
                        {activeRecording?.audioUrl && (
                            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-inner">
                                <div className="flex items-center gap-2 text-slate-600 text-xs font-bold uppercase tracking-wider">
                                    <Mic size={14} className="text-red-500 animate-pulse" /> Áudio Original
                                </div>
                                <audio src={activeRecording.audioUrl} controls className="h-8 max-w-full rounded-lg" />
                            </div>
                        )}

                        {/* SOAP GRID */}
                        <div className="grid grid-cols-1 gap-4">
                            {[
                                { id: 's', label: 'Subjetivo (Queixa)', icon: <User size={14}/>, color: 'text-blue-600', bg: 'bg-blue-50' },
                                { id: 'o', label: 'Objetivo (Exame)', icon: <Search size={14}/>, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                                { id: 'a', label: 'Avaliação (Diagnóstico)', icon: <Clock size={14}/>, color: 'text-amber-600', bg: 'bg-amber-50' },
                                { id: 'p', label: 'Plano (Conduta)', icon: <FileText size={14}/>, color: 'text-indigo-600', bg: 'bg-indigo-50' }
                            ].map((section) => (
                                <div key={section.id} className="relative group">
                                    <div className={`flex items-center gap-2 mb-2 ${section.color}`}>
                                        <div className={`p-1.5 rounded-md ${section.bg}`}>{section.icon}</div>
                                        <h4 className="text-[10px] font-black uppercase tracking-widest">{section.label}</h4>
                                    </div>
                                    <textarea 
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium leading-relaxed resize-none h-24 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                                        value={(soapData as any)[section.id] || ''}
                                        onChange={(e) => setSoapData({...soapData, [section.id]: e.target.value})}
                                    />
                                    <button 
                                        onClick={() => handleCopy((soapData as any)[section.id] || '', section.id)}
                                        className="absolute top-8 right-2 p-1.5 bg-white shadow-sm border border-slate-100 rounded-lg text-slate-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                        {copiedSection === section.id ? <Check size={12}/> : <Copy size={12}/>}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                    
                    <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between gap-2">
                        <button 
                            onClick={handleNewRecording}
                            className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2"
                        >
                            <Trash2 size={14}/> Nova Gravação
                        </button>
                        <button 
                            onClick={() => { activeRecording && updateRecording({...activeRecording, patientName, soap: soapData}); alert('Salvo!'); }}
                            className="bg-navy text-white px-6 py-2 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-all flex items-center gap-2"
                        >
                            <Save size={14}/> Salvar Alterações
                        </button>
                    </div>
                </div>
            ) : (
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center text-slate-400 flex flex-col items-center justify-center h-[400px]">
                    <Bot size={40} className="mb-3 text-slate-300"/>
                    <h4 className="text-sm font-bold text-navy uppercase tracking-widest mb-1">Visualização do SOAP</h4>
                    <p className="text-xs text-slate-400 max-w-xs leading-relaxed">Inicie uma gravação ou selecione uma consulta do histórico ao lado para gerar o prontuário automatizado.</p>
                </div>
            )}

        </div>
      </div>
    </div>
  );
};

export default Recorder;
