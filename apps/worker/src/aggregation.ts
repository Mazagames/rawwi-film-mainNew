import { supabase } from "./db.js";
import { sha256 } from "./hash.js";
import { countChunksWithStatuses, incrementJobProgress, jobHasActiveChunks, jobHasInFlightChunks } from "./jobs.js";
import { logger } from "./logger.js";
import {
  getPolicyArticles,
  getPolicyArticle,
  getPolicyAtomTitle,
  normalizeAtomId,
  atomIdNumeric,
  OUT_OF_SCOPE_ARTICLE_ID,
} from "./policyMap.js";
import { generateScriptSummary } from "./scriptSummary.js";
import { callRevisitSpotter } from "./openai.js";
import { clearCachedJobResources } from "./jobAnalysisCache.js";
import { shouldSkipRevisitForJob, shouldSkipScriptSummaryForJob } from "./performanceGating.js";
import { config } from "./config.js";
import { containsAnyNormalized } from "./textDetectionNormalize.js";
import { normalizeReviewFindingConsistency } from "./reviewFindingConsistency.js";
import { buildLineageEvent, persistLineageEvents } from "./findingLineage.js";
import { traceFindingPipelineStage, traceFindingPipelineSummary, type FindingPipelineTraceSnapshot } from "./findingPipelineTrace.js";
import { emitPipelineTelemetryBlock, recordTelemetryFromSummary } from "./pipelineTelemetry.js";
import {
  countNoteCategoriesFromSummary,
  logNotePipelineStage,
  normalizeNoteCategoryKey,
} from "./notePipelineTelemetry.js";

export type SummaryJson = {
  job_id: string;
  script_id: string;
  generated_at: string;
  analysis_meta?: {
    auditor_layer_version: "v2" | "v3" | "v4";
    violation_system_version: "v2" | "v3" | "v4" | "v5";
    analysis_engine: "v2";
    analysis_pipeline_version: "v1" | "v2";
    deep_auditor_enabled: boolean;
    generated_by: "worker";
  };
  client_name?: string;
  script_title?: string;
  totals: {
    findings_count: number;
    severity_counts: { low: number; medium: number; high: number; critical: number };
    type_counts?: { ai: number; manual: number; glossary: number; special: number };
    /** Number of unique incidents (canonical findings). Use for main report count. */
    unique_incidents_count?: number;
  };
  checklist_articles: Array<{
    article_id: number;
    title_ar: string;
    status: "ok" | "not_scanned" | "warning" | "fail";
    counts: Record<string, number>;
    triggered_atoms: string[];
  }>;
  findings_by_article: Array<{
    article_id: number;
    title_ar: string;
    counts: Record<string, number>;
    triggered_atoms: string[];
    top_findings: Array<{
      atom_id: string | null;
      title_ar: string;
      severity: string;
      confidence: number;
      evidence_snippet: string;
      location: Record<string, unknown>;
      finding_uuid?: string | null;
      page_number?: number | null;
      start_offset_global?: number | null;
      end_offset_global?: number | null;
      start_line_chunk?: number | null;
      end_line_chunk?: number | null;
      is_interpretive?: boolean;
      depiction_type?: string;
      speaker_role?: string;
      context_confidence?: number | null;
      lexical_confidence?: number | null;
      policy_confidence?: number | null;
      rationale?: string | null;
      final_ruling?: string | null;
      narrative_consequence?: string | null;
      pillar_id?: string | null;
      secondary_pillar_ids?: string[];
      primary_article_id?: number | null;
      related_article_ids?: number[];
      canonical_finding_id?: string | null;
      policy_links?: Array<{ article_id: number; atom_concept_id?: string | null; role?: string | null }>;
    }>;
  }>;
  canonical_findings?: Array<{
    canonical_finding_id: string;
    title_ar: string;
    evidence_snippet: string;
    severity: string;
    confidence: number;
    finding_uuid?: string | null;
    source?: string | null;
    final_ruling?: string | null;
    rationale?: string | null;
    pillar_id?: string | null;
    primary_article_id?: number | null;
    related_article_ids?: number[];
    policy_links?: Array<{ article_id: number; atom_concept_id?: string | null; role?: string | null }>;
    start_offset_global?: number | null;
    end_offset_global?: number | null;
    start_line_chunk?: number | null;
    end_line_chunk?: number | null;
    page_number?: number | null;
    /** PolicyMap atom key e.g. 4-1; checklist UI. */
    primary_policy_atom_id?: string | null;
    canonical_atom?: string | null;
    intensity?: number | null;
    context_impact?: number | null;
    legal_sensitivity?: number | null;
    audience_risk?: number | null;
  }>;
  /** Findings grouped by canonical atom (e.g. VIOLENCE, INSULT) for auditor overview. */
  findings_by_canonical_atom?: Array<{
    canonical_atom: string;
    count: number;
    severity_counts: { low: number; medium: number; high: number; critical: number };
    top_findings: Array<{
      canonical_finding_id: string;
      title_ar: string;
      severity: string;
      evidence_snippet: string;
      finding_uuid?: string | null;
      page_number?: number | null;
    }>;
  }>;
  context_metrics?: {
    context_ok_count: number;
    needs_review_count: number;
    violation_count: number;
  };
  script_summary?: {
    synopsis_ar: string;
    key_risky_events_ar?: string;
    narrative_stance_ar?: string;
    compliance_posture_ar?: string;
    confidence: number;
  };
  /** Findings where rationale says "not a violation" — show as تنبيهات/ملاحظات للمخرج. */
  report_hints?: Array<{
    canonical_finding_id: string;
    title_ar: string;
    evidence_snippet: string;
    severity: string;
    confidence: number;
    finding_uuid?: string | null;
    source?: string | null;
    final_ruling?: string | null;
    rationale?: string | null;
    pillar_id?: string | null;
    primary_article_id?: number | null;
    related_article_ids?: number[];
    policy_links?: Array<{ article_id: number; atom_concept_id?: string | null; role?: string | null }>;
    start_offset_global?: number | null;
    end_offset_global?: number | null;
    start_line_chunk?: number | null;
    end_line_chunk?: number | null;
    page_numbers?: number[];
  }>;
  notes_summary?: Array<{
    category: string;
    count: number;
    items: Array<{
      id: string | null;
      reviewer: string | null;
      category: string;
      title: string;
      description: string;
      snippet: string;
      event_id: number;
      confidence: number;
      status: string;
      included_in_report: boolean;
      comment: string | null;
      reviewer_comment: string | null;
      reviewed_at: string | null;
      updated_at: string | null;
      created_at?: string | null;
    }>;
  }>;
  notes?: {
    media_credibility: Array<{
      id: string | null;
      reviewer: string | null;
      category: string;
      title: string;
      description: string;
      snippet: string;
      event_id: number;
      confidence: number;
      status: string;
      included_in_report: boolean;
      comment: string | null;
      reviewer_comment: string | null;
      reviewed_at: string | null;
      updated_at: string | null;
      created_at?: string | null;
    }>;
    medical_notes: Array<{
      id: string | null;
      reviewer: string | null;
      category: string;
      title: string;
      description: string;
      snippet: string;
      event_id: number;
      confidence: number;
      status: string;
      included_in_report: boolean;
      reviewer_comment: string | null;
      reviewed_at: string | null;
      updated_at: string | null;
      created_at?: string | null;
    }>;
    classified_documents: Array<{
      id: string | null;
      reviewer: string | null;
      category: string;
      title: string;
      description: string;
      snippet: string;
      event_id: number;
      confidence: number;
      status: string;
      included_in_report: boolean;
      reviewer_comment: string | null;
      reviewed_at: string | null;
      updated_at: string | null;
      created_at?: string | null;
    }>;
    security_scenes: Array<{
      id: string | null;
      reviewer: string | null;
      category: string;
      title: string;
      description: string;
      snippet: string;
      event_id: number;
      confidence: number;
      status: string;
      included_in_report: boolean;
      reviewer_comment: string | null;
      reviewed_at: string | null;
      updated_at: string | null;
      created_at?: string | null;
    }>;
    saudi_names: Array<{
      id: string | null;
      reviewer: string | null;
      category: string;
      title: string;
      description: string;
      snippet: string;
      event_id: number;
      confidence: number;
      status: string;
      included_in_report: boolean;
      reviewer_comment: string | null;
      reviewed_at: string | null;
      updated_at: string | null;
      created_at?: string | null;
    }>;
    commercial_entities: Array<{
      id: string | null;
      reviewer: string | null;
      category: string;
      title: string;
      description: string;
      snippet: string;
      event_id: number;
      confidence: number;
      status: string;
      included_in_report: boolean;
      reviewer_comment: string | null;
      reviewed_at: string | null;
      updated_at: string | null;
      created_at?: string | null;
    }>;
  };
  /** Separate light pass: words/phrases from glossary that appeared in the script — for "كلمات/عبارات للمراجعة" only. Does not affect violations. */
  words_to_revisit?: Array<{
    term: string;
    snippet: string;
    start_offset: number;
    end_offset: number;
  }>;
  manual_review_context?: {
    carried_forward_count: number;
    source_job_ids?: string[];
    items?: Array<{
      article_id: number;
      atom_id?: string | null;
      severity: string;
      evidence_snippet: string;
      manual_comment?: string | null;
      start_offset_global?: number | null;
      end_offset_global?: number | null;
      page_number?: number | null;
    }>;
  };
  partial_report?: {
    is_partial: boolean;
    processed_chunks: number;
    total_chunks: number;
    pending_chunks: number;
    failed_chunks: number;
    stopped_at?: string | null;
  };
}

const COMPLIANCE_NEUTRAL_HINTS = ["محايد", "سياق درامي", "ليس تحريضي", "ليس تمجيد", "متوافق إجمالاً", "درامي نفسي"];
const FRAGMENTED_ARABIC_TOKEN_RE =
  /[\u0621-\u064A]{1,2}(?:(?:\s+|[-ـ])[\u0621-\u064A]{1,3}){1,4}/gu;

type RevisitMention = NonNullable<SummaryJson["words_to_revisit"]>[number];
type ScriptPageMetaRow = {
  page_number: number;
  meta?: Record<string, unknown> | null;
};

type JobConfigMeta = {
  analysis_engine?: string;
  pipeline_version?: string;
  violation_system_version?: string;
  auditor_layer_version?: string;
  deep_auditor_enabled?: boolean;
};

function buildTraceSnapshotFromRow(
  row: {
    finding_uuid?: string | null;
    lineage_id?: string | null;
    article_id?: number | null;
    title_ar?: string | null;
    description_ar?: string | null;
    rationale_ar?: string | null;
    evidence_snippet?: string | null;
    start_offset_global?: number | null;
    end_offset_global?: number | null;
    page_number?: number | null;
    canonical_atom?: string | null;
    severity?: string | null;
    confidence?: number | null;
    canonical_finding_id?: string | null;
    atom_id?: string | null;
    primary_article_id?: number | null;
  },
  stageMeta: {
    stage: string;
    passName?: string | null;
    reviewerArticleId?: number | null;
    validatorDecision?: string | null;
    dropReason?: string | null;
    bypassReason?: string | null;
    insertedFindingId?: string | null;
    canonicalFindingId?: string | null;
  },
): FindingPipelineTraceSnapshot {
  return {
    traceId: row.lineage_id ?? row.finding_uuid ?? row.canonical_finding_id ?? "",
    findingUuid: row.finding_uuid ?? row.lineage_id ?? null,
    reviewerArticleId: stageMeta.reviewerArticleId ?? row.primary_article_id ?? row.article_id ?? null,
    passName: stageMeta.passName ?? null,
    eventId: null,
    pageNumber: row.page_number ?? null,
    title_ar: row.title_ar ?? null,
    description_ar: row.description_ar ?? null,
    rationale_ar: row.rationale_ar ?? null,
    canonical_atom: row.canonical_atom ?? null,
    article_id: row.article_id ?? null,
    claimedArticleId: row.article_id ?? null,
    severity: row.severity ?? null,
    confidence: row.confidence ?? null,
    evidence_snippet: row.evidence_snippet ?? null,
    quote: row.evidence_snippet ?? null,
    start_offset: row.start_offset_global ?? null,
    end_offset: row.end_offset_global ?? null,
    validatorDecision: stageMeta.validatorDecision ?? null,
    dropReason: stageMeta.dropReason ?? null,
    bypassReason: stageMeta.bypassReason ?? null,
    insertedFindingId: stageMeta.insertedFindingId ?? null,
    canonicalFindingId: stageMeta.canonicalFindingId ?? row.canonical_finding_id ?? null,
  };
}

function pickAnalysisEngine(value: unknown): "v2" {
  return "v2";
}

function pickPipelineVersion(value: unknown): "v1" | "v2" {
  return value === "v2" ? "v2" : "v1";
}

function pickViolationSystemVersion(value: unknown): "v2" | "v3" | "v4" | "v5" {
  if (value === "v2") return "v2";
  if (value === "v4") return "v4";
  if (value === "v5") return "v5";
  return "v3";
}

