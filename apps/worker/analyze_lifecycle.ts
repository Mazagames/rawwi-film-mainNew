import fs from 'fs';

function main() {
  const runDump = JSON.parse(fs.readFileSync('run_dump.json', 'utf8'));
  const tracesDump = JSON.parse(fs.readFileSync('traces_dump.json', 'utf8'));
  const scriptText = fs.readFileSync('test_script_shadow.txt', 'utf8');

  console.log("=== PART A: ARTICLE 15 EVIDENCE MISMATCH ===");
  const art15Findings = runDump.raw_findings.filter((f: any) => f.article_id === 15);
  const art15Trace = tracesDump.find((t: any) => t.pass_name === 'v5_article_15');
  const rawArt15 = art15Trace ? JSON.parse(art15Trace.raw_response_body) : null;

  art15Findings.forEach((f: any) => {
    console.log(`\nFinding: ${f.title_ar}`);
    
    // Find matching raw finding (heuristic by title or description)
    const rawMatch = rawArt15?.findings?.find((rf: any) => rf.title === f.title_ar || f.description_ar?.includes(rf.rationale?.substring(0, 20)));
    
    console.log(`Raw Gemini quote:`, rawMatch?.quote);
    console.log(`Raw Gemini evidence_snippet:`, rawMatch?.evidence_snippet);
    console.log(`Parsed evidence:`, f.evidence_snippet); // From db
    console.log(`Grounded evidence:`, f.evidence_snippet); // same in this context
    
    const slice = scriptText.slice(f.start_offset_global, f.end_offset_global);
    console.log(`Selected source offsets: ${f.start_offset_global} - ${f.end_offset_global}`);
    console.log(`Exact screenplay text at offsets:`, JSON.stringify(slice));
    
    // Check validator
    const rejection = runDump.validator_audit?.rejections?.find((r: any) => r.findingId === f.finding_uuid);
    console.log(`Validator decision:`, rejection ? 'Rejected/Flagged' : 'Passed');
    if (rejection) {
      console.log(`Validator mismatch reason:`, rejection.issue);
    }
  });

  console.log("\n=== PART B: ARTICLE 12 OWNERSHIP ===");
  const childAbuseTitles = ["تهديد طفل بالضرب المبرح", "إهانة شخصية لطفل", "تشهير بطالب أمام زملائه في الفصل"];
  const childFindings = runDump.raw_findings.filter((f: any) => childAbuseTitles.includes(f.title_ar));
  
  // Did Art 12 detect anything?
  const art12Trace = tracesDump.find((t: any) => t.pass_name === 'v5_article_12');
  const rawArt12 = art12Trace ? JSON.parse(art12Trace.raw_response_body) : null;
  console.log("Article 12 Raw Findings Count:", rawArt12?.findings?.length || 0);
  if (rawArt12?.findings?.length > 0) {
     console.log("Article 12 Raw Findings:", JSON.stringify(rawArt12.findings, null, 2));
  }

  childFindings.forEach((f: any) => {
    console.log(`\nTitle: ${f.title_ar}`);
    console.log(`Original pass / article_id: ${f.detection_pass} / ${f.article_id}`);
    console.log(`Evidence:`, f.evidence_snippet);
    
    // Check if it's linked to an event
    const event = runDump.ai_events?.find((e: any) => e.id === f.event_id);
    console.log(`Matched structured event:`, event ? event.title : 'None');
    
    // Check if Article 12 detected something similar
    // Since we print art 12 raw findings above, we can just observe if it's there.
  });
}

main();
