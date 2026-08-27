import re

filepath = r"apps\web\src\components\reports\analysis\Pdf.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update cardHeading to support RTL
content = content.replace(
    '<View style={s.cardHeading}>',
    '<View style={[s.cardHeading, isAr ? { flexDirection: "row-reverse" as const } : {}]}>'
)

# 2. Update sectionHeading to support RTL
content = content.replace(
    '<View minPresenceAhead={80} style={[s.sectionHeading, { borderBottomColor: style.borderColor }]}>',
    '<View minPresenceAhead={80} style={[s.sectionHeading, { borderBottomColor: style.borderColor }, isAr ? { flexDirection: "row-reverse" as const } : {}]}>'
)

# 3. Update cover meta block and statistics to support RTL?
# The stats are rendered in a grid:
# s.statisticsGrid is likely flex-wrap. We can add row-reverse there too.
content = content.replace(
    '<View style={s.statisticsGrid}>',
    '<View style={[s.statisticsGrid, isAr ? { flexDirection: "row-reverse" as const } : {}]}>'
)

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched Pdf.tsx")
