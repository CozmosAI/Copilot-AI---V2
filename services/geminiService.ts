
import { GoogleGenAI, Type, Modality } from "@google/genai";

export const getAIInsights = async (data: any): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    Analise os seguintes dados de uma clínica médica e forneça um diagnóstico estratégico curto (3-4 frases).
    O médico não quer dados, ele quer saber onde está perdendo dinheiro e o que fazer.
    Seja direto, autoritário mas parceiro. Use português do Brasil.
    
    DADOS:
    ${JSON.stringify(data)}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: "Você é um consultor sênior de gestão para médicos. Seu foco é lucro real e eficiência operacional."
      }
    });
    return response.text || "Não foi possível gerar análise no momento.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Erro ao conectar com o Copiloto de IA.";
  }
};

export const analyzeLeadConversation = async (name: string, history: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    Analise a conversa de WhatsApp com o lead "${name}".
    Histórico: "${history}"
    
    Responda em 3 tópicos curtos:
    1. Humor/Temperatura (Frio, Morno, Quente).
    2. Principal Objeção (se houver).
    3. Próximo Passo sugerido para fechar a venda.
    Seja extremamente conciso.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: "Você é um especialista em vendas médicas e análise de CRM. Sua função é ajudar a secretária a converter o lead em agendamento."
      }
    });
    return response.text || "Análise indisponível.";
  } catch (error) {
    return "Erro ao analisar conversa.";
  }
};

export const generateAudioReport = async (text: string): Promise<string | null> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Diga de forma profissional e encorajadora: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio ? `data:audio/pcm;base64,${base64Audio}` : null;
  } catch (error) {
    console.error("Audio Gen Error:", error);
    return null;
  }
};

export const playPCM = async (base64Data: string) => {
  const binaryString = atob(base64Data.split(',')[1]);
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
