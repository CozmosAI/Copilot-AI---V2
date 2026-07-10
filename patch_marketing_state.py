with open('components/Marketing.tsx', 'r') as f:
    content = f.read()

# Add imports for metaAdsService mutations if needed. Wait, we need to import them.
# Let's search where toggleGoogleCampaignStatus is imported.
import re

new_imports = "import { toggleMetaCampaignStatus, updateMetaCampaignBudget } from '../services/metaAdsService';\n"
content = content.replace("import { toggleGoogleCampaignStatus, updateGoogleCampaignBudget } from '../services/googleAdsService';", "import { toggleGoogleCampaignStatus, updateGoogleCampaignBudget } from '../services/googleAdsService';\n" + new_imports)


states_to_add = """
  const [metaStatusConfirmModal, setMetaStatusConfirmModal] = useState<{ open: boolean, campaignId: string, campaignName: string, action: 'pause' | 'enable' } | null>(null);
  const [metaBudgetModal, setMetaBudgetModal] = useState<{ open: boolean, adsetId: string, adsetName: string, currentBudget: number } | null>(null);
"""
content = content.replace("const [budgetModal, setBudgetModal]", states_to_add + "const [budgetModal, setBudgetModal]")

functions_to_add = """
  const handleToggleMetaCampaign = async () => {
      if (!user || !metaStatusConfirmModal) return;
      setActionLoadingId(metaStatusConfirmModal.campaignId);
      try {
          await toggleMetaCampaignStatus(user.id, metaStatusConfirmModal.campaignId, metaStatusConfirmModal.action);
          alert(`Campanha ${metaStatusConfirmModal.action === 'pause' ? 'pausada' : 'ativada'} com sucesso!`);
          
          setMetaCampaigns(prev => prev.map(c => c.id === metaStatusConfirmModal.campaignId ? { ...c, status: metaStatusConfirmModal.action === 'pause' ? 'PAUSED' : 'ACTIVE' } : c));
      } catch (error: any) {
          alert(`Erro ao alterar status: ${error.message}`);
      } finally {
          setActionLoadingId(null);
          setMetaStatusConfirmModal(null);
      }
  };

  const handleUpdateMetaBudget = async () => {
      if (!user || !metaBudgetModal || !newBudgetAmount) return;
      const numAmount = parseFloat(newBudgetAmount);
      if (isNaN(numAmount) || numAmount <= 0) {
          alert('Insira um valor válido para o orçamento.');
          return;
      }
      setActionLoadingId(metaBudgetModal.adsetId);
      try {
          await updateMetaCampaignBudget(user.id, metaBudgetModal.adsetId, numAmount);
          alert(`Orçamento atualizado com sucesso!`);
          
          setMetaAdGroups(prev => prev.map(ag => ag.id === metaBudgetModal.adsetId ? { ...ag, spend: numAmount } : ag));
      } catch (error: any) {
          alert(`Erro ao atualizar orçamento: ${error.message}`);
      } finally {
          setActionLoadingId(null);
          setMetaBudgetModal(null);
          setNewBudgetAmount('');
      }
  };
"""

content = content.replace("const handleToggleGoogleCampaign = async () => {", functions_to_add + "\n  const handleToggleGoogleCampaign = async () => {")

modals_to_add = """
      {/* META STATUS CONFIRM MODAL */}
      {metaStatusConfirmModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                  <div className="p-6">
                      <div className="flex items-center gap-3 mb-4">
                          <div className={`p-2 rounded-xl ${metaStatusConfirmModal.action === 'pause' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                              {metaStatusConfirmModal.action === 'pause' ? <Pause size={24} /> : <Play size={24} />}
                          </div>
                          <div>
                              <h3 className="text-lg font-black text-slate-900 tracking-tight">Confirmar Ação</h3>
                          </div>
                      </div>
                      <p className="text-sm text-slate-600 mb-6">
                          Tem certeza que deseja <strong className="uppercase">{metaStatusConfirmModal.action === 'pause' ? 'pausar' : 'ativar'}</strong> a campanha "{metaStatusConfirmModal.campaignName}" no Meta Ads?
                          <br/><br/>
                          Esta ação afeta seus anúncios em produção.
                      </p>
                      <div className="flex justify-end gap-3">
                          <button 
                              onClick={() => setMetaStatusConfirmModal(null)}
                              className="px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-100 transition-colors"
                          >
                              Cancelar
                          </button>
                          <button 
                              onClick={handleToggleMetaCampaign}
                              disabled={actionLoadingId !== null}
                              className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg flex items-center gap-2 transition-all disabled:opacity-50 text-white ${metaStatusConfirmModal.action === 'pause' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200'}`}
                          >
                              {actionLoadingId !== null ? <Loader2 size={16} className="animate-spin" /> : null}
                              Confirmar {metaStatusConfirmModal.action === 'pause' ? 'Pausar' : 'Ativar'}
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* META BUDGET MODAL */}
      {metaBudgetModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                  <div className="p-6">
                      <div className="flex items-center gap-3 mb-6">
                          <div className="p-2 rounded-xl bg-[#0866ff]/10 text-[#0866ff]">
                              <DollarSign size={24} />
                          </div>
                          <div>
                              <h3 className="text-lg font-black text-slate-900 tracking-tight">Editar Orçamento</h3>
                              <p className="text-xs text-slate-500">{metaBudgetModal.adsetName}</p>
                          </div>
                      </div>
                      <div className="space-y-4 mb-6">
                          <div>
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Orçamento Diário Atual</label>
                              <div className="text-sm font-semibold text-slate-600">
                                  {formatCurrency(metaBudgetModal.currentBudget)}
                              </div>
                          </div>
                          <div>
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Novo Orçamento Diário (R$)</label>
                              <div className="relative">
                                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                      <span className="text-slate-500 sm:text-sm">R$</span>
                                  </div>
                                  <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={newBudgetAmount}
                                      onChange={(e) => setNewBudgetAmount(e.target.value)}
                                      className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-xl focus:ring-[#0866ff] focus:border-[#0866ff] sm:text-sm transition-colors"
                                      placeholder="0.00"
                                  />
                              </div>
                          </div>
                      </div>
                      <div className="flex justify-end gap-3">
                          <button 
                              onClick={() => { setMetaBudgetModal(null); setNewBudgetAmount(''); }}
                              className="px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-100 transition-colors"
                          >
                              Cancelar
                          </button>
                          <button 
                              onClick={handleUpdateMetaBudget}
                              disabled={actionLoadingId !== null || !newBudgetAmount}
                              className="px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg flex items-center gap-2 transition-all disabled:opacity-50 text-white bg-[#0866ff] hover:bg-[#0756db] shadow-[#0866ff]/20"
                          >
                              {actionLoadingId !== null ? <Loader2 size={16} className="animate-spin" /> : null}
                              Salvar Orçamento
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}
"""

content = content.replace("{/* STATUS CONFIRM MODAL */}", modals_to_add + "\n      {/* STATUS CONFIRM MODAL */}")

with open('components/Marketing.tsx', 'w') as f:
    f.write(content)

print("Done patching state logic")
