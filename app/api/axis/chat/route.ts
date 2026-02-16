
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// Configuração OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Mock do Context Builder (Simulando Drizzle/Neon)
// Em produção, isso seria uma query real ao banco.
async function buildClinicContext(clinicId: string) {
  return {
    financeiro: {
      receitaMes: "R$ 145.000,00",
      lucroLiquido: "R$ 42.000,00",
      meta: "85%",
      pendencias: 3
    },
    marketing: {
      leadsHoje: 12,
      campanhaAtiva: "Botox Week",
      custoPorLead: "R$ 15,40"
    },
    agenda: {
      ocupacaoHoje: "78%",
      proximaVaga: "14:30",
      faltasOntem: 2
    },
    vendas: {
      conversasAtivas: 24,
      taxaConversao: "18%"
    }
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { message, clinicId, context } = body;

    if (!message) {
      return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 });
    }

    // 1. Buscar dados reais (Context Augmentation)
    const dbData = await buildClinicContext(clinicId || 'demo');

    // 2. Construir System Prompt
    const systemPrompt = `
      Você é o AXIS, o Conselheiro de Inteligência Artificial da Clínica.
      Você tem acesso em tempo real a todos os dados.
      
      DADOS ATUAIS DO SISTEMA:
      ${JSON.stringify(dbData, null, 2)}
      
      CONTEXTO DO USUÁRIO:
      ${JSON.stringify(context || {})}

      DIRETRIZES:
      1. Responda sempre em Português Brasileiro.
      2. Seja extremamente conciso (máximo 3 frases curtas). É uma conversa por voz.
      3. Cite números reais fornecidos acima para fundamentar sua resposta.
      4. Seja estratégico e proativo. Sugira uma ação se houver problemas (ex: faltas, leads baixos).
      5. Não use formatação markdown complexa (negrito, listas), use texto corrido natural para fala.
    `;

    // 3. Chamada OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Modelo rápido e eficiente
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content;

    return NextResponse.json({
      response: aiResponse,
      dataQueried: Object.keys(dbData), // Metadados para debug
      actions: []
    });

  } catch (error: any) {
    console.error('AXIS AI Error:', error);
    return NextResponse.json(
      { response: "Desculpe, perdi a conexão com a base de dados. Tente novamente." },
      { status: 500 }
    );
  }
}
