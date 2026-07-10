with open('components/Marketing.tsx', 'r') as f:
    content = f.read()

content = content.replace(
"""                                                    <h4 className="font-bold text-[#0866ff] hover:underline text-sm mt-1 cursor-pointer break-words">
                                                        {ag.name}
                                                    </h4>
                                                    <span className="text-[11px] text-slate-400 block mt-0.5">Campanha: {ag.campaignName}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100">""",
"""                                                    <h4 className="font-bold text-[#0866ff] hover:underline text-sm mt-1 cursor-pointer break-words">
                                                        {ag.name}
                                                    </h4>
                                                    <span className="text-[11px] text-slate-400 block mt-0.5">Campanha: {ag.campaignName}</span>
                                                    <div className="flex items-center gap-2 mt-1.5 bg-slate-100/50 p-1.5 rounded-lg border border-slate-200/50 w-fit">
                                                        <div>
                                                            <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Orçamento</span>
                                                            <span className="text-slate-800 font-semibold text-xs">{formatCurrency(ag.budget || 0)}</span>
                                                        </div>
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setMetaBudgetModal({
                                                                    open: true,
                                                                    adsetId: ag.id,
                                                                    adsetName: ag.name,
                                                                    currentBudget: ag.budget || 0
                                                                });
                                                            }}
                                                            className="p-1.5 bg-white text-slate-500 hover:text-[#0866ff] hover:bg-[#0866ff]/10 rounded border border-slate-200 transition-all shadow-sm ml-2"
                                                        >
                                                            <Edit2 size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100">""")

with open('components/Marketing.tsx', 'w') as f:
    f.write(content)

