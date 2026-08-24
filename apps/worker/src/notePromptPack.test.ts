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
  assert(pack.noteDefinitions.length === 7, `expected 7 note reviewers, got ${pack.noteDefinitions.length}`);

  const expectedCategories = [
    "media_credibility",
    "medical_notes",
    "classified_documents",
    "saudi_names",
    "security_scenes",
    "commercial_entities",
    "religious_content",
  ];

  for (const category of expectedCategories) {
    assert(
      pack.noteDefinitions.some((definition) => definition.category === category),
      `missing note category: ${category}`,
    );
  }

  const entityNote = pack.noteDefinitions.find((definition) => definition.id === "note_entities_and_brand");
  assert(entityNote?.filename === "note_entities_and_brands.md", "expected pluralized entity note filename");
  assert(entityNote?.prompt.includes("#"), "expected note prompt to contain markdown content");
  const securityNote = pack.noteDefinitions.find((definition) => definition.id === "notes_security_scenes");
  assert(securityNote?.displayLabel === "المشاهد الأمنية", "expected Security Scenes display label");

  console.log("✓ repository note pack loads and preserves all seven categories");
}

function testNoteDefinitionsAccessibleFromRuntime(): void {
  const definitions = getNoteDefinitions();
  assert(definitions.length === 7, `expected 7 loaded note definitions, got ${definitions.length}`);
  for (const definition of definitions) {
    assert(definition.prompt.trim().length > 0, `note prompt should not be empty for ${definition.id}`);
    assert(definition.category.trim().length > 0, `note category should not be empty for ${definition.id}`);
  }
  console.log("✓ note definitions are accessible from the runtime cache");
}

function testNoteMarkdownFilesExist(): void {
  const noteDirectory = resolveNoteDirectoryForTests(process.cwd());
  const definitions = getNoteDefinitions();
  for (const definition of definitions) {
    const content = readFileSync(join(noteDirectory, definition.filename), "utf8");
    assert(content.trim().length > 0, `expected reviewer markdown to be non-empty: ${definition.filename}`);
  }
  console.log("✓ note markdown files exist and are non-empty");
}

testRepositoryNotePackLoads();
testNoteDefinitionsAccessibleFromRuntime();
testNoteMarkdownFilesExist();
