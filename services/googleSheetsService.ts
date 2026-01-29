
import { supabase } from '../lib/supabase';

/**
 * Inicia o fluxo de OAuth para o Google Sheets.
 * Define a flag 'auth_intent' para 'google_sheets'.
 */
export const signInWithGoogleSheets = async () => {
  if (!supabase) return;

  const returnUrl = window.location.origin + window.location.pathname;

  localStorage.setItem('auth_intent', 'google_sheets');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // drive.readonly é necessário para listar arquivos
      scopes: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
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
 * Lista as planilhas do Google Drive do usuário
 */
export const listSpreadsheets = async (accessToken: string) => {
  try {
    // Filtra apenas arquivos do tipo Google Sheets e que não estão na lixeira
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=20&fields=files(id,name)`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = 'Falha ao listar arquivos do Drive';
        let errorCode = 'UNKNOWN';
        
        try {
            const errorJson = JSON.parse(errorText);
            const message = errorJson.error?.message || '';
            const status = errorJson.error?.status || '';

            // Detecta API desativada
            if (message.includes('Drive API has not been used') || message.includes('API has not been used')) {
                 errorCode = 'API_DISABLED';
            } 
            // Detecta falta de escopo/permissão
            else if (message.includes('insufficient authentication scopes') || status === 'PERMISSION_DENIED') {
                 errorCode = 'SCOPES_MISSING';
            }
            
            errorMsg = message || errorMsg;
        } catch (e) {
            console.warn("Non-JSON error response from Google:", errorText);
        }
        
        const error = new Error(errorMsg);
        (error as any).code = errorCode;
        throw error;
    }

    const data = await response.json();
    return data.files || [];
  } catch (error: any) {
    console.error("Erro ao listar planilhas:", error);
    throw error;
  }
};

/**
 * Obtém os detalhes da planilha (para pegar os nomes das abas/páginas)
 */
export const getSpreadsheetDetails = async (accessToken: string, spreadsheetId: string) => {
  try {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error("Erro ao ler detalhes da planilha:", errText);
        throw new Error('Falha ao obter detalhes da planilha');
    }
    const data = await response.json();
    
    // Retorna array de nomes das abas
    return data.sheets.map((s: any) => s.properties.title);
  } catch (error) {
    console.error("Erro ao obter detalhes da planilha:", error);
    throw error;
  }
};

/**
 * Lê os dados de uma aba específica
 */
export const getSheetData = async (accessToken: string, spreadsheetId: string, range: string) => {
  try {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) throw new Error('Falha ao ler dados da planilha');
    const data = await response.json();
    return data.values || [];
  } catch (error) {
    console.error("Erro ao ler dados:", error);
    throw error;
  }
};
