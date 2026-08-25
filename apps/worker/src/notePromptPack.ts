import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

export type ReviewerKind = "note" | "violation";
export type ReviewerDestination = "analysis_notes" | "analysis_findings";

export type NoteReviewerDefinition = {
  id: string;
  category: string;
  displayLabel: string;
  filename: string;
  prompt: string;
  kind: ReviewerKind;
  destination: ReviewerDestination;
};

type LoadedNotePack = {
  noteDirectory: string;
  noteDefinitions: NoteReviewerDefinition[];
};

type NotePackEntry = {
  id: string;
  category: string;
  displayLabel: string;
  filename: string;
  kind: ReviewerKind;
  destination: ReviewerDestination;
};

const MODULE_URL = import.meta.url;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

const NOTE_PACK_ENTRIES: NotePackEntry[] = [
  { id: "article_01_religion", category: "article_01", displayLabel: "الإساءة إلى الذات الإلهية والأنبياء والرسل والكتب السماوية والشعائر الإسلامية", filename: "article_01_religion.md", kind: "note", destination: "analysis_notes" },
  { id: "article_02_state_leadership", category: "article_02", displayLabel: "الإساءة إلى القيادة السياسية ورموز الدولة والسيادة الوطنية", filename: "article_02_state_leadership.md", kind: "note", destination: "analysis_notes" },
  { id: "article_03_terrorism", category: "article_03", displayLabel: "الإرهاب والتطرف والجماعات الإرهابية", filename: "article_03_terrorism.md", kind: "note", destination: "analysis_notes" },
  { id: "article_04_drugs_alcohol", category: "article_04", displayLabel: "المخدرات والكحول وتصنيعها والترويج لها", filename: "article_04_drugs_alcohol.md", kind: "note", destination: "analysis_notes" },
  {
    id: "article_11_media_credibility",
    category: "article_11",
    displayLabel: "مصداقية الإعلام",
    filename: "article_11_media_credibility.md",
    kind: "note",
    destination: "analysis_notes",
  },
  {
    id: "article_13_medical_health_misinformation",
    category: "article_13",
    displayLabel: "ملاحظات طبية وصحية",
    filename: "article_13_medical_health_misinformation.md",
    kind: "note",
    destination: "analysis_notes",
  },
  {
    id: "article_21_classified_documents",
    category: "article_21",
    displayLabel: "الوثائق السرية",
    filename: "article_21_classified_documents.md",
    kind: "note",
    destination: "analysis_notes",
  },
  {
    id: "note_saudi_names",
    category: "saudi_names",
    displayLabel: "الأسماء السعودية",
    filename: "note_saudi_names.md",
    kind: "note",
    destination: "analysis_notes",
  },
  {
    id: "notes_security_scenes",
    category: "security_scenes",
    displayLabel: "المشاهد الأمنية",
    filename: "notes_security_scenes.md",
    kind: "note",
    destination: "analysis_notes",
  },
  {
    id: "note_entities_and_brand",
    category: "commercial_entities",
    displayLabel: "الكيانات والعلامات التجارية",
    filename: "note_entities_and_brands.md",
    kind: "note",
    destination: "analysis_notes",
  },
  {
    id: "note_religious_content",
    category: "religious_content",
    displayLabel: "محتوى ديني / مذهبي حساس",
    filename: "note_religious_content.md",
    kind: "note",
    destination: "analysis_notes",
  },
  {
    id: "article_05_violence_torture",
    category: "article_05",
    displayLabel: "العنف والقتل والتعذيب",
    filename: "article_05_violence_torture.md",
    kind: "note",
    destination: "analysis_notes",
  },
  { id: "article_06_suicide_self_harm", category: "article_06", displayLabel: "الانتحار وإيذاء النفس وتشجيعها", filename: "article_06_suicide_self_harm.md", kind: "note", destination: "analysis_notes" },
  { id: "article_07_sexual_content_nudity", category: "article_07", displayLabel: "المحتوى الجنسي والعري", filename: "article_07_sexual_content_nudity.md", kind: "note", destination: "analysis_notes" },
  { id: "article_08_magic_sorcery", category: "article_08", displayLabel: "السحر والشعوذة والخرافات والتنجيم", filename: "article_08_magic_sorcery.md", kind: "note", destination: "analysis_notes" },
  { id: "article_09_crime_criminal_methods", category: "article_09", displayLabel: "الجرائم وتقنيات ارتكابها وتعليمها", filename: "article_09_crime_criminal_methods.md", kind: "note", destination: "analysis_notes" },
  { id: "article_10_hate_speech_discrimination", category: "article_10", displayLabel: "خطاب الكراهية والتمييز والإهانة ضد الفئات", filename: "article_10_hate_speech_discrimination.md", kind: "note", destination: "analysis_notes" },
  { id: "article_15_public_order", category: "article_15", displayLabel: "النظام العام", filename: "article_15_public_order.md", kind: "note", destination: "analysis_notes" },
  { id: "article_16_misinformation_rumors", category: "article_16", displayLabel: "الشائعات والمعلومات المضللة", filename: "article_16_misinformation_rumors.md", kind: "note", destination: "analysis_notes" },
  { id: "article_17_dignity_reputation_privacy", category: "article_17", displayLabel: "الكرامة والسمعة والخصوصية", filename: "article_17_dignity_reputation_privacy.md", kind: "note", destination: "analysis_notes" },
  { id: "article_18_international_relations", category: "article_18", displayLabel: "العلاقات الدولية", filename: "article_18_international_relations.md", kind: "note", destination: "analysis_notes" },
  { id: "article_19_economic_stability", category: "article_19", displayLabel: "الاقتصاد والاستقرار المالي", filename: "article_19_economic_stability.md", kind: "note", destination: "analysis_notes" },
  { id: "article_20_bankruptcy_commercial_cases", category: "article_20", displayLabel: "الإفلاس والقضايا التجارية", filename: "article_20_bankruptcy_commercial_cases.md", kind: "note", destination: "analysis_notes" },
  { id: "article_22_treaties_agreements", category: "article_22", displayLabel: "الاتفاقيات والمعاهدات", filename: "article_22_treaties_agreements.md", kind: "note", destination: "analysis_notes" },
  { id: "article_23_public_appearance", category: "article_23", displayLabel: "المظهر العام", filename: "article_23_public_appearance.md", kind: "note", destination: "analysis_notes" },
  { id: "article_24_clothing_modesty", category: "article_24", displayLabel: "الزي والاحتشام", filename: "article_24_clothing_modesty.md", kind: "note", destination: "analysis_notes" },
  {
    id: "article_12_child_protection_exploitation",
    category: "article_12",
    displayLabel: "حماية الأطفال والقُصّر",
    filename: "article_12_child_protection_exploitation.md",
    kind: "note",
    destination: "analysis_notes",
  },
  {
    id: "article_14_profanity_personal_insults",
    category: "article_14",
    displayLabel: "الألفاظ النابية والشتائم والإهانات الشخصية",
    filename: "article_14_profanity_personal_insults.md",
    kind: "note",
    destination: "analysis_notes",
  },
];

