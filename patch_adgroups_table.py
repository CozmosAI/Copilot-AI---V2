with open('components/Marketing.tsx', 'r') as f:
    content = f.read()

# Add to headers
content = content.replace(
"""                                                { k: 'campaignName', l: 'Campanha', align: 'left' },
                                                { k: 'status', l: 'Status', align: 'left' },""",
"""                                                { k: 'campaignName', l: 'Campanha', align: 'left' },
                                                { k: 'budget', l: 'Orçamento', align: 'right' },
                                                { k: 'status', l: 'Status', align: 'left' },""")

# Add to rows
content = content.replace(
"""                                                    <td className="px-4 py-2 text-left font-normal text-slate-500 text-xs">
                                                        {ag.campaignName}
                                                    </td>
                                                    <td className="px-4 py-2 text-left font-normal">""",
"""                                                    <td className="px-4 py-2 text-left font-normal text-slate-500 text-xs">
                                                        {ag.campaignName}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-normal">
                                                        <div className="flex items-center justify-end gap-2 group/edit">
                                                            <div>
                                                                <p className="font-semibold text-slate-800 text-xs">{formatCurrency(ag.budget || 0)}</p>
                                                                <p className="text-[9px] text-slate-400 font-normal">Diário</p>
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
                                                                className="p-1 text-slate-400 hover:text-[#0866ff] hover:bg-[#0866ff]/10 rounded opacity-0 group-hover/edit:opacity-100 transition-all"
                                                                title="Editar Orçamento"
                                                            >
                                                                <Edit2 size={12} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-left font-normal">""")

with open('components/Marketing.tsx', 'w') as f:
    f.write(content)
