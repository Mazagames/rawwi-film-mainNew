import 'dotenv/config';
import { supabase } from './src/db.js';

async function run() {
  const jobId = '7e1136ee-ad71-42b9-8d28-3efd5c95b0e1';
  
  const { data: chunks } = await supabase
    .from('analysis_chunks')
    .select('*')
    .eq('job_id', jobId)
    .limit(1);
    
  if (chunks && chunks.length > 0) {
    console.log("Chunk keys:", Object.keys(chunks[0]));
    if (chunks[0].structured_events) {
       console.log(`Found ${chunks[0].structured_events.length} structured events on chunk!`);
    } else {
       console.log("No structured_events on chunk.");
    }
  }
}

run().catch(console.error);
