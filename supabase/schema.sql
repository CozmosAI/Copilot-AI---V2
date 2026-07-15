
-- ==============================================================================
-- SCHEMA COPILOT AI (ATUALIZADO PARA WHATSAPP & CRM)
-- ==============================================================================

-- 1. Extensões
create extension if not exists "uuid-ossp";

-- 2. Tabela PROFILES (Configurações do Usuário)
create table if not exists profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  name text,
  clinic_name text,
  ticket_value numeric default 450,
  google_calendar_token text,
  google_calendar_refresh_token text,
  ai_config jsonb, -- COLUNA NOVA: Armazena configurações da IA
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Garante colunas de token (caso a tabela já exista sem elas)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='profiles' and column_name='google_calendar_token') then
    alter table profiles add column google_calendar_token text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='profiles' and column_name='google_calendar_refresh_token') then
    alter table profiles add column google_calendar_refresh_token text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='profiles' and column_name='clinic_name') then
    alter table profiles add column clinic_name text;
  end if;
  -- Garante a coluna ai_config
  if not exists (select 1 from information_schema.columns where table_name='profiles' and column_name='ai_config') then
    alter table profiles add column ai_config jsonb default '{}'::jsonb;
  end if;
end $$;

-- 3. Tabela LEADS (CRM)
create table if not exists leads (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  phone text not null,
  email text,
  status text default 'Novo', -- Novo, Conversa, Agendado, Venda, Perdido
  temperature text default 'Cold', -- Cold, Warm, Hot
  source text default 'Manual',
  potential_value numeric default 0,
  last_message text,
  last_interaction timestamp with time zone default now(),
  last_sender text default 'me', -- NOVO: 'me' ou 'contact'
  notes text,
  created_at timestamp with time zone default now()
);

-- Adiciona colunas faltantes em LEADS se necessário
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='last_message') then
    alter table leads add column last_message text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='last_interaction') then
    alter table leads add column last_interaction timestamp with time zone default now();
  end if;
-- Garante last_sender
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='last_sender') then
    alter table leads add column last_sender text default 'me';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='procedure') then
    alter table leads add column procedure text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='objective') then
    alter table leads add column objective text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='leads' and column_name='ad_name') then
    alter table leads add column ad_name text;
  end if;
end $$;

-- 3.1 Índices na Tabela LEADS
create index if not exists idx_leads_user_id on public.leads(user_id);
create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_temperature on public.leads(temperature);

-- 6. Outras Tabelas Existentes (Garantia de integridade)
create table if not exists transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  type text check (type in ('payable', 'receivable')),
  category text,
  name text,
  unit_value numeric,
  total numeric,
  status text,
  date date,
  created_at timestamp with time zone default now()
);

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='transactions' and column_name='discount') then
    alter table transactions add column discount numeric default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='transactions' and column_name='addition') then
    alter table transactions add column addition numeric default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='transactions' and column_name='payment_method') then
    alter table transactions add column payment_method text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='transactions' and column_name='installments') then
    alter table transactions add column installments integer;
  end if;
end $$;

create table if not exists appointments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  patient_name text,
  date date,
  time time,
  type text,
  status text,
  created_at timestamp with time zone default now()
);

-- ==============================================================================
-- SEGURANÇA (ROW LEVEL SECURITY - RLS)
-- ==============================================================================

-- Habilita RLS em todas as tabelas críticas
alter table profiles enable row level security;
alter table leads enable row level security;
alter table transactions enable row level security;
alter table appointments enable row level security;

-- Limpa policies antigas para recriar (evita erros de duplicação)
drop policy if exists "Users can view own profile" on profiles;
drop policy if exists "Users can update own profile" on profiles;
drop policy if exists "Users can insert own profile" on profiles;

drop policy if exists "Users can view own leads" on leads;
drop policy if exists "Users can insert own leads" on leads;
drop policy if exists "Users can update own leads" on leads;

-- Cria Policies Novas

-- PROFILES
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);

-- LEADS
create policy "Users can view own leads" on leads for select using (auth.uid() = user_id);
create policy "Users can insert own leads" on leads for insert with check (auth.uid() = user_id);
create policy "Users can update own leads" on leads for update using (auth.uid() = user_id);

-- ==============================================================================
-- REALTIME
-- ==============================================================================

-- Adiciona tabelas ao publication do supabase_realtime para o frontend atualizar sozinho
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  
  -- Adiciona tabelas (ignorando erro se já estiverem lá)
  begin alter publication supabase_realtime add table profiles; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table leads; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table transactions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table appointments; exception when duplicate_object then null; end;
