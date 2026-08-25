import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

export type V5ReviewerDefinition = {
  articleNumber: number;
  articleTitle: string;
  filename: string;
  prompt: string;
  displayLabel: string;
};

type LoadedV5Pack = {
  reviewerDirectory: string;
  reviewerDefinitions: V5ReviewerDefinition[];
};

type DirectoryEntryLike = {
  isFile(): boolean;
  name: string;
};

type ParsedV5ReviewerMarkdown = {
  articleNumber: number;
  articleTitle: string;
  prompt: string;
};

const LEGACY_V5_EXCLUDED_FILENAMES = new Set([
  "article_01_religion.md",
  "article_02_state_leadership.md",
  "article_03_terrorism.md",
  "article_04_drugs_alcohol.md",
  "article_05_violence_torture.md",
  "article_06_suicide_self_harm.md",
  "article_07_sexual_content_nudity.md",
  "article_08_magic_sorcery.md",
  "article_09_crime_criminal_methods.md",
  "article_10_hate_speech_discrimination.md",
  "article_11_media_credibility.md",
  "article_12_child_protection_exploitation.md",
  "article_13_medical_health_misinformation.md",
  "article_14_profanity_personal_insults.md",
  "article_15_public_order.md",
  "article_16_misinformation_rumors.md",
  "article_17_dignity_reputation_privacy.md",
  "article_18_international_relations.md",
  "article_19_economic_stability.md",
  "article_20_bankruptcy_commercial_cases.md",
  "article_21_classified_documents.md",
  "article_22_treaties_agreements.md",
  "article_23_public_appearance.md",
  "article_24_clothing_modesty.md",
]);
const EXPECTED_V5_REVIEWER_COUNT = 24;
const EXPECTED_ARTICLE_MIN = 1;
const EXPECTED_ARTICLE_MAX = 24;
const MODULE_URL = import.meta.url;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

let cachedPack: LoadedV5Pack | null = null;

function failV5ReviewerLoad(message: string, extra?: Record<string, unknown>): never {
  logger.error("Loaded Reviewer Pack V5 validation failed", {
    message,
    ...extra,
  });
  throw new Error(message);
}

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

function compareNumericArticleIds(a: number, b: number): number {
  return a - b;
}

function isMarkdownFile(fileName: string): boolean {
  return /\.md$/i.test(fileName);
}

function isV5ArticleReviewerFile(fileName: string): boolean {
  return /^article_\d{2}_.+\.md$/i.test(fileName);
}

function isLegacyV5ReviewerFile(fileName: string): boolean {
  return isV5ArticleReviewerFile(fileName) && !LEGACY_V5_EXCLUDED_FILENAMES.has(fileName);
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function normalizeV5ReviewerPrompt(markdown: string): string {
  const legacyMarker = "# Cognitive Review Protocol (MANDATORY)";
  const violationHeading = "# What is considered a violation";
  const markerIndex = markdown.indexOf(legacyMarker);
  if (markerIndex < 0) return markdown;

  const violationIndex = markdown.indexOf(violationHeading, markerIndex + legacyMarker.length);
  if (violationIndex < 0) return markdown;

  return `${markdown.slice(0, markerIndex).trimEnd()}\n\n${markdown.slice(violationIndex)}`;
}

function formatArticleLabel(articleNumber: number, articleTitle: string): string {
  return `المادة ${String(articleNumber).padStart(2, "0")}: ${articleTitle}`;
}

function parseV5ReviewerMarkdown(filename: string, markdown: string): ParsedV5ReviewerMarkdown {
  const normalized = normalizeMarkdown(markdown);
  if (!normalized.trim()) {
    failV5ReviewerLoad("V5 reviewer markdown file is empty", { filename });
  }

  const lines = normalized.split("\n");
  if (lines.length < 2) {
    failV5ReviewerLoad("V5 reviewer markdown is missing the required two-line header", { filename });
  }

  const firstLine = lines[0];
  const secondLine = lines[1];

  const articleMatch = /^# Article (\d{2})$/.exec(firstLine);
  if (!articleMatch) {
    failV5ReviewerLoad("V5 reviewer markdown has an invalid # Article XX header", {
      filename,
      firstLine,
    });
  }

  const articleNumber = Number.parseInt(articleMatch[1], 10);
  if (!Number.isInteger(articleNumber) || articleNumber < EXPECTED_ARTICLE_MIN || articleNumber > EXPECTED_ARTICLE_MAX) {
    failV5ReviewerLoad("V5 reviewer article number must be between 01 and 24", {
      filename,
      articleNumber,
    });
  }

  const titleMatch = /^## (.+)$/.exec(secondLine);
  if (!titleMatch) {
    failV5ReviewerLoad("V5 reviewer markdown has an invalid ## <Arabic Name> header", {
      filename,
      secondLine,
    });
  }

  const articleTitle = titleMatch[1].trim();
  if (!articleTitle) {
    failV5ReviewerLoad("V5 reviewer article title is empty", { filename });
  }

  return {
    articleNumber,
    articleTitle,
    prompt: normalizeV5ReviewerPrompt(normalized),
  };
}

function resolveReviewerDirectory(baseDir = process.cwd()): string {
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
        logger.info("V5 reviewer discovery", {
          cwd: process.cwd(),
          importMetaUrl: MODULE_URL,
          moduleDir: MODULE_DIR,
          resolvedReviewerDirectory: candidate,
          searchAnchors,
        });
        return candidate;
      }
    }
  }

  failV5ReviewerLoad("V5 reviewer directory not found", {
    cwd: process.cwd(),
    importMetaUrl: MODULE_URL,
    moduleDir: MODULE_DIR,
    searchAnchors,
    triedDirectories: Array.from(triedDirectories),
  });
}

