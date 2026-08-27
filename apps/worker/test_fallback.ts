import { groundFindingEvidenceToChunk } from './src/evidenceGrounding.js';

const mockChunkText = "في هذا المشهد، هذا هو النص الأصلي في السيناريو الذي بني عليه المشهد تماماً بدون تحريف.";

const paraphrasedFinding = {
  evidence_snippet: "هذا النص في السيناريو بني المشهد بدون تحريف", // Missing words
  location: { start_offset: 0, end_offset: 0 },
  article_id: 1,
  atom_id: "1-1"
};

const res = groundFindingEvidenceToChunk(paraphrasedFinding as any, mockChunkText);
console.log(JSON.stringify(res.diagnostics, null, 2));
