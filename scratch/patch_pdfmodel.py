import re

filepath = r"apps\web\src\components\reports\analysis\pdfModel.ts"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update sourceClassification signature and body
old_source_class = """function sourceClassification(source: string | null | undefined): "violation" | "manual" | "glossary" {
  if (source === "manual") return "manual";
  if (source === "lexicon_mandatory" || source === "glossary") return "glossary";
  return "violation";
}"""

new_source_class = """function sourceClassification(row: { source?: string | null; sourceKind?: string | null; severity?: string | null; category?: string | null }): "violation" | "note" | "manual" | "glossary" {
  const src = row.sourceKind || row.source;
  if (src === "manual") return "manual";
  if (src === "lexicon_mandatory" || src === "glossary") return "glossary";
  const sev = row.severity?.toLowerCase();
  if (
    sev === "note" ||
    sev === "ملاحظة" ||
    row.category === "ملاحظة" ||
    src === "informational" ||
    src === "special"
  ) {
    return "note";
  }
  return "violation";
}"""

content = content.replace(old_source_class, new_source_class)

# 2. Update usages
content = content.replace(
    'classification: sourceClassification(row.sourceKind)',
    'classification: sourceClassification(row)'
)

content = content.replace(
    'classification: sourceClassification(row.source)',
    'classification: sourceClassification(row)'
)

content = content.replace(
    'classification: "violation" as const',
    'classification: sourceClassification(row)'
)

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched pdfModel.ts")
