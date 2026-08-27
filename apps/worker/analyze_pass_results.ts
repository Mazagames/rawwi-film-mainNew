import fs from 'fs';

function main() {
  const passResults = JSON.parse(fs.readFileSync('pass_results.json', 'utf8'));
  const runDump = JSON.parse(fs.readFileSync('run_dump.json', 'utf8'));
  const scriptText = fs.readFileSync('test_script_shadow.txt', 'utf8');

  console.log("=== PART A: ARTICLE 15 EVIDENCE MISMATCH ===");
  const art15Findings = runDump.raw_findings.filter((f: any) => f.article_id === 15);
  const art15Pass = passResults.find((p: any) => p.passName === 'v5_article_15');
  const rawArt15 = art15Pass && art15Pass.rawResponse ? JSON.parse(art15Pass.rawResponse) : null;

  console.log("Article 15 Pass Keys:", art15Pass ? Object.keys(art15Pass) : "None");
  if (art15Pass?.findings) {
    console.log("Article 15 Parsed Findings:", JSON.stringify(art15Pass.findings.map((f:any)=>({
      evidence: f.evidence_snippet,
      location: f.location,
      event_id: f.event_id,
      start_offset: f.start_offset_global
    })), null, 2));
  }

  art15Findings.forEach((f: any) => {
    console.log(`\nFinding Title (persisted): ${f.title_ar}`);
    
    // Find matching raw finding (heuristic by title or description)
    const rawMatch = rawArt15?.findings?.find((rf: any) => rf.title_ar === f.title_ar || f.description_ar?.includes(rf.rationale_ar?.substring(0, 20)));
    
    console.log(`Raw Gemini quote/snippet:`, rawMatch?.evidence_snippet);
    console.log(`Parsed evidence:`, f.evidence_snippet); // From db
    console.log(`Grounded evidence:`, f.evidence_snippet); 
    
    const slice = scriptText.slice(f.start_offset_global, f.end_offset_global);
    console.log(`Selected source offsets: ${f.start_offset_global} - ${f.end_offset_global}`);
    console.log(`Exact screenplay text at offsets:`, JSON.stringify(slice));
    
    // Check validator
    const rejection = runDump.validator_audit?.rejections?.find((r: any) => r.findingId === f.finding_uuid);
    console.log(`Validator decision:`, rejection ? 'Flagged/Rejected' : 'Passed');
    if (rejection) {
      console.log(`Validator mismatch reason:`, rejection.issue);
    }
  });

  console.log("\n=== PART B: ARTICLE 12 OWNERSHIP ===");
  const childAbuseTitles = ["تهديد طفل بالضرب المبرح", "إهانة شخصية لطفل", "تشهير بطالب أمام زملائه في الفصل"];
  const childFindings = runDump.raw_findings.filter((f: any) => childAbuseTitles.includes(f.title_ar));
  
  const art12Pass = passResults.find((p: any) => p.passName === 'v5_article_12');
  const rawArt12 = art12Pass && art12Pass.rawResponse ? JSON.parse(art12Pass.rawResponse) : null;
  console.log("Article 12 Raw Findings Count:", rawArt12?.findings?.length || 0);
  if (rawArt12?.findings?.length > 0) {
     console.log("Article 12 Raw Findings:", JSON.stringify(rawArt12.findings, null, 2));
  }

  childFindings.forEach((f: any) => {
    console.log(`\nTitle: ${f.title_ar}`);
    console.log(`Original pass: ${f.detection_pass} / Assigned article_id: ${f.article_id}`);
    console.log(`Evidence:`, f.evidence_snippet);
    
    // Check if it's linked to an event
    const event = runDump.ai_events?.find((e: any) => e.id === f.event_id);
    console.log(`Matched structured event:`, event ? event.title : 'None');
    
    // Ownership rules check in runDump
    // The finding object might have properties indicating why it was kept/assigned
    console.log(`Is Interpretive:`, f.is_interpretive);
  });
}

main();
