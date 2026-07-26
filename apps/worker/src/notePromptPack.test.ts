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
  assert(pack.noteDefinitions.length === 6, `expected 6 note reviewers, got ${pack.noteDefinitions.length}`);

  const expectedCategories = [
    "Media Credibility",
    "Medical Notes",
    "Classified Documents",
    "Saudi Names",
    "Security Scenes",
    "Commercial Entities",
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

  console.log("✓ repository note pack loads and preserves all six categories");
}

function testNoteDefinitionsAccessibleFromRuntime(): void {
  const definitions = getNoteDefinitions();
  assert(definitions.length === 6, `expected 6 loaded note definitions, got ${definitions.length}`);
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