function pickAuditorLayerVersion(value: unknown): "v2" | "v3" | "v4" {
  if (value === "v2") return "v2";
  if (value === "v3") return "v3";
  return "v4";
}

type DocumentReviewHint = NonNullable<SummaryJson["report_hints"]>[number];
type ReviewFindingInsertRow = {
  job_id: string;
  report_id: string;
  script_id: string;
  version_id: string;
  finding_uuid?: string | null;
  canonical_finding_id: string | null;
  source_kind: "ai" | "glossary" | "manual" | "special";
  primary_article_id: number;
  primary_atom_id: string | null;
  severity: string;
  review_status: "violation" | "approved" | "needs_review";
  title_ar: string;
  description_ar: string | null;
  rationale_ar: string | null;
  evidence_snippet: string;
  manual_comment: string | null;
  page_number: number | null;
  start_offset_global: number | null;
  end_offset_global: number | null;
  start_offset_page: number | null;
  end_offset_page: number | null;
  anchor_status: "exact" | "unresolved";
  anchor_method: string | null;
  anchor_text: string | null;
  anchor_confidence: number | null;
  is_manual: boolean;
  is_hidden: boolean;
  include_in_report: boolean;
  created_from_job_id: string | null;
  approved_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  edited_by?: string | null;
  edited_at?: string | null;
  supersedes_review_finding_id?: string | null;
};

type ExistingReviewFindingRow = {
  id: string;
  report_id: string;
  script_id: string;
  version_id: string;
  finding_uuid: string | null;
  canonical_finding_id: string | null;
  source_kind: "ai" | "glossary" | "manual" | "special";
  primary_article_id: number;
  primary_atom_id: string | null;
  severity: string;
  review_status: "violation" | "approved" | "needs_review";
  title_ar: string;
  description_ar: string | null;
  rationale_ar: string | null;
  evidence_snippet: string;
  manual_comment: string | null;
  page_number: number | null;
  start_offset_global: number | null;
  end_offset_global: number | null;
  start_offset_page: number | null;
  end_offset_page: number | null;
  anchor_status: "exact" | "unresolved";
  anchor_method: string | null;
  anchor_text: string | null;
  anchor_confidence: number | null;
  approved_reason: string | null;
  include_in_report: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  edited_by: string | null;
  edited_at: string | null;
  is_hidden: boolean;
  is_manual: boolean;
  created_at: string;
  updated_at: string;
};

function scriptSuggestsNeutralContext(scriptSummary: SummaryJson["script_summary"]): boolean {
  if (!scriptSummary?.compliance_posture_ar && !scriptSummary?.narrative_stance_ar) return false;
  const text = [scriptSummary.compliance_posture_ar ?? "", scriptSummary.narrative_stance_ar ?? ""].join(" ");
  return containsAnyNormalized(text, COMPLIANCE_NEUTRAL_HINTS);
}

function buildContextSnippet(text: string, start: number, end: number, radius = 18): string {
  const lo = Math.max(0, start - radius);
  const hi = Math.min(text.length, end + radius);
  return text.slice(lo, hi).replace(/\s+/g, " ").trim();
}

