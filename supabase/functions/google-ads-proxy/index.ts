
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 1. Handle CORS preflight requests (Browser check)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, access_token, developer_token, customer_id, date_range } = await req.json();

    if (!access_token) throw new Error('Missing access_token');
    if (!developer_token) throw new Error('Missing developer_token');

    const API_VERSION = 'v16';
    const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

    // --- AÇÃO: LISTAR CONTAS (List Accessible Customers) ---
    if (action === 'list_customers') {
      const url = `${BASE_URL}/customers:listAccessibleCustomers`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'developer-token': developer_token,
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Google API Error (List):", errorText);
        throw new Error(`Google Ads API Error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // A API retorna resourceNames como "customers/1234567890"
      // Vamos formatar para o frontend
      const customers = (data.resourceNames || []).map((resourceName: string) => {
        const id = resourceName.replace('customers/', '');
        return {
          id: id,
          name: resourceName,
          descriptiveName: `Conta ${id}`, // A endpoint listAccessibleCustomers infelizmente não retorna o nome legível da conta
          currencyCode: 'BRL',
          timeZone: 'America/Sao_Paulo'
        };
      });

      return new Response(JSON.stringify({ customers }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- AÇÃO: BUSCAR CAMPANHAS (Search Stream / GAQL) ---
    if (action === 'get_campaigns') {
      if (!customer_id) throw new Error('Missing customer_id');

      const cleanCustomerId = customer_id.replace(/-/g, '');
      const url = `${BASE_URL}/customers/${cleanCustomerId}/googleAds:search`;

      // Query GAQL para buscar métricas
      let query = `
        SELECT 
          campaign.id, 
          campaign.name, 
          campaign.status, 
          metrics.clicks, 
          metrics.impressions, 
          metrics.cost_micros, 
          metrics.conversions 
        FROM campaign 
        WHERE campaign.status != 'REMOVED' 
      `;

      if (date_range && date_range.start && date_range.end) {
        query += ` AND segments.date BETWEEN '${date_range.start}' AND '${date_range.end}'`;
      } else {
        query += ` AND segments.date DURING LAST_30_DAYS`;
      }
      
      // Adicionando um limite de segurança
      query += ` LIMIT 50`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'developer-token': developer_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Tratamento para erro comum de permissão ou conta incorreta
        if (errorText.includes("CUSTOMER_NOT_FOUND") || errorText.includes("NOT_ADS_USER")) {
           throw new Error("Conta não encontrada ou usuário sem permissão de acesso.");
        }
        throw new Error(`Google API Query Error: ${errorText}`);
      }

      const data = await response.json();
      
      // O endpoint search retorna { results: [...] }
      return new Response(JSON.stringify({ results: data.results || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