export const NOTE_REVIEWER_ARTICLE_NUMBERS = new Set(Array.from({ length: 24 }, (_, index) => index + 1));

export function validateArticleNoteReviewerCoverage(definitions = getNoteDefinitions()): NoteReviewerDefinition[] {
  const articleDefinitions = definitions.filter((definition) => /^article_\d{2}_/.test(definition.id));
  const byArticle = new Map<number, NoteReviewerDefinition[]>();
  for (const definition of articleDefinitions) {
    const match = /^article_(\d{2})_/.exec(definition.id);
    const articleNumber = match ? Number(match[1]) : NaN;
    const entries = byArticle.get(articleNumber) ?? [];
    entries.push(definition);
    byArticle.set(articleNumber, entries);
  }
  const expected = Array.from(NOTE_REVIEWER_ARTICLE_NUMBERS).sort((a, b) => a - b);
  const actual = [...byArticle.keys()].filter(Number.isInteger).sort((a, b) => a - b);
  const missing = expected.filter((articleNumber) => !byArticle.has(articleNumber));
  const unexpected = actual.filter((articleNumber) => !NOTE_REVIEWER_ARTICLE_NUMBERS.has(articleNumber));
  const duplicates = actual.filter((articleNumber) => (byArticle.get(articleNumber)?.length ?? 0) !== 1);
  const invalid = articleDefinitions.filter((definition) => definition.kind !== "note" || definition.destination !== "analysis_notes" || !definition.prompt.trim());
  if (missing.length || unexpected.length || duplicates.length || invalid.length || actual.length !== expected.length) {
    throw new Error(`Article Note reviewer coverage invalid: expected=${expected.length}, actual=${actual.length}, missing=${missing.join(",") || "none"}, unexpected=${unexpected.join(",") || "none"}, duplicates=${duplicates.join(",") || "none"}, invalid=${invalid.map((definition) => definition.id).join(",") || "none"}`);
  }
  return articleDefinitions;
}

let cachedPack: LoadedNotePack | null = null;

