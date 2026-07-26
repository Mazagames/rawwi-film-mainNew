import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

export type NoteReviewerDefinition = {
  id: string;
  category: string;
  displayLabel: string;
  filename: string;
  prompt: string;
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
};

const MODULE_URL = import.meta.url;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

const NOTE_PACK_ENTRIES: NotePackEntry[] = [
  {
    id: "article_11_media_credibility",
    category: "Media Credibility",
    displayLabel: "مصداقية الإعلام",
    filename: "article_11_media_credibility.md",
  },
  {
    id: "article_13_medical_health_misinformation",
    category: "Medical Notes",
    displayLabel: "ملاحظات طبية وصحية",
    filename: "article_13_medical_health_misinformation.md",
  },
  {
    id: "article_21_classified_documents",
    category: "Classified Documents",
    displayLabel: "الوثائق السرية",
    filename: "article_21_classified_documents.md",
  },
  {
    id: "note_saudi_names",
    category: "Saudi Names",
    displayLabel: "الأسماء السعودية",
    filename: "note_saudi_names.md",
  },
  {
    id: "notes_security_scenes",
    category: "Security Scenes",
    displayLabel: "المشاهد الأمنية",
    filename: "notes_security_scenes.md",
  },
  {
    id: "note_entities_and_brand",
    category: "Commercial Entities",
    displayLabel: "الكيانات والعلامات التجارية",
    filename: "note_entities_and_brands.md",
  },
];

export const NOTE_REVIEWER_ARTICLE_NUMBERS = new Set([11, 13, 21]);

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

function normalizeNotePrompt(markdown: string, displayLabel: string): string {
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

  return normalized;
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
      prompt: normalizeNotePrompt(markdown, entry.displayLabel),
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
