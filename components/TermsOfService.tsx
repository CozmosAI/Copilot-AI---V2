
import React from 'react';
import { FileText, ArrowLeft } from 'lucide-react';

const TermsOfService: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans text-slate-600">
      <div className="max-w-3xl mx-auto bg-white p-10 rounded-[40px] shadow-sm border border-slate-200">
        <div className="flex items-center gap-4 mb-8 border-b border-slate-100 pb-8">
           <div className="p-3 bg-navy text-white rounded-2xl">
              <FileText size={32} />
           </div>
           <div>
              <h1 className="text-2xl font-black text-navy uppercase tracking-tight">Termos de Serviço</h1>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Copilot AI - Gestão & Crescimento</p>
           </div>
        </div>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-bold text-navy mb-3">1. Aceitação dos Termos</h2>
            <p>
              Ao acessar e usar o software <strong>Copilot AI</strong>, você concorda em cumprir estes termos de serviço, todas as leis e regulamentos aplicáveis ​​e concorda que é responsável pelo cumprimento de todas as leis locais aplicáveis.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-navy mb-3">2. Uso de Licença</h2>
            <p>
              É concedida permissão para baixar temporariamente uma cópia dos materiais (informações ou software) no site Copilot AI, apenas para visualização transitória pessoal e não comercial. Esta é a concessão de uma licença, não uma transferência de título e, sob esta licença, você não pode:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Modificar ou copiar os materiais;</li>
              <li>Usar os materiais para qualquer finalidade comercial ou para exibição pública;</li>
              <li>Tentar descompilar ou fazer engenharia reversa de qualquer software contido no Copilot AI;</li>
              <li>Remover quaisquer direitos autorais ou outras notações de propriedade dos materiais.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-navy mb-3">3. Isenção de Responsabilidade</h2>
            <p>
              Os materiais no site da Copilot AI são fornecidos 'como estão'. O Copilot AI não oferece garantias, expressas ou implícitas, e, por este meio, isenta e nega todas as outras garantias, incluindo, sem limitação, garantias implícitas ou condições de comercialização, adequação a um fim específico ou não violação de propriedade intelectual.
            </p>
            <p className="mt-2">
                Além disso, as previsões financeiras e de marketing geradas pela nossa Inteligência Artificial são estimativas baseadas em dados históricos e não garantem resultados futuros.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-navy mb-3">4. Limitações</h2>
            <p>
              Em nenhum caso o Copilot AI ou seus fornecedores serão responsáveis ​​por quaisquer danos (incluindo, sem limitação, danos por perda de dados ou lucro ou devido a interrupção dos negócios) decorrentes do uso ou da incapacidade de usar os materiais em Copilot AI.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-navy mb-3">5. Precisão dos Materiais</h2>
            <p>
              Os materiais exibidos no site da Copilot AI podem incluir erros técnicos, tipográficos ou fotográficos. Copilot AI não garante que qualquer material em seu site seja preciso, completo ou atual.
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

export default TermsOfService;