function findFragmentedArabicMentions(text: string): RevisitMention[] {
  if (!text.trim()) return [];

  const mentions: RevisitMention[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = FRAGMENTED_ARABIC_TOKEN_RE.exec(text)) !== null) {
    const raw = match[0] ?? "";
    const fragments = raw.split(/(?:\s+|[-ـ])+/).filter(Boolean);
    if (fragments.length < 2 || fragments.length > 5) continue;
    const hasSingleLetterFragment = fragments.some((fragment) => fragment.length === 1);
    if (!hasSingleLetterFragment) continue;

    const combined = fragments.join("");
    if (combined.length < 3 || combined.length > 9) continue;

    const start = match.index;
    const end = start + raw.length;
    const snippet = buildContextSnippet(text, start, end);
    const key = `${start}:${end}:${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);

    mentions.push({
      term: raw.trim(),
      snippet,
      start_offset: start,
      end_offset: end,
    });

    if (mentions.length >= 30) break;
  }

  return mentions;
}

function buildDocumentStructureHints(pageRows: ScriptPageMetaRow[]): DocumentReviewHint[] {
  const byFlag = new Map<string, number[]>();

  for (const row of pageRows) {
    const meta = row.meta ?? {};
    const documentFlags = Array.isArray(meta.documentFlags) ? (meta.documentFlags as string[]) : [];
    const editorialFlags = Array.isArray(meta.editorialFlags) ? (meta.editorialFlags as string[]) : [];
    for (const flag of [...documentFlags, ...editorialFlags]) {
      if (!flag) continue;
      if (!byFlag.has(flag)) byFlag.set(flag, []);
      byFlag.get(flag)!.push(row.page_number);
    }
  }

  const specs: Record<string, { title: string; rationale: string }> = {
    probable_table_detected: {
      title: "تنبيه بنية المستند: جدول أو أعمدة محتملة",
      rationale: "رصد النظام صفحة أو أكثر تبدو كجدول أو تنسيق أعمدة. قد يحافظ الاستيراد على النص بينما يفقد جزءاً من بنية الصفوف والخلايا، لذا يلزم تحقق بشري من هذه الصفحات.",
    },
    probable_multi_column_layout: {
      title: "تنبيه بنية المستند: تخطيط متعدد الأعمدة",
      rationale: "رصد النظام تخطيطاً متعدد الأعمدة قد يغيّر ترتيب القراءة في النص المستخرج. يوصى بمراجعة هذه الصفحات بصرياً قبل الاعتماد الكامل على التحليل الآلي.",
    },
    probable_form_layout: {
      title: "تنبيه بنية المستند: صفحة بنمط نموذج أو حقول",
      rationale: "رصد النظام صفحة بنمط نموذج أو حقول تعبئة، وقد لا تُحفظ العلاقات بين العناوين والقيم بنفس الشكل الأصلي داخل النص التحليلي.",
    },
    probable_scan_annotation_page: {
      title: "تنبيه بنية المستند: صفحة ممسوحة أو مليئة بعناصر بصرية",
      rationale: "رصد النظام صفحة يبدو أنها ممسوحة ضوئياً أو تحتوي على عناصر بصرية مثل أختام أو كتابات جانبية أو تعليقات فوق النص. يجب على المدقق مراجعتها بصرياً لأن القراءة الآلية قد تكون أقل ثباتاً في هذه الصفحات.",
    },
    probable_repeated_header_footer: {
      title: "تنبيه بنية المستند: ترويسات أو تذييلات متكررة",
      rationale: "رصد النظام ترويسات أو تذييلات متكررة قد تدخل ضمن النص المستخرج. ينبغي على المدقق تجاهلها أو التحقق من أنها ليست جزءاً من المتن الأصلي.",
    },
    crossed_out_text_detected: {
      title: "تنبيه سلامة النص: نص مشطوب أو مشطوب عليه",
      rationale: "رصد النظام مقاطع مشطوبة في المستند الأصلي. قد تكون هذه المقاطع مقصودة للحذف أو التعديل، لذلك يجب على المدقق حسم ما إذا كانت معتمدة ضمن النص أم لا.",
    },
  };

  const hints: DocumentReviewHint[] = [];
  for (const [flag, pages] of byFlag.entries()) {
    const spec = specs[flag];
    if (!spec || pages.length === 0) continue;
    const uniquePages = [...new Set(pages)].sort((a, b) => a - b);
    const pageLabel = uniquePages.length === 1 ? `صفحة ${uniquePages[0]}` : `الصفحات ${uniquePages.join("، ")}`;
    hints.push({
      canonical_finding_id: `DOC-${flag}`,
      title_ar: spec.title,
      evidence_snippet: `${pageLabel}`,
      severity: "low",
      confidence: 0.7,
      final_ruling: "needs_review",
      rationale: spec.rationale,
      pillar_id: null,
      primary_article_id: null,
      related_article_ids: [],
      policy_links: [],
      start_offset_global: null,
      end_offset_global: null,
      start_line_chunk: null,
      end_line_chunk: null,
      page_numbers: uniquePages,
    });
  }

  return hints.sort((a, b) => String(a.title_ar).localeCompare(String(b.title_ar), "ar"));
}

function toReviewSourceKind(source: string | null | undefined, isSpecial = false): ReviewFindingInsertRow["source_kind"] {
  if (isSpecial) return "special";
  const normalized = String(source ?? "ai").toLowerCase();
  if (normalized === "manual") return "manual";
  if (normalized === "lexicon_mandatory" || normalized === "glossary") return "glossary";
  return "ai";
}

function toReviewStatus(finalRuling: string | null | undefined, isSpecial = false): ReviewFindingInsertRow["review_status"] {
  const normalized = String(finalRuling ?? "").toLowerCase();
  if (normalized === "needs_review" || isSpecial) return "needs_review";
  return "violation";
}

function compactReviewText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function buildReviewFindingRows(
  reportId: string,
  summary: SummaryJson,
  versionId: string
): ReviewFindingInsertRow[] {
  const canonical = (summary.canonical_findings ?? [])
    .filter((finding) => toReviewSourceKind(finding.source) !== "manual")
    .map((finding) => ({
      job_id: summary.job_id,
      report_id: reportId,
      script_id: summary.script_id,
      version_id: versionId,
      finding_uuid: finding.finding_uuid ?? null,
      canonical_finding_id: finding.canonical_finding_id ?? null,
      source_kind: toReviewSourceKind(finding.source),
      primary_article_id: Number.isFinite(finding.primary_article_id) ? Number(finding.primary_article_id) : 0,
      primary_atom_id: finding.primary_policy_atom_id ?? null,
      severity: finding.severity,
      review_status: toReviewStatus(finding.final_ruling),
      title_ar: finding.title_ar,
      description_ar: null,
      rationale_ar: finding.rationale ?? null,
      evidence_snippet: finding.evidence_snippet,
      manual_comment: null,
      page_number: finding.page_number ?? null,
      start_offset_global: finding.start_offset_global ?? null,
      end_offset_global: finding.end_offset_global ?? null,
      start_offset_page: null,
      end_offset_page: null,
      anchor_status:
        finding.page_number != null && finding.start_offset_global != null && finding.end_offset_global != null
          ? ("exact" as const)
          : ("unresolved" as const),
      anchor_method:
        finding.page_number != null && finding.start_offset_global != null && finding.end_offset_global != null
          ? "canonical_summary"
          : null,
      anchor_text: finding.evidence_snippet ?? null,
      anchor_confidence: finding.confidence ?? null,
      is_manual: false,
      is_hidden: false,
      include_in_report: true,
      created_from_job_id: summary.job_id,
    }));

  const hints = (summary.report_hints ?? []).map((finding) => ({
    job_id: summary.job_id,
    report_id: reportId,
    script_id: summary.script_id,
    version_id: versionId,
    finding_uuid: finding.finding_uuid ?? null,
    canonical_finding_id: finding.canonical_finding_id ?? null,
    source_kind: toReviewSourceKind(finding.source, true),
    primary_article_id: Number.isFinite(finding.primary_article_id) ? Number(finding.primary_article_id) : 0,
    primary_atom_id: null,
    severity: finding.severity,
    review_status: toReviewStatus(finding.final_ruling, true),
    title_ar: finding.title_ar,
    description_ar: null,
    rationale_ar: finding.rationale ?? null,
    evidence_snippet: finding.evidence_snippet,
    manual_comment: null,
    page_number:
      Array.isArray(finding.page_numbers) && finding.page_numbers.length > 0
        ? Number(finding.page_numbers[0] ?? null)
        : null,
    start_offset_global: finding.start_offset_global ?? null,
    end_offset_global: finding.end_offset_global ?? null,
    start_offset_page: null,
    end_offset_page: null,
    anchor_status:
      finding.start_offset_global != null && finding.end_offset_global != null
        ? ("exact" as const)
        : ("unresolved" as const),
    anchor_method:
      finding.start_offset_global != null && finding.end_offset_global != null
        ? "report_hint_summary"
        : null,
    anchor_text: finding.evidence_snippet ?? null,
    anchor_confidence: finding.confidence ?? null,
    is_manual: false,
    is_hidden: false,
    include_in_report: true,
    created_from_job_id: summary.job_id,
  }));

  return [...canonical, ...hints].filter((row) => row.primary_article_id > 0 && Boolean(row.canonical_finding_id));
}

async function loadPriorReviewFindingRows(
  reportId: string,
  scriptId: string,
  versionId: string,
): Promise<{ validRows: ExistingReviewFindingRow[], priorRows: number, priorHumanReviewedRows: number, priorAiRows: number }> {
  const { data, error } = await supabase
    .from("analysis_review_findings")
    .select("id, report_id, script_id, version_id, finding_uuid, canonical_finding_id, source_kind, primary_article_id, primary_atom_id, severity, review_status, title_ar, description_ar, rationale_ar, evidence_snippet, manual_comment, page_number, start_offset_global, end_offset_global, start_offset_page, end_offset_page, anchor_status, anchor_method, anchor_text, anchor_confidence, approved_reason, include_in_report, reviewed_by, reviewed_at, edited_by, edited_at, is_hidden, is_manual, created_at, updated_at")
    .eq("script_id", scriptId)
    .eq("version_id", versionId)
    .neq("report_id", reportId)
    .eq("is_hidden", false)
    .order("updated_at", { ascending: false });

  if (error) {
    logger.warn("Could not load prior review findings", { reportId, scriptId, versionId, error });
    return { validRows: [], priorRows: 0, priorHumanReviewedRows: 0, priorAiRows: 0 };
  }

  const allRows = (data ?? []) as ExistingReviewFindingRow[];
  const validRows = allRows.filter(r => r.is_manual || r.reviewed_by || r.reviewed_at);
  const priorAiRows = allRows.length - validRows.length;

  return {
    validRows,
    priorRows: allRows.length,
    priorHumanReviewedRows: validRows.length,
    priorAiRows,
  };
}

function applyPriorReviewState(
  row: ReviewFindingInsertRow,
  prior: ExistingReviewFindingRow | null | undefined,
): ReviewFindingInsertRow {
  if (!prior) return row;

  const hasPersistentReviewerEdit =
    prior.source_kind === "manual" ||
    prior.is_manual === true;

  const carried: ReviewFindingInsertRow = {
    ...row,
    review_status: prior.review_status || row.review_status,
    approved_reason: prior.approved_reason ?? null,
    include_in_report: prior.include_in_report ?? row.include_in_report,
    reviewed_by: prior.reviewed_by ?? null,
    reviewed_at: prior.reviewed_at ?? null,
    edited_by: prior.edited_by ?? null,
    edited_at: prior.edited_at ?? null,
    supersedes_review_finding_id: prior.id,
  };

  if (!hasPersistentReviewerEdit) {
    return carried;
  }

  // Only manual rows carry prior classification text/metadata.
  // For AI/glossary rows, stale prior edits (e.g. action text edits) must not override
  // freshly materialized evidence-based classification.
  return {
    ...carried,
    primary_article_id: prior.primary_article_id || row.primary_article_id,
    primary_atom_id: prior.primary_atom_id ?? row.primary_atom_id,
    severity: prior.severity || row.severity,
    title_ar: prior.title_ar || row.title_ar,
    description_ar: prior.description_ar ?? row.description_ar,
    rationale_ar: prior.rationale_ar ?? row.rationale_ar,
    evidence_snippet: prior.evidence_snippet || row.evidence_snippet,
    manual_comment: prior.manual_comment ?? row.manual_comment,
    page_number: prior.page_number ?? row.page_number,
    start_offset_global: prior.start_offset_global ?? row.start_offset_global,
    end_offset_global: prior.end_offset_global ?? row.end_offset_global,
    start_offset_page: prior.start_offset_page ?? row.start_offset_page,
    end_offset_page: prior.end_offset_page ?? row.end_offset_page,
    anchor_status: prior.anchor_status ?? row.anchor_status,
    anchor_method: prior.anchor_method ?? row.anchor_method,
    anchor_text: prior.anchor_text ?? row.anchor_text,
    anchor_confidence: prior.anchor_confidence ?? row.anchor_confidence,
  };
}

function pickPriorReviewFindingMatch(
  row: ReviewFindingInsertRow,
  priorRows: ExistingReviewFindingRow[],
): ExistingReviewFindingRow | null {
  if (row.finding_uuid) {
    const exactFindingUuid = priorRows.find(
      (candidate) =>
        candidate.finding_uuid === row.finding_uuid &&
        candidate.source_kind === row.source_kind,
    );
    if (exactFindingUuid) return exactFindingUuid;
  }

  if (row.canonical_finding_id) {
    const exact = priorRows.find(
      (candidate) =>
        candidate.canonical_finding_id === row.canonical_finding_id &&
        candidate.source_kind === row.source_kind,
    );
    if (exact) return exact;
  }

  const evidence = compactReviewText(row.evidence_snippet);
  if (!evidence) return null;

  return (
    priorRows.find((candidate) => {
      if (candidate.source_kind !== row.source_kind) return false;
      if (candidate.primary_article_id !== row.primary_article_id) return false;
      const candidateEvidence = compactReviewText(candidate.evidence_snippet);
      return candidateEvidence.includes(evidence) || evidence.includes(candidateEvidence);
    }) ?? null
  );
}

function reviewRowDedupKey(row: ReviewFindingInsertRow): string {
  return [
    row.source_kind,
    row.finding_uuid ?? "",
    row.canonical_finding_id ?? "",
    row.primary_article_id,
    row.primary_atom_id ?? "",
    compactReviewText(row.evidence_snippet),
    compactReviewText(row.manual_comment ?? ""),
    row.page_number ?? "",
    row.start_offset_global ?? "",
    row.end_offset_global ?? "",
    row.review_status,
    row.supersedes_review_finding_id ?? "",
  ].join("|");
}

function dedupeReviewInsertRows(rows: ReviewFindingInsertRow[]): ReviewFindingInsertRow[] {
  const seen = new Set<string>();
  const deduped: ReviewFindingInsertRow[] = [];
  for (const row of rows) {
    const key = reviewRowDedupKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

async function buildManualReviewRowsForJob(
  reportId: string,
  summary: SummaryJson,
  versionId: string,
): Promise<ReviewFindingInsertRow[]> {
  const { data, error } = await supabase
    .from("analysis_findings")
    .select("id, finding_uuid, job_id, script_id, version_id, article_id, atom_id, severity, review_status, review_reason, reviewed_by, reviewed_at, evidence_snippet, manual_comment, page_number, start_offset_global, end_offset_global, start_offset_page, end_offset_page")
    .eq("job_id", summary.job_id)
    .eq("source", "manual")
    .order("created_at", { ascending: true });

  if (error) {
    logger.warn("Could not load manual findings for review-layer materialization", { reportId, jobId: summary.job_id, error });
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((finding) => ({
    job_id: summary.job_id,
    report_id: reportId,
    script_id: summary.script_id,
    version_id: versionId,
    finding_uuid: (finding.finding_uuid as string | null | undefined) ?? (finding.id as string | null | undefined) ?? null,
    canonical_finding_id: null,
    source_kind: "manual",
    primary_article_id: Number(finding.article_id ?? 4),
    primary_atom_id: (finding.atom_id as string | null | undefined) ?? null,
    severity: String(finding.severity ?? "medium"),
    review_status: (String(finding.review_status ?? "violation") === "approved" ? "approved" : "violation"),
    title_ar: "ملاحظة يدوية",
    description_ar: (finding.manual_comment as string | null | undefined) ?? (finding.evidence_snippet as string | null | undefined) ?? null,
    rationale_ar: null,
    evidence_snippet: String(finding.evidence_snippet ?? "—"),
    manual_comment: (finding.manual_comment as string | null | undefined) ?? null,
    page_number: (finding.page_number as number | null | undefined) ?? null,
    start_offset_global: (finding.start_offset_global as number | null | undefined) ?? null,
    end_offset_global: (finding.end_offset_global as number | null | undefined) ?? null,
    start_offset_page: (finding.start_offset_page as number | null | undefined) ?? null,
    end_offset_page: (finding.end_offset_page as number | null | undefined) ?? null,
    anchor_status: "exact",
    anchor_method: "stored_offsets",
    anchor_text: String(finding.evidence_snippet ?? "—"),
    anchor_confidence: 1,
    is_manual: true,
    is_hidden: false,
    include_in_report: true,
    created_from_job_id: summary.job_id,
    approved_reason: (finding.review_reason as string | null | undefined) ?? null,
    reviewed_by: (finding.reviewed_by as string | null | undefined) ?? null,
    reviewed_at: (finding.reviewed_at as string | null | undefined) ?? null,
  }));
}

async function materializeReviewFindings(
  reportId: string,
  summary: SummaryJson,
  versionId: string,
  fullScriptText: string | null = null,
): Promise<void> {
  const priorData = await loadPriorReviewFindingRows(reportId, summary.script_id, versionId);
  const priorRows = priorData.validRows;

  const baseRows = buildReviewFindingRows(reportId, summary, versionId)
    .map((row) => normalizeReviewFindingConsistency(row, fullScriptText));
  const carriedRows = baseRows
    .map((row) => applyPriorReviewState(row, pickPriorReviewFindingMatch(row, priorRows)))
    .map((row) => normalizeReviewFindingConsistency(row, fullScriptText));
  const manualRows = (await buildManualReviewRowsForJob(reportId, summary, versionId)).map((row) =>
    applyPriorReviewState(row, pickPriorReviewFindingMatch(row, priorRows))
  );
  const rows = dedupeReviewInsertRows([...carriedRows, ...manualRows]);
  logger.info("Materializing reviewer findings", {
    reportId,
    jobId: summary.job_id,
    currentJobRows: rows.length,
    priorRows: priorData.priorRows,
    priorHumanReviewedRows: priorData.priorHumanReviewedRows,
    priorAiRows: priorData.priorAiRows,
    manualRows: manualRows.length,
  });

  if (rows.length === 0) {
    await supabase
      .from("analysis_review_findings")
      .delete()
      .eq("report_id", reportId)
      .eq("is_manual", false);
    await supabase
      .from("analysis_review_findings")
      .delete()
      .eq("report_id", reportId)
      .eq("source_kind", "manual")
      .not("supersedes_review_finding_id", "is", null);
    return;
  }

  const { error: deleteErr } = await supabase
    .from("analysis_review_findings")
    .delete()
    .eq("report_id", reportId)
    .eq("is_manual", false);

  if (deleteErr) {
    logger.error("Materialize analysis_review_findings delete FAILED", {
      reportId,
      jobId: summary.job_id,
      error: deleteErr,
    });
    throw deleteErr;
  }

  const { error: deleteCarriedManualErr } = await supabase
    .from("analysis_review_findings")
    .delete()
    .eq("report_id", reportId)
    .eq("source_kind", "manual")
    .not("supersedes_review_finding_id", "is", null);

  if (deleteCarriedManualErr) {
    logger.error("Materialize carried manual review findings delete FAILED", {
      reportId,
      jobId: summary.job_id,
      error: deleteCarriedManualErr,
    });
    throw deleteCarriedManualErr;
  }

  const { error } = await supabase
    .from("analysis_review_findings")
    .insert(rows);

  if (error) {
    logger.error("Materialize analysis_review_findings FAILED", {
      reportId,
      jobId: summary.job_id,
      error,
    });
    throw error;
  }
}

/**
 * When script summary indicates neutral/dramatic context (not inciting), downgrade
 * violation -> needs_review for non-critical canonical findings to align summary and rulings.
 */
function applySummaryContextToRulings(summary: SummaryJson): void {
  if (!scriptSuggestsNeutralContext(summary.script_summary)) return;
  const canon = summary.canonical_findings;
  if (!canon?.length) return;
  const byId = new Map(canon.map((f) => [f.canonical_finding_id, f]));
  let changed = 0;
  for (const f of canon) {
    if (f.final_ruling === "violation" && f.severity !== "critical") {
      (f as { final_ruling?: string }).final_ruling = "needs_review";
      changed++;
    }
  }
  if (changed > 0 && summary.context_metrics) {
    const violationCount = canon.filter((x) => x.final_ruling === "violation").length;
    const needsReviewCount = canon.filter((x) => x.final_ruling === "needs_review").length;
    const contextOkCount = canon.filter((x) => x.final_ruling === "context_ok").length;
    summary.context_metrics.violation_count = violationCount;
    summary.context_metrics.needs_review_count = needsReviewCount;
    summary.context_metrics.context_ok_count = contextOkCount;
  }
  if (changed > 0 && summary.findings_by_article) {
    for (const art of summary.findings_by_article) {
      for (const top of art.top_findings ?? []) {
        const loc = top.location as Record<string, unknown> | undefined;
        const v3 = loc?.v3 as Record<string, unknown> | undefined;
        const cid = v3?.canonical_finding_id as string | undefined;
        const c = cid ? byId.get(cid) : undefined;
        if (c && v3 && v3.final_ruling !== c.final_ruling) {
          v3.final_ruling = c.final_ruling ?? null;
        }
      }
    }
  }
}

/** Phrases in rationale that mean "not a violation" / acceptable context — move to report_hints. */
const RATIONALE_SAYS_NOT_VIOLATION = [
  // Explicit "not a violation"
  "لا يعد مخالفة",
  "لا توجد مخالفة",
  "لا يعتبر مخالفة",
  "لا تُعد مخالفة",
  "لا تعتبر مخالفة",
  "ليس مخالفة",
  "لا يشكل مخالفة",
  "لا توجد مخالفة واضحة",
  "لا يصل إلى حد المخالفة",
  "لا يرقى إلى مخالفة",
  "لا يُصنف كمخالفة",
  "لا يمكن اعتباره مخالفة",
  "لا يشكل انتهاكاً",
  "لا يشكل تجاوزاً",
  "لا يعد تجاوزاً",
  // Context acceptable / within bounds
  "السياق مقبول",
  "يعتبر السياق مقبولاً",
  "والسياق مقبولاً",
  "السياق طبيعي ولا يتجاوز",
  "السياق طبيعي",
  "ضمن السياق المقبول",
  "سياق مقبول",
  "مقبول في السياق",
  "متوافق مع الضوابط",
  "ضمن الضوابط",
  "لا يتعارض مع الضوابط",
  "لا خرق للضوابط",
  "لا انتهاك واضح",
  // Does not exceed / breach
  "لا يتجاوز ضوابط",
  "لا يخرق",
  "لا يخرق ضوابط",
  "لا يتجاوز الضوابط",
  "غير متجاوز للضوابط",
  // Positive handling / treatment
  "معالجة إيجابية",
  "معالجة إيجابية للسياق",
  "يعزز القيم",
  "رفض السلوك",
  // Innocent / no inappropriate content
  "بريء",
  "براءة",
  "رومانسي بريء",
  "غموض رومانسي بريء",
  "دون أي إيحاء",
  "لا إيحاءات جنسية",
  "لا يتضمن أي إيحاء",
  "لا يتضمن إيحاءات",
  "لا تجاوزات أخلاقية",
  "دون مشهد غير لائق",
  "لا يوجد مشهد غير لائق",
  "لا وصف جنسي",
  "دون وصف جنسي",
  "لا يشكل محتوى غير لائق",
  // "لا يتضمن أي" — use specific follow-ups to avoid false positives; keep only safe combo
  "لا يتضمن أي إيحاءات",
  "لا يتضمن أي تجاوز",
  "ولا يعد",
  // Dramatic / narrative / medical context (not endorsement)
  "سياق درامي فقط",
  "جزء من السياق الدرامي",
  "في إطار درامي",
  "في سياق مرضي",
  "في إطار علاجي",
  "جزء من هذيان",
  "هذيان المريض",
  "لا يعكس تحريضاً",
  "ليس تحريضاً",
  "ليس تمجيداً للعنف",
  "لا يروج للعنف",
  "لا يشكل تحريضاً",
  "لا يروّج للعنف",
  "يعكس كابوساً",
  "يعكس ذكرى",
  "ضمن إطار العمل الدرامي",
  "عنصر تشويق",
  "تشويق أو غموض رومانسي بريء",
  "يخدم السياق الدرامي",
  "يخدم السرد",
  "لأغراض الدراما",
  "لأغراض السرد",
  "قد لا يعد مخالفة",
  "لا يبدو مخالفة",
  "قد لا يعتبر مخالفة",
];

/** If the rationale clearly states it *is* a violation, do not move to hints even if it also mentions dramatic context. */
const RATIONALE_SAYS_VIOLATION = [
  "تخالف ضوابط",
  "تخالف المادة",
  "مخالفة ل",
  "ينتهك",
  "يخالف ضوابط",
  "يخالف المادة",
  "تعد مخالفة",
  "تعد مخالفة ل",
  "يعد مخالفة ل",
  "تستدعي تصنيف",
  "يتجاوز ضوابط المادة",
  "خالف المادة",
];

function rationaleSaysNotViolation(rationale: string | null | undefined): boolean {
  if (!rationale || rationale.trim() === "") return false;
  const r = rationale.trim();
  if (containsAnyNormalized(r, RATIONALE_SAYS_VIOLATION)) return false;
  return containsAnyNormalized(r, RATIONALE_SAYS_NOT_VIOLATION);
}

type CanonicalFindingItem = NonNullable<SummaryJson["canonical_findings"]>[number];

/**
 * Final gate: if the AI decided this is NOT a violation (context_ok or rationale says so),
 * move that finding to report_hints so it appears only in ملاحظات خاصة, not in violations.
 * Rule: one place only — either violations OR notes, never both.
 */
function applyReportGate(summary: SummaryJson): void {
  const canon = summary.canonical_findings;
  if (!canon?.length) return;

  const violations: CanonicalFindingItem[] = [];
  const hints: CanonicalFindingItem[] = [];

  for (const f of canon) {
    const isContextOk = (f.final_ruling ?? "").toLowerCase() === "context_ok";
    const rationaleSaysNot = rationaleSaysNotViolation(f.rationale);
    if (isContextOk || rationaleSaysNot) {
      hints.push(f);
    } else {
      violations.push(f);
    }
  }

  if (hints.length === 0) return;

  summary.canonical_findings = violations;
  summary.report_hints = hints;

  const policyArticles = getPolicyArticles();
  const severityOrder = (s: string) => (SEVERITIES.indexOf(s as (typeof SEVERITIES)[number]) + 1) || 0;

  const severity_counts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of violations) {
    if (SEVERITIES.includes(f.severity as (typeof SEVERITIES)[number])) {
      severity_counts[f.severity as keyof typeof severity_counts]++;
    }
  }

  const canonicalByPrimary = new Map<number, CanonicalFindingItem[]>();
  for (const f of violations) {
    const aid = f.primary_article_id ?? 0;
    if (aid === 0 || aid === OUT_OF_SCOPE_ARTICLE_ID) continue;
    if (!canonicalByPrimary.has(aid)) canonicalByPrimary.set(aid, []);
    canonicalByPrimary.get(aid)!.push(f);
  }

  summary.findings_by_article = policyArticles
    .filter((a) => a.articleId !== OUT_OF_SCOPE_ARTICLE_ID)
    .map((art) => {
      const list = canonicalByPrimary.get(art.articleId) ?? [];
      const counts = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const f of list) {
        if (SEVERITIES.includes(f.severity as (typeof SEVERITIES)[number])) {
          counts[f.severity as keyof typeof counts]++;
        }
      }
      const sorted = [...list].sort(compareCanonicalItemsStable);
      const top_findings = sorted.slice(0, 10).map((f) => ({
        atom_id: null as string | null,
        finding_uuid: f.finding_uuid ?? null,
        page_number: f.page_number ?? null,
        title_ar: f.title_ar,
        severity: f.severity,
        confidence: f.confidence,
        evidence_snippet: f.evidence_snippet,
        location: {
          v3: {
            primary_article_id: f.primary_article_id,
            related_article_ids: f.related_article_ids,
            canonical_finding_id: f.canonical_finding_id,
            pillar_id: f.pillar_id,
            rationale: f.rationale,
            final_ruling: f.final_ruling,
            policy_links: f.policy_links,
          },
        } as Record<string, unknown>,
        start_offset_global: f.start_offset_global,
        end_offset_global: f.end_offset_global,
        start_line_chunk: f.start_line_chunk,
        end_line_chunk: f.end_line_chunk,
        rationale: f.rationale ?? RATIONALE_FALLBACK,
        final_ruling: f.final_ruling ?? null,
        pillar_id: f.pillar_id ?? null,
        primary_article_id: f.primary_article_id ?? null,
        related_article_ids: f.related_article_ids ?? [],
        canonical_finding_id: f.canonical_finding_id,
        policy_links: f.policy_links ?? [],
      }));
      return {
        article_id: art.articleId,
        title_ar: art.title_ar,
        counts,
        triggered_atoms: [] as string[],
        top_findings,
      };
    })
    .filter((entry) => entry.top_findings.length > 0);

  summary.checklist_articles = policyArticles
    .filter((a) => a.articleId !== OUT_OF_SCOPE_ARTICLE_ID)
    .map((art) => {
      const list = canonicalByPrimary.get(art.articleId) ?? [];
      const counts = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const f of list) {
        if (SEVERITIES.includes(f.severity as (typeof SEVERITIES)[number])) {
          counts[f.severity as keyof typeof counts]++;
        }
      }
      const total = list.length;
      const hasCritical = counts.critical > 0;
      const hasHigh = counts.high > 0;
      const hasMedium = counts.medium > 0;
      const hasLow = counts.low > 0;
      let status: "ok" | "not_scanned" | "warning" | "fail" = "ok";
      if (total === 0) status = "ok";
      else if (hasCritical || hasHigh) status = "fail";
      else if (hasMedium || hasLow) status = "warning";
      return {
        article_id: art.articleId,
        title_ar: art.title_ar,
        status,
        counts,
        triggered_atoms: [] as string[],
      };
    });

  summary.totals.findings_count = violations.length;
  summary.totals.unique_incidents_count = violations.length;
  summary.totals.severity_counts = severity_counts;
  summary.totals.type_counts = countFindingTypes(violations, hints.length);

  const byCanonicalAtom = new Map<string, CanonicalFindingItem[]>();
  for (const f of violations) {
    const atom = (f as { canonical_atom?: string | null }).canonical_atom ?? "UNKNOWN";
    if (!byCanonicalAtom.has(atom)) byCanonicalAtom.set(atom, []);
    byCanonicalAtom.get(atom)!.push(f);
  }
  summary.findings_by_canonical_atom = [...byCanonicalAtom.entries()]
    .map(([canonical_atom, list]) => {
      const counts = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const f of list) {
        if (SEVERITIES.includes(f.severity as (typeof SEVERITIES)[number])) {
          counts[f.severity as keyof typeof counts]++;
        }
      }
      const sorted = [...list].sort(compareCanonicalItemsStable);
      const top_findings = sorted.slice(0, 5).map((f) => ({
        finding_uuid: f.finding_uuid ?? null,
        page_number: f.page_number ?? null,
        canonical_finding_id: f.canonical_finding_id,
        title_ar: f.title_ar,
        severity: f.severity,
        evidence_snippet: f.evidence_snippet,
      }));
      return { canonical_atom, count: list.length, severity_counts: counts, top_findings };
    })
    .sort((a, b) => b.count - a.count || String(a.canonical_atom).localeCompare(String(b.canonical_atom), "ar"));

  if (summary.context_metrics) {
    summary.context_metrics.violation_count = violations.filter((x) => x.final_ruling === "violation").length;
    summary.context_metrics.needs_review_count = violations.filter((x) => x.final_ruling === "needs_review").length;
    summary.context_metrics.context_ok_count = violations.filter((x) => x.final_ruling === "context_ok").length;
  }

  logger.info("Report gate applied", { movedToHints: hints.length, violationsCount: violations.length });
}

type DbFinding = {
  source?: string;
  article_id: number;
  atom_id: string | null;
  severity: string;
  confidence: number | null;
  title_ar: string;
  description_ar: string;
  evidence_snippet: string;
  start_offset_global: number | null;
  end_offset_global: number | null;
  start_line_chunk: number | null;
  end_line_chunk: number | null;
  page_number?: number | null;
  location: unknown;
  rationale_ar?: string | null;
  canonical_atom?: string | null;
  intensity?: number | null;
  context_impact?: number | null;
  legal_sensitivity?: number | null;
  audience_risk?: number | null;
  finding_uuid?: string | null;
  lineage_id?: string | null;
  parent_lineage_id?: string | null;
  evidence_hash?: string | null;
  canonical_hash?: string | null;
};

type DbNote = {
  id?: string | null;
  reviewer?: string | null;
  category: string;
  title: string;
  description: string;
  snippet: string;
  event_id: number;
  confidence: number | null;
  status?: string | null;
  included_in_report?: boolean | null;
  reviewer_comment?: string | null;
  reviewed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const SEVERITY_ORDER: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const RATIONALE_FALLBACK = "يتطلب تقييم مراجع مختص.";
const NOTE_CATEGORY_ORDER: Array<keyof NonNullable<SummaryJson["notes"]>> = [
  "media_credibility",
  "medical_notes",
  "classified_documents",
  "security_scenes",
  "saudi_names",
  "commercial_entities",
];
const NOTE_CATEGORY_LABELS: Record<keyof NonNullable<SummaryJson["notes"]>, string> = {
  media_credibility: "Media Credibility",
  medical_notes: "Medical Notes",
  classified_documents: "Classified Documents",
  security_scenes: "Security Scenes",
  saudi_names: "Saudi Names",
  commercial_entities: "Commercial Entities",
};

type NoteSummaryItem = NonNullable<SummaryJson["notes"]>[keyof NonNullable<SummaryJson["notes"]>][number];

function findingTypeKey(source: string | null | undefined): "ai" | "manual" | "glossary" {
  if (source === "manual") return "manual";
  if (source === "lexicon_mandatory" || source === "glossary") return "glossary";
  return "ai";
}

function countFindingTypes(
  list: Array<{ source?: string | null }>,
  specialCount = 0,
): { ai: number; manual: number; glossary: number; special: number } {
  const counts = { ai: 0, manual: 0, glossary: 0, special: Math.max(0, specialCount) };
  for (const finding of list) {
    counts[findingTypeKey(finding.source)]++;
  }
  return counts;
}

function buildNoteSummary(jobId: string, notes: DbNote[]): {
  notes_summary: NonNullable<SummaryJson["notes_summary"]>;
  notes: NonNullable<SummaryJson["notes"]>;
} {
  const groups = new Map<keyof NonNullable<SummaryJson["notes"]>, NoteSummaryItem[]>();
  for (const note of notes) {
    const key = normalizeNoteCategoryKey(note.category);
    if (!key) {
      logger.warn("Aggregation skipped note with unknown category", {
        jobId,
        noteId: note.id ?? null,
        reviewer: note.reviewer ?? null,
        category: note.category ?? null,
      });
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({
      id: note.id ?? null,
      reviewer: note.reviewer ?? null,
      category: key,
      title: note.title,
      description: note.description,
      snippet: note.snippet,
      event_id: note.event_id,
      confidence: typeof note.confidence === "number" ? note.confidence : 0.7,
      status: note.status ?? "new",
      included_in_report: typeof note.included_in_report === "boolean" ? note.included_in_report : true,
      comment: note.reviewer_comment ?? null,
      reviewer_comment: note.reviewer_comment ?? null,
      reviewed_at: note.reviewed_at ?? null,
      updated_at: note.updated_at ?? null,
      created_at: note.created_at ?? null,
    });
  }

  const notes_summary = [...groups.entries()]
    .map(([category, items]) => ({
      category,
      count: items.length,
      items,
    }))
    .sort((a, b) => NOTE_CATEGORY_ORDER.indexOf(a.category as keyof NonNullable<SummaryJson["notes"]>) - NOTE_CATEGORY_ORDER.indexOf(b.category as keyof NonNullable<SummaryJson["notes"]>));

  return {
    notes_summary,
    notes: {
      media_credibility: groups.get("media_credibility") ?? [],
      medical_notes: groups.get("medical_notes") ?? [],
      classified_documents: groups.get("classified_documents") ?? [],
      security_scenes: groups.get("security_scenes") ?? [],
      saudi_names: groups.get("saudi_names") ?? [],
      commercial_entities: groups.get("commercial_entities") ?? [],
    },
  };
}

function compareCanonicalItemsStable(
  a: {
    canonical_finding_id: string;
    severity: string;
    confidence: number;
    start_offset_global?: number | null;
    end_offset_global?: number | null;
    primary_article_id?: number | null;
    evidence_snippet?: string;
    title_ar?: string;
  },
  b: {
    canonical_finding_id: string;
    severity: string;
    confidence: number;
    start_offset_global?: number | null;
    end_offset_global?: number | null;
    primary_article_id?: number | null;
    evidence_snippet?: string;
    title_ar?: string;
  }
): number {
  return (
    (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) ||
    (b.confidence - a.confidence) ||
    (a.start_offset_global ?? Number.MAX_SAFE_INTEGER) - (b.start_offset_global ?? Number.MAX_SAFE_INTEGER) ||
    (a.end_offset_global ?? Number.MAX_SAFE_INTEGER) - (b.end_offset_global ?? Number.MAX_SAFE_INTEGER) ||
    (a.primary_article_id ?? Number.MAX_SAFE_INTEGER) - (b.primary_article_id ?? Number.MAX_SAFE_INTEGER) ||
    String(a.evidence_snippet ?? "").localeCompare(String(b.evidence_snippet ?? ""), "ar") ||
    String(a.title_ar ?? "").localeCompare(String(b.title_ar ?? ""), "ar") ||
    String(a.canonical_finding_id).localeCompare(String(b.canonical_finding_id), "ar")
  );
}

/** Detect rationale that is only "المقتطف يخالف ضوابط المادة X" + excerpt (no real explanation). */
function isSnippetOnlyRationale(rationale: string | null | undefined, evidenceSnippet: string | null | undefined): boolean {
  if (!rationale || rationale.trim() === "") return false;
  const r = rationale.trim();
  if (!/المقتطف يخالف ضوابط/.test(r)) return false;
  const hasGuillemets = /«/.test(r) && /»/.test(r);
  const snippetLen = (evidenceSnippet || "").trim().length;
  const afterPhrase = r.replace(/^.*?المقتطف يخالف ضوابط[^.]*\.?\s*/, "").trim();
  const isMostlySnippet = snippetLen > 20 && afterPhrase.length <= snippetLen + 30;
  return hasGuillemets && (r.length < 180 || isMostlySnippet);
}

const BROAD_ARTICLES = new Set([4, 5]);

function compareDbFindingStable(a: DbFinding, b: DbFinding): number {
  return (
    (a.start_offset_global ?? Number.MAX_SAFE_INTEGER) - (b.start_offset_global ?? Number.MAX_SAFE_INTEGER) ||
    (a.end_offset_global ?? Number.MAX_SAFE_INTEGER) - (b.end_offset_global ?? Number.MAX_SAFE_INTEGER) ||
    (a.article_id ?? 0) - (b.article_id ?? 0) ||
    String(a.atom_id ?? "").localeCompare(String(b.atom_id ?? ""), "ar") ||
    String(a.evidence_snippet ?? "").localeCompare(String(b.evidence_snippet ?? ""), "ar") ||
    String(a.title_ar ?? "").localeCompare(String(b.title_ar ?? ""), "ar") ||
    String(a.source ?? "").localeCompare(String(b.source ?? ""), "ar")
  );
}

function getFindingV3(f: DbFinding): Record<string, unknown> {
  const locationObj = ((f.location as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  return ((locationObj.v3 as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
}

function getStoredCanonicalId(f: DbFinding): string | null {
  const raw = getFindingV3(f).canonical_finding_id;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/** Options controlling how findings are grouped into canonical report cards. */
export type AnalysisSummaryOptions = {
  mergeStrategy?: "same_location_only" | "every_occurrence";
};

/** Overlap ratio for "same location": only merge findings that refer to nearly the same span (one card per location, multiple articles). */
const OVERLAP_SAME_LOCATION = 0.85;
/** Overlap ratio for "every occurrence": only merge when spans are effectively identical (one card per finding in practice). */
const OVERLAP_EVERY_OCCURRENCE = 1;

export function buildSummaryJson(
  jobId: string,
  scriptId: string,
  findings: DbFinding[],
  clientName?: string,
  scriptTitle?: string,
  analysisOptions?: AnalysisSummaryOptions | null,
  jobConfigMeta?: JobConfigMeta | null,
  notes: DbNote[] = [],
): SummaryJson {
  const generated_at = new Date().toISOString();
  const filtered = findings.filter((f) => f.article_id !== OUT_OF_SCOPE_ARTICLE_ID);
  const sortedFindings = [...filtered].sort(compareDbFindingStable);
  logger.info("[DEBUG] Aggregation input summary", {
    jobId,
    rawFindings: findings.length,
    filteredFindings: filtered.length,
    dedupedFindings: sortedFindings.length,
    mergeStrategy: analysisOptions?.mergeStrategy ?? "default",
  });
  const policyArticles = getPolicyArticles();

  const severityOrder = (s: string) => (SEVERITIES.indexOf(s as (typeof SEVERITIES)[number]) + 1) || 0;
  const canonical_findings: NonNullable<SummaryJson["canonical_findings"]> = sortedFindings.map((finding, index) => {
    const v3 = getFindingV3(finding);
    const articleId = finding.article_id;
    const canonicalFindingId =
      (finding.finding_uuid ?? null) ||
      (finding.lineage_id ?? null) ||
      sha256(
        [
          "finding",
          articleId,
          finding.start_offset_global ?? "",
          finding.end_offset_global ?? "",
          finding.page_number ?? "",
          finding.title_ar ?? "",
          finding.evidence_snippet ?? "",
          index,
        ].join("|")
      );
    const primaryPolicyAtomId = (() => {
      const atom = normalizeAtomId(finding.atom_id, articleId);
      return atom && String(atom).trim() !== "" ? String(atom) : null;
    })();
    const rawRationale = (finding.rationale_ar != null && finding.rationale_ar.trim() !== "")
      ? finding.rationale_ar
      : ((v3.rationale_ar as string | undefined) != null && String(v3.rationale_ar).trim() !== "")
        ? String(v3.rationale_ar)
        : RATIONALE_FALLBACK;
    return {
      canonical_finding_id: canonicalFindingId,
      finding_uuid: finding.finding_uuid ?? finding.lineage_id ?? null,
      title_ar: finding.title_ar,
      evidence_snippet: finding.evidence_snippet,
      severity: finding.severity,
      confidence: finding.confidence ?? 0,
      final_ruling: (v3.final_ruling as string | undefined) ?? null,
      rationale: isSnippetOnlyRationale(rawRationale, finding.evidence_snippet) ? RATIONALE_FALLBACK : rawRationale,
      pillar_id: (v3.pillar_id as string | undefined) ?? null,
      primary_article_id: articleId,
      related_article_ids: [],
      policy_links: [{ article_id: articleId, role: "primary" }],
      start_offset_global: finding.start_offset_global ?? null,
      end_offset_global: finding.end_offset_global ?? null,
      start_line_chunk: finding.start_line_chunk ?? null,
      end_line_chunk: finding.end_line_chunk ?? null,
      page_number: finding.page_number ?? null,
      primary_policy_atom_id: primaryPolicyAtomId,
      canonical_atom: finding.canonical_atom ?? null,
      intensity: finding.intensity ?? null,
      context_impact: finding.context_impact ?? null,
      legal_sensitivity: finding.legal_sensitivity ?? null,
      audience_risk: finding.audience_risk ?? null,
      source:
        finding.source === "lexicon_mandatory"
          ? "lexicon_mandatory"
          : finding.source === "manual"
            ? "manual"
            : "ai",
    };
  });
  const report_hints: SummaryJson["report_hints"] = [];
  const noteSummary = buildNoteSummary(jobId, notes);
  if (config.DEBUG_TRACE_FINDING_PIPELINE) {
    traceFindingPipelineStage({
      jobId,
      chunkId: jobId,
      stageName: "Aggregation Input",
      functionName: "buildSummaryJson input",
      stageChunkIndex: null,
      snapshots: canonical_findings.slice(0, 5).map((finding) => ({
        traceId: finding.finding_uuid ?? "",
        findingUuid: finding.finding_uuid ?? null,
        reviewerArticleId: finding.primary_article_id ?? null,
        passName: null,
        eventId: null,
        pageNumber: finding.page_number ?? null,
        title_ar: finding.title_ar,
        description_ar: null,
        rationale_ar: finding.rationale ?? null,
        canonical_atom: finding.canonical_atom ?? null,
        article_id: finding.primary_article_id ?? null,
        claimedArticleId: finding.primary_article_id ?? null,
        severity: finding.severity,
        confidence: finding.confidence,
        evidence_snippet: finding.evidence_snippet,
        quote: finding.evidence_snippet,
        start_offset: finding.start_offset_global ?? null,
        end_offset: finding.end_offset_global ?? null,
        canonicalFindingId: finding.canonical_finding_id,
      })),
    });
  }
  logNotePipelineStage({
    jobId,
    chunkId: null,
    stageLabel: "summary.notes",
    actionLabel: "Aggregated",
    noteCounts: countNoteCategoriesFromSummary(noteSummary.notes),
  });
  logger.info("[DEBUG] Aggregation canonicalization complete", {
    jobId,
    canonicalFindingCount: canonical_findings.length,
    noteCount: notes.length,
    reportHintCount: report_hints.length,
  });

  // Severity counts from persisted findings, grouped only by article in the report.
  const severity_counts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of canonical_findings) {
    if (SEVERITIES.includes(f.severity as (typeof SEVERITIES)[number])) {
      severity_counts[f.severity as keyof typeof severity_counts]++;
    }
  }

  // findings_by_article: direct projection from persisted findings, grouped by article only.
  const findingsByArticle = new Map<number, NonNullable<SummaryJson["canonical_findings"]>>();
  for (const f of canonical_findings) {
    const aid = f.primary_article_id ?? 0;
    if (aid === 0 || aid === OUT_OF_SCOPE_ARTICLE_ID) continue;
    if (!findingsByArticle.has(aid)) findingsByArticle.set(aid, []);
    findingsByArticle.get(aid)!.push(f);
  }

  const findings_by_article = policyArticles
    .filter((a) => a.articleId !== OUT_OF_SCOPE_ARTICLE_ID)
    .map((art) => {
      const list = findingsByArticle.get(art.articleId) ?? [];
      const counts = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const f of list) {
        if (SEVERITIES.includes(f.severity as (typeof SEVERITIES)[number])) {
          counts[f.severity as keyof typeof counts]++;
        }
      }
      const sorted = [...list].sort(compareCanonicalItemsStable);
      const top_findings = sorted.slice(0, 10).map((f) => ({
        atom_id: null as string | null,
        finding_uuid: f.finding_uuid ?? null,
        page_number: f.page_number ?? null,
        title_ar: f.title_ar,
        severity: f.severity,
        confidence: f.confidence,
        evidence_snippet: f.evidence_snippet,
        location: {
          v3: {
            primary_article_id: f.primary_article_id,
            related_article_ids: f.related_article_ids,
            canonical_finding_id: f.canonical_finding_id,
            pillar_id: f.pillar_id,
            rationale: f.rationale,
            final_ruling: f.final_ruling,
            policy_links: f.policy_links,
          },
        } as Record<string, unknown>,
        start_offset_global: f.start_offset_global,
        end_offset_global: f.end_offset_global,
        start_line_chunk: f.start_line_chunk,
        end_line_chunk: f.end_line_chunk,
        rationale: f.rationale ?? RATIONALE_FALLBACK,
        final_ruling: f.final_ruling ?? null,
        pillar_id: f.pillar_id ?? null,
        primary_article_id: f.primary_article_id ?? null,
        related_article_ids: f.related_article_ids ?? [],
        canonical_finding_id: f.canonical_finding_id,
        policy_links: f.policy_links ?? [],
      }));
      return {
        article_id: art.articleId,
        title_ar: art.title_ar,
        counts,
        triggered_atoms: [] as string[],
        top_findings,
      };
    })
    .filter((entry) => entry.top_findings.length > 0);

  if (config.DEBUG_TRACE_FINDING_PIPELINE) {
    traceFindingPipelineStage({
      jobId,
      chunkId: jobId,
      stageName: "Aggregation Output",
      functionName: "buildSummaryJson canonical_findings",
      stageChunkIndex: null,
      snapshots: canonical_findings.slice(0, 5).map((finding) => ({
        traceId: finding.finding_uuid ?? "",
        findingUuid: finding.finding_uuid ?? null,
        reviewerArticleId: finding.primary_article_id ?? null,
        passName: null,
        eventId: null,
        pageNumber: finding.page_number ?? null,
        title_ar: finding.title_ar,
        description_ar: null,
        rationale_ar: finding.rationale ?? null,
        canonical_atom: finding.canonical_atom ?? null,
        article_id: finding.primary_article_id ?? null,
        claimedArticleId: finding.primary_article_id ?? null,
        severity: finding.severity,
        confidence: finding.confidence,
        evidence_snippet: finding.evidence_snippet,
        quote: finding.evidence_snippet,
        start_offset: finding.start_offset_global ?? null,
        end_offset: finding.end_offset_global ?? null,
        canonicalFindingId: finding.canonical_finding_id,
      })),
    });
    traceFindingPipelineStage({
      jobId,
      chunkId: jobId,
      stageName: "Summary JSON",
      functionName: "buildSummaryJson findings_by_article",
      stageChunkIndex: null,
      snapshots: findings_by_article.flatMap((article) =>
        article.top_findings.slice(0, 5).map((finding) => ({
          traceId: finding.finding_uuid ?? "",
          findingUuid: finding.finding_uuid ?? null,
          reviewerArticleId: article.article_id,
          passName: null,
          eventId: null,
          pageNumber: finding.page_number ?? null,
          title_ar: finding.title_ar,
          description_ar: null,
          rationale_ar: finding.rationale ?? null,
          canonical_atom: null,
          article_id: article.article_id,
          claimedArticleId: article.article_id,
          severity: finding.severity,
          confidence: finding.confidence,
          evidence_snippet: finding.evidence_snippet,
          quote: finding.evidence_snippet,
          start_offset: finding.start_offset_global ?? null,
          end_offset: finding.end_offset_global ?? null,
          canonicalFindingId: finding.canonical_finding_id ?? null,
        })),
      ),
    });
  }

  const checklist_articles = policyArticles
    .filter((a) => a.articleId !== OUT_OF_SCOPE_ARTICLE_ID)
    .map((art) => {
      const list = findingsByArticle.get(art.articleId) ?? [];
      const counts = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const f of list) {
        if (SEVERITIES.includes(f.severity as (typeof SEVERITIES)[number])) {
          counts[f.severity as keyof typeof counts]++;
        }
      }
      const total = list.length;
      const hasCritical = counts.critical > 0;
      const hasHigh = counts.high > 0;
      const hasMedium = counts.medium > 0;
      const hasLow = counts.low > 0;
      let status: "ok" | "not_scanned" | "warning" | "fail" = "ok";
      if (total === 0) status = "ok";
      else if (hasCritical || hasHigh) status = "fail";
      else if (hasMedium || hasLow) status = "warning";
      return {
        article_id: art.articleId,
        title_ar: art.title_ar,
        status,
        counts,
        triggered_atoms: [] as string[],
      };
    });

  const context_ok_count = canonical_findings.filter((f) => f.final_ruling === "context_ok").length;
  const needs_review_count = canonical_findings.filter((f) => f.final_ruling === "needs_review").length;
  const violation_count = canonical_findings.filter((f) => f.final_ruling === "violation").length;

  // findings_by_canonical_atom: group by canonical_atom for auditor overview.
  const byCanonicalAtom = new Map<string, typeof canonical_findings>();
  for (const f of canonical_findings) {
    const atom = (f as { canonical_atom?: string | null }).canonical_atom ?? "UNKNOWN";
    if (!byCanonicalAtom.has(atom)) byCanonicalAtom.set(atom, []);
    byCanonicalAtom.get(atom)!.push(f);
  }
  const findings_by_canonical_atom: SummaryJson["findings_by_canonical_atom"] = [...byCanonicalAtom.entries()]
    .map(([canonical_atom, list]) => {
      const counts = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const f of list) {
        if (SEVERITIES.includes(f.severity as (typeof SEVERITIES)[number])) {
          counts[f.severity as keyof typeof counts]++;
        }
      }
      const sorted = [...list].sort(compareCanonicalItemsStable);
      const top_findings = sorted.slice(0, 5).map((f) => ({
        finding_uuid: f.finding_uuid ?? null,
        page_number: f.page_number ?? null,
        canonical_finding_id: f.canonical_finding_id,
        title_ar: f.title_ar,
        severity: f.severity,
        evidence_snippet: f.evidence_snippet,
      }));
      return { canonical_atom, count: list.length, severity_counts: counts, top_findings };
    })
    .sort((a, b) => b.count - a.count || String(a.canonical_atom).localeCompare(String(b.canonical_atom), "ar"));

  return {
    job_id: jobId,
    script_id: scriptId,
    generated_at,
    analysis_meta: {
      auditor_layer_version: pickAuditorLayerVersion(jobConfigMeta?.auditor_layer_version ?? config.AUDITOR_LAYER_VERSION),
      violation_system_version: pickViolationSystemVersion(jobConfigMeta?.violation_system_version ?? config.VIOLATION_SYSTEM_VERSION),
      analysis_engine: pickAnalysisEngine(jobConfigMeta?.analysis_engine ?? config.ANALYSIS_ENGINE),
      analysis_pipeline_version: pickPipelineVersion(jobConfigMeta?.pipeline_version ?? config.ANALYSIS_PIPELINE_VERSION),
      deep_auditor_enabled:
        typeof jobConfigMeta?.deep_auditor_enabled === "boolean"
          ? jobConfigMeta.deep_auditor_enabled
          : config.ANALYSIS_DEEP_AUDITOR,
      generated_by: "worker",
    },
    client_name: clientName,
    script_title: scriptTitle,
    totals: {
      findings_count: canonical_findings.length,
      severity_counts,
      type_counts: countFindingTypes(canonical_findings, 0),
      unique_incidents_count: canonical_findings.length,
    },
    context_metrics: {
      context_ok_count,
      needs_review_count,
      violation_count,
    },
    checklist_articles,
    findings_by_article,
    canonical_findings,
    findings_by_canonical_atom,
    report_hints,
    notes_summary: noteSummary.notes_summary,
    notes: noteSummary.notes,
  };
}

export function buildReportHtml(summary: SummaryJson): string {
  const s = summary;
  const typeCounts = s.totals.type_counts ?? { ai: 0, manual: 0, glossary: 0, special: (s.report_hints?.length ?? 0) };
  const typeRow = (label: string, count: number) =>
    `<tr><td>${label}</td><td>${count}</td></tr>`;
  const typeTable = `
    <table border="1" cellpadding="4"><tbody>
      ${typeRow("ملاحظات آلية", typeCounts.ai)}
      ${typeRow("ملاحظات يدوية", typeCounts.manual)}
      ${typeRow("مطابقات القاموس", typeCounts.glossary)}
      ${typeRow("ملاحظات خاصة", typeCounts.special)}
    </tbody></table>`;

  const checklistRows = s.checklist_articles
    .filter((c) => c.counts.low + c.counts.medium + c.counts.high + c.counts.critical > 0)
    .map(
      (c) =>
        `<tr><td>${c.article_id}</td><td>${c.title_ar}</td><td>${c.status}</td><td>${c.counts.low}</td><td>${c.counts.medium}</td><td>${c.counts.high}</td><td>${c.counts.critical}</td></tr>`
    )
    .join("");

  const canonicalAtomSummaryHtml =
    (s.findings_by_canonical_atom?.length ?? 0) > 0
      ? `
  <section>
    <h2>ملخص حسب نوع المخالفة (Canonical Atom)</h2>
    <p>عدد الحوادث حسب التصنيف الموحد:</p>
    <ul>
    ${(s.findings_by_canonical_atom ?? [])
      .map(
        (a) =>
          `<li><strong>${a.canonical_atom}</strong>: ${a.count} (منخفضة: ${a.severity_counts.low}, متوسطة: ${a.severity_counts.medium}, عالية: ${a.severity_counts.high}, حرجة: ${a.severity_counts.critical})</li>`
      )
      .join("")}
    </ul>
  </section>`
      : "";

  if (config.DEBUG_TRACE_FINDING_PIPELINE) {
    traceFindingPipelineStage({
      jobId: s.job_id,
      chunkId: s.job_id,
      stageName: "Report generation",
      functionName: "buildReportHtml",
      reportRenderedCount: s.findings_by_article.reduce((sum, article) => sum + article.top_findings.length, 0),
      snapshots: s.findings_by_article.flatMap((article) =>
        article.top_findings.slice(0, 5).map((finding) => ({
          traceId: finding.finding_uuid ?? "",
          findingUuid: finding.finding_uuid ?? null,
          reviewerArticleId: article.article_id,
          passName: null,
          eventId: null,
          pageNumber: finding.page_number ?? null,
          title_ar: finding.title_ar,
          description_ar: null,
          rationale_ar: finding.rationale ?? null,
          canonical_atom: null,
          article_id: article.article_id,
          claimedArticleId: article.article_id,
          severity: finding.severity,
          confidence: finding.confidence,
          evidence_snippet: finding.evidence_snippet,
          quote: finding.evidence_snippet,
          start_offset: finding.start_offset_global ?? null,
          end_offset: finding.end_offset_global ?? null,
          canonicalFindingId: finding.canonical_finding_id ?? null,
        })),
      ),
    });
  }

  let detailsHtml = "";
  for (const art of s.findings_by_article) {
    detailsHtml += `<h3>المادة ${art.article_id}: ${art.title_ar}</h3>`;
    for (const f of art.top_findings) {
      detailsHtml += `
        <div style="margin:1em 0; padding:0.5em; border:1px solid #ccc;">
          <strong>${f.title_ar}</strong> (ملاحظة، ثقة: ${f.confidence})<br/>
          <em>الدليل:</em> "${f.evidence_snippet}"
        </div>`;
    }
  }

  const hintsHtml =
    (s.report_hints?.length ?? 0) > 0
      ? `
  <section>
    <h2>ملاحظات خاصة</h2>
    <p>هذه النقاط ليست مخالفات؛ يُنصح بمراعاتها عند التصوير (مثلاً ضوابط المظهر العام والقيم الإسلامية).</p>
    ${(s.report_hints ?? [])
      .map(
        (f) => `
    <div style="margin:1em 0; padding:0.5em; border:1px solid #7dd3fc; background:#f0f9ff;">
      <strong>ملاحظة</strong> (ثقة: ${f.confidence})<br/>
      <em>النص:</em> "${f.evidence_snippet}"<br/>
      <em>لماذا ليست مخالفة:</em> ${f.rationale ?? "—"}
    </div>`
      )
      .join("")}
  </section>`
      : "";

  const notesHtml =
    (s.notes_summary?.length ?? 0) > 0
      ? `
  <section>
    <h2>٥ الملاحظات</h2>
    <p>هذه الملاحظات مستقلة عن المخالفات وتُعرض حسب الفئة فقط.</p>
    ${(s.notes_summary ?? [])
      .map(
        (group) => `
    <div style="margin:1em 0; padding:0.75em; border:1px solid #d8b4fe; background:#faf5ff;">
      <h3>${NOTE_CATEGORY_LABELS[group.category as keyof NonNullable<SummaryJson["notes"]>] ?? group.category}</h3>
      <p>عدد الملاحظات: ${group.count}</p>
      ${group.items
        .map(
          (note) => `
      <div style="margin:0.75em 0; padding:0.5em; border:1px solid #ddd; background:#fff;">
        <strong>${note.title}</strong> (المراجع: ${note.reviewer ?? "—"}, الثقة: ${note.confidence})<br/>
        <em>الوصف:</em> ${note.description}<br/>
        <em>الفقرة:</em> "${note.snippet}"
      </div>`
        )
        .join("")}
    </div>`
      )
      .join("")}
  </section>`
      : "";

  const revisitHtml =
    (s.words_to_revisit?.length ?? 0) > 0
      ? `
  <section>
    <h2>كلمات / عبارات للمراجعة</h2>
    <p>ظهور الكلمات أو العبارات التالية في النص (للمراجعة عند التصوير — لا تُحسب مخالفات).</p>
    ${(s.words_to_revisit ?? [])
      .map(
        (m) => `
    <div style="margin:0.5em 0; padding:0.5em; border:1px solid #e5e7eb; background:#f9fafb;">
      <strong>${m.term}</strong><br/>
      <em>مقتطف:</em> "${m.snippet}"
    </div>`
      )
      .join("")}
  </section>`
      : "";

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8"/><title>تقرير التحليل</title></head>
<body>
  <h1>تقرير تحليل المحتوى (GCAM)</h1>
  <section>
    <h2>١ بيانات عامة</h2>
    <p>معرف المهمة: ${s.job_id}</p>
    <p>معرف السيناريو: ${s.script_id}</p>
    <p>وقت التوليد: ${s.generated_at}</p>
  </section>
  <section>
    <h2>٢ ملخص تنفيذي</h2>
    <p>إجمالي المخالفات: ${s.totals.findings_count}</p>
    ${typeTable}
  </section>
  <section>
    <h2>٣ مصفوفة الالتزام</h2>
    <table border="1" cellpadding="4">
      <thead><tr><th>المادة</th><th>العنوان</th><th>الحالة</th><th>منخفضة</th><th>متوسطة</th><th>عالية</th><th>حرجة</th></tr></thead>
      <tbody>${checklistRows}</tbody>
    </table>
  </section>
  ${canonicalAtomSummaryHtml}
  <section>
    <h2>٤ النتائج التفصيلية</h2>
    ${detailsHtml}
  </section>
  ${hintsHtml}
  ${notesHtml}
  ${revisitHtml}
</body>
</html>`;
}