end;
$$;

-- ==============================================================================
-- 7. TABELA META_ADS_INTEGRATIONS (Fase 1)
-- ==============================================================================
create table if not exists meta_ads_integrations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  access_token text not null,
  refresh_token text,
  ad_account_id text,
  ad_account_name text,
  status text default 'pending_selection', -- active, pending_selection, expired
  token_expires_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Habilita RLS em meta_ads_integrations
alter table meta_ads_integrations enable row level security;

-- Policies para meta_ads_integrations
drop policy if exists "Users can view own meta_ads" on meta_ads_integrations;
drop policy if exists "Users can insert own meta_ads" on meta_ads_integrations;
drop policy if exists "Users can update own meta_ads" on meta_ads_integrations;
drop policy if exists "Users can delete own meta_ads" on meta_ads_integrations;

create policy "Users can view own meta_ads" on meta_ads_integrations for select using (auth.uid() = user_id);
create policy "Users can insert own meta_ads" on meta_ads_integrations for insert with check (auth.uid() = user_id);
create policy "Users can update own meta_ads" on meta_ads_integrations for update using (auth.uid() = user_id);
create policy "Users can delete own meta_ads" on meta_ads_integrations for delete using (auth.uid() = user_id);

-- Adiciona meta_ads_integrations ao publication realtime
do $$
begin
  begin alter publication supabase_realtime add table meta_ads_integrations; exception when duplicate_object then null; end;
end;
$$;

-- ==============================================================================
-- 8. TABELA GOOGLE_ADS_AUDIT_LOGS
-- ==============================================================================
create table if not exists public.google_ads_audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  customer_id text not null,
  campaign_id text,
  campaign_name text,
  action text not null, -- 'pause', 'enable', 'update_budget'
  old_value text, -- status anterior ou orçamento anterior
  new_value text, -- novo status ou novo orçamento
  created_at timestamp with time zone default now()
);

-- Habilita RLS em google_ads_audit_logs
alter table public.google_ads_audit_logs enable row level security;

drop policy if exists "Users can view own google_ads_audit_logs" on public.google_ads_audit_logs;
drop policy if exists "Users can insert own google_ads_audit_logs" on public.google_ads_audit_logs;

create policy "Users can view own google_ads_audit_logs" on public.google_ads_audit_logs for select using (auth.uid() = user_id);
create policy "Users can insert own google_ads_audit_logs" on public.google_ads_audit_logs for insert with check (auth.uid() = user_id);

-- Audit logs for Meta Ads
create table if not exists public.meta_ads_audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  ad_account_id text,
  campaign_id text,
  campaign_name text,
  action text not null,
  old_value text,
  new_value text,
  created_at timestamp with time zone default now()
);
create index if not exists idx_meta_ads_audit_user_id on public.meta_ads_audit_logs(user_id);
create index if not exists idx_meta_ads_audit_created_at on public.meta_ads_audit_logs(created_at desc);
alter table public.meta_ads_audit_logs enable row level security;

drop policy if exists "Users can view own meta ads audit logs" on public.meta_ads_audit_logs;
create policy "Users can view own meta ads audit logs" on public.meta_ads_audit_logs for select using (auth.uid() = user_id);

-- ============================================================
-- SEGMENTAÇÃO, LIFECYCLE E CUSTOM FIELDS (multi-nicho)
-- ============================================================

-- Colunas em leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lifecycle_stage text;

-- Tabela: custom_field_definitions
CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  field_label text NOT NULL,
  field_type text NOT NULL,
  field_options jsonb,
  is_required boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, field_key)
);
ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_manage_own_custom_fields ON custom_field_definitions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Tabela: lifecycle_stages
CREATE TABLE IF NOT EXISTS lifecycle_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  stage_label text NOT NULL,
  stage_color text DEFAULT '#3B82F6',
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, stage_key)
);
ALTER TABLE lifecycle_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_manage_own_lifecycle_stages ON lifecycle_stages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Tabela: lead_segments
CREATE TABLE IF NOT EXISTS lead_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  rules jsonb NOT NULL,
  color text DEFAULT '#3B82F6',
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE lead_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_manage_own_lead_segments ON lead_segments FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Scoring automático de leads (sem IA, baseado em regras)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score integer DEFAULT 50;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_updated_at timestamp with time zone DEFAULT now();
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_reasons jsonb DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score DESC);

