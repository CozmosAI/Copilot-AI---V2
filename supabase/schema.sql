
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
end $$;

-- 4. Tabela WHATSAPP_INSTANCES (Conexão Evolution API)
create table if not exists whatsapp_instances (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null unique, -- 1 instância por usuário
  instance_name text not null,
  status text default 'disconnected', -- disconnected, connected, connecting
  qr_code text, -- opcional, para cache
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 5. Tabela WHATSAPP_MESSAGES (Histórico de Chat)
create table if not exists whatsapp_messages (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid references leads(id) on delete cascade, -- Link com o CRM
  contact_phone text, -- Redundância útil para queries rápidas
  sender text check (sender in ('me', 'contact')), -- Quem enviou
  body text,
  type text default 'text',
  status text default 'delivered',
  created_at timestamp with time zone default now()
);

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
alter table whatsapp_instances enable row level security;
alter table whatsapp_messages enable row level security;
alter table transactions enable row level security;
alter table appointments enable row level security;

-- Limpa policies antigas para recriar (evita erros de duplicação)
drop policy if exists "Users can view own profile" on profiles;
drop policy if exists "Users can update own profile" on profiles;
drop policy if exists "Users can insert own profile" on profiles;

drop policy if exists "Users can view own leads" on leads;
drop policy if exists "Users can insert own leads" on leads;
drop policy if exists "Users can update own leads" on leads;

drop policy if exists "Users can view own instances" on whatsapp_instances;
drop policy if exists "Users can update own instances" on whatsapp_instances;
drop policy if exists "Users can insert own instances" on whatsapp_instances;

drop policy if exists "Users can view own messages" on whatsapp_messages;
drop policy if exists "Users can insert own messages" on whatsapp_messages;

-- Cria Policies Novas

-- PROFILES
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);

-- LEADS
create policy "Users can view own leads" on leads for select using (auth.uid() = user_id);
create policy "Users can insert own leads" on leads for insert with check (auth.uid() = user_id);
create policy "Users can update own leads" on leads for update using (auth.uid() = user_id);

-- WHATSAPP INSTANCES
create policy "Users can view own instances" on whatsapp_instances for select using (auth.uid() = user_id);
create policy "Users can update own instances" on whatsapp_instances for update using (auth.uid() = user_id);
create policy "Users can insert own instances" on whatsapp_instances for insert with check (auth.uid() = user_id);

-- WHATSAPP MESSAGES (Regra: Pode ver se o Lead pertencer ao usuário)
create policy "Users can view own messages" on whatsapp_messages for select using (
  exists (select 1 from leads where leads.id = whatsapp_messages.lead_id and leads.user_id = auth.uid())
);
-- Nota: O insert em messages geralmente é feito pelo SERVICE_ROLE (backend), então RLS de insert para usuário pode ser opcional, 
-- mas se o usuário enviar mensagem pelo front, precisa disso:
create policy "Users can insert own messages" on whatsapp_messages for insert with check (
  exists (select 1 from leads where leads.id = whatsapp_messages.lead_id and leads.user_id = auth.uid())
);

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
  begin alter publication supabase_realtime add table whatsapp_instances; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table whatsapp_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table transactions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table appointments; exception when duplicate_object then null; end;
end;
$$;