/**
 * If no pending/judging chunks for job: load findings, build summary + report, upsert analysis_reports, set job completed.
 */
export async function runAggregation(jobId: string): Promise<void> {
  const aggregationStartedAt = Date.now();
  const { data: jobControl } = await supabase
    .from("analysis_jobs")
    .select("partial_finalize_requested")
    .eq("id", jobId)
    .maybeSingle();
  const isPartialFinalize = Boolean((jobControl as { partial_finalize_requested?: boolean | null } | null)?.partial_finalize_requested);
  const hasActive = isPartialFinalize
    ? await jobHasInFlightChunks(jobId)
    : await jobHasActiveChunks(jobId);
  if (hasActive) return;

  const { data: job } = await supabase
    .from("analysis_jobs")
    .select(`
      script_id, 
      version_id, 
      created_by,
      partial_finalize_requested,
      partial_finalize_requested_at,
      normalized_text,
      progress_total,
      config_snapshot,
      scripts (
        title,
        clients (
          name_ar,
          name_en
        )
      )
    `)
    .eq("id", jobId)
    .single();

  if (!job) {
    logger.warn("runAggregation: job not found", { jobId });
    return;
  }

  const scriptData = (job as any).scripts;
  const clientName = scriptData?.clients?.name_ar || scriptData?.clients?.name_en;
  const scriptTitle = scriptData?.title;

  const finalizeRevisionCycleReanalysis = async (reportId: string | null): Promise<void> => {
    if (!reportId) return;
    const scriptId = (job as { script_id: string }).script_id;
    const { data: linkedCycle } = await supabase
      .from("script_revision_cycles")
      .select("id, status, source_report_id")
      .eq("script_id", scriptId)
      .eq("reanalyzed_job_id", jobId)
      .order("cycle_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!linkedCycle) return;

    const nextStatus = String((linkedCycle as { status?: string | null }).status ?? "").toLowerCase() === "closed"
      ? "closed"
      : "reanalyzed";
    const reanalyzedAt = new Date().toISOString();
    const { error: cycleUpdateErr } = await supabase
      .from("script_revision_cycles")
      .update({
        status: nextStatus,
        reanalyzed_report_id: reportId,
        reanalyzed_at: reanalyzedAt,
        updated_at: reanalyzedAt,
      })
      .eq("id", (linkedCycle as { id: string }).id);
    if (cycleUpdateErr) {
      logger.warn("Failed to update revision cycle with reanalysis result", {
        jobId,
        reportId,
        error: cycleUpdateErr.message,
      });
      return;
    }

    const { error: cycleEventErr } = await supabase
      .from("script_revision_cycle_events")
      .insert({
        cycle_id: (linkedCycle as { id: string }).id,
        script_id: scriptId,
        event_type: "admin_reanalysis_completed",
        actor_user_id: (job as { created_by?: string | null }).created_by ?? null,
        payload: {
          job_id: jobId,
          report_id: reportId,
        },
        created_at: reanalyzedAt,
      });
    if (cycleEventErr) {
      logger.warn("Failed to write admin_reanalysis_completed event", {
        jobId,
        reportId,
        error: cycleEventErr.message,
      });
    }

    const sourceReportId = (linkedCycle as { source_report_id?: string | null }).source_report_id ?? null;
    if (sourceReportId) {
      const { data: snapshotRow } = await supabase
        .from("script_revision_cycle_snapshots")
        .select("snapshot_payload, findings_total, severity_counts")
        .eq("cycle_id", (linkedCycle as { id: string }).id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: newReportRow } = await supabase
        .from("analysis_reports")
        .select("summary_json, findings_count, severity_counts")
        .eq("id", reportId)
        .maybeSingle();

      const oldSummary = ((snapshotRow as { snapshot_payload?: Record<string, unknown> | null } | null)?.snapshot_payload ?? {}) as Record<string, unknown>;
      const newSummary = ((newReportRow as { summary_json?: Record<string, unknown> | null } | null)?.summary_json ?? {}) as Record<string, unknown>;
      const oldCanonical = Array.isArray((oldSummary as any).canonical_findings) ? ((oldSummary as any).canonical_findings as any[]) : [];
      const newCanonical = Array.isArray((newSummary as any).canonical_findings) ? ((newSummary as any).canonical_findings as any[]) : [];
      const canonicalKey = (row: any): string => {
        const canonicalId = typeof row?.canonical_finding_id === "string" ? row.canonical_finding_id.trim() : "";
        if (canonicalId) return `cid:${canonicalId}`;
        const primary = Number(row?.primary_article_id ?? row?.article_id ?? 0) || 0;
        const atom = typeof row?.canonical_atom === "string" && row.canonical_atom.trim()
          ? row.canonical_atom.trim()
          : (typeof row?.atom_id === "string" ? row.atom_id.trim() : "");
        const title = typeof row?.title_ar === "string" ? row.title_ar.trim() : "";
        const evidence = typeof row?.evidence_snippet === "string" ? row.evidence_snippet.trim().slice(0, 180) : "";
        return `${primary}|${atom}|${title}|${evidence}`;
      };
      const oldKeys = new Set(oldCanonical.map(canonicalKey).filter(Boolean));
      const newKeys = new Set(newCanonical.map(canonicalKey).filter(Boolean));
      let persisting = 0;
      for (const key of oldKeys) if (newKeys.has(key)) persisting++;
      let resolved = 0;
      for (const key of oldKeys) if (!newKeys.has(key)) resolved++;
      let newlyIntroduced = 0;
      for (const key of newKeys) if (!oldKeys.has(key)) newlyIntroduced++;

      const baselineFindings = Number(
        (snapshotRow as { findings_total?: number } | null)?.findings_total
          ?? (oldSummary as any)?.totals?.findings_count
          ?? 0
      ) || 0;
      const reanalyzedFindings = Number((newReportRow as { findings_count?: number } | null)?.findings_count ?? 0) || 0;
      const oldSeverity = ((snapshotRow as { severity_counts?: Record<string, number> } | null)?.severity_counts ?? {}) as Record<string, number>;
      const newSeverity = ((newReportRow as { severity_counts?: Record<string, number> } | null)?.severity_counts ?? {}) as Record<string, number>;

      const comparisonSummary = {
        baseline_findings: baselineFindings,
        reanalyzed_findings: reanalyzedFindings,
        findings_delta: reanalyzedFindings - baselineFindings,
        canonical: {
          baseline_count: oldKeys.size,
          reanalyzed_count: newKeys.size,
          persisting_count: persisting,
          resolved_count: resolved,
          new_count: newlyIntroduced,
        },
        severity_delta: {
          low: Number(newSeverity.low ?? 0) - Number(oldSeverity.low ?? 0),
          medium: Number(newSeverity.medium ?? 0) - Number(oldSeverity.medium ?? 0),
          high: Number(newSeverity.high ?? 0) - Number(oldSeverity.high ?? 0),
          critical: Number(newSeverity.critical ?? 0) - Number(oldSeverity.critical ?? 0),
        },
      };

      const { error: deleteComparisonErr } = await supabase
        .from("script_revision_cycle_comparisons")
        .delete()
        .eq("cycle_id", (linkedCycle as { id: string }).id)
        .eq("new_report_id", reportId);
      if (deleteComparisonErr) {
        logger.warn("Failed to clear previous script revision comparison row", {
          jobId,
          reportId,
          cycleId: (linkedCycle as { id: string }).id,
          error: deleteComparisonErr.message,
        });
      }

      const { error: comparisonErr } = await supabase
        .from("script_revision_cycle_comparisons")
        .insert({
          cycle_id: (linkedCycle as { id: string }).id,
          script_id: scriptId,
          old_report_id: sourceReportId,
          new_report_id: reportId,
          comparison_summary: comparisonSummary,
          comparison_payload: {
            baseline_severity_counts: oldSeverity,
            reanalyzed_severity_counts: newSeverity,
            generated_at: reanalyzedAt,
          },
        });
      if (comparisonErr) {
        logger.warn("Failed to persist script revision comparison", {
          jobId,
          reportId,
          cycleId: (linkedCycle as { id: string }).id,
          error: comparisonErr.message,
        });
      }
    }
  };

  const { data: existing } = await supabase
    .from("analysis_reports")
    .select("id")
    .eq("job_id", jobId)
    .single();
  if (existing) {
    await finalizeRevisionCycleReanalysis((existing as { id?: string } | null)?.id ?? null);
    await supabase
      .from("analysis_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", jobId);
    const { logAuditEvent } = await import("./audit.js");
    const j = job as { script_id: string; created_by?: string | null };
    logAuditEvent(supabase, {
      event_type: "ANALYSIS_COMPLETED",
      target_type: "task",
      target_id: jobId,
      target_label: j.script_id,
      actor_user_id: j.created_by ?? null,
    }).catch(() => { });
    logger.info("Report already exists, job marked completed", { jobId });
    clearCachedJobResources(jobId);
    return;
  }

  const { data: findings, error: findingsErr } = await supabase
    .from("analysis_findings")
    .select(
      "source, article_id, atom_id, severity, confidence, title_ar, description_ar, evidence_snippet, start_offset_global, end_offset_global, start_line_chunk, end_line_chunk, page_number, location, rationale_ar, canonical_atom, intensity, context_impact, legal_sensitivity, audience_risk, finding_uuid, lineage_id, parent_lineage_id, evidence_hash, canonical_hash"
    )
    .eq("job_id", jobId);

  if (findingsErr) {
    logger.error("Aggregation: failed to load findings", { jobId, error: findingsErr });
  }

  const { data: notes, error: notesErr } = await supabase
    .from("analysis_notes")
    .select("id, reviewer, category, title, description, snippet, event_id, confidence, status, included_in_report, reviewer_comment, reviewed_at, updated_at, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  if (notesErr) {
    logger.warn("Aggregation: failed to load notes", { jobId, error: notesErr });
  }

  const list = (findings ?? []) as DbFinding[];
  const noteList = (notes ?? []) as DbNote[];
  await persistLineageEvents(
    list.map((finding) =>
      buildLineageEvent(finding, {
        jobId,
        chunkId: null,
        stageName: "aggregation",
        passName: null,
      })
    )
  );
  logger.info("Aggregation findings loaded", {
    jobId,
    findingsLoaded: list.length,
    notesLoaded: noteList.length,
    severityBreakdown: {
      low: list.filter(f => f.severity === "low").length,
      medium: list.filter(f => f.severity === "medium").length,
      high: list.filter(f => f.severity === "high").length,
      critical: list.filter(f => f.severity === "critical").length,
    },
    queryError: findingsErr ?? null,
  });
  if (config.DEBUG_TRACE_FINDING_PIPELINE) {
    traceFindingPipelineStage({
      jobId,
      chunkId: jobId,
      stageName: "Database Read",
      functionName: "analysis_findings load",
      stageChunkIndex: null,
      snapshots: list.slice(0, 5).map((row) =>
        buildTraceSnapshotFromRow(row, {
          stage: "Database Read",
          reviewerArticleId: row.article_id ?? null,
          passName: null,
        })
      ),
    });
  }

  const { data: pageMetaRows } = await supabase
    .from("script_pages")
    .select("page_number, meta")
    .eq("version_id", job.version_id)
    .order("page_number", { ascending: true });

  const fullScriptText = ((job as { normalized_text?: string | null }).normalized_text ?? "").trim();

  const rawAnalysisOptions = (job as { config_snapshot?: { analysisOptions?: { mergeStrategy?: string } } }).config_snapshot?.analysisOptions;
  let analysisOptions: AnalysisSummaryOptions | undefined;
  if (rawAnalysisOptions?.mergeStrategy === "same_location_only") {
    analysisOptions = { mergeStrategy: "same_location_only" };
  } else if (rawAnalysisOptions?.mergeStrategy === "every_occurrence") {
    analysisOptions = { mergeStrategy: "every_occurrence" };
  }
  const summary = buildSummaryJson(
    jobId,
      job.script_id,
      list,
      clientName,
      scriptTitle,
      analysisOptions,
      {
        analysis_engine: (job.config_snapshot as { analysis_engine?: string } | null)?.analysis_engine,
        pipeline_version: (job.config_snapshot as { pipeline_version?: string } | null)?.pipeline_version,
        violation_system_version: (job.config_snapshot as { violation_system_version?: string } | null)?.violation_system_version,
        auditor_layer_version: (job.config_snapshot as { auditor_layer_version?: string } | null)?.auditor_layer_version,
        deep_auditor_enabled: (job.config_snapshot as { deep_auditor_enabled?: boolean } | null)?.deep_auditor_enabled,
      },
      noteList,
    );
  const totalChunks = Math.max(0, (((job as { progress_total?: number | null }).progress_total ?? 1) - 1));
  if ((job as { partial_finalize_requested?: boolean | null }).partial_finalize_requested) {
    const [doneChunks, pendingChunks, failedChunks] = await Promise.all([
      countChunksWithStatuses(jobId, ["done"]),
      countChunksWithStatuses(jobId, ["pending"]),
      countChunksWithStatuses(jobId, ["failed"]),
    ]);
    summary.partial_report = {
      is_partial: true,
      processed_chunks: doneChunks,
      total_chunks: totalChunks,
      pending_chunks: pendingChunks,
      failed_chunks: failedChunks,
      stopped_at: (job as { partial_finalize_requested_at?: string | null }).partial_finalize_requested_at ?? null,
    };
  }
  const manualReviewContext =
    ((job as {
      config_snapshot?: {
        manual_review_context?: SummaryJson["manual_review_context"];
      };
    }).config_snapshot?.manual_review_context) ?? null;
  if (manualReviewContext && (manualReviewContext.carried_forward_count ?? 0) > 0) {
    summary.manual_review_context = {
      carried_forward_count: manualReviewContext.carried_forward_count,
      source_job_ids: manualReviewContext.source_job_ids ?? [],
      items: manualReviewContext.items ?? [],
    };
  }
  const documentStructureHints = buildDocumentStructureHints((pageMetaRows ?? []) as ScriptPageMetaRow[]);
  if (documentStructureHints.length > 0) {
    summary.report_hints = [...(summary.report_hints ?? []), ...documentStructureHints];
  }
  const isPartialReport = Boolean(summary.partial_report?.is_partial);
  const largeJobSize = {
    textLength: fullScriptText.length,
    chunkCount: totalChunks,
  };
  if (fullScriptText.trim()) {
    if (isPartialReport) {
      logger.info("Skipping script summary and revisit pass for partial report finalization", {
        jobId,
        textLength: largeJobSize.textLength,
        chunkCount: largeJobSize.chunkCount,
      });
    } else if (shouldSkipScriptSummaryForJob(largeJobSize)) {
      logger.info("Script summary skipped for large job", {
        jobId,
        textLength: largeJobSize.textLength,
        chunkCount: largeJobSize.chunkCount,
        textThreshold: config.ANALYSIS_LARGE_JOB_TEXT_LENGTH_THRESHOLD,
        chunkThreshold: config.ANALYSIS_LARGE_JOB_CHUNK_THRESHOLD,
      });
    } else {
      const scriptSummary = await generateScriptSummary(fullScriptText, scriptTitle);
      if (scriptSummary) summary.script_summary = scriptSummary;
    }
    // Separate light pass: words to revisit (glossary terms that appear in script). Does not affect violations.
    if (isPartialReport) {
      // Skip revisit generation on partial reports to finish quickly after stop.
    } else if (shouldSkipRevisitForJob(largeJobSize)) {
      logger.info("Revisit pass skipped for large job", {
        jobId,
        textLength: largeJobSize.textLength,
        chunkCount: largeJobSize.chunkCount,
        textThreshold: config.ANALYSIS_LARGE_JOB_TEXT_LENGTH_THRESHOLD,
        chunkThreshold: config.ANALYSIS_LARGE_JOB_CHUNK_THRESHOLD,
      });
    } else {
      try {
        const { data: lexiconRows } = await supabase
          .from("slang_lexicon")
          .select("term")
          .eq("is_active", true);
        const terms = (lexiconRows ?? []).map((r: { term?: string }) => (r.term ?? "").trim()).filter(Boolean);
        if (terms.length > 0) {
          const mentions = await callRevisitSpotter(fullScriptText, terms);
          if (mentions.length > 0) summary.words_to_revisit = mentions;
        }
      } catch (e) {
        logger.warn("Revisit pass skipped or failed", { jobId, error: String(e) });
      }
    }
    const fragmentedMentions = findFragmentedArabicMentions(fullScriptText);
    if (fragmentedMentions.length > 0) {
      const existing = summary.words_to_revisit ?? [];
      const seen = new Set(existing.map((item) => `${item.start_offset}:${item.end_offset}:${item.term}`));
      for (const mention of fragmentedMentions) {
        const key = `${mention.start_offset}:${mention.end_offset}:${mention.term}`;
        if (!seen.has(key)) {
          existing.push(mention);
          seen.add(key);
        }
      }
      summary.words_to_revisit = existing.slice(0, 60);
    }
  }
  const reportHtml = buildReportHtml(summary);

  recordTelemetryFromSummary({
    jobId,
    stageName: "aggregation",
    inputCount: findings.length,
    summaryArticles: summary.findings_by_article ?? [],
    noteSummary: Object.fromEntries((summary.notes_summary ?? []).map((entry) => [entry.category, entry.count])),
  });

  logger.info("[DEBUG] Aggregation report payload ready", {
    jobId,
    findingsCount: summary.totals.findings_count,
    canonicalFindingCount: summary.canonical_findings?.length ?? 0,
    reportHintCount: summary.report_hints?.length ?? 0,
  });

  const reportRow: Record<string, unknown> = {
    job_id: jobId,
    script_id: job.script_id,
    version_id: job.version_id,
    summary_json: summary as unknown as Record<string, unknown>,
    report_html: reportHtml,
    findings_count: summary.totals.findings_count,
    severity_counts: summary.totals.severity_counts as unknown as Record<string, unknown>,
  };
  const j = job as { created_by?: string | null };
  if (j.created_by != null) reportRow.created_by = j.created_by;

  logger.info("Aggregation: report upsert starting", {
    jobId,
    reportRow,
  });

  let savedReport: unknown = null;
  let reportErr: unknown = null;
  let reportCount: number | null = null;
  try {
    const result = await supabase
      .from("analysis_reports")
      .upsert(reportRow, { onConflict: "job_id" })
      .select("id, review_status", { count: "exact" })
      .single();

    savedReport = result.data;
    reportErr = result.error;
    reportCount = result.count ?? null;
  } catch (upsertException) {
    logger.error("Aggregation: report upsert EXCEPTION", {
      jobId,
      error: upsertException,
      stack: upsertException instanceof Error ? upsertException.stack ?? null : null,
      name: upsertException instanceof Error ? upsertException.name ?? null : null,
      message: upsertException instanceof Error ? upsertException.message ?? null : null,
    });
    throw upsertException;
  }

  const reportId = (savedReport as { id?: string } | null)?.id ?? null;
  const reportStatus = (savedReport as { review_status?: string | null } | null)?.review_status ?? null;

  logger.info("Aggregation: report upsert completed", {
    jobId,
    data: savedReport,
    error: reportErr,
    count: reportCount,
    status: reportStatus,
    reportId,
  });

  if (reportErr) {
    logger.error("Aggregation: report upsert FAILED", {
      jobId,
      error: reportErr,
      count: reportCount,
      status: reportStatus,
      reportId,
    });
    throw new Error(`Aggregation report upsert failed: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`);
  }

  if (!savedReport || !reportId) {
    logger.error("Aggregation: report upsert returned no usable row", {
      jobId,
      reason: reportErr
        ? "upsert returned an error"
        : savedReport == null
          ? "upsert returned no data"
          : "upsert returned a row without an id",
      data: savedReport,
      error: reportErr,
      count: reportCount,
      status: reportStatus,
      reportId,
    });
    throw new Error("Aggregation report upsert returned no usable row");
  }

  recordTelemetryFromSummary({
    jobId,
    stageName: "report",
    inputCount: summary.findings_by_article?.reduce((total, article) => total + (article.top_findings?.length ?? 0), 0) ?? 0,
    summaryArticles: summary.findings_by_article ?? [],
    noteSummary: Object.fromEntries((summary.notes_summary ?? []).map((entry) => [entry.category, entry.count])),
  });
  if (config.DEBUG_TRACE_FINDING_PIPELINE) {
    traceFindingPipelineStage({
      jobId,
      chunkId: jobId,
      stageName: "Report",
      functionName: "buildSummaryJson report",
      stageChunkIndex: null,
      snapshots: summary.findings_by_article.flatMap((article) =>
        article.top_findings.slice(0, 5).map((finding) => ({
          traceId: finding.finding_uuid ?? "",
          findingUuid: finding.finding_uuid ?? null,
          reviewerArticleId: article.article_id,
          passName: null,
          eventId: null,
          pageNumber: finding.page_number ?? null,
          title_ar: finding.title_ar,
          description_ar: null,
          rationale_ar: finding.rationale ?? null,
          canonical_atom: null,
          article_id: article.article_id,
          claimedArticleId: article.article_id,
          severity: finding.severity,
          confidence: finding.confidence,
          evidence_snippet: finding.evidence_snippet,
          quote: finding.evidence_snippet,
          start_offset: finding.start_offset_global ?? null,
          end_offset: finding.end_offset_global ?? null,
          canonicalFindingId: finding.canonical_finding_id,
        }))
      ),
    });
  }

  if (reportId) {
    await persistLineageEvents(
      list.map((finding) =>
        buildLineageEvent(finding, {
          jobId,
          chunkId: null,
          stageName: "final_report",
          passName: null,
        })
      )
    );
    await materializeReviewFindings(reportId, summary, job.version_id, fullScriptText);
    await finalizeRevisionCycleReanalysis(reportId);
  }

  if (!isPartialReport) {
    // Increment progress for the aggregation step (+1 that was reserved)
    await incrementJobProgress(jobId);
  }

  // Mark completed. Partial reports preserve honest chunk progress instead of forcing 100%.
  const completedAt = new Date().toISOString();
  if (isPartialReport) {
    const processedChunks = summary.partial_report?.processed_chunks ?? 0;
    const totalProgress = Math.max(1, ((job as { progress_total?: number | null }).progress_total ?? 1));
    const progressPercent = Math.floor((100 * processedChunks) / totalProgress);
    await supabase
      .from("analysis_jobs")
      .update({
        status: "completed",
        completed_at: completedAt,
        progress_done: processedChunks,
        progress_percent: progressPercent,
        pause_requested: false,
        paused_at: null,
      })
      .eq("id", jobId);
  } else {
    const { data: jobFinal } = await supabase
      .from("analysis_jobs")
      .select("progress_total")
      .eq("id", jobId)
      .single();
    const total = jobFinal?.progress_total ?? 1;
    await supabase
      .from("analysis_jobs")
      .update({
        status: "completed",
        completed_at: completedAt,
        progress_done: total,
        progress_percent: 100,
      })
      .eq("id", jobId);
  }

  const { logAuditEvent } = await import("./audit.js");
  const jobRow = job as { script_id: string; created_by?: string | null };
  logAuditEvent(supabase, {
    event_type: "ANALYSIS_COMPLETED",
    target_type: "task",
    target_id: jobId,
    target_label: jobRow.script_id,
    actor_user_id: jobRow.created_by ?? null,
  }).catch(() => { });

  logger.info("Aggregation done", {
    jobId,
    isPartialReport,
    findings_count: list.length,
    findings_count_total: summary.totals.findings_count,
    severity_counts: summary.totals.severity_counts,
    reportError: reportErr ?? null,
    aggregationDurationMs: Date.now() - aggregationStartedAt,
    scriptSummarySource: fullScriptText.length > 0 ? "analysis_jobs.normalized_text" : "none",
  });
  traceFindingPipelineSummary(jobId, jobId);
  clearCachedJobResources(jobId);
  emitPipelineTelemetryBlock({ jobId });
}
