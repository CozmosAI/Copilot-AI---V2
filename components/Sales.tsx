import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  MessageCircle, Clock, Search, Send, Plus, X, Download, Paperclip,
  BarChart3, LayoutGrid, List as ListIcon, 
  Filter, MoreHorizontal, Calendar, DollarSign,
  TrendingUp, Users, PieChart as PieChartIcon, ArrowRight,
  Mail, Link2, Tag, FileText, Activity, GripHorizontal, Edit2, Check, Trash2
} from 'lucide-react';
import { analyzeLeadConversation } from '../services/geminiService';
// import { sendMessage } from '../services/whatsappService'; // REMOVIDO
import { useApp } from '../App';
import { Lead, ChatMessage } from '../types';
import { supabase } from '../lib/supabase';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts';

type ViewMode = 'kanban' | 'chat' | 'list' | 'metrics';

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Estrutura para colunas dinâmicas
interface KanbanColumnData {
  id: string;
  title: string;
  color: string;
}

const DEFAULT_COLUMNS: KanbanColumnData[] = [
  { id: 'Novo', title: 'Entrada', color: 'bg-slate-500' },
  { id: 'Conversa', title: 'Qualificação', color: 'bg-blue-500' },
  { id: 'Agendado', title: 'Agendado', color: 'bg-amber-500' },
  { id: 'Venda', title: 'Fechado', color: 'bg-emerald-500' },
  { id: 'Perdido', title: 'Perdido', color: 'bg-rose-500' },
];

