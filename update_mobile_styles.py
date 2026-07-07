import re

with open('components/Marketing.tsx', 'r') as f:
    content = f.read()

# Pattern 1
content = content.replace(
    'bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3',
    'bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm space-y-2'
)
# Note: For Meta Ads, it has a conditional class:
content = re.sub(
    r'bg-white p-4 rounded-xl border transition-all shadow-sm space-y-3',
    r'bg-white p-2.5 rounded-xl border transition-all shadow-sm space-y-2',
    content
)

# Pattern 2
content = content.replace(
    'block md:hidden space-y-3 p-3 bg-slate-50',
    'block md:hidden space-y-2 p-2 bg-slate-50'
)

# Pattern 3
content = content.replace(
    'grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg text-xs font-medium border border-slate-100',
    'flex flex-wrap gap-x-4 gap-y-2 bg-slate-50 p-2 rounded-lg text-xs font-medium border border-slate-100'
)

with open('components/Marketing.tsx', 'w') as f:
    f.write(content)

print("Done")
