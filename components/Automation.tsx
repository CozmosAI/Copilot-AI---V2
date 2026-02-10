
import React, { useState } from 'react';
import { 
  ToggleLeft as Toggle, 
  ToggleRight as ToggleOn, 
  MessageSquare, 
  ArrowLeft, 
  Upload,
  Clock,
  ShieldCheck,
  Zap,
  ChevronRight,
  Brain,
  FileText,
  Database,
  Calendar,
  Check
} from 'lucide-react';
import { useApp } from '../App';

type AutomationView = 'selection' | 'atendimento' | 'followup';

const Automation: React.FC = () => {
  const { aiConfig, updateAiConfig } = useApp();
  const [currentView, setCurrentView] = useState<AutomationView>('selection');
  const [success, setSuccess] = useState(false);

  const handleSave = () => {
    // Simula salvamento
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2000);
  };

  // Render selection screen
  if (currentView === 'selection') {
    return (
      <div className="space-y-8 animate-in fade-in duration-500 pb-20">
        <header>
          <h2 className="text-2xl font-bold text-navy">Automações Inteligentes</h2>
          <p className="text-slate-500">Selecione qual módulo de inteligência deseja configurar.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <button 
            onClick={() => setCurrentView('atendimento')}
            className="group bg-white p-8 rounded-3xl border border-slate-200 shadow-sm hover:border-blue-400 hover:shadow-md transition-all text-left flex flex-col items-start gap-4 relative overflow-hidden"
          >
            <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-colors z-10">
              <MessageSquare size={32} />
            </div>
            <div className="z-10">
              <h3 className="text-xl font-bold text-navy mb-2">IA de Atendimento (SDR)</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Configure uma assistente virtual para acolher pacientes, tirar dúvidas e realizar a triagem inicial via WhatsApp.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-2 text-blue-600 font-bold text-xs uppercase tracking-wider z-10">
              Configurar Agora <ChevronRight size={14} />
            </div>
            <div className="absolute right-0 bottom-0 opacity-5 transform translate-x-4 translate-y-4 group-hover:scale-110 transition-transform">
               <Brain size={120} />
            </div>
          </button>

          <button 
            onClick={() => setCurrentView('followup')}
            className="group bg-white p-8 rounded-3xl border border-slate-200 shadow-sm hover:border-indigo-400 hover:shadow-md transition-all text-left flex flex-col items-start gap-4 opacity-70 grayscale"
            disabled
          >
            <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl">
              <Clock size={32} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-navy mb-2">IA de Follow-up (CRM)</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Recupere orçamentos perdidos e reative pacientes sumidos. <br/> (Em breve)
              </p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // Render Atendimento Configuration
  if (currentView === 'atendimento') {
    return (
      <div className="space-y-6 animate-in slide-in-from-right duration-500 pb-24">
        {/* Header */}
        <header className="flex items-center justify-between sticky top-0 bg-[#f1f5f9] z-20 py-4">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setCurrentView('selection')}
              className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="text-2xl font-bold text-navy">IA de Atendimento</h2>
              <p className="text-slate-500 text-sm">Personalize o cérebro e as regras da sua assistente.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
             <span className={`text-xs font-bold uppercase tracking-wider px-2 ${aiConfig.active ? 'text-emerald-600' : 'text-slate-400'}`}>
                {aiConfig.active ? 'IA Ativa' : 'IA Pausada'}
             </span>
             <button onClick={() => updateAiConfig({ active: !aiConfig.active })} className="transition-all">
                {aiConfig.active ? <ToggleOn size={40} className="text-emerald-500" /> : <Toggle size={40} className="text-slate-300" />}
             </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* COLUNA ESQUERDA: CÉREBRO DA IA */}
            <div className="space-y-6">
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Brain size={20}/></div>
                        <h3 className="font-bold text-navy uppercase tracking-widest text-xs">Identidade & Comportamento</h3>
                    </div>
                    
                    <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Nome da IA</label>
                                <input 
                                    type="text" 
                                    value={aiConfig.name} 
                                    onChange={e => updateAiConfig({ name: e.target.value })} 
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:border-blue-500 transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Função Principal</label>
                                <select 
                                    value={aiConfig.role}
                                    onChange={e => updateAiConfig({ role: e.target.value })}
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:border-blue-500 transition-all appearance-none"
                                >
                                    <option>SDR (Pré-vendas)</option>
                                    <option>Secretária Agendadora</option>
                                    <option>Tira-Dúvidas (Suporte)</option>
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Prompt Principal (Instruções)</label>
                            <textarea 
                                value={aiConfig.prompt}
                                onChange={e => updateAiConfig({ prompt: e.target.value })}
                                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm text-navy h-40 focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
                                placeholder="Descreva como a IA deve agir..."
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-rose-400 uppercase flex items-center gap-1"><ShieldCheck size={12}/> Regras de Ouro (O que NÃO fazer)</label>
                            <textarea 
                                value={aiConfig.negativePrompt}
                                onChange={e => updateAiConfig({ negativePrompt: e.target.value })}
                                className="w-full p-4 bg-rose-50 border border-rose-100 rounded-xl text-sm text-rose-900 h-24 focus:outline-none focus:border-rose-300 resize-none leading-relaxed placeholder:text-rose-300"
                                placeholder="Ex: Não dar diagnósticos, não prometer cura..."
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* COLUNA DIREITA: CONTEXTO E OPERAÇÃO */}
            <div className="space-y-6">
                
                {/* FONTE DE DADOS */}
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Database size={20}/></div>
                        <h3 className="font-bold text-navy uppercase tracking-widest text-xs">Base de Conhecimento (Contexto)</h3>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-white rounded-lg shadow-sm text-slate-400"><FileText size={16}/></div>
                                <div>
                                    <p className="text-xs font-bold text-navy">Documentos de Apoio</p>
                                    <p className="text-[10px] text-slate-400">PDFs de tabela de preços, convênios...</p>
                                </div>
                            </div>
                            <button className="text-[10px] font-bold text-blue-600 bg-white border border-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-50 flex items-center gap-1">
                                <Upload size={12}/> Upload
                            </button>
                        </div>

                        <div className="space-y-2 pt-2">
                            <label className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors">
                                <div className="flex items-center gap-3">
                                    <ToggleOn size={24} className={aiConfig.useProfile ? "text-emerald-500" : "text-slate-300"} />
                                    <span className="text-sm font-medium text-navy">Ler dados do meu Perfil</span>
                                </div>
                                <input type="checkbox" checked={aiConfig.useProfile} onChange={e => updateAiConfig({ useProfile: e.target.checked })} className="hidden" />
                            </label>
                            
                            <label className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors">
                                <div className="flex items-center gap-3">
                                    <ToggleOn size={24} className={aiConfig.useCRM ? "text-emerald-500" : "text-slate-300"} />
                                    <span className="text-sm font-medium text-navy">Ler status do lead no CRM</span>
                                </div>
                                <input type="checkbox" checked={aiConfig.useCRM} onChange={e => updateAiConfig({ useCRM: e.target.checked })} className="hidden" />
                            </label>

                            <label className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors">
                                <div className="flex items-center gap-3">
                                    <ToggleOn size={24} className={aiConfig.useHistory ? "text-emerald-500" : "text-slate-300"} />
                                    <span className="text-sm font-medium text-navy">Memória de conversas anteriores</span>
                                </div>
                                <input type="checkbox" checked={aiConfig.useHistory} onChange={e => updateAiConfig({ useHistory: e.target.checked })} className="hidden" />
                            </label>
                        </div>
                    </div>
                </div>

                {/* OPERACIONAL */}
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-amber-50 text-amber-600 rounded-lg"><Calendar size={20}/></div>
                        <h3 className="font-bold text-navy uppercase tracking-widest text-xs">Configuração Operacional</h3>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-2">Quando a IA deve responder?</label>
                            <select 
                                value={aiConfig.triggerType}
                                onChange={e => updateAiConfig({ triggerType: e.target.value as any })}
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:border-amber-500 appearance-none"
                            >
                                <option value="off_hours">Apenas fora do horário comercial</option>
                                <option value="always">24h por dia (Imediato)</option>
                                <option value="delay">Sempre, mas com atraso (Humanizado)</option>
                            </select>
                        </div>

                        {aiConfig.triggerType === 'off_hours' && (
                            <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 uppercase">Início Expediente</label>
                                    <input type="time" value={aiConfig.workingHours.start} onChange={e => updateAiConfig({ workingHours: {...aiConfig.workingHours, start: e.target.value} })} className="w-full p-2 mt-1 rounded border border-slate-200 text-xs font-bold text-navy"/>
                                </div>
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 uppercase">Fim Expediente</label>
                                    <input type="time" value={aiConfig.workingHours.end} onChange={e => updateAiConfig({ workingHours: {...aiConfig.workingHours, end: e.target.value} })} className="w-full p-2 mt-1 rounded border border-slate-200 text-xs font-bold text-navy"/>
                                </div>
                            </div>
                        )}
                        
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 italic bg-amber-50 p-2 rounded-lg border border-amber-100">
                            <Zap size={12} className="text-amber-500"/> A IA tentará sempre conduzir para o agendamento.
                        </div>
                    </div>
                </div>

            </div>
        </div>

        {/* Floating Save Bar */}
        <div className="fixed bottom-6 left-0 right-0 flex justify-center z-30 pointer-events-none">
            <div className="bg-white/90 backdrop-blur-md p-2 rounded-2xl shadow-2xl border border-slate-200 pointer-events-auto flex gap-4 items-center pl-6">
                <span className="text-xs font-bold text-slate-500">Alterações não salvas</span>
                <button 
                    onClick={handleSave}
                    className={`px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg flex items-center gap-2 transition-all ${success ? 'bg-emerald-500 text-white' : 'bg-navy text-white hover:bg-slate-800'}`}
                >
                    {success ? <Check size={16}/> : <Zap size={16} fill="currentColor"/>}
                    {success ? 'Salvo!' : 'Salvar Configurações'}
                </button>
            </div>
        </div>

      </div>
    );
  }

  return null;
};

export default Automation;
