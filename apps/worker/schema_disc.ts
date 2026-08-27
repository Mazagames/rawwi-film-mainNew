import { supabase } from './src/db.js';

const JOB_ID = 'c4639cee-f74a-4d04-90d4-72751fdac270';

async function run() {
  // Discover columns
  const { data: c } = await supabase.from('analysis_chunks').select('*').limit(1);
  console.log('CHUNK COLS:', c && c[0] ? Object.keys(c[0]).join(', ') : 'empty');

  const { data: f } = await supabase.from('analysis_findings').select('*').limit(1);
  console.log('FINDING COLS:', f && f[0] ? Object.keys(f[0]).join(', ') : 'empty');

  const { data: d } = await supabase.from('analysis_judge_diagnostics').select('*').limit(1);
  console.log('DIAG COLS:', d && d[0] ? Object.keys(d[0]).join(', ') : 'empty');

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
