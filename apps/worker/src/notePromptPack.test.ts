/**
 * Tests for the V5 notes pack loader.
 * Run: npx tsx src/notePromptPack.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strict as nodeAssert } from "node:assert";
import {
  getNoteDefinitions,
  loadNotePackFromDirectoryForTests,
  resolveNoteDirectoryForTests,
  validateArticleNoteReviewerCoverage,
} from "./notePromptPack.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function testRepositoryNotePackLoads(): void {
  const noteDirectory = resolveNoteDirectoryForTests(process.cwd());
  const pack = loadNotePackFromDirectoryForTests(noteDirectory);
  const noteDefinitions = pack.noteDefinitions.filter((definition) => definition.kind === "note");
  assert(noteDefinitions.length === 28, `expected 28 note reviewers, got ${noteDefinitions.length}`);

  const expectedCategories = [
    ...Array.from({ length: 24 }, (_, index) => `article_${String(index + 1).padStart(2, "0")}`),
    "saudi_names",
    "security_scenes",
    "commercial_entities",
    "religious_content",
  ];

  for (const category of expectedCategories) {
    assert(
      noteDefinitions.some((definition) => definition.category === category),
      `missing note category: ${category}`,
    );
  }

  const entityNote = noteDefinitions.find((definition) => definition.id === "note_entities_and_brand");
  assert(entityNote?.filename === "note_entities_and_brands.md", "expected pluralized entity note filename");
  assert(entityNote?.prompt.includes("#"), "expected note prompt to contain markdown content");
  const securityNote = noteDefinitions.find((definition) => definition.id === "notes_security_scenes");
  assert(securityNote?.displayLabel === "المشاهد الأمنية", "expected Security Scenes display label");

  console.log("✓ repository note pack loads all 24 article categories");
}

function testNoteDefinitionsAccessibleFromRuntime(): void {
  const definitions = getNoteDefinitions();
  const noteDefinitions = definitions.filter((definition) => definition.kind === "note");
  assert(noteDefinitions.length === 28, `expected 28 loaded note definitions, got ${noteDefinitions.length}`);
  for (const definition of noteDefinitions) {
    assert(definition.prompt.trim().length > 0, `note prompt should not be empty for ${definition.id}`);
    assert(definition.category.trim().length > 0, `note category should not be empty for ${definition.id}`);
  }
  console.log("✓ note definitions are accessible from the runtime cache");
}

function testPilotArticlesAreOrdinaryNotes(): void {
  const definitions = getNoteDefinitions();
  const ids = Array.from({ length: 24 }, (_, index) => `article_${String(index + 1).padStart(2, "0")}`);

  for (const id of ids) {
    const definition = definitions.find((entry) => entry.category === id);
    assert(definition, `missing article reviewer definition: ${id}`);
    assert(definition.kind === "note", `${id} must be registered as kind=note`);
    assert(definition.destination === "analysis_notes", `${id} must persist to analysis_notes`);
    assert(definition.prompt.includes("# Output Contract (MANDATORY)"), `${id} must have a Note output contract`);
  }

  console.log("✓ all Article 01-24 reviewers are ordinary Notes in analysis_notes");
}

function testNoteMarkdownFilesExist(): void {
  const noteDirectory = resolveNoteDirectoryForTests(process.cwd());
  const definitions = getNoteDefinitions().filter((definition) => definition.kind === "note");
  for (const definition of definitions) {
    const content = readFileSync(join(noteDirectory, definition.filename), "utf8");
    assert(content.trim().length > 0, `expected reviewer markdown to be non-empty: ${definition.filename}`);
  }
  console.log("✓ note markdown files exist and are non-empty");
}

function testArticleCoverageFailsFast(): void {
  const definitions = getNoteDefinitions();
  validateArticleNoteReviewerCoverage(definitions);
  const missing = definitions.filter((definition) => definition.category !== "article_24");
  nodeAssert.throws(() => validateArticleNoteReviewerCoverage(missing), /missing=24/);
  const duplicate = [...definitions, definitions.find((definition) => definition.category === "article_01")!];
  nodeAssert.throws(() => validateArticleNoteReviewerCoverage(duplicate), /duplicates=1/);
  console.log("✓ Article 01-24 coverage fails fast for missing and duplicate reviewers");
}

testRepositoryNotePackLoads();
testNoteDefinitionsAccessibleFromRuntime();
testPilotArticlesAreOrdinaryNotes();
testNoteMarkdownFilesExist();
testArticleCoverageFailsFast();