const Sales: React.FC = () => {
  const { leads, addLead, updateLead, addFinancialEntry, user /*, whatsappConfig */ } = useApp(); // whatsappConfig REMOVIDO
  
  // View State
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  
  // Kanban Columns State (Persistente)
  const [columns, setColumns] = useState<KanbanColumnData[]>(() => {
    const saved = localStorage.getItem('kanban_columns');
    return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
  });
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [tempColumnTitle, setTempColumnTitle] = useState('');

  // Persistir colunas quando mudar
  useEffect(() => {
    localStorage.setItem('kanban_columns', JSON.stringify(columns));
  }, [columns]);
  
  // AI & Chat State
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [messageText, setMessageText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CRM Integration States
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<any | null>(null);
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [conversationsMap, setConversationsMap] = useState<Record<string, any>>({});

  // Image Preview Modal state and esc listener
  const [selectedImagePreview, setSelectedImagePreview] = useState<{ src: string; attachment?: any; msg?: any } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedImagePreview(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Outbound Media Sending State
  const [selectedFileForUpload, setSelectedFileForUpload] = useState<File | null>(null);
  const [fileCaption, setFileCaption] = useState<string>('');

  // New Lead Form State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLeadData, setNewLeadData] = useState({ 
      name: '', 
      phone: '', 
      email: '', 
      entryDate: new Date().toISOString().split('T')[0],
      value: '', 
      source: 'Manual',
      adName: '',
      objective: 'Consulta',
      procedure: '',
      description: ''
  });

  // SECURE PROXY ATTACHMENT DOWNLOAD HELPER
  const downloadAttachment = async (attachment: any, msg: any) => {
      if (!attachment || !attachment.id) {
          const directUrl = attachment?.source_url || msg?.media_url;
          if (directUrl) {
              const a = document.createElement('a');
              a.href = directUrl;
              a.target = '_blank';
              a.download = attachment?.filename || msg?.media_filename || "arquivo";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
          } else {
              alert("Link do arquivo não disponível.");
          }
          return;
      }
      try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) {
              alert("Sessão expirada. Por favor, faça login novamente.");
              return;
          }

          const response = await fetch(`/api/crm/attachments/${attachment.id}/download`, {
              headers: {
                  'Authorization': `Bearer ${token}`
              }
          });

          if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              alert(errData.error || "O arquivo ainda não está disponível para download.");
              return;
          }

          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = attachment.filename || msg?.media_filename || "arquivo";
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
      } catch (err: any) {
          console.error("Erro no download do anexo:", err);
          alert("Falha ao realizar o download do arquivo.");
      }
  };

  // --- REQUISICÕES CRM ---
  const fetchCrmMessages = async (conversationId: string) => {
    try {
      const { data: messages, error } = await supabase
        .from('crm_messages')
        .select(`
          id,
          conversation_id,
          lead_id,
          message_direction,
          sender_type,
          message_type,
          message_text,
          caption,
          media_url,
          media_mime_type,
          media_filename,
          message_status,
          from_me,
          created_at,
          sent_at
        `)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      if (messages) {
        // Buscar anexos vinculados para enriquecer mídias carregadas de forma assíncrona
        const { data: attachments } = await supabase
          .from('crm_message_attachments')
          .select('*')
          .eq('conversation_id', conversationId);
        
         const mergedMessages = (messages as any[]).map(m => {
           const msgAttachs = attachments ? attachments.filter((a: any) => a.message_id === m.id) : [];
           const parsedAttach = msgAttachs[0];
           
           let cleanUrl = m.media_url || parsedAttach?.source_url || null;
           if (cleanUrl) {
             const urlStr = String(cleanUrl).toLowerCase();
             if (urlStr.includes('.enc') || urlStr.includes('mmg.whatsapp.net') || parsedAttach?.raw_metadata?.mediaUrlPending === true || parsedAttach?.raw_metadata?.mediaUrlPending === 'true') {
               cleanUrl = null;
             }
           }
           
           return {
             ...m,
             attachments: msgAttachs,
             media_url: cleanUrl,
             media_mime_type: m.media_mime_type || (parsedAttach?.mime_type || null),
             media_filename: m.media_filename || (parsedAttach?.filename || null)
           };
         });

        setChatMessages(mergedMessages);
      }
    } catch (err) {
      console.error('Error fetching CRM messages:', err);
      setChatError('Erro ao carregar mensagens do CRM.');
    }
  };

  const fetchConversationForLead = async (lead: Lead) => {
    setIsChatLoading(true);
    setChatError(null);
    setSelectedConversationId(null);
    setSelectedConversation(null);
    setChatMessages([]);

    try {
      let convId = lead.conversation_id;

      if (!convId) {
        // 1. buscar em crm_conversations por lead_id = lead.id
        const { data: convByLead } = await supabase
          .from('crm_conversations')
          .select('*')
          .eq('lead_id', lead.id)
          .maybeSingle();

        if (convByLead) {
          convId = convByLead.id;
          setSelectedConversation(convByLead);
        }
      } else {
        // Encontrar o registro correspondente para colocar no estado
        const { data: convByConvId } = await supabase
          .from('crm_conversations')
          .select('*')
          .eq('id', convId)
          .maybeSingle();
        if (convByConvId) {
          setSelectedConversation(convByConvId);
        }
      }

      if (!convId && lead.phone) {
        // 2. buscar em crm_conversations por contact.phone = lead.phone se necessário
        const { data: contact } = await supabase
          .from('crm_contacts')
          .select('id')
          .eq('phone', lead.phone)
          .maybeSingle();

        if (contact) {
          const { data: convByContact } = await supabase
            .from('crm_conversations')
            .select('*')
            .eq('contact_id', contact.id)
            .maybeSingle();

          if (convByContact) {
            convId = convByContact.id;
            setSelectedConversation(convByContact);
          }
        }
      }

      if (convId) {
        setSelectedConversationId(convId);
        await fetchCrmMessages(convId);
      } else {
        console.log('Este lead ainda não possui conversa vinculada.');
      }
    } catch (err) {
      console.error('Error fetching conversation for lead:', err);
      setChatError('Erro ao carregar mensagens do CRM.');
    } finally {
      setIsChatLoading(false);
    }
  };

  // --- EFEITOS DE AUTOCARREGAMENTO & REALTIME ---
  useEffect(() => {
    if (!activeLead) {
      setSelectedConversationId(null);
      setSelectedConversation(null);
      setChatMessages([]);
      return;
    }
    fetchConversationForLead(activeLead);
  }, [activeLead]);

  // Carrega e atualiza o mapeamento de conversas em tempo real
  useEffect(() => {
    const fetchConversations = async () => {
      const { data } = await supabase
        .from('crm_conversations')
        .select('*');
      if (data) {
        const map: Record<string, any> = {};
        data.forEach((c: any) => {
          map[c.id] = c;
          if (c.lead_id) {
            map[`lead_${c.lead_id}`] = c;
          }
        });
        setConversationsMap(map);
      }
    };
    fetchConversations();

    const convsChannel = supabase.channel('crm_conversations_all')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'crm_conversations'
        },
        (payload) => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const updatedConv = payload.new;
            setConversationsMap((prev) => ({
              ...prev,
              [updatedConv.id]: updatedConv,
              [`lead_${updatedConv.lead_id}`]: updatedConv
            }));

            if (selectedConversationId && updatedConv.id === selectedConversationId) {
              setSelectedConversation(updatedConv);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(convsChannel);
    };
  }, [selectedConversationId]);

  // Canal em tempo real para novas mensagens da conversa selecionada
  useEffect(() => {
    if (!selectedConversationId) return;

    const messagesChannel = supabase.channel(`crm_messages_${selectedConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'crm_messages',
          filter: `conversation_id=eq.${selectedConversationId}`
        },
        (payload) => {
          const newMsg = payload.new;
          setChatMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, { ...newMsg, attachments: [] }];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'crm_messages',
          filter: `conversation_id=eq.${selectedConversationId}`
        },
        (payload) => {
          const updatedMsg = payload.new;
          setChatMessages((prev) => {
            return prev.map((m) => {
              if (m.id === updatedMsg.id) {
                return {
                  ...m,
                  ...updatedMsg,
                  attachments: m.attachments || []
                };
              }
              return m;
            });
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'crm_message_attachments',
          filter: `conversation_id=eq.${selectedConversationId}`
        },
        (payload) => {
          const changedAttachment = payload.new as any;
          if (!changedAttachment) return;
          setChatMessages((prev) => {
            return prev.map((m) => {
              if (m.id === changedAttachment.message_id) {
                const existingAttachments = m.attachments || [];
                const hasMatch = existingAttachments.some((a: any) => a.id === changedAttachment.id);
                const updatedAttachs = hasMatch
                  ? existingAttachments.map((a: any) => a.id === changedAttachment.id ? changedAttachment : a)
                  : [...existingAttachments, changedAttachment];
                
                return {
                  ...m,
                  attachments: updatedAttachs,
                  media_url: m.media_url || changedAttachment.source_url,
                  media_mime_type: m.media_mime_type || changedAttachment.mime_type,
                  media_filename: m.media_filename || changedAttachment.filename
                };
              }
              return m;
            });
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
    };
  }, [selectedConversationId]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // --- LÓGICA DE COLUNAS (CRUD + DnD) ---
  
  const handleAddColumn = () => {
    const newId = `col_${Date.now()}`;
    const newCol: KanbanColumnData = {
      id: newId,
      title: 'Nova Fase',
      color: 'bg-slate-400' // Cor padrão
    };
    setColumns([...columns, newCol]);
    // Inicia edição automaticamente
    setEditingColumnId(newId);
    setTempColumnTitle('Nova Fase');
  };

  const handleUpdateColumnTitle = (id: string) => {
    if (!tempColumnTitle.trim()) return;
    setColumns(prev => prev.map(c => c.id === id ? { ...c, title: tempColumnTitle } : c));
    setEditingColumnId(null);
  };

  const handleDeleteColumn = (id: string) => {
    // Verifica se tem leads
    const hasLeads = leads.some(l => l.status === id);
    if (hasLeads) {
      alert("Não é possível excluir uma coluna que contém leads. Mova-os primeiro.");
      return;
    }
    if (confirm("Excluir esta coluna?")) {
      setColumns(prev => prev.filter(c => c.id !== id));
    }
  };

  // Drag and Drop de Colunas
  const handleColumnDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('colIndex', index.toString());
    e.dataTransfer.setData('type', 'COLUMN'); // Identificador do tipo
  };

  const handleColumnDrop = (e: React.DragEvent, dropIndex: number) => {
    const type = e.dataTransfer.getData('type');
    
    if (type === 'COLUMN') {
      e.preventDefault();
      const dragIndex = Number(e.dataTransfer.getData('colIndex'));
      if (dragIndex === dropIndex) return;

      const newColumns = [...columns];
      const [draggedItem] = newColumns.splice(dragIndex, 1);
      newColumns.splice(dropIndex, 0, draggedItem);
      setColumns(newColumns);
    }
  };

  // Drag and Drop de Leads
  const handleLeadDragStart = (e: React.DragEvent, leadId: string) => { 
    e.dataTransfer.setData('leadId', leadId);
    e.dataTransfer.setData('type', 'LEAD');
  };

  const handleLeadDrop = async (e: React.DragEvent, newStatus: string) => {
      // Importante: Só processar se for um LEAD sendo solto
      if (e.dataTransfer.getData('type') !== 'LEAD') return;

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

  const handleSendAttachment = async (file: File | null, caption: string) => {
      if (!selectedConversationId) {
          alert("Nenhuma conversa selecionada.");
          return;
      }
      if (!file) {
          alert("Por favor, selecione um arquivo.");
          return;
      }

      setSendingMsg(true);

      try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;

          if (!token) {
              alert("Sessão expirada. Por favor, faça login novamente.");
              setSendingMsg(false);
              return;
          }

          const formData = new FormData();
          formData.append('file', file);
          formData.append('caption', caption);

          const response = await fetch(`/api/crm/conversations/${selectedConversationId}/send-media`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${token}`
              },
              body: formData
          });

          const result = await response.json();

          if (result.ok || result.message) {
              if (result.message) {
                  const newMsg = result.message;
                  setChatMessages(prev => {
                      if (prev.some(m => m.id === newMsg.id)) return prev;
                      return [...prev, newMsg];
                  });
              }
              // Limpar preview e arquivo
              setSelectedFileForUpload(null);
              setFileCaption('');
              if (!result.ok && result.error) {
                  alert(result.error);
              }
          } else {
              alert(result.error || "Erro ao enviar o arquivo de mídia.");
          }
      } catch (err: any) {
          console.error("Erro ao enviar mídia do CRM:", err);
          alert("Ocorreu uma falha de conexão ao enviar o arquivo.");
      } finally {
          setSendingMsg(false);
      }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedConversationId || !messageText.trim() || sendingMsg) return;

      const bodyText = messageText.trim();
      setSendingMsg(true);

      try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;

          if (!token) {
              alert("Sessão expirada. Por favor, faça login novamente.");
              setSendingMsg(false);
              return;
          }

          const response = await fetch(`/api/crm/conversations/${selectedConversationId}/send`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ text: bodyText })
          });

          const result = await response.json();

          if (result.ok || result.message) {
              setMessageText('');
              if (result.message) {
                  const newMsg = result.message;
                  setChatMessages(prev => {
                      if (prev.some(m => m.id === newMsg.id)) return prev;
                      return [...prev, newMsg];
                  });
              }
              if (!result.ok && result.error) {
                  alert("Falha ao enviar mensagem.");
              }
          } else {
              alert("Falha ao enviar mensagem.");
          }
      } catch (err) {
          console.error("Erro ao enviar mensagem:", err);
          alert("Falha ao enviar mensagem.");
      } finally {
          setSendingMsg(false);
      }
  };

  const handleAnalyzeLead = async () => {
    if (!activeLead) return; setIsAnalyzing(true);
    const historyText = chatMessages.slice(-15).map(m => {
      const isOutbound = m.from_me === true || m.message_direction === 'outbound' || m.sender_type === 'me' || m.sender_type === 'ai';
      const content = m.message_text || m.caption || (m.message_type ? `[${m.message_type}]` : '[mensagem]');
      return `${isOutbound ? 'Eu' : 'Cliente'}: ${content}`;
    }).join('\n');
    const result = await analyzeLeadConversation(activeLead.name, historyText || 'Sem mensagens.');
    setAiAnalysis(result); setIsAnalyzing(false);
  };

  const handleAddLeadSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      await addLead({ 
          id: '', 
          name: newLeadData.name, 
          phone: newLeadData.phone, 
          email: newLeadData.email,
          status: 'Novo', 
          temperature: 'Cold', 
          potentialValue: Number(newLeadData.value) || 0, 
          lastMessage: newLeadData.description || 'Adicionado manualmente', 
          source: newLeadData.source,
          objective: newLeadData.objective,
          procedure: newLeadData.procedure,
          adName: newLeadData.adName,
          notes: newLeadData.description,
          created_at: new Date(newLeadData.entryDate).toISOString()
      });
      setShowAddModal(false); 
      setNewLeadData({ name: '', phone: '', email: '', entryDate: new Date().toISOString().split('T')[0], value: '', source: 'Manual', adName: '', objective: 'Consulta', procedure: '', description: '' });
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

  const KanbanColumn: React.FC<{ status: string; title: string; color: string; index: number }> = ({ status, title, color, index }) => {
      const columnLeads = leads.filter(l => l.status === status);
      const totalValue = columnLeads.reduce((acc, l) => acc + (l.potentialValue || 0), 0);
      const isEditing = editingColumnId === status;

      return (
          <div 
            className="flex flex-col h-full min-w-[280px] w-full md:w-1/5 bg-[#f8fafc] rounded-xl border border-slate-200 transition-all" 
            onDragOver={(e) => e.preventDefault()} 
            onDrop={(e) => {
               // Handle Lead Drop
               if (e.dataTransfer.getData('type') === 'LEAD') {
                   handleLeadDrop(e, status);
               } 
               // Handle Column Drop (Reordering)
               else if (e.dataTransfer.getData('type') === 'COLUMN') {
                   handleColumnDrop(e, index);
               }
            }}
            draggable={!isEditing}
            onDragStart={(e) => handleColumnDragStart(e, index)}
          >
              <div className={`p-4 border-b border-slate-200 flex justify-between items-center bg-white rounded-t-xl group cursor-move`}>
                  <div className="flex items-center gap-2 flex-1">
                      <div className="cursor-grab text-slate-300 hover:text-slate-500"><GripHorizontal size={14} /></div>
                      <div className={`w-3 h-3 rounded-full ${color.replace('bg-', 'bg-').replace('/10', '')} shrink-0`}></div>
                      
                      {isEditing ? (
                        <div className="flex items-center gap-1 flex-1">
                           <input 
                              autoFocus
                              value={tempColumnTitle}
                              onChange={(e) => setTempColumnTitle(e.target.value)}
                              className="w-full text-sm font-bold text-slate-700 bg-slate-50 border border-blue-300 rounded px-1 focus:outline-none"
                              onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateColumnTitle(status); }}
                           />
                           <button onClick={() => handleUpdateColumnTitle(status)} className="p-1 bg-green-50 text-green-600 rounded hover:bg-green-100"><Check size={12}/></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 group/title flex-1">
                           <h4 className="font-bold text-slate-700 text-sm truncate" onDoubleClick={() => { setEditingColumnId(status); setTempColumnTitle(title); }}>{title}</h4>
                           <button onClick={() => { setEditingColumnId(status); setTempColumnTitle(title); }} className="opacity-0 group-hover/title:opacity-100 p-1 hover:bg-slate-100 rounded text-slate-400 transition-opacity">
                              <Edit2 size={10} />
                           </button>
                        </div>
                      )}
                  </div>
                  <div className="flex items-center gap-1">
                     <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">{columnLeads.length}</span>
                     {!DEFAULT_COLUMNS.find(c => c.id === status) && (
                        <button onClick={() => handleDeleteColumn(status)} className="text-slate-300 hover:text-rose-500 p-1"><Trash2 size={12}/></button>
                     )}
                  </div>
              </div>
              <div className="p-2 flex-1 overflow-y-auto custom-scrollbar space-y-3">
                  {columnLeads.map(lead => (
                      <div key={lead.id} draggable onDragStart={(e) => handleLeadDragStart(e, lead.id)} onClick={() => { setActiveLead(lead); setViewMode('chat'); }}
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
      {/* HEADER DE ESTATÍSTICAS */}
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

      {/* METRICS VIEW */}
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
              <div className="flex gap-4 h-full min-w-max px-1">
                  {columns.map((col, index) => (
                      <KanbanColumn 
                        key={col.id} 
                        status={col.id} 
                        title={col.title} 
                        color={col.color}
                        index={index}
                      />
                  ))}
                  
                  {/* ADD NEW COLUMN BUTTON */}
                  <div className="min-w-[100px] flex flex-col justify-start pt-2">
                      <button 
                        onClick={handleAddColumn}
                        className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all group gap-2 h-[100px]"
                      >
                          <div className="bg-white p-2 rounded-full shadow-sm group-hover:shadow-md transition-all">
                             <Plus size={20} />
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-widest">Nova Coluna</span>
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* CHAT VIEW */}
      {viewMode === 'chat' && (
          <div className="flex-1 flex gap-0 border border-slate-200 rounded-2xl bg-white overflow-hidden shadow-sm h-full">
            <div className="w-80 flex flex-col border-r border-slate-200 bg-slate-50/50">
               <div className="p-4 border-b border-slate-200 bg-white">
                  <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="Buscar lead..." 
                        value={chatSearchQuery}
                        onChange={(e) => setChatSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 transition-all" 
                      />
                  </div>
               </div>
               <div className="flex-1 overflow-y-auto custom-scrollbar">
                   {leads.filter(lead => {
                       const nameMatch = lead.name.toLowerCase().includes(chatSearchQuery.toLowerCase());
                       const phoneMatch = lead.phone ? lead.phone.includes(chatSearchQuery) : false;
                       return nameMatch || phoneMatch;
                   }).map(lead => {
                       const conv = conversationsMap[lead.conversation_id || ''] || conversationsMap[`lead_${lead.id}`];
                       const displayLastMessage = conv?.last_message_text || lead.lastMessage || '...';
                       const displayLastInteraction = conv?.last_message_at 
                         ? new Date(conv.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                         : (lead.lastInteraction || '');
                       const unreadCount = conv?.unread_count || 0;
                       
                       return (
                           <div 
                             key={lead.id} 
                             id={`lead-item-${lead.id}`}
                             onClick={() => setActiveLead(lead)} 
                             className={`px-4 py-4 border-b border-slate-100 cursor-pointer hover:bg-white transition-all group ${
                               activeLead?.id === lead.id 
                                 ? 'bg-white border-l-4 border-l-blue-600 shadow-sm' 
                                 : 'border-l-4 border-l-transparent'
                             }`}
                           >
                               <div className="flex justify-between items-center mb-1">
                                   <div className="flex items-center gap-1.5 min-w-0">
                                       <h4 className={`text-sm font-bold truncate ${activeLead?.id === lead.id ? 'text-blue-600' : 'text-slate-700'}`}>
                                           {lead.name}
                                       </h4>
                                       {lead.channel === 'whatsapp' && (
                                           <span className="shrink-0 text-[8px] bg-green-100 text-green-700 px-1 py-0.2 rounded font-semibold uppercase">
                                               WhatsApp
                                           </span>
                                       )}
                                   </div>
                                   <div className="flex items-center gap-1.5 shrink-0">
                                       <span className="text-[10px] text-slate-400">{displayLastInteraction}</span>
                                       {unreadCount > 0 && (
                                           <span className="bg-blue-600 text-white font-bold text-[9px] w-4 h-4 rounded-full flex items-center justify-center shrink-0">
                                               {unreadCount}
                                           </span>
                                       )}
                                   </div>
                               </div>
                               <p className="text-xs text-slate-500 truncate group-hover:text-slate-700">
                                   {displayLastMessage}
                               </p>
                               <div className="flex items-center justify-between mt-1">
                                   {lead.objective ? (
                                       <p className="text-[9px] text-slate-400 bg-slate-50 px-1 py-0.5 rounded inline-block">
                                           {lead.objective}
                                       </p>
                                   ) : <div/>}
                                   {(lead.conversation_id || conv?.id) && (
                                       <span className="text-[9px] text-blue-500 font-medium">Conversa ativa</span>
                                   )}
                               </div>
                           </div>
                       );
                   })}
               </div>
            </div>

            <div className="flex-1 flex flex-col bg-[#efeae2] relative">
                {activeLead ? (
                    <>
                        <div className="h-16 px-6 border-b border-slate-200 bg-white flex justify-between items-center shadow-sm z-10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-sm">{activeLead.name.charAt(0)}</div>
                                <div>
                                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                        {activeLead.name}
                                        {activeLead.source && <span className="text-[9px] px-2 py-0.5 bg-slate-100 rounded-full text-slate-500 font-normal uppercase">{activeLead.source}</span>}
                                    </h3>
                                    <p className="text-xs text-slate-500">{activeLead.phone} {activeLead.email ? `• ${activeLead.email}` : ''}</p>
                                </div>
                            </div>
                            <button onClick={handleAnalyzeLead} className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:text-blue-600 hover:border-blue-200 flex items-center gap-2 transition-all">
                                {isAnalyzing ? <span className="animate-spin">⌛</span> : <span className="text-lg">✨</span>} AI Insight
                            </button>
                        </div>

                        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col gap-3 relative bg-opacity-50">
                             <div className="absolute inset-0 opacity-[0.05] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] pointer-events-none"></div>
                            {aiAnalysis && <div className="z-10 bg-white/95 backdrop-blur border border-blue-100 p-4 rounded-xl text-xs text-blue-900 shadow-md mx-auto max-w-lg mb-4 text-center leading-relaxed"><strong>🤖 Copilot Insight:</strong> {aiAnalysis}</div>}
                            
                            {chatError ? (
                              <div className="flex-1 flex flex-col items-center justify-center text-rose-500 z-10 gap-2">
                                <span className="text-sm font-semibold">Erro ao carregar mensagens do CRM.</span>
                              </div>
                            ) : isChatLoading ? (
                              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 z-10 gap-2">
                                <span className="animate-spin text-xl animate-bounce">⌛</span>
                                <span className="text-sm">Carregando mensagens do CRM...</span>
                              </div>
                            ) : !selectedConversationId ? (
                              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 z-10 gap-2">
                                <p className="text-sm font-medium bg-white/80 px-4 py-2 rounded-lg border shadow-sm">Este lead ainda não possui conversa vinculada.</p>
                              </div>
                            ) : chatMessages.length === 0 ? (
                              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 z-10 gap-2">
                                <p className="text-sm font-medium bg-white/80 px-4 py-2 rounded-lg border shadow-sm">Nenhuma mensagem nesta conversa ainda.</p>
                              </div>
                            ) : (
                              chatMessages.map(msg => {
                                  const isOutbound = msg.from_me === true || msg.message_direction === 'outbound' || msg.sender_type === 'me' || msg.sender_type === 'ai';
                                  const msgType = (msg.message_type || 'text').toLowerCase();
                                  
                                  const msgTime = msg.sent_at || msg.created_at;
                                  const formattedTime = msgTime ? new Date(msgTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';

                                  // Elemento de renderização dinâmico conforme o tipo
                                  const attachment = (msg as any).attachments && (msg as any).attachments[0];
                                  const sourceUrl = attachment?.source_url || msg.media_url;
                                  const isPending = !sourceUrl || 
                                                    sourceUrl.includes('.enc') || 
                                                    sourceUrl.includes('mmg.whatsapp.net') || 
                                                    (attachment?.raw_metadata?.mediaUrlPending === true) || 
                                                    (attachment?.raw_metadata?.mediaUrlPending === 'true') ||
                                                    ((msg as any).raw_metadata?.mediaUrlPending === true);

                                  // Helper de formatação de bytes
                                  const formatBytes = (bytesNum: number) => {
                                      if (!bytesNum) return '';
                                      const k = 1024;
                                      const dm = 1;
                                      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                                      const i = Math.floor(Math.log(bytesNum) / Math.log(k));
                                      return parseFloat((bytesNum / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
                                  };

                                  // Coleta da legenda/caption normalizada
                                  const getLegenda = () => {
                                      if (msg.caption && String(msg.caption).trim() !== '') {
                                          return msg.caption;
                                      }
                                      const text = msg.message_text;
                                      if (text) {
                                          const lowerText = text.trim().toLowerCase();
                                          const placeholders = ['[imagem]', '[áudio]', '[documento]', '[vídeo]', '[sticker]', '[mensagem]'];
                                          if (!placeholders.includes(lowerText)) {
                                              return text;
                                          }
                                      }
                                      return null;
                                  };
                                  const legenda = getLegenda();

                                  let contentElement = null;

                                  if (msgType === 'deleted' || msg.message_text === 'Mensagem apagada') {
                                      contentElement = (
                                          <div className="italic text-slate-400/80 flex items-center gap-1.5 py-0.5">
                                              <Trash2 size={14} className="text-slate-300" />
                                              <span>Mensagem apagada</span>
                                          </div>
                                      );
                                  } else if (msgType === 'reaction') {
                                      contentElement = (
                                          <div className="italic text-slate-500 flex items-center gap-1.5 py-0.5">
                                              <span>Reagiu:</span>
                                              <span className="text-base not-italic font-bold">{msg.message_text || '❤️'}</span>
                                          </div>
                                      );
                                  } else if (msgType === 'edited') {
                                      contentElement = (
                                          <div className="flex flex-col gap-0.5">
                                              <div>{msg.message_text}</div>
                                              <span className="text-[9px] text-slate-400 italic font-medium block mt-0.5">(editada)</span>
                                          </div>
                                      );
                                  } else if (msgType.includes('image') || msgType === 'sticker') {
                                      const isSticker = msgType === 'sticker';
                                      contentElement = (sourceUrl && !isPending) ? (
                                          <div className="flex flex-col gap-1.5 text-left font-sans">
                                              <div 
                                                  onClick={() => !isSticker && setSelectedImagePreview({ src: sourceUrl, attachment, msg })}
                                                  className={isSticker ? "cursor-default" : "cursor-pointer group relative overflow-hidden rounded-xl border border-slate-200/50 shadow-sm"}
                                              >
                                                  <img 
                                                      src={sourceUrl} 
                                                      alt="Mídia WhatsApp" 
                                                      className={isSticker ? "w-24 h-24 object-contain rounded-lg" : "max-w-xs md:max-w-sm max-h-64 object-cover rounded-xl transition-transform duration-200 group-hover:scale-[1.02]"} 
                                                      referrerPolicy="no-referrer" 
                                                  />
                                                  {!isSticker && (
                                                      <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center animate-fade-in" />
                                                  )}
                                              </div>
                                              {legenda && <p className="text-slate-800 text-sm mt-0.5 max-w-[280px] leading-relaxed break-words">{legenda}</p>}
                                          </div>
                                      ) : (
                                          <div className="flex flex-col p-2 text-slate-400 bg-slate-50/40 rounded-xl border border-slate-100 min-w-[200px] text-left font-sans">
                                              <div className="flex items-center gap-2">
                                                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                                                  <span className="text-xs font-semibold text-slate-500 leading-none">Mídia pendente / baixando...</span>
                                              </div>
                                              <span className="text-[10px] text-slate-400 mt-1 font-sans">Uazapi está carregando a imagem.</span>
                                              {legenda && <p className="text-slate-800 text-sm mt-2 max-w-[250px] leading-relaxed break-words">{legenda}</p>}
                                          </div>
                                      );
                                  } else if (msgType.includes('audio') || msgType.includes('ptt') || msgType.includes('voice')) {
                                      contentElement = (sourceUrl && !isPending) ? (
                                          <div className="flex flex-col gap-1.5 pt-1 min-w-[200px] sm:min-w-[245px] text-left font-sans">
                                              <audio src={sourceUrl} controls className="w-full max-w-[260px] h-9" />
                                              {legenda && <p className="text-slate-800 text-sm mt-1 max-w-[250px] leading-relaxed break-words">{legenda}</p>}
                                          </div>
                                      ) : (
                                          <div className="flex flex-col p-2 text-slate-400 bg-slate-50/40 rounded-xl border border-slate-100 min-w-[200px] text-left font-sans">
                                              <div className="flex items-center gap-2">
                                                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                                                  <span className="text-xs font-semibold text-slate-500 leading-none">Áudio pendente / baixando...</span>
                                              </div>
                                              <span className="text-[10px] text-slate-400 mt-1 font-sans">Uazapi está baixando o áudio.</span>
                                              {legenda && <p className="text-slate-800 text-sm mt-2 max-w-[250px] leading-relaxed break-words">{legenda}</p>}
                                          </div>
                                      );
                                  } else if (msgType.includes('video')) {
                                      contentElement = (sourceUrl && !isPending) ? (
                                          <div className="flex flex-col gap-1.5 text-left font-sans">
                                              <video src={sourceUrl} controls className="max-w-xs md:max-w-sm max-h-64 rounded-xl shadow-sm border border-slate-200/50" />
                                              {legenda && <p className="text-slate-800 text-sm mt-0.5 max-w-[280px] leading-relaxed break-words">{legenda}</p>}
                                          </div>
                                      ) : (
                                          <div className="flex flex-col p-2 text-slate-400 bg-slate-50/40 rounded-xl border border-slate-100 min-w-[200px] text-left font-sans">
                                              <div className="flex items-center gap-2">
                                                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                                                  <span className="text-xs font-semibold text-slate-500 leading-none">Vídeo pendente / baixando...</span>
                                              </div>
                                              <span className="text-[10px] text-slate-400 mt-1 font-sans">Uazapi está processando o arquivo de vídeo.</span>
                                              {legenda && <p className="text-slate-800 text-sm mt-2 max-w-[250px] leading-relaxed break-words">{legenda}</p>}
                                          </div>
                                      );
                                  } else if (msgType.includes('document')) {
                                      const docFilename = attachment?.filename || msg.media_filename || 'documento';
                                      const sizeText = attachment?.size_bytes ? ` (${formatBytes(attachment.size_bytes)})` : '';
                                      contentElement = (sourceUrl && !isPending) ? (
                                          <div className="flex flex-col gap-1.5 text-left font-sans">
                                              <button 
                                                  onClick={() => downloadAttachment(attachment, msg)}
                                                  className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50/90 hover:bg-slate-100/90 border border-slate-200/60 transition-colors text-blue-600 font-bold shadow-xs cursor-pointer text-left w-full outline-hidden"
                                              >
                                                  <FileText size={20} className="text-blue-500 flex-shrink-0" />
                                                  <div className="flex-1 min-w-0">
                                                      <span className="text-xs truncate block max-w-[170px] text-blue-600 font-semibold" title={docFilename}>
                                                          {docFilename}
                                                      </span>
                                                      {sizeText && (
                                                          <span className="text-[10px] text-slate-400 font-medium font-mono">{sizeText}</span>
                                                      )}
                                                  </div>
                                              </button>
                                              {legenda && <p className="text-slate-800 text-sm mt-0.5 max-w-[280px] leading-relaxed break-words">{legenda}</p>}
                                          </div>
                                      ) : (
                                          <div className="flex flex-col p-2 text-slate-400 bg-slate-50/40 rounded-xl border border-slate-100 min-w-[200px] text-left font-sans">
                                              <div className="flex items-center gap-2">
                                                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                                                  <span className="text-xs font-semibold text-slate-500 leading-none">Documento pendente...</span>
                                              </div>
                                              <span className="text-[10px] text-slate-400 mt-1 font-sans">Uazapi está gerando o link do documento.</span>
                                              {legenda && <p className="text-slate-800 text-sm mt-2 max-w-[250px] leading-relaxed break-words">{legenda}</p>}
                                          </div>
                                      );
                                  } else if (msgType.includes('location')) {
                                      const locationQuery = msg.media_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(msg.message_text || '')}`;
                                      contentElement = (
                                          <div className="flex flex-col gap-1.5">
                                              <a 
                                                  href={locationQuery}
                                                  target="_blank" 
                                                  rel="noreferrer" 
                                                  className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50/90 hover:bg-slate-100/90 border border-slate-200/60 transition-colors text-blue-600 font-bold shadow-xs"
                                              >
                                                  <span className="text-lg">📍</span>
                                                  <div className="text-left font-sans">
                                                      <span className="text-[11px] block font-bold text-slate-700">Ver Localização</span>
                                                      <span className="text-[9px] text-slate-400 block truncate max-w-[150px] font-medium">{msg.message_text || 'Abrir Maps'}</span>
                                                  </div>
                                              </a>
                                          </div>
                                      );
                                  } else if (msgType === 'contact') {
                                      contentElement = (
                                          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center gap-2.5 min-w-[180px] select-none text-left font-sans shadow-xs">
                                              <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-black text-xs border border-blue-100">
                                                  {msg.message_text ? msg.message_text.substring(0, 2).toUpperCase() : 'CT'}
                                              </div>
                                              <div className="text-left leading-tight">
                                                  <p className="text-xs font-bold text-slate-700 truncate max-w-[130px]">{msg.message_text || 'Contato WhatsApp'}</p>
                                                  <p className="text-[9px] text-slate-400 font-medium">Contato compartilhado</p>
                                              </div>
                                          </div>
                                      );
                                  } else {
                                      // Renderização de textos padrão segura
                                      let txtContent = msg.message_text || msg.caption || '';
                                      if (!txtContent) {
                                          if (msgType.includes('image')) txtContent = '[imagem]';
                                          else if (msgType.includes('audio') || msgType.includes('voice')) txtContent = '[áudio]';
                                          else if (msgType.includes('video')) txtContent = '[vídeo]';
                                          else if (msgType.includes('document')) txtContent = '[documento]';
                                          else txtContent = '[mensagem]';
                                      }
                                      contentElement = <div className="break-words max-w-[320px] whitespace-pre-wrap">{txtContent}</div>;
                                  }

                                  return (
                                      <div key={msg.id} className={`z-10 max-w-[70%] px-4 py-3 rounded-2xl text-sm shadow-sm relative leading-relaxed flex flex-col ${isOutbound ? 'self-end bg-[#d9fdd3] text-slate-800 rounded-br-none' : 'self-start bg-white text-slate-800 rounded-bl-none'}`}>
                                          {contentElement}
                                          <span className="text-[9px] text-slate-400 block text-right mt-1.5 font-medium opacity-80 select-none align-bottom self-end leading-none">{formattedTime}</span>
                                      </div>
                                  );
                              })
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        <form onSubmit={handleSendMessage} className="p-4 bg-slate-100 border-t border-slate-200 flex gap-3">
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={(e) => {
                                    if (e.target.files && e.target.files[0]) {
                                        setSelectedFileForUpload(e.target.files[0]);
                                        setFileCaption('');
                                    }
                                }}
                                accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
                                className="hidden"
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={!selectedConversationId || sendingMsg}
                                className={`p-3 rounded-xl transition-all shadow-md flex items-center justify-center ${
                                    (!selectedConversationId || sendingMsg)
                                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                        : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                                }`}
                                title="Anexar arquivo"
                            >
                                <Paperclip size={20} />
                            </button>
                            <input 
                                value={messageText} 
                                onChange={e => setMessageText(e.target.value)} 
                                className="flex-1 px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:border-blue-500 text-sm shadow-sm bg-white disabled:bg-slate-50 disabled:text-slate-400" 
                                placeholder={selectedConversationId ? "Digite uma mensagem..." : "Selecione uma conversa para responder."} 
                                disabled={!selectedConversationId || sendingMsg} 
                            />
                            <button 
                                type="submit"
                                disabled={!selectedConversationId || !messageText.trim() || sendingMsg} 
                                className={`p-3 rounded-xl transition-all shadow-md flex items-center justify-center ${
                                    (!selectedConversationId || !messageText.trim() || sendingMsg) 
                                        ? 'bg-blue-600/50 text-white cursor-not-allowed' 
                                        : 'bg-blue-600 text-white hover:bg-blue-700'
                                    }`}
                            >
                                {sendingMsg ? (
                                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                ) : (
                                    <Send size={20}/>
                                )}
                            </button>
                        </form>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4"><MessageCircle size={32} className="opacity-30"/></div>
                        <p className="text-sm font-bold uppercase tracking-widest opacity-50">Selecione um lead para iniciar.</p>
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
                              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Objetivo</th>
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
                                  <td className="px-6 py-4">
                                      <span className="text-xs text-slate-600 block">{lead.source || 'Manual'}</span>
                                      {lead.adName && <span className="text-[9px] text-slate-400 italic">Anúncio: {lead.adName}</span>}
                                  </td>
                                  <td className="px-6 py-4"><span className="text-xs text-slate-500">{lead.objective || '-'}</span></td>
                                  <td className="px-6 py-4 text-sm font-mono font-bold text-emerald-600">R$ {lead.potentialValue}</td>
                                  <td className="px-6 py-4 text-right"><button onClick={() => { setActiveLead(lead); setViewMode('chat'); }} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"><MessageCircle size={16}/></button></td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>
      )}

      {/* MODAL NOVO LEAD EXPANDIDO */}
      {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/80 backdrop-blur-sm animate-in fade-in p-4">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl border border-slate-200 animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-3xl">
                      <div>
                        <h3 className="text-xl font-bold text-navy">Novo Lead</h3>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Adicionar ao Pipeline</p>
                      </div>
                      <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><X size={20} className="text-slate-400"/></button>
                  </div>
                  
                  <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                      <form id="newLeadForm" onSubmit={handleAddLeadSubmit} className="space-y-8">
                          
                          {/* SEÇÃO: DADOS PESSOAIS */}
                          <div>
                              <h4 className="text-xs font-black text-blue-600 uppercase tracking-widest mb-4 flex items-center gap-2"><Users size={14}/> Dados Pessoais</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome Completo *</label>
                                     <input required value={newLeadData.name} onChange={e => setNewLeadData({...newLeadData, name: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" placeholder="Ex: Ana Silva" />
                                  </div>
                                  <div className="space-y-1.5">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Telefone (WhatsApp) *</label>
                                     <input required value={newLeadData.phone} onChange={e => setNewLeadData({...newLeadData, phone: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" placeholder="Ex: 11999999999" />
                                  </div>
                                  <div className="space-y-1.5 md:col-span-2">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">E-mail</label>
                                     <div className="relative">
                                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                                        <input type="email" value={newLeadData.email} onChange={e => setNewLeadData({...newLeadData, email: e.target.value})} className="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" placeholder="ana@email.com" />
                                     </div>
                                  </div>
                              </div>
                          </div>

                          {/* SEÇÃO: RASTREAMENTO & MARKETING */}
                          <div>
                              <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-4 flex items-center gap-2"><Link2 size={14}/> Rastreamento & Marketing</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data de Entrada</label>
                                     <input type="date" required value={newLeadData.entryDate} onChange={e => setNewLeadData({...newLeadData, entryDate: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
                                  </div>
                                  <div className="space-y-1.5">
                                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Origem do Lead</label>
                                      <select value={newLeadData.source} onChange={e => setNewLeadData({...newLeadData, source: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all appearance-none">
                                          <option>Manual</option>
                                          <option>Google Ads</option>
                                          <option>Meta Ads (Insta/Face)</option>
                                          <option>Indicação</option>
                                          <option>Orgânico</option>
                                      </select>
                                  </div>
                                  <div className="space-y-1.5 md:col-span-2">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Anúncio / Campanha</label>
                                     <input value={newLeadData.adName} onChange={e => setNewLeadData({...newLeadData, adName: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" placeholder="Ex: Campanha Botox - Criativo 01" />
                                     <p className="text-[9px] text-slate-400 italic">Se veio de ads, tente especificar qual criativo trouxe o lead.</p>
                                  </div>
                              </div>
                          </div>

                          {/* SEÇÃO: DETALHES CLÍNICOS */}
                          <div>
                              <h4 className="text-xs font-black text-emerald-600 uppercase tracking-widest mb-4 flex items-center gap-2"><Activity size={14}/> Detalhes Clínicos</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Objetivo</label>
                                      <select value={newLeadData.objective} onChange={e => setNewLeadData({...newLeadData, objective: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all appearance-none">
                                          <option>Consulta</option>
                                          <option>Retorno</option>
                                          <option>Procedimento</option>
                                          <option>Exame</option>
                                          <option>Cirurgia</option>
                                      </select>
                                  </div>
                                  <div className="space-y-1.5">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Procedimento Específico</label>
                                     <input value={newLeadData.procedure} onChange={e => setNewLeadData({...newLeadData, procedure: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" placeholder="Ex: Harmonização Facial" />
                                  </div>
                                  <div className="space-y-1.5 md:col-span-2">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor Estimado (R$)</label>
                                     <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">R$</span>
                                        <input type="number" value={newLeadData.value} onChange={e => setNewLeadData({...newLeadData, value: e.target.value})} className="w-full pl-8 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" placeholder="0,00" />
                                     </div>
                                  </div>
                                  <div className="space-y-1.5 md:col-span-2">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Descrição / Observações</label>
                                     <textarea value={newLeadData.description} onChange={e => setNewLeadData({...newLeadData, description: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all min-h-[100px]" placeholder="Detalhes importantes, objeções médicas, histórico..." />
                                  </div>
                              </div>
                          </div>

                      </form>
                  </div>

                  <div className="p-6 border-t border-slate-100 bg-white rounded-b-3xl flex justify-end gap-3">
                     <button type="button" onClick={() => setShowAddModal(false)} className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 hover:bg-slate-50 rounded-xl transition-all">Cancelar</button>
                     <button type="submit" form="newLeadForm" className="bg-navy text-white px-8 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-navy/30 hover:bg-slate-800 transition-all flex items-center gap-2">
                        <Plus size={16} /> Salvar Lead
                     </button>
                  </div>
              </div>
          </div>
      )}

      {/* OVERLAY DIALOG / IMAGE PREVIEW MODAL */}
      {selectedImagePreview && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4 transition-all animate-fade-in">
          {/* Top toolbar */}
          <div className="absolute top-4 right-4 flex items-center gap-3">
            {selectedImagePreview.attachment && (
              <button 
                onClick={() => downloadAttachment(selectedImagePreview.attachment, selectedImagePreview.msg)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-all border border-slate-700 shadow-lg flex items-center gap-1.5 cursor-pointer outline-hidden"
                title="Download"
              >
                <Download size={14} />
                <span>Baixar</span>
              </button>
            )}
            <button 
              onClick={() => setSelectedImagePreview(null)}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-full transition-all border border-slate-700 shadow-lg cursor-pointer outline-hidden"
              title="Fechar"
            >
              <X size={20} />
            </button>
          </div>

          {/* Centered Image */}
          <div className="max-w-4xl max-h-[80vh] flex flex-col items-center justify-center overflow-hidden">
            <img 
              src={selectedImagePreview.src} 
              alt="Visualização" 
              className="max-w-full max-h-[70vh] object-contain rounded-xl shadow-2xl border border-white/10"
              referrerPolicy="no-referrer"
            />
            {/* Show normalized caption if available below the image */}
            {selectedImagePreview.msg && (() => {
                const text = selectedImagePreview.msg.message_text;
                const caption = selectedImagePreview.msg.caption;
                let modalLegenda = null;
                if (caption && String(caption).trim() !== '') {
                    modalLegenda = caption;
                } else if (text) {
                    const lowerText = text.trim().toLowerCase();
                    const placeholders = ['[imagem]', '[áudio]', '[documento]', '[vídeo]', '[sticker]', '[mensagem]'];
                    if (!placeholders.includes(lowerText)) {
                        modalLegenda = text;
                    }
                }
                return modalLegenda ? (
                  <p className="text-white/90 text-sm mt-4 bg-black/40 px-4 py-2 rounded-lg border border-white/5 backdrop-blur-xs max-w-lg text-center leading-relaxed break-words shadow-sm">
                    {modalLegenda}
                  </p>
                ) : null;
            })()}
          </div>
        </div>
      )}

      {/* OVERLAY DIALOG / FILE UPLOAD PREVIEW MODAL */}
      {selectedFileForUpload && (() => {
        const isImage = selectedFileForUpload.type.startsWith('image/');
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in backdrop-blur-xs">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full flex flex-col overflow-hidden max-h-[90vh]">
              
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
                <h3 className="font-semibold text-slate-800 text-base">Enviar Arquivo Comercial</h3>
                <button 
                  type="button"
                  onClick={() => {
                    setSelectedFileForUpload(null);
                    setFileCaption('');
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Content Preview */}
              <div className="p-6 flex flex-col items-center gap-4 overflow-y-auto flex-1">
                {isImage ? (
                  <div className="w-full max-h-[220px] flex items-center justify-center bg-slate-50 rounded-xl overflow-hidden border border-slate-100">
                    <img 
                      src={URL.createObjectURL(selectedFileForUpload)} 
                      alt="Preview" 
                      className="max-w-full max-h-[220px] object-contain rounded-lg"
                    />
                  </div>
                ) : (
                  <div className="w-[84px] h-[84px] bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center border border-blue-100 shadow-sm">
                    <FileText size={40} />
                  </div>
                )}

                <div className="text-center w-full">
                  <p className="font-semibold text-slate-800 break-all text-sm px-2">{selectedFileForUpload.name}</p>
                  <p className="text-xs text-slate-400 mt-1 font-mono">{formatBytes(selectedFileForUpload.size)} • {selectedFileForUpload.type || 'arquivo indocumentado'}</p>
                </div>

                {/* Optional Caption Field */}
                <div className="w-full mt-2">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Legenda (Opcional)</label>
                  <input 
                    type="text"
                    value={fileCaption}
                    onChange={(e) => setFileCaption(e.target.value)}
                    placeholder="Adicione uma legenda ou mensagem para acompanhar o arquivo..."
                    className="w-full px-4 py-3 border border-slate-200 focus:outline-none focus:border-blue-500 rounded-xl text-sm shadow-xs bg-slate-50/50"
                    disabled={sendingMsg}
                  />
                </div>
              </div>

              {/* Actions Footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
                <button
                  type="button"
                  disabled={sendingMsg}
                  onClick={() => {
                    setSelectedFileForUpload(null);
                    setFileCaption('');
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-medium text-sm transition-all focus:outline-none disabled:opacity-50 cursor-pointer"
                >
                  Cancelar
                </button>
                
                <button
                  type="button"
                  disabled={sendingMsg}
                  onClick={async () => {
                    await handleSendAttachment(selectedFileForUpload, fileCaption);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 min-w-[120px] focus:outline-none disabled:opacity-50 cursor-pointer"
                >
                  {sendingMsg ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <>
                      <Send size={16} />
                      <span>Enviar Mídia</span>
                    </>
                  )}
                </button>
              </div>

            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default Sales;