function collectAncestorDirectories(startDir: string): string[] {
  const resolvedStartDir = resolve(startDir);
  const ancestors: string[] = [];
  let currentDir = resolvedStartDir;

  while (!ancestors.includes(currentDir)) {
    ancestors.push(currentDir);
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return ancestors;
}

function failNoteLoad(message: string, extra?: Record<string, unknown>): never {
  logger.error("Loaded Note Pack V5 validation failed", {
    message,
    ...extra,
  });
  throw new Error(message);
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function resolveNoteDirectory(baseDir = process.cwd()): string {
  const searchAnchors = [baseDir, process.cwd(), MODULE_DIR];
  const triedDirectories = new Set<string>();

  for (const anchor of searchAnchors) {
    for (const ancestor of collectAncestorDirectories(anchor)) {
      const candidate = resolve(ancestor, "reviewers", "v5");
      if (triedDirectories.has(candidate)) {
        continue;
      }
      triedDirectories.add(candidate);
      if (existsSync(candidate)) {
        logger.info("V5 note discovery", {
          cwd: process.cwd(),
          importMetaUrl: MODULE_URL,
          moduleDir: MODULE_DIR,
          resolvedNoteDirectory: candidate,
          searchAnchors,
        });
        return candidate;
      }
    }
  }

  failNoteLoad("V5 note directory not found", {
    cwd: process.cwd(),
    importMetaUrl: MODULE_URL,
    moduleDir: MODULE_DIR,
    searchAnchors,
    triedDirectories: Array.from(triedDirectories),
  });
}

function normalizeNotePrompt(markdown: string, displayLabel: string, category: string): string {
  const normalized = normalizeMarkdown(markdown).trim();
  if (!normalized) {
    failNoteLoad("V5 note markdown file is empty", { displayLabel });
  }

  const [firstLine = "", secondLine = ""] = normalized.split("\n");
  if (!firstLine.startsWith("# ")) {
    failNoteLoad("V5 note markdown file is missing the required first heading", {
      displayLabel,
      firstLine,
    });
  }
  if (!secondLine.startsWith("## ")) {
    failNoteLoad("V5 note markdown file is missing the required second heading", {
      displayLabel,
      secondLine,
    });
  }

  const noteFraming = "This is a Note reviewer for human review. A Note is not a violation. Do not produce findings or violation decisions.";
  const framing = normalized.includes(noteFraming) ? normalized : `${normalized}\n\n${noteFraming}`;
  if (framing.includes("# Output Contract (MANDATORY)")) {
    return framing;
  }

  return `${framing}\n\n---\n\n# Output Contract (MANDATORY)\n\nReturn valid JSON only, with no prose or Markdown outside one JSON object:\n\n{\n  "notes": [\n    {\n      "category": "${category}",\n      "title": "",\n      "description": "",\n      "paragraph": "",\n      "quote": "",\n      "event_id": 12,\n      "confidence": 0.7\n    }\n  ]\n}\n\nThe event_id MUST come from the provided StructuredEvents. The quote MUST be an exact literal substring from the provided event. If any required field cannot be produced, omit that Note. If no relevant Note exists, return {"notes": []}.`;
}
function loadNotePackFromDirectory(noteDirectory: string): LoadedNotePack {
  const noteDefinitions = NOTE_PACK_ENTRIES.map((entry) => {
    const filePath = resolve(noteDirectory, entry.filename);
    if (!existsSync(filePath)) {
      failNoteLoad("V5 note markdown file is missing", {
        noteDirectory,
        filename: entry.filename,
        noteId: entry.id,
      });
    }
    const markdown = readFileSync(filePath, "utf8");
    return {
      ...entry,
      prompt: normalizeNotePrompt(markdown, entry.displayLabel, entry.category),
    } satisfies NoteReviewerDefinition;
  });

  logger.info("Loaded Note Pack V5", {
    cwd: process.cwd(),
    importMetaUrl: MODULE_URL,
    moduleDir: MODULE_DIR,
    Directory: noteDirectory,
    noteCount: noteDefinitions.length,
    noteFilesLoaded: noteDefinitions.map((note) => note.filename),
    noteCategoriesLoaded: noteDefinitions.map((note) => note.category),
    noteLabelsLoaded: noteDefinitions.map((note) => note.displayLabel),
  });

  logger.info(`${noteDefinitions.length} notes loaded`, {
    Directory: noteDirectory,
  });

  return {
    noteDirectory,
    noteDefinitions,
  };
}

export function getNotePack(): LoadedNotePack {
  if (!cachedPack) {
    cachedPack = loadNotePackFromDirectory(resolveNoteDirectory());
  }
  return cachedPack;
}

export function getNoteDefinitions(): NoteReviewerDefinition[] {
  return getNotePack().noteDefinitions;
}

export function clearNotePackCacheForTests(): void {
  cachedPack = null;
}

export function resolveNoteDirectoryForTests(baseDir: string): string {
  return resolveNoteDirectory(baseDir);
}

export function loadNotePackFromDirectoryForTests(noteDirectory: string): LoadedNotePack {
  return loadNotePackFromDirectory(noteDirectory);
}
