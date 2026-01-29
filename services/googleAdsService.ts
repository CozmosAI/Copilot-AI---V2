import { supabase } from '../lib/supabase';
import { GoogleAdAccount } from '../types';

/**
 * Helper para tratar a resposta do servidor com segurança.
 * Evita o erro "Unexpected end of JSON input" lendo como texto primeiro.
 */
const handleApiResponse = async (response: Response) => {
  const text = await response.text();
  
  let data;
  try {
    // Tenta converter o texto para JSON. Se for vazio, vira objeto vazio.
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    console.error("Non-JSON response received:", text);
    throw new Error(`Erro de comunicação com o servidor (${response.status}): A resposta não é válida.`);
  }

  if (!response.ok) {
     throw new Error(data.error || `Erro do servidor: ${response.statusText}`);
  }

  return data;
};

/**
 * Inicia o fluxo de Login com Google Ads.
 */
export const signInWithGoogleAds = async () => {
  if (!supabase) return;

  const returnUrl = window.location.origin + window.location.pathname;
  localStorage.setItem('auth_intent', 'google_ads');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: 'https://www.googleapis.com/auth/adwords',
      redirectTo: returnUrl,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) throw error;
  return data;
};

/**
 * Busca a lista de contas via Backend Interno (/api/google-ads).
 */
export const getAccessibleCustomers = async (accessToken: string, _developerToken?: string): Promise<GoogleAdAccount[]> => {
  try {
    const response = await fetch('/api/google-ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'list_customers',
            access_token: accessToken
        })
    });

    const data = await handleApiResponse(response);
    return data.customers || [];
  } catch (err: any) {
    console.error("Service Error (List Customers):", err.message);
    throw err;
  }
};

/**
 * Busca campanhas via Backend Interno (/api/google-ads).
 */
export const getGoogleCampaigns = async (customerId: string, accessToken: string, _developerToken?: string, dateRange?: { start: string, end: string }) => {
  try {
    const response = await fetch('/api/google-ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'get_campaigns',
            customer_id: customerId,
            access_token: accessToken,
            date_range: dateRange
        })
    });

    const data = await handleApiResponse(response);
    return data.results || [];

  } catch (error: any) {
    console.error("Service Error (Get Campaigns):", error.message);
    // Retorna array vazio em caso de erro para não quebrar a tela de Marketing
    return [];
  }
};
