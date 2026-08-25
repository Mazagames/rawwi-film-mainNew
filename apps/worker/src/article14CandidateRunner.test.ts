import dotenv from "dotenv";
import nock from "nock";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
  const { config } = await import("./config.js");
  const { runArticleCandidateRunner } = await import("./article14CandidateRunner.js");
  const { enforceDeterministicOwnership } = await import("./deterministicOwnership.js");
  const { runFinalAdjudicator } = await import("./finalAdjudicator.js");

  (config as any).AI_PROVIDER = "openai";
  (config as any).OPENAI_API_KEY = "prototype-test-key";

  const events: any[] = [
    {
      event_id: 50,
      event_summary: "Threat with a shoe",
      actor: "Wife",
      target: "Husband",
      action: "Threatens to hit",
      intent: "anger",
      consequence: "fear",
      quote: "بقوم آخذ الجزمة وأضربك فيها",
      start_offset: 0,
      end_offset: 27,
      dominant_meaning: "threat",
    },
    {
      event_id: 52,
      event_summary: "Colloquial insult",
      actor: "Wife",
      target: "Husband",
      action: "Insults",
      intent: "anger",
      consequence: "tension",
      quote: "لا تتفلسفين",
      start_offset: 29,
      end_offset: 41,
      dominant_meaning: "insult",
    },
    {
      event_id: 53,
      event_summary: "Child-directed insult",
      actor: "Parent",
      target: "Child",
      action: "Insults",
      intent: "discipline",
      consequence: "fear",
      quote: "قوم يا عديم التربية",
      start_offset: 43,
      end_offset: 63,
      dominant_meaning: "child-directed insult",
    },
    {
      event_id: 23,
      event_summary: "Planning a rumor campaign",
      actor: "Saeed",
      target: "Public",
      action: "Plans to publish fabricated rumors",
      intent: "deception",
      consequence: "misinformation",
      quote: "نستخدم حسابات وهمية، نكتب إشاعات… ونركّب قصص... حتى لو ما عندنا دليل",
      start_offset: 65,
      end_offset: 127,
      dominant_meaning: "misinformation",
    },
    {
      event_id: 25,
      event_summary: "Sensitive file is leaked",
      actor: "Employee",
      target: "Public",
      action: "Leaks a sensitive file",
      intent: "disclosure",
      consequence: "exposure",
      quote: "ملف مسرّب من الداخلية",
      start_offset: 129,
      end_offset: 151,
      dominant_meaning: "classified document disclosure",
    },
    {
      event_id: 60,
      event_summary: "Threat to publish private photos",
      actor: "Man",
      target: "Woman",
      action: "Threatens to publish private photos and expose her",
      intent: "blackmail",
      consequence: "reputational harm",
      quote: "سأنشر صورك الخاصة التي أرسلتها لي وأفضحك أمام عائلتك وأصدقائك في كل مكان",
      start_offset: 153,
      end_offset: 229,
      dominant_meaning: "privacy and reputation violation",
    },
  ];
  const chunkText = events.map((event) => event.quote).join("\n");
  const rawResponseFor = (articleNumber: number, eventIds: number[]) => JSON.stringify({
    findings: events.filter((event) => eventIds.includes(event.event_id)).map((event) => ({
      article_id: articleNumber,
      event_id: event.event_id,
      title_ar: articleNumber === 5 ? "تهديد بالعنف" : articleNumber === 12 ? "إهانة طفل" : "إهانة شخصية",
      rationale_ar: "يتضمن الحدث سلوكاً ذا صلة بالمادة.",
      evidence_snippet: event.quote,
      confidence: 0.9,
    })),
  });

  const adjudicatorScope = nock("https://api.openai.com")
    .post("/v1/chat/completions")
    .times(6)
    .reply(200, (_uri, requestBody: any) => {
      const body = typeof requestBody === "string" ? JSON.parse(requestBody) : requestBody;
      const userPrompt = String(body.messages?.[1]?.content ?? "");
      const candidate = JSON.parse(userPrompt) as { evidence_snippet?: string };
      const evidence = candidate.evidence_snippet ?? "";
      const rejected = evidence === "لا تتفلسفين";
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              action: rejected ? "REJECT" : "KEEP",
              final_article_id: rejected ? null : 14,
              final_canonical_atom: rejected ? null : "INSULT",
              final_evidence: rejected ? null : evidence,
              reason: rejected ? "mild colloquial language" : "exact evidence supports the candidate",
            }),
          },
          finish_reason: "stop",
        }],
      };
    });

  const result = await runArticleCandidateRunner({
    articleNumber: 14,
    events,
    chunkText,
    primary: async () => rawResponseFor(14, [52, 53]),
    fallback: async () => {
      throw new Error("fallback must not be called after successful primary response");
    },
    finalAdjudicator: async (rows) => rows,
  });

  const article5 = await runArticleCandidateRunner({
    articleNumber: 5,
    events,
    chunkText,
    primary: async () => rawResponseFor(5, [50]),
    fallback: async () => { throw new Error("Article 5 fallback must not be called"); },
    finalAdjudicator: async (rows) => rows,
  });
  const article12 = await runArticleCandidateRunner({
    articleNumber: 12,
    events,
    chunkText,
    primary: async () => rawResponseFor(12, [53]),
    fallback: async () => { throw new Error("Article 12 fallback must not be called"); },
    finalAdjudicator: async (rows) => rows,
  });
  const article16 = await runArticleCandidateRunner({
    articleNumber: 16,
    events,
    chunkText,
    primary: async () => rawResponseFor(16, [23]),
    fallback: async () => { throw new Error("Article 16 fallback must not be called"); },
    finalAdjudicator: async (rows) => rows,
  });
  const article17 = await runArticleCandidateRunner({
    articleNumber: 17,
    events,
    chunkText,
    primary: async () => rawResponseFor(17, [60]),
    fallback: async () => { throw new Error("Article 17 fallback must not be called"); },
    finalAdjudicator: async (rows) => rows,
  });
  const article21 = await runArticleCandidateRunner({
    articleNumber: 21,
    events,
    chunkText,
    primary: async () => rawResponseFor(21, [25]),
    fallback: async () => { throw new Error("Article 21 fallback must not be called"); },
    finalAdjudicator: async (rows) => rows,
  });

  assert(result.rawCandidates.length === 2, `expected 2 raw Article 14 candidates, got ${result.rawCandidates.length}`);
  assert(result.parsedCandidates.length === 2, `expected 2 Article 14 candidates, got ${result.parsedCandidates.length}`);
  assert(result.groundedCandidates.length === 2, `expected 2 grounded Article 14 candidates, got ${result.groundedCandidates.length}`);
  assert(result.groundedCandidates.every((finding) => events.some((event) => event.event_id === finding.event_id && event.quote === finding.evidence_snippet)), "candidate evidence must remain exact and event-bound");
  assert(article5.parsedCandidates.length === 1 && article5.groundedCandidates.length === 1, "Article 5 candidate must parse and ground");
  assert(article12.parsedCandidates.length === 1 && article12.groundedCandidates.length === 1, "Article 12 candidate must parse and ground");
  assert(article16.parsedCandidates.length === 1 && article16.groundedCandidates.length === 1, "Article 16 candidate must parse and ground");
  assert(article17.parsedCandidates.length === 1 && article17.groundedCandidates.length === 1, "Article 17 candidate must parse and ground");
  assert(article21.parsedCandidates.length === 1 && article21.groundedCandidates.length === 1, "Article 21 candidate must parse and ground");

  const overlap = enforceDeterministicOwnership(
    [...article12.groundedCandidates, ...result.groundedCandidates],
    events,
    chunkText,
  );
  assert(overlap.finalFindings.length === 2, `expected ownership to retain Article 12 and distinct Article 14 candidates, got ${overlap.finalFindings.length}`);
  assert(overlap.finalFindings.some((finding) => finding.article_id === 12 && finding.event_id === 53), "Article 12 must own the overlapping event 53 claim");
  assert(!overlap.finalFindings.some((finding) => finding.article_id === 14 && finding.event_id === 53), "Article 14 overlap must be suppressed by Article 12 ownership");

  const finalRows = [article5.ownedCandidates[0], ...overlap.finalFindings, article16.ownedCandidates[0], article17.ownedCandidates[0], article21.ownedCandidates[0]].map((finding) => ({
    ...finding,
    finding_uuid: `article-prototype-${finding.article_id}-${finding.event_id}`,
    location: { ...finding.location, v3: { ...(finding.location?.v3 ?? {}), event_id: finding.event_id } },
  }));
  const finalFindings = await runFinalAdjudicator(finalRows, events, chunkText);
  assert(finalFindings.length === 5, `expected adjudicator to keep five representative results, got ${finalFindings.length}`);
  assert(finalFindings.some((finding) => finding.article_id === 5 && finding.location?.v3?.event_id === 50), "Article 5 candidate should survive adjudication");
  assert(finalFindings.some((finding) => finding.article_id === 12 && finding.location?.v3?.event_id === 53), "Article 12 candidate should survive adjudication");
  assert(finalFindings.some((finding) => finding.article_id === 16 && finding.location?.v3?.event_id === 23), "Article 16 candidate should survive adjudication");
  assert(finalFindings.some((finding) => finding.article_id === 17 && finding.location?.v3?.event_id === 60), "Article 17 candidate should survive adjudication");
  assert(finalFindings.some((finding) => finding.article_id === 21 && finding.location?.v3?.event_id === 25), "Article 21 candidate should survive adjudication");
  assert(!finalFindings.some((finding) => finding.location?.v3?.event_id === 52), "mild Article 14 candidate should be rejected by adjudication");
  assert(result.providerCalls.primary === 1 && result.providerCalls.fallback === 0, "successful primary candidate generation must not use fallback");
  assert(adjudicatorScope.isDone(), "Final Adjudicator should receive one request per owned candidate");
  nock.cleanAll();
  console.log("✓ Articles 5, 12, and 14 preserve candidates through grounding, ownership, and Final Adjudicator");
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  nock.cleanAll();
  console.error(error);
  process.exitCode = 1;
});
