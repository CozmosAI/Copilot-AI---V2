
import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Clock, UserCheck, UserX, ChevronLeft, ChevronRight, Bot, Target, LayoutGrid, List, RefreshCw, X, Save, Edit2, AlertCircle, Loader2, CheckCircle2, Users, UserPlus, Trash2, Plus, Filter } from 'lucide-react';
import { useApp } from '../App';
import { getUpcomingEvents, GoogleCalendarEvent, signInWithGoogleCalendar, createCalendarEvent } from '../services/googleCalendarService';
import { Appointment } from '../types';
import { GoogleCalendarLogo } from './icons/CustomLogos';

type ViewMode = 'month' | 'week';

interface ExtendedGoogleEvent extends GoogleCalendarEvent {
  calendarName?: string;
}

const Agenda: React.FC = () => {
  const { appointments, googleCalendarToken, calendarAccounts, setCalendarAccounts, addAppointment, updateAppointment, user, refreshGoogleCredentials } = useApp();
  const [viewDate, setViewDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [googleEvents, setGoogleEvents] = useState<ExtendedGoogleEvent[]>([]);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState(false);
  
  const [teamCalendars, setTeamCalendars] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('team_calendars');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [activeCalendarEmails, setActiveCalendarEmails] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('active_calendar_emails');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [user?.email || 'Minha Agenda'];
  });

  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [subordinateEmail, setSubordinateEmail] = useState('');
  const [addTeamError, setAddTeamError] = useState('');

  useEffect(() => {
    localStorage.setItem('team_calendars', JSON.stringify(teamCalendars));
  }, [teamCalendars]);

  useEffect(() => {
    localStorage.setItem('active_calendar_emails', JSON.stringify(activeCalendarEmails));
  }, [activeCalendarEmails]);
  
  const [tokenExpiryWarning, setTokenExpiryWarning] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncCount, setSyncCount] = useState(0);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  const getTokenExpiryDays = (token: string | null): number | null => {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload.exp) return null;
      const expDate = new Date(payload.exp * 1000);
      const now = new Date();
      const diffDays = Math.floor((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays;
    } catch (e) {
      return null;
    }
  };

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingApt, setEditingApt] = useState<Appointment | null>(null);
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formTime, setFormTime] = useState('09:00');
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('Consulta');

  const today = new Date();

  // Busca eventos de múltiplas agendas do Google se conectado
  useEffect(() => {
    // Sincronizar seleção ativa de agendas com e-mail do usuário se estiver vazia
    if (activeCalendarEmails.length === 0) {
      const defaultEmail = user?.email || 'Minha Agenda';
      setActiveCalendarEmails([defaultEmail]);
      return;
    }

    if (googleCalendarToken) {
      // Verificar dias até expirar
      const days = getTokenExpiryDays(googleCalendarToken);
      if (days !== null) {
        if (days < 0) {
          setTokenExpiryWarning('expired');
        } else if (days <= 7) {
          setTokenExpiryWarning(`expiring_${days}`);
        } else {
          setTokenExpiryWarning(null);
        }
      }
    } else {
      setTokenExpiryWarning(null);
    }

    const fetchAllEvents = async () => {
      // Se não há contas configuradas e nenhum token principal, limpa os eventos e retorna
      if (calendarAccounts.length === 0 && !googleCalendarToken) {
        setGoogleEvents([]);
        return;
      }

      setLoadingCalendar(true);
      setCalendarError(false);

      const allEvents: ExtendedGoogleEvent[] = [];
      const nowStr = new Date().toISOString();

      for (const email of activeCalendarEmails) {
        // 1. Tenta achar uma conta autenticada via OAuth correspondente
        const oauthAcc = calendarAccounts.find(acc => acc.email === email);
        if (oauthAcc) {
          try {
            const events = await getUpcomingEvents(oauthAcc.token, user?.id);
            allEvents.push(...events.map(ev => ({ ...ev, calendarName: oauthAcc.email })));
          } catch (err) {
            console.error('Erro ao buscar eventos OAuth de:', oauthAcc.email, err);
          }
        } else {
          // 2. Verifica se é uma agenda da equipe (subordinado)
          const isTeam = teamCalendars.includes(email);
          if (isTeam) {
            try {
              // Usa o token do gestor (token ativo) para chamar a API e ler a agenda do subordinado
              const gestorToken = googleCalendarToken || (calendarAccounts.length > 0 ? calendarAccounts[0].token : null);
              if (gestorToken) {
                const response = await fetch(
                  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(email)}/events?timeMin=${nowStr}&maxResults=20&singleEvents=true&orderBy=startTime`,
                  {
                    headers: {
                      'Authorization': `Bearer ${gestorToken}`,
                      'Content-Type': 'application/json'
                    }
                  }
                );
                if (response.ok) {
                  const data = await response.json();
                  const events = data.items || [];
                  allEvents.push(...events.map((ev: any) => ({ ...ev, calendarName: email })));
                } else {
                  console.error('Erro da API Google Calendar ao buscar subordinado:', email, response.statusText);
                }
              }
            } catch (err) {
              console.error('Erro ao buscar agenda da equipe:', email, err);
            }
          } else {
            // 3. Fallback para a conta primária se calendarAccounts estiver vazio mas houver token geral
            if (googleCalendarToken && (email === user?.email || email === 'Minha Agenda')) {
              try {
                const events = await getUpcomingEvents(googleCalendarToken, user?.id);
                allEvents.push(...events.map(ev => ({ ...ev, calendarName: email })));
              } catch (err) {
                console.error('Erro ao buscar agenda primária:', err);
              }
            }
          }
        }
      }

      setGoogleEvents(allEvents);
      setLoadingCalendar(false);
    };

    fetchAllEvents();
  }, [googleCalendarToken, calendarAccounts, activeCalendarEmails, teamCalendars, user?.id]);

  // Sincroniza agendamentos locais não sincronizados para o Google Calendar automaticamente
  useEffect(() => {
    if (!googleCalendarToken || !user?.id || appointments.length === 0) {
      return;
    }
    
    const syncExistingAppointments = async () => {
      const syncedIdsKey = `synced_appointments_${user.id}`;
      const syncedIds: string[] = JSON.parse(localStorage.getItem(syncedIdsKey) || '[]');
      const unsynced = appointments.filter(a => !syncedIds.includes(a.id));
      
      if (unsynced.length === 0) {
        setSyncStatus('idle');
        return;
      }
      
      setSyncStatus('syncing');
      let successCount = 0;
      let failCount = 0;
      const newSyncedIds = [...syncedIds];
      
      for (const apt of unsynced) {
        try {
          const startDateTime = new Date(`${apt.date}T${apt.time || '09:00'}:00`).toISOString();
          const endTime = new Date(new Date(`${apt.date}T${apt.time || '09:00'}:00`).getTime() + 60 * 60 * 1000).toISOString();
          
          const googleEventId = await createCalendarEvent(googleCalendarToken, {
            summary: `${apt.patientName} - ${apt.type}`,
            start: { dateTime: startDateTime },
            end: { dateTime: endTime },
            description: `Agendamento criado via AXIS AI - Tipo: ${apt.type}`
          });
          
          if (googleEventId) {
            newSyncedIds.push(apt.id);
            successCount++;
          } else {
            failCount++;
          }
        } catch (err) {
          console.error('Erro ao sincronizar agendamento:', apt.id, err);
          failCount++;
        }
      }
      
      localStorage.setItem(syncedIdsKey, JSON.stringify(newSyncedIds));
      setSyncCount(successCount);
      
      if (failCount === 0) {
        setSyncStatus('success');
      } else if (successCount === 0) {
        setSyncStatus('error');
      } else {
        setSyncStatus('success'); // partial success
      }
      
      // Reset status after 5 seconds
      setTimeout(() => setSyncStatus('idle'), 5000);
    };
    
    syncExistingAppointments();
  }, [googleCalendarToken, appointments, user?.id]);

  const handleReconnectCalendar = async () => {
     try {
        await signInWithGoogleCalendar();
     } catch (e) {
        console.error("Erro ao reconectar calendário", e);
     }
  };

  // Merge Appointments and Google Events
  const allEvents = useMemo(() => {
     const mappedGoogleEvents = googleEvents.map(ev => {
        const dateStr = ev.start.dateTime ? ev.start.dateTime.split('T')[0] : (ev.start.date || '');
        const timeStr = ev.start.dateTime ? ev.start.dateTime.split('T')[1].slice(0, 5) : 'Dia Inteiro';
        const calLabel = ev.calendarName ? ` (${ev.calendarName.split('@')[0]})` : '';
        return {
           id: ev.id,
           date: dateStr,
           time: timeStr,
           patientName: `${ev.summary || 'Evento Google'}${calLabel}`,
           type: 'Google Calendar',
           status: 'Confirmado' as const,
           isGoogle: true
        };
     });
     return [...appointments, ...mappedGoogleEvents];
  }, [appointments, googleEvents]);


  const stats = [
    { label: 'Taxa de Ocupação', value: '78%', trend: 5, icon: <Target className="text-blue-500" /> },
    { label: 'Horários Ociosos', value: '12h', trend: -2, icon: <Clock className="text-amber-500" /> },
    { label: 'Taxa de Falta', value: '14%', trend: -3, icon: <UserX className="text-rose-500" /> },
    { label: 'Retornos Marcados', value: '42', trend: 12, icon: <UserCheck className="text-emerald-500" /> },
  ];

  // Filtra agendamentos para o dia selecionado (para a sidebar)
  const todayStr = viewDate.toISOString().split('T')[0];
  const todaySlots = useMemo(() => {
    return allEvents.filter(a => a.date === todayStr).sort((a,b) => a.time.localeCompare(b.time));
  }, [allEvents, todayStr]);

  // Calendar logic
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const currentMonth = viewDate.getMonth();
  const currentYear = viewDate.getFullYear();
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const monthNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  // Navigation Logic
  const handleNavigate = (direction: number) => {
    if (viewMode === 'month') {
      setViewDate(new Date(currentYear, currentMonth + direction, 1));
    } else {
      const newDate = new Date(viewDate);
      newDate.setDate(viewDate.getDate() + (direction * 7));
      setViewDate(newDate);
    }
  };

  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getDate() === d2.getDate() && 
           d1.getMonth() === d2.getMonth() && 
           d1.getFullYear() === d2.getFullYear();
  };

  // Get current week days based on viewDate
  const currentWeekDays = useMemo(() => {
    const startOfWeek = new Date(viewDate);
    startOfWeek.setDate(viewDate.getDate() - viewDate.getDay());
    
    return Array.from({ length: 7 }).map((_, i) => {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + i);
      return day;
    });
  }, [viewDate]);

  // Handle Form
  const handleOpenModal = () => {
    setFormDate(todayStr);
    setFormTime('09:00');
    setFormName('');
    setFormType('Consulta');
    setEditingApt(null);
    setShowModal(true);
  };

  const handleEditClick = (apt: Appointment) => {
    setEditingApt(apt);
    setFormDate(apt.date);
    setFormTime(apt.time);
    setFormName(apt.patientName);
    setFormType(apt.type || 'Consulta');
    setShowModal(true);
  };

  const handleEditStatus = async (apt: any, newStatus: string) => {
     if (apt.isGoogle) return;
     await updateAppointment({ ...apt, status: newStatus });
  };

  const handleSubmit = async (e: React.FormEvent) => {
     e.preventDefault();
     if (!formName) return;

     if (editingApt) {
        await updateAppointment({
           ...editingApt,
           date: formDate,
           time: formTime,
           patientName: formName,
           type: formType as any
        });
     } else {
        const newAptId = crypto.randomUUID();
        const newApt: any = {
           id: newAptId,
           date: formDate,
           time: formTime,
           patientName: formName,
           type: formType,
           status: 'Confirmado'
         };

         if (googleCalendarToken) {
            try {
               const startDateTime = new Date(`${formDate}T${formTime}:00`).toISOString();
               const endTime = new Date(new Date(`${formDate}T${formTime}:00`).getTime() + 60 * 60 * 1000).toISOString();
               
               const googleEventId = await createCalendarEvent(googleCalendarToken, {
                 summary: `${formName} - ${formType}`,
                 start: { dateTime: startDateTime },
                 end: { dateTime: endTime },
                 description: `Agendamento criado via AXIS AI - Tipo: ${formType}`
               });

               if (googleEventId && user?.id) {
                  const syncedIdsKey = `synced_appointments_${user.id}`;
                  const syncedIds = JSON.parse(localStorage.getItem(syncedIdsKey) || '[]');
                  syncedIds.push(newAptId);
                  localStorage.setItem(syncedIdsKey, JSON.stringify(syncedIds));
               }
            } catch (err) {
               console.error('Erro ao sincronizar novo agendamento com o Google Calendar:', err);
            }
         }

         await addAppointment(newApt);
     }
     setShowModal(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12 relative">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold text-navy">Gestão de Agenda</h2>
            {googleCalendarToken && appointments.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (user?.id) {
                    localStorage.removeItem(`synced_appointments_${user.id}`);
                    // Forçar re-render pra re-disparar o useEffect
                    setSyncStatus('syncing');
                    setTimeout(() => {
                      // Trigger re-sync by updating appointments reference
                      setSyncStatus('idle');
                    }, 100);
                  }
                }}
                className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 shadow-sm"
                title="Reenviar todos os agendamentos para o Google Calendar"
              >
                <RefreshCw size={14} />
                Sincronizar Calendar
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
             <p className="text-slate-500">Otimize seu tempo e reduza a ociosidade.</p>
             {googleCalendarToken && (
               <>
                 {calendarError ? (
                    <button onClick={handleReconnectCalendar} className="flex items-center gap-1 text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-full uppercase hover:bg-rose-100 transition-colors">
                       <AlertCircle size={10} /> Sessão Expirada (Reconectar)
                    </button>
                 ) : (
                    <span className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full uppercase">
                      <GoogleCalendarLogo size={12} /> <RefreshCw size={10} className={`${loadingCalendar ? 'animate-spin' : ''}`} /> Google Calendar Sincronizado
                    </span>
                 )}
               </>
             )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <button 
              onClick={() => setShowFilterDropdown(!showFilterDropdown)} 
              className="bg-white px-3 py-2.5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-colors"
            >
              <Calendar size={16} className="text-slate-500" />
              <span className="text-sm font-bold text-slate-700">Filtrar</span>
              <Filter size={14} className="text-slate-400" />
            </button>
            
            {showFilterDropdown && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-lg border border-slate-100 p-3 z-50">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Agendas Conectadas</h4>
                
                <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                  {/* Minha Agenda (se nenhuma conectada formalmente) */}
                  {calendarAccounts.length === 0 && (
                    <label className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition-all cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeCalendarEmails.includes(user?.email || 'Minha Agenda')}
                        onChange={(e) => {
                          const email = user?.email || 'Minha Agenda';
                          if (e.target.checked) setActiveCalendarEmails(prev => [...prev, email]);
                          else setActiveCalendarEmails(prev => prev.filter(x => x !== email));
                        }}
                        className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 border-slate-300"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-700 truncate">Minha Agenda</p>
                        <p className="text-[10px] text-slate-400 truncate">{user?.email || ''}</p>
                      </div>
                    </label>
                  )}
                  
                  {/* Contas Google */}
                  {calendarAccounts.map((account) => (
                    <label key={account.email} className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition-all cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeCalendarEmails.includes(account.email)}
                        onChange={(e) => {
                          if (e.target.checked) setActiveCalendarEmails(prev => [...prev, account.email]);
                          else setActiveCalendarEmails(prev => prev.filter(x => x !== account.email));
                        }}
                        className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 border-slate-300"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-700 truncate">{account.email === user?.email ? 'Minha Agenda' : 'Agenda Conectada'}</p>
                        <p className="text-[10px] text-slate-400 truncate">{account.email}</p>
                      </div>
                    </label>
                  ))}
                  
                  {/* Agendas de Equipe */}
                  {teamCalendars.length > 0 && <div className="pt-2 border-t border-slate-100 mt-2"></div>}
                  {teamCalendars.map((email) => (
                    <label key={email} className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition-all cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeCalendarEmails.includes(email)}
                        onChange={(e) => {
                          if (e.target.checked) setActiveCalendarEmails(prev => [...prev, email]);
                          else setActiveCalendarEmails(prev => prev.filter(x => x !== email));
                        }}
                        className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 border-slate-300"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-700 truncate">Equipe: {email.split('@')[0]}</p>
                        <p className="text-[10px] text-slate-400 truncate">{email}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-2">
            <Clock size={16} className="text-blue-500" />
            <span className="text-sm font-bold text-navy">
              {today.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </span>
          </div>
        </div>
      </header>

      {googleCalendarToken && tokenExpiryWarning && (
        <div className={`p-4 rounded-xl border flex items-start gap-3 ${
          tokenExpiryWarning === 'expired' 
            ? 'bg-rose-50 border-rose-200 text-rose-800' 
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold">
              {tokenExpiryWarning === 'expired' 
                ? 'Acesso ao Google Calendar expirado' 
                : `Acesso ao Google Calendar expira em ${tokenExpiryWarning.replace('expiring_', '')} dias`
              }
            </p>
            <p className="text-xs mt-0.5 opacity-90">
              {tokenExpiryWarning === 'expired' 
                ? 'Clique em "Reconectar" para voltar a ver seus agendamentos.'
                : 'Recomendamos reconectar antes que expire para não perder acesso aos agendamentos.'
              }
            </p>
          </div>
          <button 
            type="button"
            onClick={handleReconnectCalendar}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors shrink-0 ${
              tokenExpiryWarning === 'expired'
                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                : 'bg-amber-500 hover:bg-amber-600 text-white'
            }`}
          >
            Reconectar
          </button>
        </div>
      )}

      {syncStatus === 'syncing' && (
        <div className="mb-4 p-4 rounded-xl border bg-blue-50 border-blue-200 text-blue-800 flex items-center gap-3">
          <Loader2 size={20} className="animate-spin shrink-0 text-blue-600" />
          <div>
            <p className="text-sm font-bold">Sincronizando agendamentos com Google Calendar...</p>
            <p className="text-xs mt-0.5 opacity-90">Aguarde, seus agendamentos estão sendo enviados para o Google Calendar.</p>
          </div>
        </div>
      )}

      {syncStatus === 'success' && (
        <div className="mb-4 p-4 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-center gap-3">
          <CheckCircle2 size={20} className="shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-bold">{syncCount} agendamento(s) sincronizado(s) com Google Calendar!</p>
            <p className="text-xs mt-0.5 opacity-90">Você já pode ver seus agendamentos no Google Calendar.</p>
          </div>
        </div>
      )}

      {syncStatus === 'error' && (
        <div className="mb-4 p-4 rounded-xl border bg-rose-50 border-rose-200 text-rose-800 flex items-center gap-3">
          <AlertCircle size={20} className="shrink-0 text-rose-600" />
          <div>
            <p className="text-sm font-bold">Erro ao sincronizar com Google Calendar</p>
            <p className="text-xs mt-0.5 opacity-90">Verifique se o token não expirou e tente novamente. Seus agendamentos continuam salvos no AXIS.</p>
          </div>
        </div>
      )}



      {/* KPI GRID */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-4">
        {stats.map((stat, i) => (
          <div key={`stat-kpi-${stat.label}-${i}`} className="bg-white p-3 md:p-5 rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-all">
            <div className="flex justify-between items-start mb-1 md:mb-2">
              <span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate mr-1">{stat.label}</span>
              <div className="p-1.5 md:p-2 bg-slate-50 rounded-lg shrink-0">{stat.icon}</div>
            </div>
            <div className="text-lg md:text-2xl font-bold text-navy leading-none mt-1">{stat.value}</div>
            <div className={`text-[8px] md:text-[10px] mt-1.5 md:mt-2 font-bold uppercase truncate ${stat.trend > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {stat.trend > 0 ? '+' : ''}{stat.trend}% vs média
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CALENDAR VIEW SECTION */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-navy text-white rounded-xl shadow-lg">
                <Calendar size={22} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-navy leading-none">
                  {viewMode === 'month' ? monthNames[currentMonth] : `Semana de ${currentWeekDays[0].getDate()} a ${currentWeekDays[6].getDate()}`}
                </h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                  {viewMode === 'month' ? currentYear : `${monthNames[currentWeekDays[0].getMonth()]} ${currentWeekDays[0].getFullYear()}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* VIEW SWITCHER */}
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                <button 
                  onClick={() => setViewMode('month')}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all ${viewMode === 'month' ? 'bg-white text-navy shadow-sm' : 'text-slate-500 hover:text-navy'}`}
                >
                  <LayoutGrid size={14} /> Mês
                </button>
                <button 
                  onClick={() => setViewMode('week')}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all ${viewMode === 'week' ? 'bg-white text-navy shadow-sm' : 'text-slate-500 hover:text-navy'}`}
                >
                  <List size={14} /> Semana
                </button>
              </div>

              {/* NAVIGATION */}
              <div className="flex gap-2">
                <button 
                  onClick={() => handleNavigate(-1)}
                  className="p-2 hover:bg-slate-50 rounded-xl border border-slate-200 text-slate-500 transition-colors shadow-sm"
                >
                  <ChevronLeft size={18} />
                </button>
                <button 
                  onClick={() => handleNavigate(1)}
                  className="p-2 hover:bg-slate-50 rounded-xl border border-slate-200 text-slate-500 transition-colors shadow-sm"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>
          
          <div className="flex-1">
            {viewMode === 'month' ? (
              /* MONTHLY VIEW GRID */
              <div className="grid grid-cols-7 gap-3 animate-in fade-in duration-300">
                {weekDays.map(d => (
                  <div key={d} className="text-center text-[10px] font-extrabold text-slate-400 uppercase py-2 tracking-widest">{d}</div>
                ))}
                
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`empty-${i}`} className="h-24 bg-slate-50/20 rounded-xl border border-transparent"></div>
                ))}

                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateObj = new Date(currentYear, currentMonth, day);
                  const dateStr = dateObj.toISOString().split('T')[0];
                  const currentIsToday = isSameDay(dateObj, today);
                  
                  // Verifica quantos agendamentos tem neste dia
                  const dayAppointments = allEvents.filter(a => a.date === dateStr);
                  const count = dayAppointments.length;
                  const isOccupied = count > 0;
                  const isFull = count > 10;
                  
                  return (
                    <div 
                      key={day} 
                      onClick={() => setViewDate(dateObj)}
                      className={`h-24 border rounded-xl p-3 transition-all relative cursor-pointer group
                        ${isSameDay(dateObj, viewDate) ? 'ring-2 ring-blue-500' : ''}
                        ${currentIsToday ? 'border-navy shadow-lg bg-white z-10' : 'border-slate-100 hover:border-slate-300 hover:bg-slate-50 bg-white/50'}
                        ${isFull && !currentIsToday ? 'bg-slate-50/80' : ''}
                      `}
                    >
                      <div className="flex justify-between items-start">
                        <span className={`text-[12px] font-black ${currentIsToday ? 'text-navy' : 'text-slate-400'}`}>
                          {day}
                        </span>
                        {isOccupied && !isFull && (
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.5)]"></div>
                        )}
                        {isFull && (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-900 shadow-[0_0_5px_rgba(15,23,42,0.5)]"></div>
                        )}
                      </div>
                      
                      <div className="mt-3 space-y-1.5">
                        <div className={`h-1 w-full rounded-full transition-all ${isFull ? 'bg-slate-900' : (isOccupied ? 'bg-blue-400' : 'bg-slate-100')}`}></div>
                        {isOccupied && (
                          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter truncate">
                            {count} Eventos
                          </p>
                        )}
                      </div>
                      
                      {currentIsToday && (
                        <div className="absolute inset-x-0 bottom-0 bg-navy text-white text-[7px] font-black text-center py-0.5 rounded-b-md uppercase tracking-[0.2em] animate-pulse">
                          Hoje
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              /* WEEKLY VIEW GRID */
              <div className="grid grid-cols-7 gap-4 animate-in slide-in-from-right duration-300">
                {currentWeekDays.map((date, idx) => {
                  const currentIsToday = isSameDay(date, today);
                  const dateStr = date.toISOString().split('T')[0];
                  const dayAppointments = allEvents.filter(a => a.date === dateStr);
                  const isOccupied = dayAppointments.length > 0;
                  
                  return (
                    <div 
                      key={`weekly-col-${dateStr}-${idx}`}
                      className={`flex flex-col min-h-[400px] rounded-2xl border transition-all ${currentIsToday ? 'bg-white ring-2 ring-navy border-navy shadow-xl' : 'bg-slate-50/50 border-slate-100'}`}
                    >
                      <div className={`p-4 border-b text-center rounded-t-2xl ${currentIsToday ? 'bg-navy text-white' : 'border-slate-100 bg-white'}`}>
                        <p className={`text-[10px] font-black uppercase tracking-widest ${currentIsToday ? 'text-blue-300' : 'text-slate-400'}`}>{weekDays[idx]}</p>
                        <p className="text-2xl font-black mt-1 leading-none">{date.getDate()}</p>
                      </div>
                      
                      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[320px] custom-scrollbar">
                        {isOccupied ? (
                           <div className="space-y-1">
                              {dayAppointments.map((app, i) => (
                                <div key={app.id ? `apt-item-${app.id}` : `apt-item-g-${dateStr}-${i}-${app.time}`} className={`p-2 rounded-lg border shadow-sm ${ (app as any).isGoogle ? 'bg-amber-50 border-amber-100' : 'bg-white border-slate-100'}`}>
                                  <div className="flex items-center justify-between gap-1 mb-1">
                                    <span className={`text-[8px] font-black uppercase ${ (app as any).isGoogle ? 'text-amber-600' : 'text-slate-400'}`}>{app.time.slice(0, 5)}</span>
                                    <div className={`w-1.5 h-1.5 rounded-full ${ (app as any).isGoogle ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>
                                  </div>
                                  <p className="text-[9px] font-bold text-navy truncate">{app.patientName}</p>
                                </div>
                              ))}
                           </div>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-50 px-2 py-10">
                             <Clock size={16} className="mb-2" />
                             <p className="text-[8px] font-black uppercase tracking-widest text-center leading-tight">Livre</p>
                          </div>
                        )}
                      </div>
                      
                      {currentIsToday && (
                         <div className="p-2 bg-navy text-center border-t border-white/10">
                            <span className="text-[7px] font-black text-blue-300 uppercase tracking-widest">Atendimento Ativo</span>
                         </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* DAILY SLOTS & INSIGHTS (SIDEBAR) */}
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
            <h3 className="text-xs font-bold text-navy mb-6 uppercase tracking-widest flex items-center gap-2">
              <Clock size={16} className="text-blue-500" /> Detalhes do Dia
            </h3>
            <div className="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar">
              {todaySlots.length === 0 ? (
                  <p className="text-xs text-slate-400 italic text-center py-4">Nenhum agendamento para este dia.</p>
              ) : todaySlots.map((slot, i) => (
                <div key={slot.id ? `slot-today-${slot.id}` : `slot-today-g-${i}-${slot.time}`} className={`flex items-center gap-4 p-4 rounded-xl border transition-all hover:shadow-md ${ (slot as any).isGoogle ? 'bg-amber-50 border-amber-100' : 'bg-white border-slate-100'}`}>
                  <div className="flex flex-col items-center min-w-[40px]">
                    <span className="text-[10px] font-black text-navy">{slot.time.slice(0, 5)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                        <p className={`text-xs font-bold truncate text-navy`}>
                          {slot.patientName}
                        </p>
                        {!slot.isGoogle && (
                            <button onClick={() => handleEditClick(slot)} className="text-slate-300 hover:text-navy transition-colors">
                                <Edit2 size={12} />
                            </button>
                        )}
                    </div>
                    {/* Select de Status Simples para Agenda */}
                    {!(slot as any).isGoogle ? (
                      <select 
                        value={slot.status} 
                        onChange={(e) => handleEditStatus(slot, e.target.value)}
                        className="mt-1 text-[9px] bg-slate-50 border border-slate-200 rounded px-1 py-0.5 text-slate-500 uppercase font-bold focus:outline-none cursor-pointer"
                      >
                         <option value="Confirmado">Confirmado</option>
                         <option value="Realizado">Realizado</option>
                         <option value="Cancelado">Cancelado</option>
                      </select>
                    ) : (
                      <p className="text-[9px] text-amber-500 font-bold uppercase tracking-tight mt-0.5">Google Calendar</p>
                    )}
                  </div>
                  {slot.status === 'Confirmado' && (
                    <div className={`w-2.5 h-2.5 rounded-full shadow-lg shrink-0 ${ (slot as any).isGoogle ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>
                  )}
                  {slot.status === 'Realizado' && <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0"></div>}
                  {slot.status === 'Cancelado' && <div className="w-2.5 h-2.5 rounded-full bg-slate-300 shrink-0"></div>}
                </div>
              ))}
            </div>
            <button 
                onClick={handleOpenModal}
                className="w-full mt-8 bg-slate-900 text-white py-4 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
            >
              Adicionar Novo Agendamento
            </button>
          </div>

          {/* AI AGENDA INSIGHT ENHANCED */}
          <div className="bg-navy p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden border border-white/5">
            <div className="absolute -right-6 -top-6 opacity-10">
              <Bot size={120} />
            </div>
            <div className="relative z-10 flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-500/20 rounded-xl h-fit border border-blue-500/30">
                  <Bot className="text-blue-400" size={24} />
                </div>
                <h4 className="font-black text-xs uppercase tracking-widest text-blue-400 leading-none">Copiloto da Agenda</h4>
              </div>
              <p className="text-[13px] text-slate-300 leading-relaxed italic font-medium">
                "Notei que as **Quintas-feiras** têm 35% de ociosidade recorrente. 
                Sugiro abrir o agendamento online para **Consultas de Telemedicina** nesses horários. 
                Isso pode elevar seu faturamento semanal em até **12%**."
              </p>
              <div className="pt-4 border-t border-white/5">
                <button className="text-[9px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2 group">
                  Aplicar Otimização Automática <ChevronRight size={12} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Agendamento */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-navy/80 backdrop-blur-md animate-in fade-in duration-300">
           <div className="bg-white rounded-[40px] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
              <form onSubmit={handleSubmit}>
                 <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h3 className="text-xl font-bold text-navy">{editingApt ? 'Editar Agendamento' : 'Novo Agendamento'}</h3>
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">Insira os dados do paciente</p>
                    </div>
                    <button type="button" onClick={() => setShowModal(false)} className="p-2 hover:bg-slate-200 rounded-full transition-all text-slate-400"><X size={24} /></button>
                 </div>
                 <div className="p-8 space-y-4">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome do Paciente</label>
                        <input required type="text" value={formName} onChange={e => setFormName(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:ring-2 focus:ring-navy" placeholder="Ex: Maria Silva" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data</label>
                            <input required type="date" value={formDate} onChange={e => setFormDate(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:ring-2 focus:ring-navy" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hora</label>
                            <input required type="time" value={formTime} onChange={e => setFormTime(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:ring-2 focus:ring-navy" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo</label>
                        <select value={formType} onChange={e => setFormType(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy appearance-none">
                            <option>Consulta</option>
                            <option>Retorno</option>
                            <option>Procedimento</option>
                        </select>
                    </div>
                 </div>
                 <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                    <button type="button" onClick={() => setShowModal(false)} className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 hover:bg-slate-200 rounded-2xl transition-all">Cancelar</button>
                    <button type="submit" className="bg-navy text-white px-8 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-navy/30 hover:bg-slate-800 transition-all flex items-center gap-2">
                        <Save size={16} /> Salvar
                    </button>
                 </div>
              </form>
           </div>
        </div>
      )}

      {/* Modal para Adicionar Agenda de Subordinado */}
      {showAddTeamModal && (
        <div className="fixed inset-0 bg-navy/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-[40px] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!subordinateEmail) return;
              if (!subordinateEmail.includes('@')) {
                setAddTeamError('Por favor, insira um e-mail válido.');
                return;
              }
              if (teamCalendars.includes(subordinateEmail)) {
                setAddTeamError('Esta agenda já foi adicionada.');
                return;
              }
              
              setTeamCalendars(prev => [...prev, subordinateEmail]);
              setActiveCalendarEmails(prev => [...prev, subordinateEmail]);
              setShowAddTeamModal(false);
              setSubordinateEmail('');
              setAddTeamError('');
            }}>
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div>
                  <h3 className="text-xl font-bold text-navy">Adicionar Agenda da Equipe</h3>
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">Conecte agendas de subordinados</p>
                </div>
                <button type="button" onClick={() => { setShowAddTeamModal(false); setSubordinateEmail(''); setAddTeamError(''); }} className="p-2 hover:bg-slate-200 rounded-full transition-all text-slate-400">
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-8 space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">E-mail do Subordinado</label>
                  <input
                    required
                    type="email"
                    value={subordinateEmail}
                    onChange={(e) => { setSubordinateEmail(e.target.value); setAddTeamError(''); }}
                    placeholder="Ex: dr.joao@gmail.com"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-navy focus:outline-none focus:ring-2 focus:ring-navy"
                  />
                  {addTeamError && <p className="text-rose-500 text-xs mt-1 font-semibold">{addTeamError}</p>}
                </div>
                <p className="text-[10px] text-slate-400 font-bold uppercase leading-relaxed">
                  Nota: O AXIS utilizará a API do Google Calendar com o token do gestor para acessar a agenda do subordinado. O subordinado precisa compartilhar a agenda dele com você (permissão de visualização ou edição).
                </p>
              </div>

              <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setShowAddTeamModal(false); setSubordinateEmail(''); setAddTeamError(''); }}
                  className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 hover:bg-slate-200 rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="bg-navy text-white px-8 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-navy/30 hover:bg-slate-800 transition-all flex items-center gap-2"
                >
                  <Save size={16} /> Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Agenda;
