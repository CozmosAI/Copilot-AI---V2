
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  MessageCircle, Clock, Search, Send, Plus, X, 
  BarChart3, LayoutGrid, List as ListIcon, 
  Filter, MoreHorizontal, Calendar, DollarSign,
  TrendingUp, Users, PieChart as PieChartIcon, ArrowRight
} from 'lucide-react';
import { analyzeLeadConversation } from '../services/geminiService';
import { sendMessage } from '../services/whatsappService';
import { useApp } from '../App';
import { Lead, ChatMessage } from '../types';
import { supabase } from '../lib/supabase';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts';

type ViewMode = 'kanban' | 'chat' | 'list' | 'metrics';

const Sales: React.FC = () => {
  const { leads, addLead, updateLead, addFinancialEntry, user, whatsappConfig } = useApp();
  
  // View State
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  
  // AI & Chat State
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // New Lead Form
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLeadData, setNewLeadData] = useState({ name: '', phone: '', value: '', source: 'Manual' });

  // --- EFEITOS ---
  useEffect(() => {
    if (!activeLead) return;
    const fetchMessages = async () => {
        const { data } = await supabase.from('whatsapp_messages').select('*').eq('contact_phone', activeLead.phone).order('created_at', { ascending: true });
        if (data) setChatMessages(data as ChatMessage[]);
    };
    fetchMessages();
    const channel = supabase.channel(`chat-${activeLead.phone}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `contact_phone=eq.${activeLead.phone}` }, (payload) => setChatMessages(prev => [...prev, payload.new as ChatMessage]))
        .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeLead]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  const handleDragStart = (e: React.DragEvent, leadId: string) => { e.dataTransfer.setData('leadId', leadId); };
  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
      e.preventDefault();
      const leadId = e.dataTransfer.getData('leadId');
      const lead = leads.find(l => l.id === leadId);
      if (lead && lead.status !== newStatus) {
          await updateLead({ ...lead, status: newStatus as any });
          if (newStatus === 'Venda') {
             if(confirm(`Confirmar venda para ${lead.name}?`)) {
                await addFinancialEntry({ id: crypto.randomUUID(), type: 'receivable', category: 'Consulta Particular', name: `Consulta - ${lead.name}`, unitValue: user?.ticketValue || 450, total: user?.ticketValue || 450, status: 'efetuada', date: new Date().toISOString().split('T')[0], discount: 0, addition: 0 });
             }
          }
      }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!activeLead || !messageText.trim()) return;
      const text = messageText; setMessageText(''); setSendingMsg(true);
      if (whatsappConfig?.isConnected && whatsappConfig.instanceName) {
          try { await sendMessage(whatsappConfig.instanceName, activeLead.phone, text); } catch { alert('Erro API.'); } finally { setSendingMsg(false); }
      } else {
          window.open(`https://wa.me/55${activeLead.phone}?text=${encodeURIComponent(text)}`, '_blank'); setSendingMsg(false);
      }
  };

  const handleAnalyzeLead = async () => {
    if (!activeLead) return; setIsAnalyzing(true);
    const historyText = chatMessages.slice(-15).map(m => `${m.sender === 'me' ? 'Eu' : 'Cliente'}: ${m.body}`).join('\n');
    const result = await analyzeLeadConversation(activeLead.name, historyText || 'Sem mensagens.');
    setAiAnalysis(result); setIsAnalyzing(false);
  };

  const handleAddLeadSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      await addLead({ id: '', name: newLeadData.name, phone: newLeadData.phone, status: 'Novo', temperature: 'Cold', potentialValue: Number(newLeadData.value) || 0, lastMessage: 'Adicionado manualmente', source: newLeadData.source });
      setShowAddModal(false); setNewLeadData({ name: '', phone: '', value: '', source: 'Manual' });
  };

  // --- STATS PARA O HEADER ---
  const pipelineValue = leads.reduce((acc, l) => acc + (l.potentialValue || 0), 0);
  const conversionRate = leads.length > 0 ? (leads.filter(l => l.status === 'Venda').length / leads.length) * 100 : 0;
  const activeLeadsCount = leads.filter(l => l.status !== 'Venda' && l.status !== 'Perdido').length;

  const sourceData = useMemo(() => {
    const sources: any = {};
    leads.forEach(l => {
        const s = l.source || 'Outros';
        sources[s] = (sources[s] || 0) + 1;
    });
    return Object.keys(sources).map(k => ({ name: k, value: sources[k] }));
  }, [leads]);
  
  const COLORS = ['#0f172a', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  const KanbanColumn = ({ status, title, color }: { status: string, title: string, color: string }) => {
      const columnLeads = leads.filter(l => l.status === status);
      const totalValue = columnLeads.reduce((acc, l) => acc + (l.potentialValue || 0), 0);
      return (
          <div className="flex flex-col h-full min-w-[280px] w-full md:w-1/5 bg-[#f8fafc] rounded-xl border border-slate-200" onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, status)}>
              <div className={`p-4 border-b border-slate-200 flex justify-between items-center bg-white rounded-t-xl`}>
                  <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${color.replace('bg-', 'bg-').replace('/10', '')}`}></div>
                      <h4 className="font-bold text-slate-700 text-sm">{title}</h4>
                  </div>
                  <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">{columnLeads.length}</span>
              </div>
              <div className="p-2 flex-1 overflow-y-auto custom-scrollbar space-y-3">
                  {columnLeads.map(lead => (
                      <div key={lead.id} draggable onDragStart={(e) => handleDragStart(e, lead.id)} onClick={() => { setActiveLead(lead); setViewMode('chat'); }}
                        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-md transition-all group select-none relative overflow-hidden">
                          <div className={`absolute left-0 top-0 bottom-0 w-1 ${lead.temperature === 'Hot' ? 'bg-orange-500' : lead.temperature === 'Warm' ? 'bg-amber-400' : 'bg-slate-300'}`}></div>
                          
                          <div className="flex justify-between items-start mb-2 pl-2">
                             <h5 className="font-bold text-slate-800 text-sm truncate">{lead.name}</h5>
                             {lead.potentialValue ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">R${lead.potentialValue}</span> : null}
                          </div>
                          
                          <div className="pl-2 space-y-2">
                              <p className="text-xs text-slate-500 truncate">{lead.lastMessage || 'Sem interações recentes'}</p>
                              
                              <div className="flex items-center gap-2 mt-2">
                                  {lead.source && (
                                    <span className="text-[9px] font-bold text-slate-400 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded uppercase">{lead.source}</span>
                                  )}
                                  <div className="flex items-center gap-1 text-[9px] text-slate-400 ml-auto">
                                      <Clock size={10} /> {lead.lastInteraction || 'Hoje'}
                                  </div>
                              </div>
                          </div>
                      </div>
                  ))}
              </div>
              <div className="p-3 border-t border-slate-200 text-center bg-white rounded-b-xl">
                 <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total: R$ {totalValue.toLocaleString('pt-BR', { notation: 'compact' })}</span>
              </div>
          </div>
      );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] overflow-hidden">
      {/* HEADER DE ESTATÍSTICAS (NOVO) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 shrink-0">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pipeline Total</p>
                  <p className="text-xl font-black text-navy">R$ {pipelineValue.toLocaleString('pt-BR', { notation: 'compact' })}</p>
              </div>
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><DollarSign size={20} /></div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Leads Ativos</p>
                  <p className="text-xl font-black text-navy">{activeLeadsCount}</p>
              </div>
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Users size={20} /></div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Conversão</p>
                  <p className="text-xl font-black text-emerald-600">{conversionRate.toFixed(1)}%</p>
              </div>
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><TrendingUp size={20} /></div>
          </div>
           {/* VIEW SWITCHER */}
          <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
             {[{id: 'kanban', icon: <LayoutGrid size={16}/>}, {id: 'list', icon: <ListIcon size={16}/>}, {id: 'chat', icon: <MessageCircle size={16}/>}, {id: 'metrics', icon: <BarChart3 size={16}/>}].map((mode) => (
                <button key={mode.id} onClick={() => setViewMode(mode.id as ViewMode)} className={`flex-1 h-full rounded-lg flex items-center justify-center transition-all ${viewMode === mode.id ? 'bg-navy text-white shadow-md' : 'text-slate-400 hover:text-navy hover:bg-slate-50'}`}>
                   {mode.icon}
                </button>
             ))}
             <button onClick={() => setShowAddModal(true)} className="ml-2 bg-blue-600 hover:bg-blue-700 text-white p-2.5 rounded-lg shadow-md transition-all">
                <Plus size={16} />
             </button>
          </div>
      </div>

      {/* METRICS VIEW (NOVO) */}
      {viewMode === 'metrics' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar grid grid-cols-1 lg:grid-cols-2 gap-6 pb-20">
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                  <h3 className="font-bold text-navy mb-6">Origem dos Leads</h3>
                  <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                              <Pie data={sourceData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                  {sourceData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                              </Pie>
                              <Tooltip />
                              <Legend />
                          </PieChart>
                      </ResponsiveContainer>
                  </div>
              </div>
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                  <h3 className="font-bold text-navy mb-6">Funil de Vendas</h3>
                  <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={[
                              { name: 'Novos', value: leads.filter(l => l.status === 'Novo').length },
                              { name: 'Em Conversa', value: leads.filter(l => l.status === 'Conversa').length },
                              { name: 'Agendados', value: leads.filter(l => l.status === 'Agendado').length },
                              { name: 'Vendidos', value: leads.filter(l => l.status === 'Venda').length },
                          ]}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                              <YAxis hide />
                              <Tooltip cursor={{fill: 'transparent'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'}} />
                              <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40} />
                          </BarChart>
                      </ResponsiveContainer>
                  </div>
              </div>
          </div>
      )}

      {/* KANBAN DENSE */}
      {viewMode === 'kanban' && (
          <div className="flex-1 overflow-x-auto pb-4">
              <div className="flex gap-4 h-full min-w-[1200px] px-1">
                  <KanbanColumn status="Novo" title="Entrada" color="bg-slate-500" />
                  <KanbanColumn status="Conversa" title="Qualificação" color="bg-blue-500" />
                  <KanbanColumn status="Agendado" title="Agendado" color="bg-amber-500" />
                  <KanbanColumn status="Venda" title="Fechado" color="bg-emerald-500" />
                  <KanbanColumn status="Perdido" title="Perdido" color="bg-rose-500" />
              </div>
          </div>
      )}

      {/* CHAT VIEW (Mantido igual) */}
      {viewMode === 'chat' && (
          <div className="flex-1 flex gap-0 border border-slate-200 rounded-2xl bg-white overflow-hidden shadow-sm h-full">
            <div className="w-80 flex flex-col border-r border-slate-200 bg-slate-50/50">
               <div className="p-4 border-b border-slate-200 bg-white">
                  <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" placeholder="Buscar lead..." className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 transition-all" />
                  </div>
               </div>
               <div className="flex-1 overflow-y-auto custom-scrollbar">
                   {leads.map(lead => (
                       <div key={lead.id} onClick={() => setActiveLead(lead)} className={`px-4 py-4 border-b border-slate-100 cursor-pointer hover:bg-white transition-all group ${activeLead?.id === lead.id ? 'bg-white border-l-4 border-l-blue-600 shadow-sm' : 'border-l-4 border-l-transparent'}`}>
                           <div className="flex justify-between items-center mb-1">
                               <h4 className={`text-sm font-bold ${activeLead?.id === lead.id ? 'text-blue-600' : 'text-slate-700'}`}>{lead.name}</h4>
                               <span className="text-[10px] text-slate-400">{lead.lastInteraction || '12:00'}</span>
                           </div>
                           <p className="text-xs text-slate-500 truncate group-hover:text-slate-700">{lead.lastMessage || '...'}</p>
                       </div>
                   ))}
               </div>
            </div>

            <div className="flex-1 flex flex-col bg-[#efeae2] relative">
                {activeLead ? (
                    <>
                        <div className="h-16 px-6 border-b border-slate-200 bg-white flex justify-between items-center shadow-sm z-10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-sm">{activeLead.name.charAt(0)}</div>
                                <div><h3 className="font-bold text-slate-800">{activeLead.name}</h3><p className="text-xs text-slate-500">{activeLead.phone}</p></div>
                            </div>
                            <button onClick={handleAnalyzeLead} className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:text-blue-600 hover:border-blue-200 flex items-center gap-2 transition-all">
                                {isAnalyzing ? <span className="animate-spin">⌛</span> : <span className="text-lg">✨</span>} AI Insight
                            </button>
                        </div>

                        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col gap-3 relative bg-opacity-50">
                             <div className="absolute inset-0 opacity-[0.05] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] pointer-events-none"></div>
                            {aiAnalysis && <div className="z-10 bg-white/95 backdrop-blur border border-blue-100 p-4 rounded-xl text-xs text-blue-900 shadow-md mx-auto max-w-lg mb-4 text-center leading-relaxed"><strong>🤖 Copilot Insight:</strong> {aiAnalysis}</div>}
                            {chatMessages.map(msg => (
                                <div key={msg.id} className={`z-10 max-w-[65%] px-4 py-3 rounded-2xl text-sm shadow-sm relative leading-relaxed ${msg.sender === 'me' ? 'self-end bg-[#d9fdd3] text-slate-800 rounded-br-none' : 'self-start bg-white text-slate-800 rounded-bl-none'}`}>
                                    {msg.body}
                                    <span className="text-[10px] text-slate-400 block text-right mt-1 opacity-70">{new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>

                        <form onSubmit={handleSendMessage} className="p-4 bg-slate-100 border-t border-slate-200 flex gap-3">
                            <input value={messageText} onChange={e => setMessageText(e.target.value)} className="flex-1 px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:border-blue-500 text-sm shadow-sm" placeholder="Digite uma mensagem..." />
                            <button disabled={sendingMsg || !messageText} className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md"><Send size={20}/></button>
                        </form>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4"><MessageCircle size={32} className="opacity-30"/></div>
                        <p className="text-sm font-bold uppercase tracking-widest opacity-50">Selecione um lead para iniciar</p>
                    </div>
                )}
            </div>
          </div>
      )}

      {/* LIST VIEW (TABLE) */}
      {viewMode === 'list' && (
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col shadow-sm">
              <div className="overflow-auto custom-scrollbar flex-1">
                  <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                          <tr>
                              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nome / Contato</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Origem</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Valor</th>
                              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Ações</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {leads.map(lead => (
                              <tr key={lead.id} className="hover:bg-slate-50/80 transition-colors">
                                  <td className="px-6 py-4">
                                      <p className="text-sm font-bold text-slate-700">{lead.name}</p>
                                      <p className="text-xs text-slate-400 font-mono mt-0.5">{lead.phone}</p>
                                  </td>
                                  <td className="px-6 py-4"><span className="px-2.5 py-1 rounded-md bg-slate-100 text-[10px] font-bold text-slate-600 uppercase border border-slate-200">{lead.status}</span></td>
                                  <td className="px-6 py-4"><span className="text-xs text-slate-500">{lead.source || '-'}</span></td>
                                  <td className="px-6 py-4 text-sm font-mono font-bold text-emerald-600">R$ {lead.potentialValue}</td>
                                  <td className="px-6 py-4 text-right"><button onClick={() => { setActiveLead(lead); setViewMode('chat'); }} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"><MessageCircle size={16}/></button></td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>
      )}

      {/* MODAL NOVO LEAD */}
      {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/80 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 border border-slate-200 animate-in zoom-in-95">
                  <div className="flex justify-between items-center mb-8">
                      <div>
                        <h3 className="text-xl font-bold text-navy">Novo Lead</h3>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Adicionar ao Pipeline</p>
                      </div>
                      <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={20} className="text-slate-400"/></button>
                  </div>
                  <form onSubmit={handleAddLeadSubmit} className="space-y-5">
                      <div className="space-y-1.5">
                         <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome</label>
                         <input required value={newLeadData.name} onChange={e => setNewLeadData({...newLeadData, name: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
                      </div>
                      <div className="space-y-1.5">
                         <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Telefone</label>
                         <input required value={newLeadData.phone} onChange={e => setNewLeadData({...newLeadData, phone: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor (R$)</label>
                            <input type="number" value={newLeadData.value} onChange={e => setNewLeadData({...newLeadData, value: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Origem</label>
                            <select value={newLeadData.source} onChange={e => setNewLeadData({...newLeadData, source: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all appearance-none">
                                <option>Manual</option>
                                <option>Indicação</option>
                                <option>Google Ads</option>
                                <option>Instagram</option>
                            </select>
                        </div>
                      </div>
                      <button type="submit" className="w-full bg-navy text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-navy/20 mt-2">Salvar Lead</button>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
};

export default Sales;
