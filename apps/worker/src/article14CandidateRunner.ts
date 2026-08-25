import { getScriptStandardArticle } from "./gcam.js";
import { groundFindingEvidenceToChunk } from "./evidenceGrounding.js";
import { enforceDeterministicOwnership } from "./deterministicOwnership.js";
import { runFinalAdjudicator } from "./finalAdjudicator.js";
import { parseJudgeWithRepair } from "./openai.js";
import {
  runNotesProviderWithFallback,
  runWithBoundedConcurrency,
} from "./noteDetection.js";
import { getDetectionPassesForViolationSystem } from "./multiPassJudge.js";
import { getV5ReviewerDefinitions } from "./v5PromptPack.js";
import type { StructuredEvent } from "./eventUnderstanding.js";
import type { JudgeFinding } from "./schemas.js";

export type Article14CandidateRunnerResult = {
  systemPrompt: string;
  userPrompt: string;
  rawCandidates: JudgeFinding[];
  parsedCandidates: JudgeFinding[];
  groundedCandidates: JudgeFinding[];
  ownedCandidates: JudgeFinding[];
  finalFindings: any[];
  providerCalls: { primary: number; fallback: number };
};

export async function runArticleCandidateRunner(args: {
  articleNumber: 5 | 12 | 14 | 16 | 17 | 21;
  events: StructuredEvent[];
  chunkText: string;
  primaryProvider?: "openai" | "gemini";
  primary: (systemPrompt: string, userPrompt: string) => Promise<string>;
  fallback: (systemPrompt: string, userPrompt: string) => Promise<string>;
  finalAdjudicator?: typeof runFinalAdjudicator;
}): Promise<Article14CandidateRunnerResult> {
  const passName = `v5_article_${String(args.articleNumber).padStart(2, "0")}`;
  const pass = getDetectionPassesForViolationSystem("v5").find((item) => item.name === passName)
    ?? (() => {
      const reviewer = getV5ReviewerDefinitions().find((item) => item.articleNumber === args.articleNumber);
      return reviewer
        ? {
            name: passName,
            articleIds: [args.articleNumber],
            buildPrompt: () => reviewer.prompt,
            model: "gpt-4.1",
            displayLabel: reviewer.displayLabel,
            sourceFileName: reviewer.filename,
          }
        : undefined;
    })();
  if (!pass) throw new Error(`V5 Article ${args.articleNumber} reviewer pass is unavailable`);

  const article = getScriptStandardArticle(args.articleNumber);
  const systemPrompt = pass.buildPrompt([article], []);
  const userPrompt = JSON.stringify({ events: args.events }, null, 2);
  const providerCalls = { primary: 0, fallback: 0 };

  const [rawResponse] = await runWithBoundedConcurrency([pass], 1, async () =>
    runNotesProviderWithFallback({
      primaryProvider: args.primaryProvider ?? "gemini",
      primary: async () => {
        providerCalls.primary += 1;
        return args.primary(systemPrompt, userPrompt);
      },
      fallback: async () => {
        providerCalls.fallback += 1;
        return args.fallback(systemPrompt, userPrompt);
      },
    }),
  );

  const parsed = await parseJudgeWithRepair(rawResponse, "gpt-4.1", {
    passName: `v5_article_${String(args.articleNumber).padStart(2, "0")}`,
  });
  const parsedCandidates = parsed.findings.filter((finding) => finding.article_id === args.articleNumber);
  const groundedCandidates = parsedCandidates.flatMap((finding) => {
    const grounded = groundFindingEvidenceToChunk(finding, args.chunkText, args.events);
    return grounded.grounded ? [grounded.finding] : [];
  });
  const ownedCandidates = enforceDeterministicOwnership(
    groundedCandidates,
    args.events,
    args.chunkText,
  ).finalFindings;
  const dbRows = ownedCandidates.map((finding) => ({
    ...finding,
    finding_uuid: `article14-prototype-${finding.event_id}`,
    location: {
      ...finding.location,
      v3: { ...(finding.location?.v3 ?? {}), event_id: finding.event_id },
    },
  }));
  const adjudicator = args.finalAdjudicator ?? runFinalAdjudicator;
  const finalFindings = await adjudicator(dbRows, args.events, args.chunkText);

  return {
    systemPrompt,
    userPrompt,
    rawCandidates: parsed.findings,
    parsedCandidates,
    groundedCandidates,
    ownedCandidates,
    finalFindings,
    providerCalls,
  };
}

export function runArticle14CandidateRunner(args: Omit<Parameters<typeof runArticleCandidateRunner>[0], "articleNumber">) {
  return runArticleCandidateRunner({ ...args, articleNumber: 14 });
}
