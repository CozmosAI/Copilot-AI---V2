
import React from 'react';

export enum AppSection {
  DASHBOARD = 'dashboard',
  MARKETING = 'marketing',
  VENDAS = 'vendas',
  AGENDA = 'agenda',
  AUTOMACAO = 'automacao',
  FINANCEIRO = 'financeiro',
  INTEGRACAO = 'integracao',
  GRAVADOR = 'gravador',
  PERFIL = 'perfil',
  AXIS = 'axis' // Nova Seção
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  label: string;
}

// --- PERFIL & USUÁRIO ---
export type UserRole = 'owner' | 'admin' | 'member';

export interface User {
  id: string;
  name: string;
  clinic: string;
  email: string;
  plan: 'free' | 'pro' | 'enterprise';
  ticketValue: number;
  phone?: string;
  specialty?: string;
  procedures?: string;
  city?: string;
  role?: UserRole;
  avatar_url?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'pending';
  addedAt: string;
}

// --- GRAVADOR & SOAP ---
export interface ConsultationRecording {
  id: string;
  patientName: string;
  date: string;
  duration: string;
  transcript?: string; // Texto bruto
  soap: {
    s: string; // Subjetivo
    o: string; // Objetivo
    a: string; // Avaliação
    p: string; // Plano
  };
  audioUrl?: string; // Blob URL
}

// --- CONFIGURAÇÃO DA IA ---
export interface AIConfig {
  active: boolean;
  name: string;
  role: string; // Ex: SDR, Secretária
  objective: string; // Ex: Agendar, Tirar Dúvidas
  prompt: string;
  negativePrompt: string; // O que não fazer
  
  // Fontes de Dados (Contexto)
  useProfile: boolean; // Acesso aos dados do médico
  useCRM: boolean; // Saber status do lead
  useHistory: boolean; // Ler mensagens anteriores
  
  // Operacional
  triggerType: 'always' | 'off_hours' | 'delay';
  delaySeconds: number;
  workingHours: {
    start: string;
    end: string;
    weekends: boolean;
  };
}

// --- TABELA: MARKETING_METRICS ---
export interface GoogleAdAccount {
  id: string;
  name: string; // resourceName no Google Ads
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
}

export interface AdPerformance {
  platform: 'google' | 'meta';
  spend: number;
  leads: number;
  cpl: number; // Custo por Lead
  appointments: number; // Consultas Marcadas
  cpa: number; // Custo por Agendamento
  topAd: {
    name: string;
    imageUrl: string;
    headline: string;
    clicks: number;
    generatedLeads: number; // Leads gerados especificamente por este criativo
  };
}

// --- TABELA: LEADS (CRM) ---
export interface Lead {
  id: string; // UUID no banco
  name: string;
  phone: string;
  email?: string; // Novo
  procedure?: string; // Novo (Interesse)
  objective?: string; // Novo (Consulta, Retorno, etc)
  adName?: string; // Novo (Qual anúncio trouxe)
  notes?: string; // Novo (Obs)
  status: string; // ALTERADO: De union type fixo para string para permitir colunas personalizadas
  temperature: 'Hot' | 'Warm' | 'Cold';
  lastMessage?: string;
  lastInteraction?: string;
  lastSender?: 'me' | 'contact'; // NOVO: Para saber quem mandou a última msg
  history?: string; // JSON ou Texto longo
  potentialValue?: number;
  source?: string;
  created_at?: string;
  conversation_id?: string; // Vincular ao CRM
  channel?: string;
  external_chat_id?: string;
}

// --- TABELA: MENSAGENS WHATSAPP ---
export interface ChatMessage {
  id: string;
  lead_id?: string;
  sender: 'me' | 'contact';
  body: string;
  created_at: string;
  status: 'sent' | 'delivered' | 'read';
}

// --- TABELA: TRANSACTIONS (Financeiro) ---
export enum FinancialSubSection {
  OVERVIEW = 'overview',
  PAYABLE = 'payable',
  RECEIVABLE = 'receivable',
  CASHFLOW = 'cashflow'
}

export type FinancialEntryStatus = 'efetuada' | 'atrasada' | 'cancelada';
export type FinancialEntryType = 'payable' | 'receivable';

export interface FinancialEntry {
  id: string; // UUID
  date: string;
  type: FinancialEntryType;
  category: string;
  name: string;
  unitValue: number;
  discount: number;
  addition: number;
  total: number;
  status: FinancialEntryStatus;
  paymentMethod?: 'pix' | 'credit_card' | 'boleto' | 'dinheiro';
  installments?: number;
  created_at?: string;
}

// --- TABELA: APPOINTMENTS (Agenda) ---
export interface Appointment {
  id: string;
  date: string;
  time: string;
  patientName: string;
  type: 'Avaliação' | 'Retorno' | 'Procedimento' | 'Cirurgia' | 'Google Calendar' | string;
  status: 'Confirmado' | 'Pendente' | 'Cancelado' | 'Realizado' | string;
  isGoogle?: boolean; 
}

// --- CONFIGURAÇÃO WHATSAPP ---
export interface WhatsappConfig {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  isConnected: boolean;
}

// --- DASHBOARD AGGREGATES ---
export interface ConsolidatedMetrics {
  marketing: {
    investimento: number;
    leads: number;
    clicks: number;
    impressions: number;
    cpl: number;
    ctr: number;
  };
  vendas: {
    conversas: number;
    agendamentos: number;
    comparecimento: number; // Baseado em Agenda Realizada
    comparecimentoTaxa: number; 
    noShows: number; // Baseado em CRM Status 'No Show' ou Agenda 'Falta'
    leadsSemResposta: number; // NOVO
    vendas: number;
    taxaConversao: number; // Leads -> Agendamento
    cac: number;
    cpv: number;
  };
  financeiro: {
    receitaBruta: number; // Entradas (Receivables)
    gastosTotais: number; // Saídas (Payables) + Marketing (se não estiver incluso)
    lucroLiquido: number;
    roi: number;
    ticketMedio: number;
  };
}
