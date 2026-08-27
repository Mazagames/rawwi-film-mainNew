import { config as loadEnv } from 'dotenv';
loadEnv();
import { supabase } from "./src/db.js";

async function main() {
  const { data, error } = await supabase.from("pipeline_telemetry_logs").select("*").limit(1);
  console.log("Telemetry logs test:");
  console.log(data);
  console.log(error);
}
main().catch(console.error);
