
import { apiFetch, safeJsonResponse } from './apiClient';

export const getAIInsights = async (data: any): Promise<string> => {
  try {
    const response = await apiFetch('/api/gemini/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
    const result = await safeJsonResponse(response);
    return result.text || "Não foi possível gerar análise no momento.";
  } catch (error) {
    return "Erro ao conectar com o Copiloto de IA.";
  }
};

export const analyzeLeadConversation = async (name: string, history: string): Promise<string> => {
  try {
    const response = await apiFetch('/api/gemini/analyze-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, history })
    });
    const result = await safeJsonResponse(response);
    return result.text || "Análise indisponível.";
  } catch (error) {
    return "Erro ao analisar conversa.";
  }
};

export const generateSOAPFromTranscript = async (transcript: string): Promise<{s: string, o: string, a: string, p: string}> => {
  try {
    const response = await apiFetch('/api/gemini/soap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript })
    });
    return await safeJsonResponse(response);
  } catch (error) {
    return { s: "Erro ao gerar.", o: "Erro ao gerar.", a: "Erro ao gerar.", p: "Erro ao gerar." };
  }
};

export const generateAudioReport = async (text: string): Promise<string | null> => {
  try {
    const response = await apiFetch('/api/gemini/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await safeJsonResponse(response);
    return data.audio ? `data:audio/pcm;base64,${data.audio}` : null;
  } catch (error) {
    return null;
  }
};

export const playPCM = async (base64Data: string) => {
  const binaryString = atob(base64Data.split(',')[1] || base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const dataInt16 = new Int16Array(bytes.buffer);
  const buffer = audioCtx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  source.start();
};
