import { supabase } from './src/db.js';
async function getCols() {
  const { data, error } = await supabase.from('analysis_chunk_runs').select('*').limit(1);
  if (data && data.length) console.log(Object.keys(data[0]).join(', '));
  else console.log('Empty table or error:', error);
}
getCols().catch(console.error);
