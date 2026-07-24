import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "./logger.js";

export type V5ReviewerDefinition = {
  name: string;
  fileName: string;
  filePath: string;
  articleIds: number[];
  markdown: string;
};

type LoadedV5Pack = {
  reviewerDirectory: string;
  reviewerDefinitions: V5ReviewerDefinition[];
};

type DirectoryEntryLike = {
  isFile(): boolean;
  name: string;
};

let cachedPack: LoadedV5Pack | null = null;

function resolveReviewerDirectory(): string {
  const candidates = [
    resolve(process.cwd(), "apps", "worker", "V5"),
    resolve(process.cwd(), "V5"),
    resolve(process.cwd(), "..", "V5"),
    resolve("/app", "apps", "worker", "V5"),
    resolve("/app", "V5"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function compareFileNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
}

function extractArticleIds(fileName: string, fallbackIndex: number): number[] {
  const matches = fileName.match(/\d+/g) ?? [];
  const ids = [...new Set(matches.map((match) => Number.parseInt(match, 10)).filter((value) => Number.isFinite(value)))];
  if (ids.length > 0) return ids;
  return [fallbackIndex + 1];
}

function loadReviewerPack(): LoadedV5Pack {
  const reviewerDirectory = resolveReviewerDirectory();
  const reviewerFiles: string[] = readdirSync(reviewerDirectory, { withFileTypes: true })
    .filter((entry: DirectoryEntryLike) => entry.isFile())
    .map((entry: DirectoryEntryLike) => entry.name)
    .filter((fileName: string) => /^article[_-]?\d.*\.md$/i.test(fileName))
    .sort(compareFileNames);

  const reviewerDefinitions: V5ReviewerDefinition[] = reviewerFiles.map((fileName: string, index: number) => {
    const filePath = resolve(reviewerDirectory, fileName);
    const markdown = readFileSync(filePath, "utf8");
    const articleIds = extractArticleIds(fileName, index);
    return {
      name: fileName.replace(/\.md$/i, ""),
      fileName,
      filePath,
      articleIds,
      markdown,
    };
  });

  logger.info("Violation Prompt System: V5", {
    reviewerDirectory,
    reviewerCount: reviewerDefinitions.length,
    reviewerFilesLoaded: reviewerDefinitions.map((reviewer) => reviewer.fileName),
  });

  return {
    reviewerDirectory,
    reviewerDefinitions,
  };
}

export function getV5ReviewerPack(): LoadedV5Pack {
  if (!cachedPack) {
    cachedPack = loadReviewerPack();
  }
  return cachedPack;
}

export function getV5ReviewerDefinitions(): V5ReviewerDefinition[] {
  return getV5ReviewerPack().reviewerDefinitions;
}
