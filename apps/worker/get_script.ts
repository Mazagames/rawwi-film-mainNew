import { supabase } from './src/db.js';
import fs from 'fs';

const JOB = 'c4639cee-f74a-4d04-90d4-72751fdac270';

async function run() {
  const { data: job } = await supabase.from('analysis_jobs').select('script_id, version_id').eq('id', JOB).single();
  const scriptId = job.script_id;
  const versionId = job.version_id;
  
  const { data: pages } = await supabase.from('analysis_script_pages')
    .select('text_content')
    .eq('script_id', scriptId)
    .eq('version_id', versionId)
    .order('page_number', { ascending: true });
    
  const fullText = pages?.map(p => p.text_content).join('\n') || '';
  fs.writeFileSync('full_script.txt', fullText);
  console.log('Wrote full_script.txt with length:', fullText.length);
}
run().catch(console.error);
