import { config as loadEnv } from 'dotenv';
loadEnv();
import { supabase } from './src/db.js';

async function queryFindings() {
  const { data: runs } = await supabase
    .from('analysis_chunk_runs')
    .select('ai_findings, validated_ai_findings')
    .order('created_at', { ascending: false })
    .limit(1);
    
  if (runs && runs.length > 0) {
    const run = runs[0];
    console.log("=== RAW ===");
    console.log(JSON.stringify(run.ai_findings, null, 2));
    console.log("=== VALIDATED ===");
    console.log(JSON.stringify(run.validated_ai_findings, null, 2));
  }
}

queryFindings().catch(console.error);
