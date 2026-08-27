import { config as loadEnv } from 'dotenv';
loadEnv();
import { runMultiPassDetection } from './src/multiPassJudge.js';
import fs from 'fs';
import path from 'path';

async function run() {
  const text = fs.readFileSync(path.join(process.cwd(), 'chunk_0_raw.txt'), 'utf8');
  console.log('Running controlled analysis on chunk_0_raw.txt...');
  const terms = [];
  
  // Read a couple of real GCAM articles for context
  const articleDir = path.join(process.cwd(), '../../reviewers/v5');
  const files = fs.readdirSync(articleDir).filter(f => f.startsWith('article_'));
  const allArticles = [];
  for (const f of files) {
    if (f.endsWith('.md')) {
      const content = fs.readFileSync(path.join(articleDir, f), 'utf8');
      const articleIdMatch = content.match(/article_id:\s*(\d+)/);
      const articleId = articleIdMatch ? parseInt(articleIdMatch[1], 10) : 0;
      allArticles.push({
        id: articleId,
        v5_prompt_text: content,
        v5_note_text: null
      });
    }
  }
  
  const results = await runMultiPassDetection(
    text,
    0,
    text.length,
    allArticles,
    terms,
    { temperature: 0, seed: 12345 },
    { chunkId: '999' }
  );
  
  console.log('Analysis Complete.');
  console.log('Findings:', JSON.stringify(results, null, 2));
}
run().catch(console.error);
