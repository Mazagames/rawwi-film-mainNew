import { supabase } from './src/db.js';
import fs from 'fs';

const CHUNK_ID = 'cc18174d-69b0-4f09-8fdb-35bdbe807706';

async function run() {
  const { data } = await supabase.from('analysis_event_understanding').select('events_json').eq('chunk_id', CHUNK_ID);
  fs.writeFileSync('eu_events.json', JSON.stringify(data || [], null, 2));
}
run();
