/**
 * Tests for the semantic event understanding pass.
 * Run: npx tsx src/eventUnderstanding.test.ts
 */
import {
  EVENT_UNDERSTANDING_SYSTEM_PROMPT,
  EVENT_UNDERSTANDING_VERIFIER_SYSTEM_PROMPT,
  buildEventUnderstandingUserPrompt,
  buildEventUnderstandingVerifierUserPrompt,
  parseEventUnderstandingOutput,
  parseEventUnderstandingVerificationOutput,
  renderStructuredEventContext,
} from "./eventUnderstanding.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function testPromptContract(): void {
  const prompt = buildEventUnderstandingUserPrompt("يدفع سامي خالد بقوة فيقع على الأرض.", 120, 156);
  assert(EVENT_UNDERSTANDING_SYSTEM_PROMPT.includes("screenplay understanding engine"), "system prompt should define the understanding role");
  assert(EVENT_UNDERSTANDING_SYSTEM_PROMPT.includes("domain-neutral"), "system prompt should state the layer is domain-neutral");
  assert(prompt.includes("Sequential Cognitive Protocol (V5.7)"), "user prompt should introduce the sequential protocol");
  assert(prompt.includes("Phase 1 — Read"), "user prompt should start with reading before extraction");
  assert(prompt.includes("Phase 2 — Segment the Narrative"), "user prompt should segment the narrative");
  assert(prompt.includes("Phase 3 — Build the Event Skeleton"), "user prompt should build the skeleton first");
  assert(prompt.includes("Phase 4 — Enrich the Event"), "user prompt should enrich the event after the skeleton");
  assert(prompt.includes("Phase 5 — Internal Verification"), "user prompt should include internal verification");
  assert(prompt.includes("Phase 6 — Return JSON"), "user prompt should end with JSON return instructions");
  assert(prompt.includes("A continuous conversation normally remains one event."), "user prompt should keep continuous interactions together");
  assert(prompt.includes("Do not create events for:"), "user prompt should exclude non-events");
  assert(prompt.includes("The action must always describe an observable action."), "user prompt should define action clearly");
  assert(prompt.includes("event_summary"), "user prompt should request event summaries");
  assert(prompt.includes("dominant_meaning"), "user prompt should constrain dominant meaning");
  assert(prompt.includes("When uncertain between two reasonable interpretations"), "user prompt should prefer the less specific interpretation when uncertain");
  assert(prompt.includes("\"event_summary\""), "user prompt should request event summaries");
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
        event_summary: "Actor physically assaults another character.",
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
  assert(parsed.events[0]?.event_summary === "Actor physically assaults another character.", "event summary should be preserved");
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
        event_summary: "Document disclosure.",
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
  assert(context.includes("The screenplay has already been read and understood."), "context should tell the reviewer the screenplay is already understood");
  assert(context.includes("You must trust the structured events below."), "context should tell the reviewer to trust structured events");
  assert(context.includes("تسرب الوثيقة ثم انتشر الخبر"), "context should include the structured event quote");
  assert(context.includes("\"event_summary\""), "context should include event summaries in the structured payload");
  assert(!context.includes("raw chunk"), "context should not describe the raw chunk as the payload");
  console.log("✓ structured reviewer context is rendered");
}

function testVerificationPromptContract(): void {
  const understanding = {
    chunk_start: 0,
    chunk_end: 28,
    event_count: 1,
    events: [
      {
        event_id: 1,
        event_summary: "Document disclosure.",
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
  };

  const prompt = buildEventUnderstandingVerifierUserPrompt(understanding, "تسرب الوثيقة ثم انتشر الخبر");
  assert(EVENT_UNDERSTANDING_VERIFIER_SYSTEM_PROMPT.includes("screenplay understanding verifier"), "verifier system prompt should define its role");
  assert(prompt.includes("Compare the screenplay chunk with the structured events."), "verifier user prompt should compare chunk and events");
  assert(prompt.includes("Did any event merge unrelated actions?"), "verifier user prompt should check for merged events");
  assert(prompt.includes("Do not add policy language."), "verifier user prompt should remain domain neutral");

  const ok = parseEventUnderstandingVerificationOutput('{ "status": "ok" }');
  assert(ok.status === "ok", "status ok should parse");
  assert(ok.events.length === 0, "status ok should return no corrected events");

  const corrected = parseEventUnderstandingVerificationOutput(JSON.stringify({
    status: "corrected",
    events: understanding.events,
  }));
  assert(corrected.status === "corrected", "corrected status should parse");
  assert(corrected.events.length === 1, "corrected output should keep events");
  assert(corrected.events[0]?.event_summary === "Document disclosure.", "corrected events should preserve summaries");
  console.log("✓ event understanding verification prompt contract");
}

async function main(): Promise<void> {
  testPromptContract();
  testParseEventUnderstandingOutput();
  testStructuredContextWrapsEvents();
  testVerificationPromptContract();
  console.log("\nEvent understanding tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
