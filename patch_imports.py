with open('components/Marketing.tsx', 'r') as f:
    content = f.read()

content = content.replace(
"""  getMetaOverview, getMetaCampaigns, getMetaAdGroups, getMetaAds, getMetaSearchTerms
} from '../services/metaAdsService';""",
"""  getMetaOverview, getMetaCampaigns, getMetaAdGroups, getMetaAds, getMetaSearchTerms,
  toggleMetaCampaignStatus, updateMetaCampaignBudget
} from '../services/metaAdsService';""")

# Add Edit2 to lucide-react imports if not present
if "Edit2" not in content[:1000]:
    content = content.replace(
        "FileUp, Download, Image as ImageIcon, Play, Pause, Pencil, Settings, Folder, HelpCircle",
        "FileUp, Download, Image as ImageIcon, Play, Pause, Pencil, Settings, Folder, HelpCircle, Edit2"
    )

with open('components/Marketing.tsx', 'w') as f:
    f.write(content)
