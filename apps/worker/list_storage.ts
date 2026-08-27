import { supabase } from './src/db.js';

async function run() {
  const { data, error } = await supabase.storage.from('scripts').list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' }});
  console.log(data, error);
}
run();
