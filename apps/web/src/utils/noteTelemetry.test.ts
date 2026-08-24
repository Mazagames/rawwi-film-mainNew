import { countNotesByCategory } from "./noteTelemetry";
import type { ReportNote } from "../../api/models";
import assert from "assert";

console.log("Running noteTelemetry UI Category test...");
const mockNotes: Partial<Record<any, ReportNote[]>> = {
  religious_content: [
    { id: "1", category: "religious_content" } as ReportNote,
    { id: "2", category: "religious_content" } as ReportNote,
  ],
  security_scenes: [
    { id: "3", category: "security_scenes" } as ReportNote,
  ]
};
const counts = countNotesByCategory(mockNotes as any);
assert.strictEqual(counts.religious_content, 2, "religious_content count should be 2");
assert.strictEqual(counts.security_scenes, 1, "security_scenes count should be 1");
assert.strictEqual(counts.medical_notes, 0, "medical_notes count should be 0");
console.log("✓ Religious UI category mapped correctly");
