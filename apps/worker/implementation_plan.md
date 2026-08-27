# Implementation Plan: Deterministic Evidence Grounding

## Goal Description
The Gemini Judge frequently paraphrases the `evidence_snippet` despite strict V5 instructions to extract verbatim text. This causes findings to be dropped by `groundFindingEvidenceToChunk()` since it currently requires an exact substring match (or a highly flexible string match that still fails on severe paraphrasing).

We need a deterministic post-processing step to safely replace the paraphrased evidence with the exact source substring without changing the finding's meaning.

## Proposed Changes

### [MODIFY] apps/worker/src/evidenceGrounding.ts
We will enhance `groundFindingEvidenceToChunk` with two new deterministic fallback mechanisms for fixing paraphrased evidence:

1. **Structured Event Integration (Preferred):**
   - Update the signature: `export function groundFindingEvidenceToChunk(finding: JudgeFinding, chunkText: string, events: StructuredEvent[] = []): GroundedFindingResult`
   - **Logic:** Before attempting exact string matches, we will use `findBestEventMatch(finding, events)`. If the semantic match score is high (e.g., `>= 35`), we deterministically replace the Judge's `evidence_snippet` with `event.quote` and update the `start_offset`/`end_offset`. Since event quotes originate verbatim from the screenplay, this perfectly grounds the finding.

2. **Jaccard Token Overlap Fallback:**
   - If Event Understanding is unavailable or yields no match, we will implement a token-overlap fallback.
   - **Logic:** Tokenize the Judge's paraphrased `evidence_snippet`. Compare it against all `sentenceCandidates` built from `chunkText` (using the existing `buildSentenceCandidates`). Calculate the Jaccard similarity / Token overlap score. If a sentence candidate has a `>= 75%` token overlap with the paraphrased evidence, we deterministically replace the paraphrased text with the exact sentence candidate text from the chunk.

### [MODIFY] apps/worker/src/pipeline.ts
Update the invocation of `groundFindingEvidenceToChunk` to pass the `events` from `multiPassEventUnderstanding`.
```typescript
// Old:
const result = groundFindingEvidenceToChunk(f, chunkText);
// New:
const result = groundFindingEvidenceToChunk(f, chunkText, multiPassEventUnderstanding?.events || []);
```

## User Review Required
I have implemented the deterministic code modifications to `evidenceGrounding.ts` and `pipeline.ts`. 

> [!WARNING]
> **Regarding the 8 rejected findings from `c4639cee`:** 
> I attempted to run the 8 rejected findings through the new mechanism. However, because the job was completed (and appears to have been an empty test chunk), the upstream Event Understanding pass yielded `0` events, and the original `chunkText` was cleared from the database post-aggregation. 
> 
> Because I do not have access to the original source text for that specific job, I cannot retroactively reconstruct the *"exact screenplay evidence"* for those 8 findings. However, I have tested the new token-overlap fallback locally on a mocked paraphrased finding, and it successfully recovers the exact original source sentence.

You can run `git diff` locally to review my uncommitted changes to `apps/worker/src/evidenceGrounding.ts` and `apps/worker/src/pipeline.ts`. Once you approve the diff, we can commit and push it.
