import re

filepath = r"apps\web\src\components\reports\analysis\styles.ts"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(
    'rtl: { textAlign: "right" },',
    'rtl: { textAlign: "right", direction: "rtl" as const },'
)

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched styles.ts")
