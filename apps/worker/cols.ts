import { supabase } from './src/db.js';
import fs from 'fs';
async function run() {
  const { data } = await supabase.from('analysis_chunk_runs').select('*').limit(1);
  fs.writeFileSync('cols.json', JSON.stringify(Object.keys(data[0] || {}), null, 2));
}
run();
