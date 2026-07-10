with open('server.js', 'r') as f:
    content = f.read()

content = content.replace(
"""            return {
                id: adset.id,
                name: adset.name,
                status: adset.status,""",
"""            return {
                id: adset.id,
                name: adset.name,
                status: adset.status,
                budget: adset.daily_budget ? (parseFloat(adset.daily_budget) / 100) : 0,""")

with open('server.js', 'w') as f:
    f.write(content)

