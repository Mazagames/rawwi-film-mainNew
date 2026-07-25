/**
 * Tests for the semantic event understanding pass.
 * Run: npx tsx src/eventUnderstanding.test.ts
 */
import {
  EVENT_UNDERSTANDING_SYSTEM_PROMPT,
  buildEventUnderstandingUserPrompt,
  parseEventUnderstandingOutput,
  renderStructuredEventContext,
} from "./eventUnderstanding.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function testPromptContract(): void {
  const prompt = buildEventUnderstandingUserPrompt("يدفع سامي خالد بقوة فيقع على الأرض.", 120, 156);
  assert(EVENT_UNDERSTANDING_SYSTEM_PROMPT.includes("screenplay understanding engine"), "system prompt should define the understanding role");
  assert(EVENT_UNDERSTANDING_SYSTEM_PROMPT.includes("domain-neutral"), "system prompt should state the layer is domain-neutral");
  assert(prompt.includes("Read the entire screenplay chunk before producing any output."), "user prompt should require reading the whole chunk first");
  assert(prompt.includes("Never reference GCAM."), "user prompt should prohibit GCAM references");
  assert(prompt.includes("Do not create events for:"), "user prompt should exclude non-events");
  assert(prompt.includes("The action must always be the central observable action"), "user prompt should define action clearly");
  assert(prompt.includes("dominant_meaning must be a short objective description"), "user prompt should constrain dominant meaning");
  assert(prompt.includes("If two reasonable readers could describe the same event differently"), "user prompt should require objective descriptions");
  assert(!prompt.includes("chunk_start:"), "user prompt should not ask the model to regenerate chunk_start");
  assert(!prompt.includes("chunk_end:"), "user prompt should not ask the model to regenerate chunk_end");
  console.log("✓ event understanding prompt contract");
}

function testParseEventUnderstandingOutput(): void {
  const raw = JSON.stringify({
    chunk_start: 999,
    chunk_end: 888,
    event_count: 1,
    events: [
      {
        event_id: 1,
        actor: "سامي",
        target: "خالد",
        action: "يدفع",
        intent: "اعتداء جسدي",
        consequence: "يقع خالد على الأرض",
        quote: "يدفع سامي خالد بقوة فيقع على الأرض",
        start_offset: 0,
        end_offset: 34,
        dominant_meaning: "اعتداء جسدي",
      },
    ],
  });

  const parsed = parseEventUnderstandingOutput(raw, 120, 156);
  assert(parsed.chunk_start === 120, `expected chunk_start 120, got ${parsed.chunk_start}`);
  assert(parsed.chunk_end === 156, `expected chunk_end 156, got ${parsed.chunk_end}`);
  assert(parsed.event_count === 1, `expected one event, got ${parsed.event_count}`);
  assert(parsed.events[0]?.quote === "يدفع سامي خالد بقوة فيقع على الأرض", "quote should be preserved verbatim");
  assert(parsed.events[0]?.start_offset === 0, "start offset should be preserved relative to chunk");
  assert(parsed.events[0]?.end_offset === 34, "end offset should be preserved relative to chunk");
  assert(parsed.events[0]?.dominant_meaning === "اعتداء جسدي", "dominant meaning should be preserved");
  console.log("✓ event understanding JSON parsing");
}

function testStructuredContextWrapsEvents(): void {
  const context = renderStructuredEventContext({
    chunk_start: 0,
    chunk_end: 28,
    event_count: 1,
    events: [
      {
        event_id: 1,
        actor: "الوثيقة",
        target: "",
        action: "تسرب",
        intent: "كشف أو إفشاء",
        consequence: "الأثر ينتشر أو ينكشف: انتشر",
        quote: "تسرب الوثيقة ثم انتشر الخبر",
        start_offset: 0,
        end_offset: 28,
        dominant_meaning: "كشف أو إفشاء",
      },
    ],
  });

  assert(context.includes("semantic_event_understanding"), "context should mark the semantic understanding layer");
  assert(context.includes("one_event_one_finding"), "context should preserve the one-event-one-finding invariant");
  assert(context.includes("domain_neutrality"), "context should reinforce domain neutrality");
  assert(context.includes("تسرب الوثيقة ثم انتشر الخبر"), "context should include the structured event quote");
  assert(context.includes("Each finding must originate from exactly one structured event."), "context should use the strengthened reviewer contract");
  assert(context.includes("The structured events below are the single source of truth for narrative understanding."), "context should declare the events as the source of truth");
  assert(!context.includes("raw chunk"), "context should not describe the raw chunk as the payload");
  console.log("✓ structured reviewer context is rendered");
}

async function main(): Promise<void> {
  testPromptContract();
  testParseEventUnderstandingOutput();
  testStructuredContextWrapsEvents();
  console.log("\nEvent understanding tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
