
-- Tabela dedicada para a Integração Google Ads (Backend-to-Backend)
create table if not exists google_ads_integrations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  
  -- Tokens OAuth
  refresh_token text not null,  -- CRÍTICO: Token de longa duração (nunca expira a menos que revogado)
  access_token text,            -- Token temporário (1h)
  token_expires_at bigint,      -- Timestamp de expiração
  
  -- Identificação da Conta
  customer_id text,             -- ID da conta de anúncios selecionada (ex: 123-456-7890)
  manager_id text,              -- ID da conta MCC (se houver)
  customer_name text,           -- Nome legível da conta
  
  -- Status
  status text default 'active', -- 'active', 'error', 'disconnected'
  last_sync_at timestamp with time zone,
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Garante que cada usuário tenha apenas 1 registro de integração ativo (para simplificar a lógica inicial)
alter table google_ads_integrations add constraint unique_user_ads_integration unique (user_id);

-- Habilita segurança (RLS)
alter table google_ads_integrations enable row level security;

-- Política: Usuário só vê e edita sua própria integração
create policy "Users can manage their own ads integration"
  on google_ads_integrations for all
  using (auth.uid() = user_id);

-- Adiciona permissão para o Service Role (Backend) atualizar essa tabela livremente
-- (O Supabase já garante isso por padrão para a chave de serviço, mas é bom saber)
