/**
 * Tests for the noteDetection fixes.
 * Run: npx tsx src/noteDetection.test.ts
 */
import { normalizeNote, buildNoteSystemPrompt } from "./noteDetection.js";
import type { NoteItem } from "./schemas.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function testNormalizeNoteStripsLineIds() {
  const note: NoteItem = {
    title: "Test",
    description: "Test",
    category: "Media Credibility",
    paragraph: "0109: خالد...",
    quote: "0109: خالد...",
  };
  
  // @ts-ignore - testing internal
  const result = normalizeNote(note, "test-reviewer");
  assert(result?.paragraph === "خالد...", `Failed to strip 0109: from paragraph. Got: ${result?.paragraph}`);
  assert(result?.quote === "خالد...", `Failed to strip 0109: from quote. Got: ${result?.quote}`);
  console.log("✓ normalizeNote removes 0109: from the beginning of an evidence line");
}

function testNormalizeNoteMultipleLineIds() {
  const note: NoteItem = {
    title: "Test",
    description: "Test",
    category: "Media Credibility",
    paragraph: "0109: خالد...\n0110: غالي...",
    quote: "0109: خالد...\n0110: غالي...",
  };
  // @ts-ignore
  const result = normalizeNote(note, "test-reviewer");
  assert(result?.paragraph === "خالد...\nغالي...", `Failed to strip multiple IDs. Got: ${result?.paragraph}`);
  assert(result?.quote === "خالد...\nغالي...", `Failed to strip multiple IDs. Got: ${result?.quote}`);
  console.log("✓ normalizeNote removes multiple leaked line IDs");
}

function testNormalizeNotePreservesMiddleLineIds() {
  const note: NoteItem = {
    title: "Test",
    description: "Test",
    category: "Media Credibility",
    paragraph: "خالد يقول الوقت 1030: مساء",
    quote: "خالد يقول الوقت 1030: مساء",
  };
  // @ts-ignore
  const result = normalizeNote(note, "test-reviewer");
  assert(result?.paragraph === "خالد يقول الوقت 1030: مساء", `Failed to preserve middle ID. Got: ${result?.paragraph}`);
  assert(result?.quote === "خالد يقول الوقت 1030: مساء", `Failed to preserve middle ID. Got: ${result?.quote}`);
  console.log("✓ normalizeNote preserves legitimate 4-digit colon content in the middle of a line");
}

function testNormalizeNotePreservesNewlines() {
  const note: NoteItem = {
    title: "Test",
    description: "Test",
    category: "Media Credibility",
    paragraph: "خالد...\nغالي...",
    quote: "خالد...\nغالي...",
  };
  // @ts-ignore
  const result = normalizeNote(note, "test-reviewer");
  assert(result?.paragraph === "خالد...\nغالي...", `Failed to preserve newlines. Got: ${result?.paragraph}`);
  assert(result?.quote === "خالد...\nغالي...", `Failed to preserve newlines. Got: ${result?.quote}`);
  console.log("✓ normalizeNote preserves original line boundaries");
}

function testBuildNoteSystemPrompt() {
  // @ts-ignore
  const prompt = buildNoteSystemPrompt({ prompt: "TEST", category: "test", id: "test", name: "test" });
  assert(prompt.includes("verbatim in the original language"), "prompt must forbid translation");
  assert(prompt.includes("Do not translate"), "prompt must forbid translation");
  assert(prompt.includes("INTERNAL REVIEW IDS"), "prompt must mark 4-digit prefixes");
  assert(prompt.includes("0109:"), "prompt must show 0109: as example");
  console.log("✓ buildNoteSystemPrompt correctly includes new constraints");
}

testNormalizeNoteStripsLineIds();
testNormalizeNoteMultipleLineIds();
testNormalizeNotePreservesMiddleLineIds();
testNormalizeNotePreservesNewlines();
testBuildNoteSystemPrompt();
