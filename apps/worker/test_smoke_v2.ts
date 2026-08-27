process.env.VIOLATION_SYSTEM_VERSION = 'v5';
import { runMultiPassDetection, DETECTION_PASSES } from './src/multiPassJudge.js';
import fs from 'fs';

async function run() {
  const text = fs.readFileSync('job2_fulltext.txt', 'utf-8');
  
  const mockArticles = [
    { id: 17, title_ar: "الكرامة والسمعة والخصوصية", text_ar: "يمنع التشهير", atoms: [] } as any
  ];

  const plan = {
    activePasses: DETECTION_PASSES.filter(p => p.name === 'v5_article_17'),
    skippedPasses: []
  };

  const start = Date.now();
  console.log('--- STARTING SMOKE TEST ---');
  try {
    const res = await runMultiPassDetection(
      text, // chunkText
      0, // chunkStart
      text.length, // chunkEnd
      mockArticles, // allArticles
      [], // lexiconTerms
      { temperature: 0, seed: 123 }, // jobConfig
      undefined, // progressOpts
      plan, // executionPlan
      undefined, // promptContext
      new AbortController().signal // signal
    );

    const dur = Date.now() - start;
    console.log('\n=== RESULTS ===');
    console.log('Duration:', dur);
    console.log('Event count:', res.eventUnderstanding?.events?.length ?? 0);
    if (res.eventUnderstanding?.events?.length) {
       console.log('Events:', JSON.stringify(res.eventUnderstanding.events.map(e => e.summary), null, 2));
    }
    
    console.log('\nFindings:');
    for (const f of res.findings) {
      if (f.article_id === 17) {
        console.log('- Art.17 Finding:', f.title_ar);
        console.log('  Evidence Snippet:', f.evidence_snippet);
      }
    }
  } catch (err) {
    console.error('\nError:', err.message);
  }
}
run();
