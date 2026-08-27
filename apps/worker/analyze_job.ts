import fs from 'fs';

async function run() {
  const data = JSON.parse(fs.readFileSync('job_investigation.json', 'utf-8'));
  
  console.log('--- 1. Duplicate Insertion ---');
  const uuid = '5268344b-65e6-42ba-bb7e-9f2559f7a7ad';
  for (const run of data.runs || []) {
    const raw = run.ai_findings || [];
    const valid = Array.isArray(run.validated_ai_findings) ? run.validated_ai_findings : (run.validated_ai_findings?.findings || []);
    const rawMatches = raw.filter((f: any) => f.finding_uuid === uuid);
    const validMatches = valid.filter((f: any) => f.finding_uuid === uuid);
    if (rawMatches.length > 0 || validMatches.length > 0) {
      console.log(`Run ${run.id}: raw matches = ${rawMatches.length}, valid matches = ${validMatches.length}`);
      if (rawMatches.length > 0) console.log(JSON.stringify(rawMatches, null, 2));
    }
  }

  console.log('\n--- 2. Script Summary Malformed JSON ---');
  console.log(`Job script_summary_json:`, data.job?.script_summary_json ? 'Exists' : 'Missing');
  for (const run of data.runs || []) {
    if (run.truth_layer_meta?.script_summary_json_error) {
       console.log(`Run ${run.id} script_summary_error:`, run.truth_layer_meta.script_summary_json_error);
    }
    if (run.script_summary_json) {
       console.log(`Run ${run.id} script_summary_json exists`);
    }
  }

  console.log('\n--- 3. Placeholder Canonical Atom ---');
  let runPlaceholderCount = 0;
  for (const run of data.runs || []) {
    const valid = Array.isArray(run.validated_ai_findings) ? run.validated_ai_findings : (run.validated_ai_findings?.findings || []);
    for (const f of valid) {
       if (f.canonical_atom_id === 'placeholder_canonical_atom_1' || String(f.finding_title).includes('Placeholder')) {
         runPlaceholderCount++;
         if (runPlaceholderCount === 1) {
           console.log(`Example placeholder finding:`, { article_id: f.article_id, finding_title: f.finding_title, canonical_atom_id: f.canonical_atom_id });
         }
       }
    }
  }
  console.log(`Total placeholder findings in runs: ${runPlaceholderCount}`);

  console.log('\n--- 4. Unrelated Articles with Political Scene / event_evidence_mismatch ---');
  const mismatches = [];
  for (const run of data.runs || []) {
    const valid = Array.isArray(run.validated_ai_findings) ? run.validated_ai_findings : (run.validated_ai_findings?.findings || []);
    for (const f of valid) {
      if (f.evidence_quality_issue === 'event_evidence_mismatch' || (f.evidence_snippet && f.evidence_snippet.includes('political'))) {
         mismatches.push({ article: f.article_id, title: f.finding_title, snippet: String(f.evidence_snippet).substring(0, 50), quality: f.evidence_quality_issue });
      }
    }
  }
  console.log(`Mismatches found in runs: ${mismatches.length}`);
  if (mismatches.length > 0) {
     console.log('Sample mismatches:', mismatches.slice(0, 3));
  }
}

run().catch(console.error);
