/**
 * Tests for the V5 reviewer pack loader.
 * Run: npx tsx src/v5PromptPack.test.ts
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearV5ReviewerPackCacheForTests,
  getV5ReviewerPack,
  loadV5ReviewerPackFromDirectoryForTests,
  parseV5ReviewerMarkdownForTests,
  resolveV5ReviewerDirectoryForTests,
} from "./v5PromptPack.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function articleNumber(article: number): string {
  return String(article).padStart(2, "0");
}

function reviewerMarkdown(article: number, title: string, body = "هذا نص تجريبي."): string {
  return `# Article ${articleNumber(article)}\n## ${title}\n\n${body}\n`;
}

function makeTempBase(): string {
  return mkdtempSync(join(tmpdir(), "v5-reviewers-"));
}

function makeCanonicalReviewerDir(baseDir: string): string {
  const dir = join(baseDir, "reviewers", "v5");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeReviewer(dir: string, filename: string, article: number, title: string, body = "هذا نص تجريبي."): string {
  const filePath = join(dir, filename);
  writeFileSync(filePath, reviewerMarkdown(article, title, body), "utf8");
  return filePath;
}

function expectThrows(fn: () => unknown, expectedMessage: string): void {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expectedMessage), `expected error message to include "${expectedMessage}", got "${message}"`);
  }
  assert(threw, `expected function to throw "${expectedMessage}"`);
}

function testParseReviewerHeader(): void {
  const parsed = parseV5ReviewerMarkdownForTests(
    "whatever.md",
    "# Article 01\n## مقدمة المراجعة\n\nنص"
  );
  assert(parsed.articleNumber === 1, `expected articleNumber=1, got ${parsed.articleNumber}`);
  assert(parsed.articleTitle === "مقدمة المراجعة", `unexpected articleTitle: ${parsed.articleTitle}`);
  assert(parsed.prompt.startsWith("# Article 01\n## مقدمة المراجعة"), "prompt should preserve markdown header");
  console.log("✓ parses mandatory reviewer header");
}

function testRejectMalformedHeader(): void {
  expectThrows(
    () => parseV5ReviewerMarkdownForTests("bad.md", "## مقدمة\n# Article 01\nنص"),
    "invalid # Article XX header"
  );
  expectThrows(
    () => parseV5ReviewerMarkdownForTests("bad.md", "# Article 01\nمقدمة\nنص"),
    "invalid ## <Arabic Name> header"
  );
  expectThrows(
    () => parseV5ReviewerMarkdownForTests("bad.md", "# Article 00\n## مقدمة\nنص"),
    "between 01 and 24"
  );
  expectThrows(
    () => parseV5ReviewerMarkdownForTests("bad.md", ""),
    "empty"
  );
  console.log("✓ rejects malformed reviewer markdown");
}

function testPromptNormalizationRemovesLegacyDuplicateCognitiveBlock(): void {
  const parsed = parseV5ReviewerMarkdownForTests(
    "article-07.md",
    [
      "# Article 07",
      "## المحتوى الجنسي والعري",
      "",
      "# Purpose",
      "هدف تجريبي.",
      "",
      "# Event Decomposition Protocol (MANDATORY)",
      "محتوى حدثي.",
      "",
      "# Cognitive Review Protocol (MANDATORY)",
      "إرث قديم يجب إزالته.",
      "",
      "# What is considered a violation",
      "قائمة المخالفات.",
    ].join("\n")
  );

  assert(parsed.prompt.includes("# Event Decomposition Protocol (MANDATORY)"), "event decomposition protocol should remain");
  assert(!parsed.prompt.includes("إرث قديم يجب إزالته"), "legacy cognitive block should be removed");
  assert(parsed.prompt.includes("# What is considered a violation"), "violation section should remain");
  console.log("✓ normalizes reviewer prompts by removing the legacy duplicate cognitive block");
}

function testCanonicalDirectoryDiscovery(): void {
  const baseDir = makeTempBase();
  try {
    const canonicalDir = makeCanonicalReviewerDir(baseDir);
    const resolved = resolveV5ReviewerDirectoryForTests(baseDir);
    assert(resolved === canonicalDir, `expected canonical directory, got ${resolved}`);
    console.log("✓ canonical reviewer directory discovery prefers reviewers/v5");
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
}

function testAncestorDirectoryDiscovery(): void {
  const baseDir = makeTempBase();
  try {
    const canonicalDir = makeCanonicalReviewerDir(baseDir);
    const nestedWorkerDir = join(baseDir, "apps", "worker", "src");
    mkdirSync(nestedWorkerDir, { recursive: true });
    const resolved = resolveV5ReviewerDirectoryForTests(nestedWorkerDir);
    assert(resolved === canonicalDir, `expected ancestor discovery to resolve ${canonicalDir}, got ${resolved}`);
    console.log("✓ ancestor traversal finds reviewers/v5 from nested worker paths");
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
}

function testRepositoryFallbackDiscovery(): void {
  const baseDir = makeTempBase();
  try {
    const resolved = resolveV5ReviewerDirectoryForTests(baseDir);
    const normalized = resolved.replace(/\\/g, "/");
    assert(
      normalized.endsWith("reviewers/v5"),
      `expected resolver to fall back to the repository reviewer pack, got ${resolved}`
    );
    console.log("✓ repository fallback discovery resolves reviewers/v5");
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
}

function buildFullReviewerPack(baseDir: string): string {
  const dir = makeCanonicalReviewerDir(baseDir);
  for (let article = 1; article <= 24; article += 1) {
    writeReviewer(dir, `reviewer-${articleNumber(article)}.md`, article, `العنوان ${articleNumber(article)}`);
  }
  return dir;
}

function testFilenameIgnoredDuringLoad(): void {
  const baseDir = makeTempBase();
  try {
    const dir = makeCanonicalReviewerDir(baseDir);
    for (let article = 1; article <= 24; article += 1) {
      const filename = article === 1 ? "foo.md" : article === 2 ? "01.md" : `${articleNumber(article)}.md`;
      writeReviewer(dir, filename, article, `عنوان ${articleNumber(article)}`);
    }
    const pack = loadV5ReviewerPackFromDirectoryForTests(dir);
    assert(pack.reviewerDefinitions.length === 24, `expected 24 reviewers, got ${pack.reviewerDefinitions.length}`);
    const reviewer1 = pack.reviewerDefinitions.find((reviewer) => reviewer.articleNumber === 1);
    assert(reviewer1?.filename === "foo.md", `expected filename foo.md for article 1, got ${reviewer1?.filename ?? "missing"}`);
    const reviewer2 = pack.reviewerDefinitions.find((reviewer) => reviewer.articleNumber === 2);
    assert(reviewer2?.filename === "01.md", `expected filename 01.md for article 2, got ${reviewer2?.filename ?? "missing"}`);
    console.log("✓ filenames are ignored for article identity");
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
}

function testDuplicateReviewerFilesFailFast(): void {
  const baseDir = makeTempBase();
  try {
    const dir = makeCanonicalReviewerDir(baseDir);
    writeReviewer(dir, "alpha.md", 1, "الافتتاح");
    writeReviewer(dir, "beta.md", 1, "الافتتاح المكرر");
    for (let article = 2; article <= 23; article += 1) {
      writeReviewer(dir, `${articleNumber(article)}.md`, article, `عنوان ${articleNumber(article)}`);
    }
    expectThrows(
      () => loadV5ReviewerPackFromDirectoryForTests(dir),
      "duplicate article numbers"
    );
    console.log("✓ duplicate reviewer files fail fast");
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
}

function testMissingArticleFailsFast(): void {
  const baseDir = makeTempBase();
  try {
    const dir = makeCanonicalReviewerDir(baseDir);
    for (let article = 1; article <= 24; article += 1) {
      if (article === 13) continue;
      writeReviewer(dir, `${articleNumber(article)}.md`, article, `عنوان ${articleNumber(article)}`);
    }
    expectThrows(
      () => loadV5ReviewerPackFromDirectoryForTests(dir),
      "missing one or more article numbers"
    );
    console.log("✓ missing article numbers fail fast");
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
}

function testStartupValidationFailure(): void {
  const baseDir = makeTempBase();
  const previousCwd = process.cwd();
  try {
    const dir = makeCanonicalReviewerDir(baseDir);
    for (let article = 1; article <= 23; article += 1) {
      writeReviewer(dir, `reviewer-${articleNumber(article)}.md`, article, `عنوان ${articleNumber(article)}`);
    }
    clearV5ReviewerPackCacheForTests();
    process.chdir(baseDir);
    expectThrows(() => getV5ReviewerPack(), "missing one or more article numbers");
    console.log("✓ startup validation fails loudly for incomplete packs");
  } finally {
    process.chdir(previousCwd);
    clearV5ReviewerPackCacheForTests();
    rmSync(baseDir, { recursive: true, force: true });
  }
}

function testCacheCorrectness(): void {
  const baseDir = makeTempBase();
  const previousCwd = process.cwd();
  try {
    const dir = buildFullReviewerPack(baseDir);
    clearV5ReviewerPackCacheForTests();
    process.chdir(baseDir);
    const first = getV5ReviewerPack();
    const originalPrompt = first.reviewerDefinitions.find((reviewer) => reviewer.articleNumber === 1)?.prompt;
    assert(originalPrompt?.includes("العنوان 01"), "expected original prompt to include header title");

    const filePath = join(dir, "reviewer-01.md");
    writeFileSync(filePath, reviewerMarkdown(1, "العنوان 01 المعدل", "نص معدل"), "utf8");

    const second = getV5ReviewerPack();
    assert(first === second, "expected cached pack object to be reused");
    const cachedPrompt = second.reviewerDefinitions.find((reviewer) => reviewer.articleNumber === 1)?.prompt;
    assert(cachedPrompt === originalPrompt, "expected cached prompt to remain unchanged after file edit");
    console.log("✓ reviewer pack is cached in memory");
  } finally {
    process.chdir(previousCwd);
    clearV5ReviewerPackCacheForTests();
    rmSync(baseDir, { recursive: true, force: true });
  }
}

function testValidPackLoadsAllArticles(): void {
  const baseDir = makeTempBase();
  try {
    const dir = buildFullReviewerPack(baseDir);
    const pack = loadV5ReviewerPackFromDirectoryForTests(dir);
    assert(pack.reviewerDefinitions.length === 24, `expected 24 reviewers, got ${pack.reviewerDefinitions.length}`);
    const articles = pack.reviewerDefinitions.map((reviewer) => reviewer.articleNumber);
    assert(JSON.stringify(articles) === JSON.stringify(Array.from({ length: 24 }, (_, i) => i + 1)), "article numbers must be 1..24 in order");
    assert(readFileSync(join(dir, "reviewer-01.md"), "utf8").startsWith("# Article 01"), "test fixture sanity check");
    console.log("✓ valid pack loads exactly 24 ordered reviewers");
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  testCanonicalDirectoryDiscovery();
  testAncestorDirectoryDiscovery();
  testRepositoryFallbackDiscovery();
  testParseReviewerHeader();
  testRejectMalformedHeader();
  testPromptNormalizationRemovesLegacyDuplicateCognitiveBlock();
  testFilenameIgnoredDuringLoad();
  testDuplicateReviewerFilesFailFast();
  testMissingArticleFailsFast();
  testValidPackLoadsAllArticles();
  testStartupValidationFailure();
  testCacheCorrectness();
  console.log("\nAll V5 reviewer loader tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
