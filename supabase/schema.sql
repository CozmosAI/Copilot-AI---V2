
-- ==============================================================================
-- ATUALIZAÇÃO DE SCHEMA - PERSISTÊNCIA DE TOKENS
-- ==============================================================================

-- 1. Verifica e adiciona colunas de Token no perfil
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='profiles' and column_name='google_calendar_token') then
    alter table profiles add column google_calendar_token text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='profiles' and column_name='google_calendar_refresh_token') then
    alter table profiles add column google_calendar_refresh_token text;
  end if;
end $$;

-- 2. Garante que as tabelas existem (caso esteja rodando do zero)
create table if not exists whatsapp_instances (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  instance_name text not null,
  status text default 'disconnected',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Habilita RLS para segurança dos tokens
alter table profiles enable row level security;
drop policy if exists "Users can view own profile" on profiles;
drop policy if exists "Users can update own profile" on profiles;
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- Adiciona ao realtime para atualização instantânea na UI
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  begin
    alter publication supabase_realtime add table profiles;
  exception when duplicate_object then null; end;
end;
$$;