function loadReviewerPackFromDirectory(reviewerDirectory: string): LoadedV5Pack {
  const reviewerFiles: string[] = readdirSync(reviewerDirectory, { withFileTypes: true })
    .filter((entry: DirectoryEntryLike) => entry.isFile())
    .map((entry: DirectoryEntryLike) => entry.name)
    .filter(isMarkdownFile)
    .filter(isLegacyV5ReviewerFile);

  if (reviewerFiles.length === 0) {
    return { reviewerDirectory, reviewerDefinitions: [] };
  }

  const parsedReviewers = reviewerFiles.map((filename) => {
    const filePath = resolve(reviewerDirectory, filename);
    const markdown = readFileSync(filePath, "utf8");
    const parsed = parseV5ReviewerMarkdown(filename, markdown);
    return {
      articleNumber: parsed.articleNumber,
      articleTitle: parsed.articleTitle,
      filename,
      prompt: parsed.prompt,
      displayLabel: formatArticleLabel(parsed.articleNumber, parsed.articleTitle),
    } satisfies V5ReviewerDefinition;
  });

  const byArticle = new Map<number, V5ReviewerDefinition>();
  for (const reviewer of parsedReviewers) {
    if (reviewer.articleNumber < EXPECTED_ARTICLE_MIN || reviewer.articleNumber > EXPECTED_ARTICLE_MAX) {
      failV5ReviewerLoad("V5 reviewer article number is outside the allowed range", {
        reviewerDirectory,
        filename: reviewer.filename,
        articleNumber: reviewer.articleNumber,
      });
    }

    if (byArticle.has(reviewer.articleNumber)) {
      const existing = byArticle.get(reviewer.articleNumber)!;
      failV5ReviewerLoad("V5 reviewer pack contains duplicate article numbers", {
        articleNumber: reviewer.articleNumber,
        firstFilename: existing.filename,
        duplicateFilename: reviewer.filename,
      });
    }

    byArticle.set(reviewer.articleNumber, reviewer);
  }

  const missingArticleNumbers: number[] = [];
  for (let articleNumber = EXPECTED_ARTICLE_MIN; articleNumber <= EXPECTED_ARTICLE_MAX; articleNumber += 1) {
    if (!byArticle.has(articleNumber)) {
      missingArticleNumbers.push(articleNumber);
    }
  }
  if (missingArticleNumbers.length > 0) {
    failV5ReviewerLoad("V5 reviewer pack is missing one or more article numbers", {
      reviewerDirectory,
      missingArticleNumbers,
      reviewerCount: parsedReviewers.length,
      expectedCount: EXPECTED_V5_REVIEWER_COUNT,
    });
  }

  if (parsedReviewers.length !== EXPECTED_V5_REVIEWER_COUNT) {
    failV5ReviewerLoad("V5 reviewer pack must contain exactly 0 markdown files", {
      reviewerDirectory,
      reviewerCount: parsedReviewers.length,
      expectedCount: EXPECTED_V5_REVIEWER_COUNT,
    });
  }

  const orderedReviewers = Array.from(byArticle.values()).sort((a, b) => compareNumericArticleIds(a.articleNumber, b.articleNumber));

  logger.info("Loaded Reviewer Pack V5", {
    cwd: process.cwd(),
    importMetaUrl: MODULE_URL,
    moduleDir: MODULE_DIR,
    Directory: reviewerDirectory,
    reviewerCount: orderedReviewers.length,
    reviewerFilesLoaded: orderedReviewers.map((reviewer) => reviewer.filename),
    reviewerArticlesLoaded: orderedReviewers.map((reviewer) => reviewer.articleNumber),
    reviewerLabelsLoaded: orderedReviewers.map((reviewer) => reviewer.displayLabel),
  });

  logger.info(`${orderedReviewers.length} reviewers loaded`, {
    Directory: reviewerDirectory,
  });

  logger.info("Validation passed", {
    Directory: reviewerDirectory,
    articleChecks: orderedReviewers.map((reviewer) => `Article ${String(reviewer.articleNumber).padStart(2, "0")} ✓`),
  });

  return {
    reviewerDirectory,
    reviewerDefinitions: orderedReviewers,
  };
}

export function getV5ReviewerPack(): LoadedV5Pack {
  if (!cachedPack) {
    cachedPack = loadReviewerPackFromDirectory(resolveReviewerDirectory());
  }
  return cachedPack;
}

export function getV5ReviewerDefinitions(): V5ReviewerDefinition[] {
  return getV5ReviewerPack().reviewerDefinitions;
}

export function clearV5ReviewerPackCacheForTests(): void {
  cachedPack = null;
}

export function resolveV5ReviewerDirectoryForTests(baseDir: string): string {
  return resolveReviewerDirectory(baseDir);
}

export function parseV5ReviewerMarkdownForTests(filename: string, markdown: string): ParsedV5ReviewerMarkdown {
  return parseV5ReviewerMarkdown(filename, markdown);
}

export function loadV5ReviewerPackFromDirectoryForTests(reviewerDirectory: string): LoadedV5Pack {
  return loadReviewerPackFromDirectory(reviewerDirectory);
}
