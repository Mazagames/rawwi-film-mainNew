import { config as loadEnv } from 'dotenv';
loadEnv();
import { supabase } from "./src/db.js";

async function main() {
  const { data } = await supabase.from("analysis_review_notes").select("job_id, category").limit(100);
  console.log(data);
}

main().catch(console.error);
