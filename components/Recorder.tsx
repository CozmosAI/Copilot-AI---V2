
import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, Square, Play, Save, Trash2, FileText, 
  Clock, Search, Download, Bot,
  Loader2, Copy, Check, User, Edit3, Sparkles
} from 'lucide-react';
import { useApp } from '../App';
import { ConsultationRecording } from '../types';
import { generateSOAPFromTranscript } from '../services/geminiService';

// Declaração de tipos para a API de Reconhecimento de Voz do navegador
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const Recorder: React.FC = () => {
  const { recordings, addRecording, updateRecording, deleteRecording } = useApp();
  
  // State: Recording Logic
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  
  // State: Transcription (Real-time)
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const finalTranscriptRef = useRef(''); 

  // State: Processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeRecording, setActiveRecording] = useState<ConsultationRecording | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Form State (SOAP Editing)
  const [soapData, setSoapData] = useState({ s: '', o: '', a: '', p: '' });
  const [patientName, setPatientName] = useState('');
  
  // State: Feedback de Cópia
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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // --- HELPER: COPY TO CLIPBOARD ---
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
  const startRecording = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Seu navegador não suporta transcrição de voz nativa. Tente usar o Google Chrome ou Edge.");
      return;
    }

    setTranscript('');
    finalTranscriptRef.current = ''; 
    setRecordingTime(0);
    setActiveRecording(null); 
    setSoapData({ s: '', o: '', a: '', p: '' }); 
    setPatientName('Paciente Novo');

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true; 
      recognition.interimResults = true;
      recognition.lang = 'pt-BR'; 

      recognition.onstart = () => setIsRecording(true);

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
        console.error("Speech Recognition Error", event.error);
        if (event.error === 'not-allowed') {
            alert("Acesso ao microfone negado. Verifique as permissões do navegador.");
            setIsRecording(false);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;

    } catch (err) {
      console.error(err);
      alert("Erro ao acessar microfone.");
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    setTimeout(() => {
        if (finalTranscriptRef.current.trim() || transcript.trim()) {
            handleProcessing();
        }
    }, 1000);
  };

  // --- PROCESSING ---
  const handleProcessing = async () => {
    const textToProcess = finalTranscriptRef.current || transcript;

    if (!textToProcess.trim()) {
        alert("Nenhuma fala detectada. O microfone captou áudio?");
        return;
    }

    setIsProcessing(true);

    try {
      const soapResult = await generateSOAPFromTranscript(textToProcess);
      
      const newRecording: ConsultationRecording = {
        id: crypto.randomUUID(),
        patientName: patientName || `Consulta ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`,
        date: new Date().toISOString().split('T')[0],
        duration: formatTime(recordingTime),
        transcript: textToProcess, 
        soap: soapResult
      };

      addRecording(newRecording);
      setActiveRecording(newRecording);
      setSoapData(soapResult);
      setPatientName(newRecording.patientName);
      setTranscript(textToProcess); 

    } catch (e) {
      alert("Erro ao gerar SOAP com IA.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelectRecording = (rec: ConsultationRecording) => {
    setActiveRecording(rec);
    setSoapData(rec.soap);
    setPatientName(rec.patientName);
    setTranscript(rec.transcript || '');
    finalTranscriptRef.current = rec.transcript || '';
  };

  const handleSaveSOAP = () => {
    if (activeRecording) {
      updateRecording({
        ...activeRecording,
        patientName,
        soap: soapData,
        transcript: transcript
      });
      alert("Registro salvo com sucesso!");
    }
  };

  const handleDownload = () => {
    if (!activeRecording) return;
    const text = `PACIENTE: ${patientName}\nDATA: ${activeRecording.date}\n\n=== TRANSCRIÇÃO ===\n${transcript}\n\n=== SOAP ===\n[S] SUBJETIVO:\n${soapData.s}\n\n[O] OBJETIVO:\n${soapData.o}\n\n[A] AVALIAÇÃO:\n${soapData.a}\n\n[P] PLANO:\n${soapData.p}`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SOAP-${patientName.replace(/ /g, '_')}.txt`;
    a.click();
  };

  const filteredRecordings = recordings.filter(r => 
    r.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.date.includes(searchTerm)
  );

  return (
    <div className="h-[calc(100vh-100px)] flex flex-col gap-6 animate-in fade-in duration-500 pb-6">
      
      {/* HEADER SIMPLES */}
      <header className="flex justify-between items-end shrink-0 px-1">
        <div>
          <h2 className="text-2xl font-bold text-navy flex items-center gap-2">
            Gravador de Consultas 
            <span className="bg-indigo-50 text-indigo-600 text-[10px] font-black px-2 py-0.5 rounded-full uppercase border border-indigo-100">IA Beta</span>
          </h2>
          <p className="text-slate-500 text-sm mt-1">Transcreva áudio e gere prontuários SOAP automaticamente.</p>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
        
        {/* SIDEBAR: RECORDER & LIST (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6 overflow-hidden">
          
          {/* CARTÃO DO GRAVADOR */}
          <div className="bg-white p-8 rounded-[24px] border border-slate-200 shadow-sm shrink-0 relative overflow-hidden group">
             {/* Efeitos de Fundo */}
             {isRecording && (
                <>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-red-100/50 rounded-full animate-ping pointer-events-none"></div>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-red-100 rounded-full animate-pulse pointer-events-none"></div>
                </>
             )}
             
             <div className="text-center relative z-10">
                <div className={`w-20 h-20 mx-auto rounded-2xl flex items-center justify-center transition-all duration-500 ${isRecording ? 'bg-red-500 shadow-xl shadow-red-500/30 scale-110 rotate-3' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'}`}>
                   <Mic size={32} className={isRecording ? 'text-white' : 'text-slate-500'} />
                </div>
                
                <div className="mt-6 mb-6">
                   <h3 className={`text-4xl font-black font-mono tracking-wider tabular-nums ${isRecording ? 'text-navy' : 'text-slate-300'}`}>
                      {formatTime(recordingTime)}
                   </h3>
                   <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">
                      {isRecording ? 'Gravando Áudio...' : 'Pronto para Iniciar'}
                   </p>
                </div>

                <div className="flex gap-3 justify-center">
                   {!isRecording ? (
                      <button onClick={startRecording} className="w-full bg-navy text-white py-3.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-all flex items-center justify-center gap-2 group/btn">
                         <Play size={14} fill="currentColor" className="group-hover/btn:translate-x-0.5 transition-transform"/> Iniciar Consulta
                      </button>
                   ) : (
                      <button onClick={stopRecording} className="w-full bg-red-500 text-white py-3.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:bg-red-600 transition-all flex items-center justify-center gap-2 animate-pulse">
                         <Square size={14} fill="currentColor"/> Parar Gravação
                      </button>
                   )}
                </div>
             </div>
             
             {/* TRANSCRIÇÃO AO VIVO (MINI) */}
             {isRecording && (
                 <div className="mt-6 pt-4 border-t border-slate-100">
                    <p className="text-[9px] text-slate-400 font-bold uppercase mb-2 flex items-center gap-1"><Sparkles size={10} className="text-amber-400"/> Detectando fala:</p>
                    <p className="text-xs text-slate-600 italic leading-relaxed line-clamp-3 bg-slate-50 p-2 rounded-lg border border-slate-100">
                        "{transcript || '...'}"
                    </p>
                 </div>
             )}
          </div>

          {/* LISTA DE HISTÓRICO */}
          <div className="flex-1 bg-white rounded-[24px] border border-slate-200 shadow-sm flex flex-col overflow-hidden">
             <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-navy uppercase tracking-widest flex items-center gap-2">
                       <Clock size={14} className="text-slate-400"/> Histórico
                    </h3>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-200/50 px-2 py-0.5 rounded-full">{recordings.length}</span>
                </div>
                <div className="relative">
                   <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                   <input 
                      type="text" 
                      placeholder="Buscar paciente..." 
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-navy focus:ring-1 focus:ring-navy transition-all placeholder:text-slate-300"
                   />
                </div>
             </div>
             
             <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                {filteredRecordings.length === 0 ? (
                   <div className="text-center py-12 text-slate-300">
                      <FileText size={32} className="mx-auto mb-3 opacity-30"/>
                      <p className="text-[10px] font-bold uppercase tracking-widest">Nenhuma gravação</p>
                   </div>
                ) : filteredRecordings.map(rec => (
                   <div 
                      key={rec.id} 
                      onClick={() => handleSelectRecording(rec)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer group relative ${activeRecording?.id === rec.id ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'}`}
                   >
                      <div className="flex justify-between items-start mb-1">
                         <h4 className={`text-xs font-bold truncate pr-6 ${activeRecording?.id === rec.id ? 'text-blue-700' : 'text-slate-700'}`}>{rec.patientName}</h4>
                         {activeRecording?.id === rec.id && <div className="w-2 h-2 rounded-full bg-blue-500 absolute right-3 top-4"></div>}
                      </div>
                      <div className="flex justify-between items-center mt-1">
                         <span className="text-[10px] text-slate-400 font-medium">{rec.date.split('-').reverse().join('/')}</span>
                         <div className="flex items-center gap-2">
                             <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">{rec.duration}</span>
                             <button onClick={(e) => { e.stopPropagation(); deleteRecording(rec.id); }} className="text-slate-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100">
                                <Trash2 size={12}/>
                             </button>
                         </div>
                      </div>
                   </div>
                ))}
             </div>
          </div>
        </div>

        {/* EDITOR AREA (8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-[24px] border border-slate-200 shadow-sm flex flex-col overflow-hidden relative">
           
           {/* LOADING OVERLAY */}
           {isProcessing && (
              <div className="absolute inset-0 bg-white/95 backdrop-blur-md z-30 flex flex-col items-center justify-center text-navy animate-in fade-in duration-300">
                 <div className="relative">
                     <div className="w-16 h-16 border-4 border-slate-100 border-t-blue-600 rounded-full animate-spin"></div>
                     <Bot size={24} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-600" />
                 </div>
                 <h3 className="text-lg font-bold mt-6">Gerando SOAP com IA...</h3>
                 <p className="text-xs text-slate-500 font-medium uppercase tracking-widest mt-2">Analisando contexto médico e estruturando dados</p>
              </div>
           )}

           {!activeRecording ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300 p-10 text-center bg-slate-50/30">
                 <div className="w-24 h-24 bg-white border border-slate-100 rounded-full flex items-center justify-center mb-6 shadow-sm">
                    <FileText size={40} className="text-slate-200"/>
                 </div>
                 <h3 className="text-lg font-bold text-navy mb-2">Prontuário Inteligente</h3>
                 <p className="text-sm max-w-xs mx-auto leading-relaxed text-slate-500">Selecione uma gravação à esquerda ou inicie uma nova consulta para ver o SOAP gerado automaticamente.</p>
              </div>
           ) : (
              <>
                 {/* EDITOR HEADER */}
                 <div className="px-8 py-6 border-b border-slate-100 bg-white sticky top-0 z-20 shadow-[0_2px_15px_-10px_rgba(0,0,0,0.1)]">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                        <div className="w-full">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Nome do Paciente</label>
                            <div className="relative group">
                                <input 
                                    type="text" 
                                    value={patientName} 
                                    onChange={(e) => setPatientName(e.target.value)}
                                    className="text-2xl font-black text-navy w-full bg-transparent border-none p-0 focus:ring-0 placeholder:text-slate-200 transition-colors"
                                    placeholder="Nome do Paciente"
                                />
                                <Edit3 size={16} className="absolute -right-6 top-1/2 -translate-y-1/2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"/>
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 flex items-center gap-1">
                                    <Bot size={10}/> Gerado por IA
                                </span>
                                <span className="text-[10px] text-slate-400 font-medium">
                                    {activeRecording.date.split('-').reverse().join('/')} • {activeRecording.duration}
                                </span>
                            </div>
                        </div>
                        
                        <div className="flex gap-2 shrink-0">
                           <button onClick={handleCopyFullReport} className="h-9 px-4 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-navy hover:border-slate-300 flex items-center gap-2 transition-all">
                              {copiedSection === 'full' ? <Check size={14} className="text-emerald-500"/> : <Copy size={14}/>} 
                              <span className="hidden sm:inline">{copiedSection === 'full' ? 'Copiado!' : 'Copiar Tudo'}</span>
                           </button>
                           <button onClick={handleDownload} className="h-9 px-4 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-navy hover:border-slate-300 flex items-center gap-2 transition-all">
                              <Download size={14}/> 
                              <span className="hidden sm:inline">Baixar</span>
                           </button>
                           <button onClick={handleSaveSOAP} className="h-9 px-6 bg-navy text-white rounded-lg text-xs font-bold uppercase tracking-widest shadow-md hover:bg-slate-800 flex items-center gap-2 transition-all hover:scale-105 active:scale-95">
                              <Save size={14}/> Salvar
                           </button>
                        </div>
                    </div>
                 </div>

                 {/* CONTENT SCROLL */}
                 <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-8 bg-slate-50/30">
                    
                    {/* TRANSCRIPTION BLOCK */}
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden group focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                <Mic size={12}/> Transcrição Original
                            </h4>
                            <button 
                                onClick={() => handleCopy(transcript, 'transcript')}
                                className="text-[9px] font-bold text-slate-400 hover:text-blue-600 bg-white border border-slate-200 px-2 py-1 rounded flex items-center gap-1 transition-colors"
                            >
                                {copiedSection === 'transcript' ? <Check size={10} className="text-emerald-500"/> : <Copy size={10}/>} Copiar
                            </button>
                        </div>
                        <textarea
                            value={transcript}
                            onChange={(e) => setTranscript(e.target.value)}
                            className="w-full p-4 text-xs text-slate-600 leading-relaxed min-h-[100px] border-none focus:ring-0 resize-none bg-transparent"
                            placeholder="A transcrição aparecerá aqui..."
                        />
                    </div>

                    {/* SOAP GRID */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                       
                       {/* SUBJETIVO */}
                       <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col focus-within:ring-2 focus-within:ring-blue-500/20 transition-all group hover:border-blue-200">
                          <div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100 flex justify-between items-center">
                              <label className="flex items-center gap-2 text-xs font-black text-blue-700 uppercase tracking-widest">
                                 <span className="w-5 h-5 rounded bg-blue-100 text-blue-600 flex items-center justify-center text-[10px]">S</span> Subjetivo
                              </label>
                              <button onClick={() => handleCopy(soapData.s, 's')} className="text-blue-300 hover:text-blue-600 transition-colors">
                                {copiedSection === 's' ? <Check size={14} className="text-emerald-500"/> : <Copy size={14}/>}
                              </button>
                          </div>
                          <textarea 
                             value={soapData.s}
                             onChange={e => setSoapData({...soapData, s: e.target.value})}
                             className="w-full flex-1 p-4 text-sm text-slate-700 leading-relaxed border-none focus:ring-0 resize-none bg-transparent h-48"
                             placeholder="Histórico, queixas..."
                          />
                       </div>

                       {/* OBJETIVO */}
                       <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all group hover:border-emerald-200">
                          <div className="px-4 py-3 bg-emerald-50/50 border-b border-emerald-100 flex justify-between items-center">
                              <label className="flex items-center gap-2 text-xs font-black text-emerald-700 uppercase tracking-widest">
                                 <span className="w-5 h-5 rounded bg-emerald-100 text-emerald-600 flex items-center justify-center text-[10px]">O</span> Objetivo
                              </label>
                              <button onClick={() => handleCopy(soapData.o, 'o')} className="text-emerald-300 hover:text-emerald-600 transition-colors">
                                {copiedSection === 'o' ? <Check size={14} className="text-emerald-500"/> : <Copy size={14}/>}
                              </button>
                          </div>
                          <textarea 
                             value={soapData.o}
                             onChange={e => setSoapData({...soapData, o: e.target.value})}
                             className="w-full flex-1 p-4 text-sm text-slate-700 leading-relaxed border-none focus:ring-0 resize-none bg-transparent h-48"
                             placeholder="Exames, sinais vitais..."
                          />
                       </div>

                       {/* AVALIAÇÃO */}
                       <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col focus-within:ring-2 focus-within:ring-amber-500/20 transition-all group hover:border-amber-200">
                          <div className="px-4 py-3 bg-amber-50/50 border-b border-amber-100 flex justify-between items-center">
                              <label className="flex items-center gap-2 text-xs font-black text-amber-700 uppercase tracking-widest">
                                 <span className="w-5 h-5 rounded bg-amber-100 text-amber-600 flex items-center justify-center text-[10px]">A</span> Avaliação
                              </label>
                              <button onClick={() => handleCopy(soapData.a, 'a')} className="text-amber-300 hover:text-amber-600 transition-colors">
                                {copiedSection === 'a' ? <Check size={14} className="text-emerald-500"/> : <Copy size={14}/>}
                              </button>
                          </div>
                          <textarea 
                             value={soapData.a}
                             onChange={e => setSoapData({...soapData, a: e.target.value})}
                             className="w-full flex-1 p-4 text-sm text-slate-700 leading-relaxed border-none focus:ring-0 resize-none bg-transparent h-48"
                             placeholder="Diagnóstico, hipóteses..."
                          />
                       </div>

                       {/* PLANO */}
                       <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col focus-within:ring-2 focus-within:ring-purple-500/20 transition-all group hover:border-purple-200">
                          <div className="px-4 py-3 bg-purple-50/50 border-b border-purple-100 flex justify-between items-center">
                              <label className="flex items-center gap-2 text-xs font-black text-purple-700 uppercase tracking-widest">
                                 <span className="w-5 h-5 rounded bg-purple-100 text-purple-600 flex items-center justify-center text-[10px]">P</span> Plano
                              </label>
                              <button onClick={() => handleCopy(soapData.p, 'p')} className="text-purple-300 hover:text-purple-600 transition-colors">
                                {copiedSection === 'p' ? <Check size={14} className="text-emerald-500"/> : <Copy size={14}/>}
                              </button>
                          </div>
                          <textarea 
                             value={soapData.p}
                             onChange={e => setSoapData({...soapData, p: e.target.value})}
                             className="w-full flex-1 p-4 text-sm text-slate-700 leading-relaxed border-none focus:ring-0 resize-none bg-transparent h-48"
                             placeholder="Tratamento, receitas, retorno..."
                          />
                       </div>

                    </div>
                 </div>
              </>
           )}
        </div>

      </div>
    </div>
  );
};

export default Recorder;
