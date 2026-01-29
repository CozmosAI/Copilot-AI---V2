
import React from 'react';
import { ShieldCheck, ArrowLeft } from 'lucide-react';

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans text-slate-600">
      <div className="max-w-3xl mx-auto bg-white p-10 rounded-[40px] shadow-sm border border-slate-200">
        <div className="flex items-center gap-4 mb-8 border-b border-slate-100 pb-8">
           <div className="p-3 bg-navy text-white rounded-2xl">
              <ShieldCheck size={32} />
           </div>
           <div>
              <h1 className="text-2xl font-black text-navy uppercase tracking-tight">Política de Privacidade</h1>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Copilot AI - Gestão & Crescimento</p>
           </div>
        </div>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-bold text-navy mb-3">1. Introdução</h2>
            <p>
              A sua privacidade é importante para nós. É política do <strong>Copilot AI</strong> respeitar a sua privacidade em relação a qualquer informação sua que possamos coletar no site e aplicação.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-navy mb-3">2. Coleta de Dados (Google & Meta)</h2>
            <p>
              Para fornecer nossos serviços de análise e gestão, solicitamos permissão para acessar dados limitados de suas contas de anúncio (Google Ads e Meta Ads).
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>O que coletamos:</strong> Nomes de campanhas, valor investido, número de cliques, impressões e conversões.</li>
              <li><strong>Como usamos:</strong> Apenas para exibir dashboards consolidados e gerar insights de inteligência artificial para o seu negócio.</li>
              <li><strong>Armazenamento:</strong> Os tokens de acesso são armazenados de forma criptografada e segura.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-navy mb-3">3. Compartilhamento de Informações</h2>
            <p>
              Não compartilhamos suas informações de identificação pessoal publicamente ou com terceiros, exceto quando exigido por lei. Os dados processados pela nossa IA são anonimizados sempre que possível.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-navy mb-3">4. Exclusão de Dados</h2>
            <p>
              Você tem o direito de solicitar a exclusão completa dos seus dados e revogar o acesso às suas contas de anúncio a qualquer momento através do menu "Integrações" dentro da plataforma ou entrando em contato com nosso suporte.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-navy mb-3">5. Consentimento</h2>
            <p>
              O uso continuado de nosso site será considerado como aceitação de nossas práticas em torno de privacidade e informações pessoais.
            </p>
          </section>

          <div className="pt-8 border-t border-slate-100 mt-8">
             <p className="text-xs text-slate-400">Última atualização: {new Date().toLocaleDateString()}</p>
             <a href="/" className="inline-flex items-center gap-2 mt-4 text-xs font-bold text-navy hover:text-blue-600 uppercase tracking-widest transition-colors">
                <ArrowLeft size={14} /> Voltar para o App
             </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
