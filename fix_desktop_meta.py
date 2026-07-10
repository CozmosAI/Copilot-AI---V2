with open('components/Marketing.tsx', 'r') as f:
    content = f.read()

# 1. Remove the "Ações" header I mistakenly added in Meta Campaigns desktop
content = content.replace("                                                { k: 'spend', l: 'Valor Gasto', align: 'right' },\n                                                { k: 'actions', l: 'Ações', align: 'center' },", "                                                { k: 'spend', l: 'Valor Gasto', align: 'right' },")

# 2. Add the <td ...> action button at the end of the row (before </tr>) for Meta Campaigns
action_td = """                                                    <td className="px-2 md:px-4 py-1.5 md:py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            onClick={() => setMetaStatusConfirmModal({
                                                                open: true,
                                                                campaignId: c.id,
                                                                campaignName: c.name,
                                                                action: (c.status === 'ENABLED' || c.status === 'ACTIVE') ? 'pause' : 'enable'
                                                            })}
                                                            className={`p-1.5 rounded-lg transition-colors ${
                                                                (c.status === 'ENABLED' || c.status === 'ACTIVE') 
                                                                    ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' 
                                                                    : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                                                            }`}
                                                            title={(c.status === 'ENABLED' || c.status === 'ACTIVE') ? 'Pausar' : 'Ativar'}
                                                        >
                                                            {(c.status === 'ENABLED' || c.status === 'ACTIVE') ? <Pause size={14} /> : <Play size={14} />}
                                                        </button>
                                                    </td>
"""
# Currently, the row ends with:
row_end = """                                                    <td className="px-2 md:px-4 py-1.5 md:py-2 text-right font-semibold text-slate-800">
                                                        {formatCurrency(cCostPerConv)}
                                                    </td>
                                                </tr>"""
# The first replacement in patch_meta_table.py might have already done this. Let's check if actions column exists.

with open('components/Marketing.tsx', 'w') as f:
    f.write(content)
