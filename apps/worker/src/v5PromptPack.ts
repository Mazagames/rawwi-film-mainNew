import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const EXPECTED_V5_REVIEWER_COUNT = 24;
const EXPECTED_ARTICLE_MIN = 1;
const EXPECTED_ARTICLE_MAX = 24;

let cachedPack: LoadedV5Pack | null = null;

function failV5ReviewerLoad(message: string, extra?: Record<string, unknown>): never {
  logger.error("Loaded Reviewer Pack V5 validation failed", {
    message,
    ...extra,
  });
  throw new Error(message);
}

function compareNumericArticleIds(a: number, b: number): number {
  return a - b;
}

function isMarkdownFile(fileName: string): boolean {
  return /\.md$/i.test(fileName);
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
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
    prompt: normalized,
  };
}

function resolveReviewerDirectory(baseDir = process.cwd()): string {
  const canonical = resolve(baseDir, "reviewers", "v5");
  if (existsSync(canonical)) {
    return canonical;
  }

  failV5ReviewerLoad("V5 reviewer directory not found", {
    canonical,
  });
}

function loadReviewerPackFromDirectory(reviewerDirectory: string): LoadedV5Pack {
  const reviewerFiles: string[] = readdirSync(reviewerDirectory, { withFileTypes: true })
    .filter((entry: DirectoryEntryLike) => entry.isFile())
    .map((entry: DirectoryEntryLike) => entry.name)
    .filter(isMarkdownFile);

  if (reviewerFiles.length === 0) {
    failV5ReviewerLoad("No V5 reviewer markdown files were found", {
      reviewerDirectory,
    });
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

  if (parsedReviewers.length !== EXPECTED_V5_REVIEWER_COUNT) {
    failV5ReviewerLoad("V5 reviewer pack must contain exactly 24 markdown files", {
      reviewerDirectory,
      reviewerCount: parsedReviewers.length,
      expectedCount: EXPECTED_V5_REVIEWER_COUNT,
    });
  }

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
    });
  }

  const orderedReviewers = Array.from(byArticle.values()).sort((a, b) => compareNumericArticleIds(a.articleNumber, b.articleNumber));

  logger.info("Loaded Reviewer Pack V5", {
    reviewerDirectory,
    reviewerCount: orderedReviewers.length,
    reviewerFilesLoaded: orderedReviewers.map((reviewer) => reviewer.filename),
    reviewerArticlesLoaded: orderedReviewers.map((reviewer) => reviewer.articleNumber),
    reviewerLabelsLoaded: orderedReviewers.map((reviewer) => reviewer.displayLabel),
  });

  logger.info("Reviewer pack validation passed", {
    reviewerDirectory,
    reviewerCount: orderedReviewers.length,
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
