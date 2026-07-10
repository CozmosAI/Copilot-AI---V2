import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  MessageCircle, Clock, Search, Send, Plus, X, Download, Paperclip,
  BarChart3, LayoutGrid, List as ListIcon, 
  Filter, MoreHorizontal, Calendar, DollarSign,
  TrendingUp, Users, PieChart as PieChartIcon, ArrowRight,
  Mail, Link2, Tag, FileText, Activity, GripHorizontal, Edit2, Check, Trash2, Smile, Mic, Image as ImageIcon, Headphones
} from 'lucide-react';
import { analyzeLeadConversation } from '../services/geminiService';
import { apiFetch, apiUrl, safeJsonResponse } from '../services/apiClient';
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

const formatConversationPreview = (conv: any, leadLastMessage?: string) => {
    const type = conv?.last_message_type?.toLowerCase() || '';
    const text = conv?.last_message_text || leadLastMessage;
    const isOutbound = conv?.last_sender === 'me' || conv?.last_sender === 'ai';

    if (type === 'image') return isOutbound ? '📸 Imagem enviada' : '📸 Imagem recebida';
    if (type === 'audio' || type === 'voice') return isOutbound ? '🎤 Áudio enviado' : '🎤 Áudio recebido';
    if (type === 'video') return isOutbound ? '🎥 Vídeo enviado' : '🎥 Vídeo recebido';
    if (type === 'document') return isOutbound ? '📄 Documento enviado' : '📄 Documento recebido';
    if (type === 'sticker') return isOutbound ? '✨ Figurinha enviada' : '✨ Figurinha recebida';
    
    if (text && text.trim().length > 0) {
        // Se o text for uma tag crua, converter para amigável
        const rawTags = ['[midia]', '[mídia]', '[mensagem]', '[documento]', '[imagem]', '[áudio]', '[video]', '[vídeo]', '[sticker]', '[figurinha]'];
        if (rawTags.includes(text?.trim()?.toLowerCase())) {
            const tagMap: Record<string, string> = {
                '[midia]': 'Mídia', '[mídia]': 'Mídia',
                '[mensagem]': 'Mensagem',
                '[documento]': 'Documento',
                '[imagem]': 'Imagem',
                '[áudio]': 'Áudio', '[audio]': 'Áudio',
                '[video]': 'Vídeo', '[vídeo]': 'Vídeo',
                '[sticker]': 'Figurinha', '[figurinha]': 'Figurinha'
            };
            return tagMap[text.trim().toLowerCase()] || 'Mídia';
        }
        return text;
    }
    
    return 'Sem mensagens ainda';
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
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [attachmentAccept, setAttachmentAccept] = useState('image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain');

  // CRM Integration States
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<any | null>(null);
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatSendError, setChatSendError] = useState<string | null>(null);
  const [phoneValidationError, setPhoneValidationError] = useState<string | null>(null);
  const [addLeadPhoneError, setAddLeadPhoneError] = useState<string | null>(null);
  const [editLeadPhoneError, setEditLeadPhoneError] = useState<string | null>(null);
  const [isStartingConversation, setIsStartingConversation] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [conversationsMap, setConversationsMap] = useState<Record<string, any>>({});

  // Image Preview Modal state and esc listener
  const [selectedImagePreview, setSelectedImagePreview] = useState<{ src: string; attachment?: any; msg?: any } | null>(null);
  const [showClearChatModal, setShowClearChatModal] = useState(false);
  const [isClearingChat, setIsClearingChat] = useState(false);

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

  // Edit Lead Form State
  const [showEditModal, setShowEditModal] = useState(false);
  const formatPhoneWithMask = (value: string) => {
      const clean = value.replace(/\D/g, '');
      if (clean.startsWith('55')) {
          return clean;
      }
      if (clean.length > 11) {
          return clean;
      }
      if (clean.length <= 2) return clean;
      if (clean.length <= 6) return `(${clean.slice(0, 2)}) ${clean.slice(2)}`;
      if (clean.length <= 10) return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
      return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
  };

  const validateLeadPhone = (phone: string): { ok: boolean; error: string | null; clean?: string; normalized?: string } => {
      const clean = String(phone || '').replace(/\D/g, '');

      if (!clean) {
          return { ok: false, error: "O telefone não pode ser vazio." };
      }

      const hasCountryCode = clean.startsWith('55');

      // Sem DDI: aceitar apenas 10 ou 11 dígitos.
      if (!hasCountryCode) {
          if (clean.length === 10 || clean.length === 11) {
              return { ok: true, error: null, clean, normalized: `55${clean}` };
          }
          return {
              ok: false,
              clean,
              error: `Telefone inválido. Use DDD + número, com ou sem DDI 55. Ex: 4187348600 ou 554187348600.`
          };
      }

      // Com DDI 55: aceitar apenas 12 ou 13 dígitos.
      if (clean.length === 12 || clean.length === 13) {
          return { ok: true, error: null, clean, normalized: clean };
      }
      return {
          ok: false,
          clean,
          error: `Telefone inválido. Use DDD + número, com ou sem DDI 55. Ex: 4187348600 ou 554187348600.`
      };
  };

  const [editingLeadData, setEditingLeadData] = useState<Lead | null>(null);

  const handleOpenEditModal = (lead: Lead) => {
      setEditingLeadData({
          ...lead,
          potentialValue: lead.potentialValue || 0,
          email: lead.email || '',
          notes: lead.notes || '',
          source: lead.source || 'Manual',
          procedure: lead.procedure || '',
          objective: lead.objective || 'Consulta',
          adName: lead.adName || ''
      });
      setShowEditModal(true);
  };

  const handleEditLeadSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingLeadData) return;
      setEditLeadPhoneError(null);

      const validation = validateLeadPhone(editingLeadData.phone);
      if (!validation.ok) {
          setEditLeadPhoneError(validation.error);
          return;
      }

      const finalPhone = validation.normalized!;
      const updatedLead = { ...editingLeadData, phone: finalPhone };

      await updateLead(updatedLead);
      
      // Update activeLead if it's currently selected
      if (activeLead && activeLead.id === editingLeadData.id) {
          const oldPhone = activeLead.phone;
          setActiveLead(updatedLead);
          
          // Limpar erros de validação de telefone e do composer
          setPhoneValidationError(null);
          setChatSendError(null);

          // Se o telefone mudou ou foi corrigido, re-iniciar conversa p/ atualizar crm_contacts e conexões no backend
          if (oldPhone !== finalPhone) {
              setTimeout(async () => {
                  try {
                      const token = await supabase.auth.getSession().then(({ data }) => data.session?.access_token);
                      if (token) {
                          await apiFetch(`/api/crm/leads/${updatedLead.id}/start-whatsapp-conversation`, {
                              method: 'POST',
                              headers: { 'Authorization': `Bearer ${token}` }
                          });
                      }
                  } catch (err) {
                      console.error("Erro ao sincronizar novo telefone do lead com crm_contacts:", err);
                  }
              }, 100);
          }
      }
      
      setShowEditModal(false);
      setEditingLeadData(null);
  };

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

          const response = await fetch(apiUrl(`/api/crm/attachments/${attachment.id}/download`), {
              headers: {
                  'Authorization': `Bearer ${token}`
              }
          });

          if (!response.ok) {
              const errData = await safeJsonResponse(response).catch(() => ({}));
              alert(errData.error || "O arquivo ainda não está disponível para download. Servidor pode ter retornado erro ou HTML.");
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
        
        // Marcar como lida e zerar unread_count
        const token = await supabase.auth.getSession().then(({ data }) => data.session?.access_token);
        if (token) {
            try {
                const response = await apiFetch(`/api/crm/conversations/${convId}/mark-read`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                // Trata a response mas ignora erro para nao quebrar UI
                await safeJsonResponse(response).catch(()=>({}));
                
                // Atualizar estado local para remover badge imediatamente
                setConversationsMap(prev => {
                    const existing = prev[convId];
                    if (!existing) return prev;
                    const updated = { ...existing, unread_count: 0 };
                    return {
                        ...prev,
                        [convId]: updated,
                        ...(updated.lead_id ? { [`lead_${updated.lead_id}`]: updated } : {})
                    };
                });
                if (selectedConversation) {
                    setSelectedConversation((prev: any) => prev ? { ...prev, unread_count: 0 } : null);
                }
            } catch (err) {
                console.error("Erro ao marcar conversa como lida:", err);
            }
        }

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

  const handleClearChatHistory = async () => {
    if (!selectedConversationId) return;
    setIsClearingChat(true);
    try {
      // Chamar o endpoint seguro do backend que deleta usando supabaseAdmin e limpa os dados
      const token = await supabase.auth.getSession().then(({ data }) => data.session?.access_token);
      const response = await apiFetch(`/api/crm/conversations/${selectedConversationId}/clear-chat`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const result = await safeJsonResponse(response);
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Falha desconhecida no servidor");
      }

      // 4. Limpar o estado local de mensagens
      setChatMessages([]);

      // 5. Atualizar o conversationsMap local do React para limpar a última mensagem mostrada na esquerda
      setConversationsMap(prev => {
        const existing = prev[selectedConversationId];
        const leadId = activeLead?.id || existing?.lead_id;
        const updated = existing ? {
          ...existing,
          last_message_text: null,
          last_message_type: null,
          last_message_at: null,
          unread_count: 0
        } : {
          id: selectedConversationId,
          lead_id: leadId,
          last_message_text: null,
          last_message_type: null,
          last_message_at: null,
          unread_count: 0
        };
        
        const nextMap = {
          ...prev,
          [selectedConversationId]: updated
        };
        if (leadId) {
          nextMap[`lead_${leadId}`] = updated;
        }
        return nextMap;
      });

      if (selectedConversation) {
        setSelectedConversation((prev: any) => prev ? {
          ...prev,
          last_message_text: null,
          last_message_type: null,
          last_message_at: null,
          unread_count: 0
        } : null);
      }

      // 6. Limpar lastMessage e lastInteraction do lead ativo no estado local
      if (activeLead) {
        const updatedLead = {
          ...activeLead,
          lastMessage: undefined,
          lastInteraction: undefined
        };
        setActiveLead(updatedLead);
        await updateLead(updatedLead);
      }

      // Fechar modal e avisar sucesso
      setShowClearChatModal(false);
      alert("Histórico de mensagens apagado com sucesso!");
    } catch (err: any) {
      console.error("Erro ao apagar histórico de mensagens:", err);
      alert("Falha ao apagar histórico de mensagens: " + (err.message || err));
    } finally {
      setIsClearingChat(false);
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    if (!window.confirm("Tem certeza? Esta ação vai apagar o lead, todas as conversas e mensagens. Não pode ser desfeito.")) {
        return;
    }
    try {
        const token = await supabase.auth.getSession().then(({ data }) => data.session?.access_token);
        const response = await apiFetch(`/api/crm/leads/${leadId}/delete`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await safeJsonResponse(response);
        if (!response.ok || !result.ok) {
            throw new Error(result.error || "Falha desconhecida ao deletar lead");
        }

        alert("Lead apagado com sucesso");
        setActiveLead(null);
    } catch (err: any) {
        console.error("Erro ao deletar lead:", err);
        alert(err.message || "Erro ao deletar lead.");
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
          const token = await supabase.auth.getSession().then(({ data }) => data.session?.access_token);

          if (!token) {
              alert("Sessão expirada. Por favor, faça login novamente.");
              setSendingMsg(false);
              return;
          }

          const formData = new FormData();
          formData.append('file', file);
          formData.append('caption', caption);

          const response = await apiFetch(`/api/crm/conversations/${selectedConversationId}/send-media`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${token}`
              },
              body: formData
          });

          const result = await safeJsonResponse(response);

          if (result.ok) {
              if (result.message) {
                  const newMsg = result.message;
                  setChatMessages(prev => {
                      if (prev.some(m => m.id === newMsg.id)) return prev;
                      return [...prev, newMsg];
                  });
              }
              // Limpar preview e arquivo apenas em caso de sucesso
              setSelectedFileForUpload(null);
              setFileCaption('');
              if (fileInputRef.current) fileInputRef.current.value = '';
          } else {
              if (result.code === "INVALID_LEAD_PHONE" || result.phone_validation) {
                  setChatSendError("Telefone inválido. Revise o cadastro do lead. Use DDD + número, exemplo: 4187348600 ou 554187348600.");
              } else {
                  alert(`Erro ao salvar/enviar mídia: ${result.error || "Ocorreu um erro desconhecido."}`);
              }
          }
      } catch (err: any) {
          console.error("Erro ao enviar mídia do CRM:", err);
          alert(`Erro ao salvar/enviar mídia: Ocorreu uma falha de conexão.`);
      } finally {
          setSendingMsg(false);
      }
  };

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([audioBlob], `Audio_${new Date().getTime()}.webm`, { type: 'audio/webm' });
        await handleSendAttachment(file, '');
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingTimerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Erro ao acessar o microfone", err);
      alert("Não foi possível acessar o microfone. Verifique as permissões de áudio do seu navegador.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const cancelRecording = () => {
     if (mediaRecorderRef.current && isRecording) {
       mediaRecorderRef.current.onstop = null; // Disable sending
       mediaRecorderRef.current.stop();
       mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
       setIsRecording(false);
       if (recordingTimerRef.current) {
         clearInterval(recordingTimerRef.current);
         recordingTimerRef.current = null;
       }
     }
  };

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAttachmentSelect = (type: 'document' | 'image' | 'audio') => {
      switch (type) {
          case 'document':
              setAttachmentAccept("application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain");
              break;
          case 'image':
              setAttachmentAccept("image/*,video/*");
              break;
          case 'audio':
              setAttachmentAccept("audio/*");
              break;
      }
      setShowAttachmentMenu(false);
      setTimeout(() => {
          fileInputRef.current?.click();
      }, 0);
  };

  const handleStartWhatsAppConversation = async () => {
      if (!activeLead || !activeLead.phone) return;
      setIsStartingConversation(true);
      setChatError(null);
      setPhoneValidationError(null);
      try {
          const token = await supabase.auth.getSession().then(({ data }) => data.session?.access_token);
          if (!token) throw new Error("Não autenticado");

          const response = await apiFetch(`/api/crm/leads/${activeLead.id}/start-whatsapp-conversation`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` }
          });

          const result = await safeJsonResponse(response);
          if (response.ok && result.ok && result.conversation) {
              setSelectedConversationId(result.conversation.id);
              setSelectedConversation(result.conversation);
              setChatMessages([]);
              
              // Update local maps
              setConversationsMap(prev => ({
                  ...prev,
                  [result.conversation.id]: result.conversation,
                  [`lead_${activeLead.id}`]: result.conversation
              }));
              
              // Refresh lead on screen (with conv ID)
              setActiveLead(result.lead);
          } else {
              setChatError(result.error || 'Não consegui iniciar a conversa. Verifique as conexões do CRM.');
              if (result.phone_validation) {
                  setPhoneValidationError(result.phone_validation.reason || result.error);
              } else {
                  setPhoneValidationError(result.error);
              }
          }
      } catch (err: any) {
          console.error("Erro ao iniciar conversa:", err);
          setChatError(err?.message || 'Falha ao conectar com o servidor e iniciar a conversa.');
          setPhoneValidationError(err?.message || 'Falha ao conectar com o servidor e iniciar a conversa.');
      } finally {
          setIsStartingConversation(false);
      }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedConversationId || !messageText.trim() || sendingMsg) return;

      const bodyText = messageText.trim();
      setSendingMsg(true);
      setChatSendError(null);

      try {
          const token = await supabase.auth.getSession().then(({ data }) => data.session?.access_token);

          if (!token) {
              setChatSendError("Sessão expirada. Por favor, faça login novamente.");
              setSendingMsg(false);
              return;
          }

          const response = await apiFetch(`/api/crm/conversations/${selectedConversationId}/send`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ text: bodyText })
          });

          const result = await safeJsonResponse(response);

          if (result.ok && result.message) {
              setMessageText('');
              const newMsg = result.message;
              setChatMessages(prev => {
                  if (prev.some(m => m.id === newMsg.id)) return prev;
                  return [...prev, newMsg];
              });
              
              // Atualizar local map para preview imediato
              setConversationsMap(prev => {
                  const existing = prev[selectedConversationId];
                  if (!existing) return prev;
                  const updated = { 
                      ...existing, 
                      last_message_text: newMsg.message_text,
                      last_message_type: 'text',
                      last_sender: 'me',
                      last_message_at: newMsg.sent_at || newMsg.created_at,
                      unread_count: 0
                  };
                  return {
                      ...prev,
                      [selectedConversationId]: updated,
                      ...(updated.lead_id ? { [`lead_${updated.lead_id}`]: updated } : {})
                  };
              });
          } else {
              if (result.code === "INVALID_LEAD_PHONE" || result.phone_validation) {
                  setChatSendError("Telefone inválido. Revise o cadastro do lead. Use DDD + número, exemplo: 4187348600 ou 554187348600.");
              } else {
                  setChatSendError(result.error || "Erro no backend CRM ao enviar mensagem. Verifique a conexão.");
              }
          }
      } catch (err) {
          console.error("Erro ao enviar mensagem:", err);
          setChatSendError("Erro no backend CRM ao enviar mensagem. Verifique a conexão.");
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
      setAddLeadPhoneError(null);

      const validation = validateLeadPhone(newLeadData.phone);
      if (!validation.ok) {
          setAddLeadPhoneError(validation.error);
          return;
      }

      const finalPhone = validation.normalized!;

      await addLead({ 
          id: '', 
          name: newLeadData.name, 
          phone: finalPhone, 
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
                             <div className="flex items-center gap-1 shrink-0">
                                <button onClick={(e) => { e.stopPropagation(); handleOpenEditModal(lead); }} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-100 text-slate-400 hover:text-blue-500 rounded transition-all cursor-pointer" title="Editar Lead">
                                    <Edit2 size={12} />
                                </button>
                                {lead.potentialValue ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">R${lead.potentialValue}</span> : null}
                             </div>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4 mb-4 md:mb-6 shrink-0">
          <div className="bg-white p-3 md:p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                  <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Pipeline Total</p>
                  <p className="text-base md:text-xl font-black text-navy leading-none">R$ {pipelineValue.toLocaleString('pt-BR', { notation: 'compact' })}</p>
              </div>
              <div className="p-1.5 md:p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0"><DollarSign size={16} className="md:w-5 md:h-5" /></div>
          </div>
          <div className="bg-white p-3 md:p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                  <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Leads Ativos</p>
                  <p className="text-base md:text-xl font-black text-navy leading-none">{activeLeadsCount}</p>
              </div>
              <div className="p-1.5 md:p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0"><Users size={16} className="md:w-5 md:h-5" /></div>
          </div>
          <div className="bg-white p-3 md:p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                  <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Conversão</p>
                  <p className="text-base md:text-xl font-black text-emerald-600 leading-none">{conversionRate.toFixed(1)}%</p>
              </div>
              <div className="p-1.5 md:p-2 bg-emerald-50 text-emerald-600 rounded-lg shrink-0"><TrendingUp size={16} className="md:w-5 md:h-5" /></div>
          </div>
           {/* VIEW SWITCHER */}
          <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
             {[{id: 'kanban', icon: <LayoutGrid size={14} className="md:w-4 md:h-4"/>}, {id: 'list', icon: <ListIcon size={14} className="md:w-4 md:h-4"/>}, {id: 'chat', icon: <MessageCircle size={14} className="md:w-4 md:h-4"/>}, {id: 'metrics', icon: <BarChart3 size={14} className="md:w-4 md:h-4"/>}].map((mode) => (
                <button key={mode.id} onClick={() => setViewMode(mode.id as ViewMode)} className={`flex-1 h-full py-1.5 md:py-2.5 rounded-lg flex items-center justify-center transition-all ${viewMode === mode.id ? 'bg-navy text-white shadow-md' : 'text-slate-400 hover:text-navy hover:bg-slate-50'}`}>
                   {mode.icon}
                </button>
             ))}
             <button onClick={() => setShowAddModal(true)} className="ml-1.5 bg-blue-600 hover:bg-blue-700 text-white p-2 md:p-2.5 rounded-lg shadow-md transition-all shrink-0">
                <Plus size={14} className="md:w-4 md:h-4" />
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
          <div className="flex-1 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
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
                   })
                   .sort((a, b) => {
                       const convA = conversationsMap[a.conversation_id || ''] || conversationsMap[`lead_${a.id}`];
                       const convB = conversationsMap[b.conversation_id || ''] || conversationsMap[`lead_${b.id}`];
                       
                       const timeA = convA?.last_message_at ? new Date(convA.last_message_at).getTime() : new Date(a.created_at || 0).getTime();
                       const timeB = convB?.last_message_at ? new Date(convB.last_message_at).getTime() : new Date(b.created_at || 0).getTime();
                       
                       return timeB - timeA; // Descending
                   })
                   .map(lead => {
                       const conv = conversationsMap[lead.conversation_id || ''] || conversationsMap[`lead_${lead.id}`];
                       const displayLastMessage = formatConversationPreview(conv, lead.lastMessage);
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
                            <div className="flex items-center gap-2">
                                <button onClick={() => handleOpenEditModal(activeLead)} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 hover:text-blue-600 hover:border-blue-200 transition-all flex items-center justify-center" title="Editar Dados do Lead">
                                    <Edit2 size={14} />
                                </button>
                                <button 
                                    onClick={() => handleDeleteLead(activeLead.id)} 
                                    className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-500 hover:text-rose-700 hover:border-rose-300 transition-all flex items-center justify-center" 
                                    title="Deletar Lead"
                                >
                                    <Trash2 size={14} />
                                </button>
                                <button onClick={handleAnalyzeLead} className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:text-blue-600 hover:border-blue-200 flex items-center gap-2 transition-all">
                                    {isAnalyzing ? <span className="animate-spin">⌛</span> : <span className="text-lg">✨</span>} AI Insight
                                </button>
                                {selectedConversationId && (
                                    <button 
                                        onClick={() => setShowClearChatModal(true)} 
                                        className="px-4 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs font-bold text-rose-600 hover:bg-rose-100 hover:text-rose-700 flex items-center gap-2 transition-all"
                                        title="Limpar Histórico de Mensagens"
                                    >
                                        <Trash2 size={14} />
                                        Limpar Chat
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col gap-3 relative bg-opacity-50">
                             <div className="absolute inset-0 opacity-[0.05] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] pointer-events-none"></div>
                            {aiAnalysis && <div className="z-10 bg-white/95 backdrop-blur border border-blue-100 p-4 rounded-xl text-xs text-blue-900 shadow-md mx-auto max-w-lg mb-4 text-center leading-relaxed"><strong>🤖 Copilot Insight:</strong> {aiAnalysis}</div>}
                            
                            {isChatLoading ? (
                              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 z-10 gap-2">
                                <span className="animate-spin text-xl animate-bounce">⌛</span>
                                <span className="text-sm">Carregando mensagens do CRM...</span>
                              </div>
                            ) : !selectedConversationId ? (
                              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 z-10 gap-3">
                                {chatError && (
                                  <div className="text-rose-500 text-sm font-semibold max-w-sm text-center mb-2 px-4 py-2 bg-rose-50 border border-rose-200 rounded-xl shadow-sm">
                                    {chatError}
                                  </div>
                                )}
                                {!activeLead.phone ? (
                                    <p className="text-sm font-medium bg-white/80 px-4 py-2 rounded-lg border shadow-sm text-center">Este lead não possui telefone para iniciar WhatsApp.</p>
                                ) : (
                                    <>
                                        <p className="text-sm font-medium bg-white/80 px-4 py-2 rounded-lg border shadow-sm mb-2">Este lead ainda não possui conversa no WhatsApp.</p>
                                        <button 
                                            onClick={handleStartWhatsAppConversation} 
                                            disabled={isStartingConversation}
                                            className="px-6 py-3 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                                        >
                                            {isStartingConversation ? (
                                                <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Iniciando...</>
                                            ) : (
                                                <><MessageCircle size={20} className="fill-white/20" /> Iniciar conversa no WhatsApp</>
                                            )}
                                        </button>
                                        {phoneValidationError && (
                                            <div className="mt-3 text-center px-4 py-2 bg-rose-50 border border-rose-200 text-rose-600 text-xs rounded-xl max-w-sm font-semibold">
                                                <p className="font-bold mb-1">Telefone inválido. Revise o cadastro do lead. Use DDD + número, exemplo: 4187348600 ou 554187348600.</p>
                                                <p className="opacity-80">Motivo: {phoneValidationError}</p>
                                            </div>
                                        )}
                                    </>
                                )}
                              </div>
                            ) : chatError ? (
                              <div className="flex-1 flex flex-col items-center justify-center text-rose-500 z-10 gap-2">
                                <span className="text-sm font-semibold">Erro ao carregar mensagens do CRM.</span>
                                <p className="text-xs text-rose-400">{chatError}</p>
                              </div>
                            ) : chatMessages.length === 0 ? (
                              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 z-10 gap-2">
                                <p className="text-sm font-medium bg-white/80 px-4 py-2 rounded-lg border shadow-sm">Conversa iniciada. Envie a primeira mensagem.</p>
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

                        {chatSendError && (
                            <div className="px-4 py-2 bg-rose-50 border-t border-b border-rose-200 text-rose-655 text-sm font-semibold flex justify-between items-center z-20">
                                <span>{chatSendError}</span>
                                <button type="button" onClick={() => setChatSendError(null)} className="text-rose-400 hover:text-rose-600 font-bold ml-2 text-lg">×</button>
                            </div>
                        )}

                        <form onSubmit={handleSendMessage} className="px-4 py-3 bg-[#f0f2f5] border-t border-slate-200 flex items-center gap-2 relative">
                            {/* Attachment Menu Popover */}
                            {showAttachmentMenu && (
                                <div className="absolute bottom-16 left-4 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 w-56 animate-fade-in z-50 overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => handleAttachmentSelect('document')}
                                        className="w-full px-5 py-3 hover:bg-slate-50 flex items-center gap-4 transition-colors text-slate-700 text-[15px] font-medium"
                                    >
                                        <div className="bg-[#7F66FF] text-white p-2.5 rounded-full shadow-sm"><FileText size={20} strokeWidth={2.5} /></div>
                                        Documento
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleAttachmentSelect('image')}
                                        className="w-full px-5 py-3 hover:bg-slate-50 flex items-center gap-4 transition-colors text-slate-700 text-[15px] font-medium"
                                    >
                                        <div className="bg-[#007AFC] text-white p-2.5 rounded-full shadow-sm"><ImageIcon size={20} strokeWidth={2.5} /></div>
                                        Fotos e vídeos
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleAttachmentSelect('audio')}
                                        className="w-full px-5 py-3 hover:bg-slate-50 flex items-center gap-4 transition-colors text-slate-700 text-[15px] font-medium"
                                    >
                                        <div className="bg-[#FF7A00] text-white p-2.5 rounded-full shadow-sm"><Headphones size={20} strokeWidth={2.5} /></div>
                                        Áudio
                                    </button>
                                </div>
                            )}

                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={(e) => {
                                    if (e.target.files && e.target.files[0]) {
                                        setSelectedFileForUpload(e.target.files[0]);
                                        setFileCaption('');
                                    }
                                }}
                                accept={attachmentAccept}
                                className="hidden"
                            />
                            {!isRecording && (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
                                        disabled={!selectedConversationId || sendingMsg}
                                        className={`p-2 transition-all flex items-center justify-center text-slate-500 rounded-full cursor-pointer ${
                                            (!selectedConversationId || sendingMsg) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-200'
                                        }`}
                                        title="Anexar arquivo"
                                    >
                                        <Plus size={26} strokeWidth={2.5} className={(showAttachmentMenu) ? "rotate-45 transition-transform" : "transition-transform"} />
                                    </button>
                                    <button
                                        type="button"
                                        className="p-2 transition-all flex items-center justify-center text-slate-500 hover:bg-slate-200 rounded-full cursor-not-allowed opacity-80"
                                        disabled
                                    >
                                        <Smile size={26} strokeWidth={2.2} />
                                    </button>
                                </>
                            )}
                            
                            {isRecording ? (
                                <div className="flex-1 flex items-center justify-between mx-2 px-5 py-3 rounded-full bg-white text-slate-700 shadow-sm border border-rose-200 h-[46px]">
                                    <div className="flex flex-1 items-center gap-3">
                                        <div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse"></div>
                                        <span className="font-mono text-sm font-medium text-slate-600">{formatRecordingTime(recordingTime)}</span>
                                        <span className="text-sm text-slate-400 font-medium">Gravando...</span>
                                    </div>
                                    <button 
                                        type="button" 
                                        onClick={cancelRecording}
                                        className="text-slate-400 hover:text-rose-500 transition-colors p-1"
                                        title="Cancelar gravação"
                                    >
                                        <Trash2 size={20} />
                                    </button>
                                </div>
                            ) : (
                                <input 
                                    value={messageText} 
                                    onChange={e => setMessageText(e.target.value)} 
                                    onFocus={() => setShowAttachmentMenu(false)}
                                    className="flex-1 mx-2 px-5 py-3 rounded-full bg-white focus:outline-none text-slate-700 placeholder-slate-500 text-[15px] border border-transparent shadow-sm disabled:opacity-50" 
                                    placeholder={selectedConversationId ? "Digite uma mensagem..." : "Selecione uma conversa"} 
                                    disabled={!selectedConversationId || sendingMsg} 
                                />
                            )}

                            {isRecording ? (
                                <button
                                    type="button"
                                    onClick={stopRecording}
                                    className="p-2.5 transition-all flex items-center justify-center text-white bg-emerald-500 hover:bg-emerald-600 rounded-full cursor-pointer shadow-md"
                                    title="Enviar áudio"
                                >
                                    <Send size={24} className="ml-0.5" />
                                </button>
                            ) : (
                                <button 
                                    type={messageText.trim() ? "submit" : "button"}
                                    onClick={messageText.trim() ? undefined : startRecording}
                                    disabled={!selectedConversationId || sendingMsg} 
                                    className={`p-2.5 transition-all flex items-center justify-center text-slate-500 rounded-full ${
                                        (!selectedConversationId || sendingMsg) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-200 cursor-pointer'
                                    }`}
                                >
                                    {sendingMsg ? (
                                        <span className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></span>
                                    ) : messageText.trim() ? (
                                        <Send size={24} className="ml-1 text-slate-600" />
                                    ) : (
                                        <Mic size={24} className="text-slate-600" />
                                    )}
                                </button>
                            )}
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
              <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100 flex-1">
                  <table className="min-w-[800px] w-full text-left">
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
                                  <td className="px-6 py-4 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                          <button onClick={() => handleOpenEditModal(lead)} className="p-2 text-slate-400 hover:bg-slate-100 hover:text-blue-500 rounded-lg transition-colors" title="Editar Lead">
                                              <Edit2 size={16}/>
                                          </button>
                                          <button onClick={() => { setActiveLead(lead); setViewMode('chat'); }} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Enviar Mensagem">
                                              <MessageCircle size={16}/>
                                          </button>
                                      </div>
                                  </td>
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
                                     <input required value={newLeadData.phone} onChange={e => setNewLeadData({...newLeadData, phone: formatPhoneWithMask(e.target.value)})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" placeholder="Ex: (11) 99999-9999" />
                                     {addLeadPhoneError && <p className="text-rose-500 text-xs font-semibold mt-1 bg-rose-50 p-2 rounded border border-rose-100">{addLeadPhoneError}</p>}
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

      {/* MODAL EDITAR LEAD EXPANDIDO */}
      {showEditModal && editingLeadData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/80 backdrop-blur-sm animate-in fade-in p-4">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl border border-slate-200 animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-3xl">
                      <div>
                        <h3 className="text-xl font-bold text-navy">Editar Lead</h3>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Atualizar Pipeline</p>
                      </div>
                      <button onClick={() => { setShowEditModal(false); setEditingLeadData(null); }} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><X size={20} className="text-slate-400"/></button>
                  </div>
                  
                  <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                      <form id="editLeadForm" onSubmit={handleEditLeadSubmit} className="space-y-8">
                          
                          {/* SEÇÃO: DADOS PESSOAIS */}
                          <div>
                              <h4 className="text-xs font-black text-blue-600 uppercase tracking-widest mb-4 flex items-center gap-2"><Users size={14}/> Dados Pessoais</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome Completo *</label>
                                     <input required value={editingLeadData.name} onChange={e => setEditingLeadData({...editingLeadData, name: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
                                  </div>
                                  <div className="space-y-1.5">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Telefone (WhatsApp) *</label>
                                     <input required value={editingLeadData.phone} onChange={e => setEditingLeadData({...editingLeadData, phone: formatPhoneWithMask(e.target.value)})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
                                      {!validateLeadPhone(editingLeadData.phone).ok && (
                                          <p className="text-amber-600 text-xs font-semibold mt-1 bg-amber-50 p-2 rounded border border-amber-100">
                                              Telefone inválido. Corrija antes de salvar.
                                          </p>
                                      )}
                                      {editLeadPhoneError && <p className="text-rose-500 text-xs font-semibold mt-1 bg-rose-50 p-2 rounded border border-rose-100">{editLeadPhoneError}</p>}
                                  </div>
                                  <div className="space-y-1.5 md:col-span-2">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">E-mail</label>
                                     <div className="relative">
                                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                                        <input type="email" value={editingLeadData.email || ''} onChange={e => setEditingLeadData({...editingLeadData, email: e.target.value})} className="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
                                     </div>
                                  </div>
                              </div>
                          </div>

                          {/* SEÇÃO: RASTREAMENTO & MARKETING */}
                          <div>
                              <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-4 flex items-center gap-2"><Link2 size={14}/> Rastreamento & Marketing</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Origem do Lead</label>
                                      <select value={editingLeadData.source || 'Manual'} onChange={e => setEditingLeadData({...editingLeadData, source: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all appearance-none">
                                          <option value="Manual">Manual</option>
                                          <option value="Google Ads">Google Ads</option>
                                          <option value="Meta Ads (Insta/Face)">Meta Ads (Insta/Face)</option>
                                          <option value="Indicação">Indicação</option>
                                          <option value="Orgânico">Orgânico</option>
                                      </select>
                                  </div>
                                  <div className="space-y-1.5">
                                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Temperatura</label>
                                      <select value={editingLeadData.temperature || 'Cold'} onChange={e => setEditingLeadData({...editingLeadData, temperature: e.target.value as any})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all appearance-none">
                                          <option value="Cold">Cold (Frio)</option>
                                          <option value="Warm">Warm (Morno)</option>
                                          <option value="Hot">Hot (Quente)</option>
                                      </select>
                                  </div>
                                  <div className="space-y-1.5 md:col-span-2">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Anúncio / Campanha</label>
                                     <input value={editingLeadData.adName || ''} onChange={e => setEditingLeadData({...editingLeadData, adName: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
                                  </div>
                              </div>
                          </div>

                          {/* SEÇÃO: DETALHES CLÍNICOS */}
                          <div>
                              <h4 className="text-xs font-black text-emerald-600 uppercase tracking-widest mb-4 flex items-center gap-2"><Activity size={14}/> Detalhes Clínicos</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Objetivo</label>
                                      <select value={editingLeadData.objective || 'Consulta'} onChange={e => setEditingLeadData({...editingLeadData, objective: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all appearance-none">
                                          <option value="Consulta">Consulta</option>
                                          <option value="Retorno">Retorno</option>
                                          <option value="Procedimento">Procedimento</option>
                                          <option value="Exame">Exame</option>
                                          <option value="Cirurgia">Cirurgia</option>
                                      </select>
                                  </div>
                                  <div className="space-y-1.5">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Procedimento Específico</label>
                                     <input value={editingLeadData.procedure || ''} onChange={e => setEditingLeadData({...editingLeadData, procedure: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
                                  </div>
                                  <div className="space-y-1.5 md:col-span-2">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Valor Estimado (R$)</label>
                                     <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">R$</span>
                                        <input type="number" value={editingLeadData.potentialValue || ''} onChange={e => setEditingLeadData({...editingLeadData, potentialValue: Number(e.target.value) || 0})} className="w-full pl-8 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" />
                                     </div>
                                  </div>
                                  <div className="space-y-1.5 md:col-span-2">
                                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Descrição / Observações</label>
                                     <textarea value={editingLeadData.notes || ''} onChange={e => setEditingLeadData({...editingLeadData, notes: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all min-h-[100px]" />
                                  </div>
                              </div>
                          </div>

                      </form>
                  </div>

                  <div className="p-6 border-t border-slate-100 bg-white rounded-b-3xl flex justify-end gap-3">
                     <button type="button" onClick={() => { setShowEditModal(false); setEditingLeadData(null); }} className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 hover:bg-slate-50 rounded-xl transition-all">Cancelar</button>
                     <button type="submit" form="editLeadForm" className="bg-navy text-white px-8 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-navy/30 hover:bg-slate-800 transition-all flex items-center gap-2">
                        <Check size={16} /> Salvar Alterações
                     </button>
                  </div>
              </div>
          </div>
      )}

      {/* OVERLAY DIALOG / IMAGE PREVIEW MODAL */}
      {/* MODAL DE CONFIRMAÇÃO DE LIMPEZA DE CHAT */}
      {showClearChatModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy/80 backdrop-blur-sm animate-in fade-in p-4">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md border border-slate-200 animate-in zoom-in-95 flex flex-col p-6">
                  <div className="flex items-start gap-4">
                      <div className="p-3 bg-rose-50 rounded-2xl text-rose-500">
                          <Trash2 size={24} />
                      </div>
                      <div className="flex-1">
                          <h3 className="text-lg font-bold text-navy">Apagar histórico de mensagens?</h3>
                          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Ação Irreversível</p>
                          <p className="text-sm text-slate-500 mt-3 leading-relaxed">
                              Tem certeza que deseja apagar permanentemente todo o histórico de mensagens e anexos deste lead?
                          </p>
                          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-3 flex gap-2.5 items-start">
                              <span className="text-amber-500 text-sm mt-0.5">⚠️</span>
                              <p className="text-[11px] text-amber-800 leading-relaxed font-medium">
                                  <strong>Atenção:</strong> Isso removerá todas as mensagens e mídias salvas localmente no CRM para este contato. Esta ação não poderá ser desfeita.
                              </p>
                          </div>
                      </div>
                  </div>
                  
                  <div className="flex gap-3 mt-6 justify-end">
                      <button 
                          type="button" 
                          onClick={() => setShowClearChatModal(false)} 
                          className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-50 rounded-xl transition-all"
                          disabled={isClearingChat}
                      >
                          Cancelar
                      </button>
                      <button 
                          type="button" 
                          onClick={handleClearChatHistory} 
                          className="px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white bg-rose-600 hover:bg-rose-700 active:scale-95 rounded-xl shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
                          disabled={isClearingChat}
                      >
                          {isClearingChat ? "Limpando..." : "Sim, Apagar tudo"}
                      </button>
                  </div>
              </div>
          </div>
      )}

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