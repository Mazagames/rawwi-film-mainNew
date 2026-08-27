import { generateOpenAICompletion } from './src/aiClient.js';
import { getV5ReviewerPrompt } from './src/v5PromptPack.js';
import * as dotenv from 'dotenv';
dotenv.config();

const testCases = [
  { event_id: 50, quote: "بقوم آخذ الجزمة وأضربك فيها" },
  { event_id: 51, quote: "اللي ما يفهم بالكلام… يفهم بالضرب" },
  { event_id: 52, quote: "لا تتفلسفين" },
  { event_id: 53, quote: "قوم يا عديم التربية" }
];

async function run() {
  const articles = [5, 14, 12];
  
  for (const article of articles) {
    const reviewer = await getV5ReviewerPrompt(article);
    const systemPrompt = `CRITICAL EVALUATION RULES (HIGH RECALL):\n\n${reviewer.prompt}`;
    
    console.log(`\n=================== ARTICLE ${article} ===================`);
    
    const eventsPayload = JSON.stringify({ events: testCases });
    
    try {
      const response = await generateOpenAICompletion(systemPrompt, eventsPayload, {
        temperature: 0,
        model: "gpt-4o-mini"
      });
      console.log(response);
    } catch (e: any) {
      console.error(e.message);
    }
  }
}

run();
