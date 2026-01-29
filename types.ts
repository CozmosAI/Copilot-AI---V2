
import React from 'react';

export enum AppSection {
  DASHBOARD = 'dashboard',
  MARKETING = 'marketing',
  VENDAS = 'vendas',
  AGENDA = 'agenda',
  AUTOMACAO = 'automacao',
  FINANCEIRO = 'financeiro',
  INTEGRACAO = 'integracao',
  PERFIL = 'perfil'
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  label: string;
}

// --- TABELA: MARKETING_METRICS ---
export interface GoogleAdAccount {
  id: string;
  name: string; // resourceName no Google Ads
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
}

// --- TABELA: LEADS (CRM) ---
export interface Lead {
  id: string; // UUID no banco
  name: string;
  phone: string;
  email?: string; // Novo
  procedure?: string; // Novo (Interesse)
  notes?: string; // Novo (Obs)
  status: 'Novo' | 'Conversa' | 'Agendado' | 'No Show' | 'Venda' | 'Perdido';
  temperature: 'Hot' | 'Warm' | 'Cold';
  lastMessage?: string;
  lastInteraction?: string;
  history?: string; // JSON ou Texto longo
  potentialValue?: number;
  source?: string;
  created_at?: string;
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
    comparecimento: number;
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
