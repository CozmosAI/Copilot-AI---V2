import { createClient } from '@supabase/supabase-js';

// Tenta obter as variáveis de diferentes formas para garantir compatibilidade
const getEnvVar = (name: string) => {
  const metaEnv = (import.meta as any).env;
  const processEnv = (typeof process !== 'undefined' ? process.env : {});
  return metaEnv?.[name] || (processEnv as any)?.[name] || '';
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || 'https://rxvvtdqxinttuoamtapa.supabase.co';
const supabaseKey = getEnvVar('VITE_SUPABASE_ANON_KEY') || 'sb_publishable_cZXM43qOuiYp_JOR2D0Y7w_ofs7o-Gi';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase: URL ou Key não encontradas. Verifique seu arquivo .env');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
