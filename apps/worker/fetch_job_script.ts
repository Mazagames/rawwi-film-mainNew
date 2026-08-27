import { supabase } from './src/db.js';

import fs from 'fs';
import { sha256 } from './src/hash.js';

function compactSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function run() {
  const jobId = 'e8901ebf-1c83-4a4a-a7d6-d544322a7a3d';
  const { data: job } = await supabase.from('analysis_jobs').select('*').eq('id', jobId).single();
  if (!job) throw new Error("Job not found");

  console.log('--- JOB INFO ---');
  console.log(`scriptId: ${job.script_id}`);
  console.log(`versionId: ${job.version_id}`);
  console.log(`scriptContentHash: ${job.script_content_hash}`);
  console.log(`canonicalLength: ${job.canonical_length}`);

  const { count: chunkCount } = await supabase.from('analysis_chunks').select('*', { count: 'exact', head: true }).eq('job_id', jobId);
  console.log(`chunk count: ${chunkCount}`);

  console.log('\n--- VERSION INFO ---');
  const { data: version } = await supabase.from('analysis_script_versions').select('*').eq('id', job.version_id).maybeSingle();
  let dbScriptText = version?.script_text || '';
  if (!version) {
    console.log("Version not found in DB. We will extract from docx.");
  } else {
    const containsAnchors = [
      'المشهد 17', 'عاشوراء', 'وزارة الداخلية', 'المشهد 20', 'استوديو تصوير إعلاني', 'حقوق الملكية الفكرية'
    ].map(a => ({ anchor: a, found: dbScriptText.includes(a) }));
    console.log(containsAnchors);
  }

  console.log('\n--- FETCHING UPLOADED DOCX ---');
  // Usually stored in 'scripts' bucket with path: script_id/version_id/filename
  // Let's list files in the bucket for this script
  const { data: files } = await supabase.storage.from('scripts').list(`${job.script_id}/${job.version_id}`);
  if (!files || files.length === 0) {
    console.log("No files found in storage for this version.");
    return;
  }
  const file = files[0];
  console.log(`Found file: ${file.name}`);
  const { data: blob } = await supabase.storage.from('scripts').download(`${job.script_id}/${job.version_id}/${file.name}`);
  if (!blob) throw new Error("Failed to download");
  
  const buffer = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync('downloaded.docx', buffer);
  
  const rawHash = crypto.createHash('sha256').update(buffer).digest('hex');
  console.log('\n--- EXTRACTING & NORMALIZING DOCX ---');
  try {
     const mammoth = await import('mammoth');
     const result = await mammoth.extractRawText({ buffer: buffer });
     const extractedText = result.value;
     
     const normalized = compactSpace(extractedText);
     const normalizedHash = sha256(normalized);
     console.log(`Uploaded file normalized text length: ${normalized.length}`);
     console.log(`Uploaded file normalized hash: ${normalizedHash}`);
     
     if (normalizedHash === job.script_content_hash && normalized.length === job.canonical_length) {
       console.log('\nVerdict: EXACT SAME SCRIPT');
     } else {
       console.log('\nVerdict: DIFFERENT SCRIPT');
       console.log(`Job expected hash: ${job.script_content_hash}, got: ${normalizedHash}`);
       console.log(`Job expected length: ${job.canonical_length}, got: ${normalized.length}`);
     }

     console.log('\n--- VERIFYING ANCHORS IN EXTRACTED TEXT ---');
     const containsAnchors = [
        'المشهد 17', 'عاشوراء', 'وزارة الداخلية', 'المشهد 20', 'استوديو تصوير إعلاني', 'حقوق الملكية الفكرية'
     ].map(a => ({ anchor: a, found: normalized.includes(a) }));
     console.log(containsAnchors);
  } catch (e) {
     console.error("Extraction failed", e);
  }
}
run().catch(console.error);
