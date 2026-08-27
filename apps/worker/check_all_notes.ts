import { config as loadEnv } from 'dotenv';
loadEnv();
import { supabase } from "./src/db.js";

async function main() {
  const { data, error } = await supabase.from("analysis_review_notes").select("*").limit(5);
  console.log("Data:", data);
  console.log("Error:", error);
}

main().catch(console.error);
