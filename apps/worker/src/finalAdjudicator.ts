import { generateStructuredCompletion } from "./aiClient.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { StructuredEvent } from "./eventUnderstanding.js";
import { getAtomDefinition } from "./canonicalAtomFramework.js";
import { findExactContiguousMatches } from "./exactContiguousMatch.js";

// We receive the DB-bound findings (rows) and return the filtered/updated ones
export async function runFinalAdjudicator(
  findings: any[],
  events: StructuredEvent[],
  chunkText: string
): Promise<any[]> {
  if (findings.length === 0) return findings;

  const systemPrompt = `You are a final accuracy adjudicator for a strict media compliance pipeline.
Your job is to correct misclassified or poorly evidenced findings that survived deterministic validation.

You will receive ONE candidate finding at a time, along with its mapped event context, surrounding scene context, actor/target metadata, scene heading, and article definition.
This surrounding context is provided to help you understand relationships between characters, ages, or preceding actions that inform the event.

You must output exactly ONE of these actions in your JSON response:
- "KEEP": The finding is correct and the evidence strictly proves the article violation, considering both the raw quote and the surrounding context.
- "REASSIGN": The finding is a valid violation, but belongs to a different article/atom.
- "REJECT": The finding does not meet the strict threshold for any violation, or the evidence doesn't support it, or you cannot confidently correct it.

CRITICAL RULES:
1. For KEEP and REASSIGN, you MUST return an exact contiguous substring of the supplied 'raw event quote' or 'surrounding context' as the 'final_evidence'. Never invent or paraphrase evidence.
2. Reject weak or topic-only candidates. The finding must independently satisfy the article definition with direct evidence from the current event; do not import facts from unrelated scenes.
3. Article 3 (EXTREMISM), Article 9 (MISINFORMATION), and Article 17 (PRIVACY) MUST NEVER be used for school teacher-student abuse (like slapping, holding ears, scolding). Reject them.
4. Article 12 (CHILD_SAFETY) must only be kept if the specific evidence proves physical, verbal, or emotional abuse against a minor. If the surrounding context proves the target is a minor (e.g., 12 years old), and the action is abusive (e.g., sexist humiliation or physical harm), then keep it.
5. Genuine public-order events (e.g., inciting people to the street) should be kept as Article 15 when supported.
6. A security scene/police raid is NOT Article 5 (Violence) unless there is excessive/unjustified gore or violence beyond standard security operations.
7. Do not silently drop unclear cases. If you cannot confidently correct a candidate, return REJECT rather than inventing a new article/evidence assignment.

Output JSON Format:
{
  "action": "KEEP" | "REASSIGN" | "REJECT",
  "final_article_id": number | null,
  "final_canonical_atom": string | null,
  "final_evidence": string | null,
  "reason": "Detailed explanation of your decision"
}`;

  const finalRows: any[] = [];

  for (const row of findings) {
    // 1. Gather context
    const eventId = row.location?.v3?.event_id;
    const event = events.find(e => e.event_id === eventId) || null;

    // Find preceding/following events for context
    let surroundingContext = "";
    if (event) {
      const idx = events.indexOf(event);
      const prevEvent = idx > 0 ? events[idx - 1] : null;
      const nextEvent = idx < events.length - 1 ? events[idx + 1] : null;
      if (prevEvent) surroundingContext += `[Preceding] ${prevEvent.quote}\n`;
      if (nextEvent) surroundingContext += `[Following] ${nextEvent.quote}`;
    }

    const articleDef = getAtomDefinition(row.canonical_atom ?? "");
    const articleDefinition = articleDef ? `Article ${row.article_id} (${row.canonical_atom}): ${articleDef.title_ar} - ${articleDef.description_ar}` : "Unknown definition";

    const userPayload = {
      candidate_article: row.article_id,
      canonical_atom: row.canonical_atom,
      evidence_snippet: row.evidence_snippet,
      raw_event_quote: event?.quote ?? row.evidence_snippet,
      scene_heading: event?.event_summary ?? "Unknown", // Approximate heading/summary
      actor: event?.actor ?? "Unknown",
      target: event?.target ?? "Unknown",
      surrounding_context: surroundingContext.trim() || "None",
      article_definition: articleDefinition
    };

    const userPrompt = JSON.stringify(userPayload, null, 2);

    try {
      const resp = await generateStructuredCompletion({
        model: config.AI_PROVIDER === "gemini" ? config.GEMINI_JUDGE_MODEL : config.OPENAI_JUDGE_MODEL,
        systemPrompt,
        userPrompt,
        temperature: 0,
        maxTokens: 8192,
        thinkingBudget: 6144
      });

      let decision: any;
      try {
        decision = JSON.parse(resp.content);
      } catch (e) {
        logger.warn("Adjudicator returned invalid JSON", { finding_uuid: row.finding_uuid });
        continue; // REJECT if invalid JSON
      }

      if (decision.action === "REJECT") {
        logger.info("Adjudicator REJECTED finding", {
          finding_uuid: row.finding_uuid,
          article_id: row.article_id,
          reason: decision.reason
        });
        continue;
      }

      if (decision.action === "KEEP" || decision.action === "REASSIGN") {
        let finalEvidence = decision.final_evidence;
        if (!finalEvidence || typeof finalEvidence !== "string") {
          logger.warn("Adjudicator returned KEEP/REASSIGN without valid final_evidence", { finding_uuid: row.finding_uuid });
          continue;
        }

        // Recalculate offsets using exactContiguousMatch
        // Search in the whole chunkText (normalized)
        let matches = findExactContiguousMatches(chunkText, finalEvidence, "phrase");
        if (matches.length === 0) {
          // If the model hallucinated slightly, fallback to original evidence
          logger.warn("Adjudicator evidence not found exactly in text, rejecting finding", {
            finding_uuid: row.finding_uuid,
            hallucinated_evidence: finalEvidence.slice(0, 50)
          });
          continue;
        }
        let exactMatch = matches[0];

        row.evidence_snippet = exactMatch.matchedText;
        row.start_offset_global = exactMatch.startIndex;
        row.end_offset_global = exactMatch.endIndex;

        if (decision.action === "REASSIGN") {
          row.article_id = decision.final_article_id;
          row.canonical_atom = decision.final_canonical_atom;
        }

        logger.info(`Adjudicator ${decision.action} finding`, {
          finding_uuid: row.finding_uuid,
          final_article_id: row.article_id,
          final_canonical_atom: row.canonical_atom,
          reason: decision.reason
        });
        finalRows.push(row);
      }
    } catch (e) {
      logger.error("Error during final adjudication", { error: e });
      // In case of error, to be safe we might reject, or keep. The prompt said strict threshold.
      // We will reject if the adjudicator fails.
    }
  }

  return finalRows;
}
