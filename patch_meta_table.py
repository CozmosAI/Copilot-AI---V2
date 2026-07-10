with open('components/Marketing.tsx', 'r') as f:
    content = f.read()

# Replace the Meta Style Toggle Switch in campaigns (desktop & mobile) with proper action buttons

# For campaigns desktop:
import re
# We look for the whole <td className="px-2 py-1.5 text-center w-12... inside meta Campaigns table.
# Since activePlatform === 'meta' renders its own table, we can just replace the specific columns.
# Actually, the user asked to put an "AÇÕES" column with pause/play. The prompt says:
# "Na tabela de campanhas Meta Ads ... adicionar coluna AÇÕES ... Botão Pausar/Ativar"

# First, let's find the headers of the Meta Campaigns table.
content = content.replace("{ k: 'spend', l: 'Valor Gasto', align: 'right' },", "{ k: 'spend', l: 'Valor Gasto', align: 'right' },\n                                                { k: 'actions', l: 'Ações', align: 'center' },", 1)

actions_col = """
                                                    <td className="px-2 md:px-4 py-1.5 md:py-2 text-center" onClick={(e) => e.stopPropagation()}>
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

# The row has 1) checkbox, 2) toggle switch, 3) campaign name, 4) status badge... wait.
# The user wants "AÇÕES" column. Let's find where the Meta table body maps and insert this td at the end.
# Wait, I need to look at how the table is structured. Let's see the current Meta Campaigns headers:
content = content.replace("                                                    <td className=\"px-2 md:px-4 py-1.5 md:py-2 text-right font-semibold text-[#0f9d58]\">\n                                                        {formatNumber(c.conversions)}\n                                                    </td>\n                                                    <td className=\"px-2 md:px-4 py-1.5 md:py-2 text-right font-semibold text-slate-800\">\n                                                        {formatCurrency(cCostPerConv)}\n                                                    </td>\n                                                </tr>", 
"                                                    <td className=\"px-2 md:px-4 py-1.5 md:py-2 text-right font-semibold text-[#0f9d58]\">\n                                                        {formatNumber(c.conversions)}\n                                                    </td>\n                                                    <td className=\"px-2 md:px-4 py-1.5 md:py-2 text-right font-semibold text-slate-800\">\n                                                        {formatCurrency(cCostPerConv)}\n                                                    </td>\n" + actions_col + "                                                </tr>", 1)


# Also in Mobile view for Meta Campaigns:
mobile_campaign_action = """
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setMetaStatusConfirmModal({
                                                            open: true,
                                                            campaignId: c.id,
                                                            campaignName: c.name,
                                                            action: (c.status === 'ENABLED' || c.status === 'ACTIVE') ? 'pause' : 'enable'
                                                        });
                                                    }}
                                                    className={`p-1.5 rounded-lg transition-colors ${
                                                        (c.status === 'ENABLED' || c.status === 'ACTIVE') 
                                                            ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' 
                                                            : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                                                    }`}
                                                >
                                                    {(c.status === 'ENABLED' || c.status === 'ACTIVE') ? <Pause size={14} /> : <Play size={14} />}
                                                </button>
"""
# Replace the toggle switch in Mobile Meta Campaigns
content = re.sub(
    r'<label className="relative inline-flex items-center cursor-pointer">\s*<input[^>]*onChange=\{[^}]*\}[^>]*>\s*<div[^>]*></div>\s*</label>',
    mobile_campaign_action,
    content,
    count=2 # One for desktop? Oh wait, I left the desktop toggle switch. The user might want the desktop toggle switch removed since I added "AÇÕES" column.
)

with open('components/Marketing.tsx', 'w') as f:
    f.write(content)

print("Done patching meta table")
