/**
 * Tests for the V5 notes pack loader.
 * Run: npx tsx src/notePromptPack.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getNoteDefinitions,
  loadNotePackFromDirectoryForTests,
  resolveNoteDirectoryForTests,
} from "./notePromptPack.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function testRepositoryNotePackLoads(): void {
  const noteDirectory = resolveNoteDirectoryForTests(process.cwd());
  const pack = loadNotePackFromDirectoryForTests(noteDirectory);
  const noteDefinitions = pack.noteDefinitions.filter((definition) => definition.kind === "note");
  assert(noteDefinitions.length === 8, `expected 8 note reviewers, got ${noteDefinitions.length}`);

  const expectedCategories = [
    "media_credibility",
    "medical_notes",
    "classified_documents",
    "saudi_names",
    "security_scenes",
    "commercial_entities",
    "religious_content",
    "article_14",
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

  console.log("✓ repository note pack loads and preserves all seven categories");
}

function testNoteDefinitionsAccessibleFromRuntime(): void {
  const definitions = getNoteDefinitions();
  const noteDefinitions = definitions.filter((definition) => definition.kind === "note");
  assert(noteDefinitions.length === 8, `expected 8 loaded note definitions, got ${noteDefinitions.length}`);
  for (const definition of noteDefinitions) {
    assert(definition.prompt.trim().length > 0, `note prompt should not be empty for ${definition.id}`);
    assert(definition.category.trim().length > 0, `note category should not be empty for ${definition.id}`);
  }
  console.log("✓ note definitions are accessible from the runtime cache");
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

testRepositoryNotePackLoads();
testNoteDefinitionsAccessibleFromRuntime();
testNoteMarkdownFilesExist();
