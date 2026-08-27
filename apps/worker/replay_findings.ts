import fs from 'fs';
import { buildFindingUuid } from './src/findingIdentity.js';
import { groundFindingEvidenceToChunk } from './src/evidenceGrounding.js';

async function run() {
  const data = JSON.parse(fs.readFileSync('job_investigation.json', 'utf-8'));
  const text = fs.readFileSync('test_script_shadow.txt', 'utf-8');

  let initialFindingsCount = 0;
  let placeholdersRemoved = 0;
  
  let uuidsBefore = new Set();
  let duplicateUuidsBefore = 0;
  let uuidsAfter = new Set();
  let duplicateUuidsAfter = 0;
  
  let mismatchesRejected = 0;
  let finalFindingsCount = 0;

  for (const run of data.runs || []) {
    const rawFindings = run.ai_findings || [];

    for (const f of rawFindings) {
      initialFindingsCount++;
      
      // Track initial duplicate UUIDs
      if (f.finding_uuid) {
        if (uuidsBefore.has(f.finding_uuid)) {
          duplicateUuidsBefore++;
        } else {
          uuidsBefore.add(f.finding_uuid);
        }
      }

      // 1. Proposed Fix: Remove placeholders
      if (f.canonical_atom === 'placeholder_canonical_atom_1' || f.title_ar === 'Placeholder Title 1' || String(f.title_ar).includes('Placeholder')) {
        placeholdersRemoved++;
        continue;
      }

      // 2. Proposed Fix: Re-generate UUID deterministically ignoring AI's finding_uuid
      const newUuid = buildFindingUuid({
        pass_name: f.detection_pass ?? null,
        index: 0,
        article_id: f.article_id ?? null,
        atom_id: f.atom_id ?? null,
        canonical_atom: f.canonical_atom ?? null,
        title_ar: f.title_ar ?? null,
        description_ar: f.description_ar ?? null,
        evidence_snippet: f.evidence_snippet ?? null,
        location: f.location ?? null,
        detection_pass: f.detection_pass ?? null,
      });

      if (uuidsAfter.has(newUuid)) {
        duplicateUuidsAfter++;
      } else {
        uuidsAfter.add(newUuid);
      }

      // 3. Proposed Fix: Validator for Event Evidence Mismatch
      const groundedResult = groundFindingEvidenceToChunk(f, text);
      if (!groundedResult.grounded) {
        mismatchesRejected++;
        continue;
      }

      finalFindingsCount++;
    }
  }

  console.log(`--- REPLAY RESULTS ---`);
  console.log(`Initial Raw Findings: ${initialFindingsCount}`);
  console.log(`Placeholder Findings Removed: ${placeholdersRemoved}`);
  console.log(`Duplicate UUIDs Before: ${duplicateUuidsBefore}`);
  console.log(`Duplicate UUIDs After: ${duplicateUuidsAfter}`);
  console.log(`Event-Evidence Mismatches Rejected: ${mismatchesRejected}`);
  console.log(`Legitimate Findings Remaining: ${finalFindingsCount}`);
}

run().catch(console.error);
