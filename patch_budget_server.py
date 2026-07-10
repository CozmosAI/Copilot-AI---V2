with open('server.js', 'r') as f:
    content = f.read()

# Add daily_budget to fields in the Ad Sets query
content = content.replace(
    "fields: `id,name,status,campaign{id,name},insights.time_range(${time_range_str}){spend,impressions,clicks,actions}`",
    "fields: `id,name,status,daily_budget,campaign{id,name},insights.time_range(${time_range_str}){spend,impressions,clicks,actions}`"
)

# Map daily_budget in the results
mapping_replacement = """            return {
                id: adset.id,
                name: adset.name,
                status: adset.status,
                budget: adset.daily_budget ? (parseFloat(adset.daily_budget) / 100) : 0,"""
# Since I only saw the beginning of the return block, let's find exactly what it returns
