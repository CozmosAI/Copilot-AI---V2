
import React, { useState } from 'react';
import { 
  ToggleLeft as Toggle, 
  ToggleRight as ToggleOn, 
  MessageSquare, 
  CalendarClock, 
  History, 
  FileText, 
  ArrowLeft, 
  Upload,
  Clock,
  ShieldCheck,
  Zap,
  ChevronRight
} from 'lucide-react';

type AutomationView = 'selection' | 'atendimento' | 'followup';

const Automation: React.FC = () => {
  const [currentView, setCurrentView] = useState<AutomationView>('selection');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [followUpEnabled, setFollowUpEnabled] = useState(true);

  // Render selection screen
  if (currentView === 'selection') {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <header>
          <h2 className="text-2xl font-bold text-navy">Automações Inteligentes</h2>
          <p className="text-slate-500">Selecione qual módulo de inteligência deseja configurar.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <button 
            onClick={() => setCurrentView('atendimento')}
            className="group bg-white p-8 rounded-2xl border border-slate-200 shadow-sm hover:border-blue-400 hover:shadow-md transition-all text-left flex flex-col items-start gap-4"
          >
            <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <MessageSquare size={32} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-navy mb-2">IA de Atendimento (Wpp)</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Configure uma assistente virtual para tirar dúvidas, passar preços e agendar consultas via WhatsApp 24h por dia.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-2 text-blue-600 font-bold text-xs uppercase tracking-wider">
              Configurar Agora <ChevronRight size={14} />
            </div>
          </button>

          <button 
            onClick={() => setCurrentView('followup')}
            className="group bg-white p-8 rounded-2xl border border-slate-200 shadow-sm hover:border-indigo-400 hover:shadow-md transition-all text-left flex flex-col items-start gap-4"
          >
            <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <CalendarClock size={32} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-navy mb-2">IA de Follow-up (CRM)</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Recupere orçamentos perdidos, reative pacientes sumidos e reduza faltas com mensagens automáticas e inteligentes.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-wider">
              Configurar Agora <ChevronRight size={14} />
            </div>
          </button>
        </div>
        
        <div className="bg-slate-100 p-6 rounded-2xl flex items-center gap-4">
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-navy shadow-sm">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-navy">Segurança e Ética</h4>
            <p className="text-xs text-slate-500">Todas as automações respeitam as normas do CFM e a LGPD.</p>
          </div>
        </div>
      </div>
    );
  }

  // Render Atendimento Configuration
  if (currentView === 'atendimento') {
    return (
      <div className="space-y-6 animate-in slide-in-from-right duration-500">
        <header className="flex items-center gap-4">
          <button 
            onClick={() => setCurrentView('selection')}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-navy">IA de Atendimento</h2>
            <p className="text-slate-500 text-sm">Personalize como sua assistente virtual deve se comportar.</p>
          </div>
        </header>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 md:p-8 space-y-8">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <MessageSquare size={20} />
                </div>
                <h3 className="font-bold text-navy text-lg">IA de Atendimento (Wpp)</h3>
              </div>
              <button onClick={() => setAiEnabled(!aiEnabled)} className="transition-all">
                {aiEnabled ? <ToggleOn size={44} className="text-blue-600" /> : <Toggle size={44} className="text-slate-300" />}
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div>
                  <label className="text-sm font-bold text-navy block mb-3 uppercase tracking-wider text-[11px]">Quando a IA deve atuar?</label>
                  <select className="w-full p-3 bg-slate-900 text-white rounded-xl text-sm focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer">
                    <option>Apenas fora do horário comercial</option>
                    <option>Quando a secretária demorar &gt; 10 min</option>
                    <option>24 horas por dia (Híbrido)</option>
                    <option>Pausada (Somente manual)</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-bold text-navy block mb-3 uppercase tracking-wider text-[11px]">Instruções da IA (Prompt Principal)</label>
                  <textarea 
                    className="w-full p-4 bg-slate-800 text-slate-100 rounded-xl text-sm h-48 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none leading-relaxed"
                    defaultValue="Você é a assistente da Dra. Ana. Seja gentil, esclareça dúvidas sobre convênios e tente agendar a consulta inicial. Nunca prometa resultados de cura, apenas melhoria estética."
                  />
                  <p className="mt-2 text-[10px] text-slate-400 italic font-medium">* Este prompt define a personalidade e os limites da sua IA.</p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-sm font-bold text-navy block mb-3 uppercase tracking-wider text-[11px]">Materiais de Apoio (Conhecimento)</label>
                  <div className="p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-300 flex flex-col items-center text-center gap-3">
                    <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center text-slate-400">
                      <FileText size={24} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-navy">Material de Treinamento</h4>
                      <p className="text-[10px] text-slate-500 mt-1">PDFs com preços, convênios e horários.</p>
                    </div>
                    <button className="mt-2 bg-white px-6 py-2 rounded-lg border border-slate-200 text-xs font-bold text-navy hover:bg-slate-50 transition-colors flex items-center gap-2">
                      <Upload size={14} /> Upload
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-bold text-navy block mb-3 uppercase tracking-wider text-[11px]">Horário Comercial da Clínica</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Seg - Sex</span>
                      <span className="text-xs font-bold text-navy">08:00 - 18:00</span>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Sábado</span>
                      <span className="text-xs font-bold text-navy">08:00 - 12:00</span>
                    </div>
                  </div>
                  <button className="mt-3 text-[10px] font-bold text-blue-600 flex items-center gap-1 hover:underline">
                    <Clock size={12} /> Editar horários detalhados
                  </button>
                </div>
              </div>
            </div>
            
            <div className="pt-6 border-t border-slate-100 flex justify-end">
              <button className="bg-navy text-white px-10 py-3 rounded-xl font-bold text-sm shadow-lg hover:bg-slate-800 transition-all flex items-center gap-2">
                <Zap size={18} fill="currentColor" /> Salvar e Ativar IA
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render Follow-up Configuration
  if (currentView === 'followup') {
    return (
      <div className="space-y-6 animate-in slide-in-from-right duration-500">
        <header className="flex items-center gap-4">
          <button 
            onClick={() => setCurrentView('selection')}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-navy">IA de Follow-up (CRM)</h2>
            <p className="text-slate-500 text-sm">Automações focadas em recuperação de faturamento e fidelização.</p>
          </div>
        </header>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 md:p-8 space-y-8">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <CalendarClock size={20} />
                </div>
                <h3 className="font-bold text-navy text-lg">IA de Follow-up (CRM)</h3>
              </div>
              <button onClick={() => setFollowUpEnabled(!followUpEnabled)} className="transition-all">
                {followUpEnabled ? <ToggleOn size={44} className="text-indigo-600" /> : <Toggle size={44} className="text-slate-300" />}
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-3">
                <label className="text-sm font-bold text-navy block mb-2 uppercase tracking-wider text-[11px]">Réguas de Atendimento Ativas</label>
                {[
                  { label: 'Não respondeu 1ª mensagem', time: '2h depois', icon: <MessageSquare size={14} /> },
                  { label: 'Orçamento enviado (sem aceite)', time: '24h depois', icon: <FileText size={14} /> },
                  { label: 'Faltou na consulta (No-show)', time: '1h depois', icon: <History size={14} /> },
                  { label: 'Reativação de pacientes (Sumidos)', time: '30 dias depois', icon: <Zap size={14} /> },
                ].map((rule, i) => (
                  <div key={i} className="flex justify-between items-center p-4 bg-slate-50 border border-slate-100 rounded-xl hover:border-indigo-200 transition-colors cursor-pointer group">
                    <div className="flex items-center gap-3">
                      <div className="text-slate-400 group-hover:text-indigo-500 transition-colors">
                        {rule.icon}
                      </div>
                      <span className="text-sm font-semibold text-slate-700">{rule.label}</span>
                    </div>
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg uppercase tracking-wider">
                      {rule.time}
                    </span>
                  </div>
                ))}
                <button className="w-full mt-2 border-2 border-dashed border-slate-200 py-3 rounded-xl text-xs font-bold text-slate-400 hover:border-indigo-300 hover:text-indigo-400 transition-all">
                  + Adicionar Nova Régua Personalizada
                </button>
              </div>

              <div className="space-y-6">
                <div className="bg-navy p-8 rounded-3xl text-white shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <History size={100} />
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-4 text-indigo-400">
                      <History size={20} />
                      <span className="text-xs font-bold uppercase tracking-widest">Impacto Estimado</span>
                    </div>
                    <p className="text-lg leading-relaxed font-light mb-6">
                      Essa automação pode recuperar <span className="text-emerald-400 font-bold">R$ 12.400</span> em faturamento perdido este mês, baseado nos seus dados de conversão atuais.
                    </p>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <ShieldCheck size={14} /> IA validada para aumento de 15% no agendamento.
                    </div>
                  </div>
                </div>

                <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100">
                  <h4 className="text-xs font-bold text-indigo-900 mb-2 flex items-center gap-2">
                    <Zap size={14} /> Modo Inteligente Ativo
                  </h4>
                  <p className="text-[11px] text-indigo-800 leading-relaxed">
                    A IA analisa se o paciente já respondeu manualmente antes de enviar o follow-up, evitando mensagens redundantes.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 flex justify-end gap-3">
              <button className="px-6 py-3 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-50 transition-all">
                Testar Fluxo
              </button>
              <button className="bg-indigo-600 text-white px-10 py-3 rounded-xl font-bold text-sm shadow-lg hover:bg-indigo-700 transition-all">
                Salvar Automações
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default Automation;
