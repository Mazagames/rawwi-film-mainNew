import React from "react";
import { pdf } from "@react-pdf/renderer";
import { AnalysisSectionPdf } from "./Pdf";
import type { AnalysisFinding, AnalysisReviewFinding } from "@/api";
import type { NoteCategoryKey, ReportNote } from "@/api/models";
import type { ViewerPageSlice } from "@/utils/findingContext";
import { countNotesByCategory, logNotePipelineStage } from "@/utils/noteTelemetry";
import { buildPdfReportCollections } from "./pdfModel";

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface DownloadAnalysisPdfParams {
  isQuickAnalysis?: boolean;
  reportId?: string | null;
  jobId?: string | null;
  scriptTitle: string;
  clientName: string;
  createdAt: string;
  logoUrl?: string | null;
  findings?: AnalysisFinding[] | null;
  reviewFindings?: AnalysisReviewFinding[] | null;
  findingsByArticle?: Array<{ article_id: number; top_findings?: Array<{ title_ar?: string; severity?: string; confidence?: number; evidence_snippet?: string }> }> | null;
  canonicalFindings?: Array<{
    canonical_finding_id: string;
    title_ar: string;
    evidence_snippet: string;
    severity: string;
    confidence: number;
    rationale?: string | null;
    pillar_id?: string | null;
    primary_article_id?: number | null;
    related_article_ids?: number[];
    start_line_chunk?: number | null;
    end_line_chunk?: number | null;
    source?: string | null;
  }> | null;
  reportHints?: Array<{
    canonical_finding_id: string;
    title_ar: string;
    evidence_snippet: string;
    severity: string;
    confidence: number;
    rationale?: string | null;
    pillar_id?: string | null;
    primary_article_id?: number | null;
    related_article_ids?: number[];
    start_line_chunk?: number | null;
    end_line_chunk?: number | null;
  }> | null;
  notes?: Partial<Record<NoteCategoryKey, ReportNote[]>> | null;
  scriptSummary?: {
    synopsis_ar: string;
    key_risky_events_ar?: string;
    narrative_stance_ar?: string;
    compliance_posture_ar?: string;
    confidence: number;
  } | null;
  wordsToRevisit?: Array<{ term: string; snippet: string; start_offset: number; end_offset: number }> | null;
  viewerPages?: ViewerPageSlice[] | null;
  lang: "ar" | "en";
  dateFormat?: string;
}

export async function downloadAnalysisPdf(params: DownloadAnalysisPdfParams): Promise<void> {
  const origin = window.location.origin;
  logNotePipelineStage({
    stageLabel: "PDF",
    actionLabel: "Rendered",
    noteCounts: countNotesByCategory(params.notes),
    reportId: params.reportId ?? null,
    jobId: params.jobId ?? null,
    source: "analysis-pdf",
  });
  const collections = buildPdfReportCollections({
    findings: params.findings,
    reviewFindings: params.reviewFindings,
    findingsByArticle: params.findingsByArticle,
    canonicalFindings: params.canonicalFindings,
    reportHints: params.reportHints,
    isQuickAnalysis: params.isQuickAnalysis,
    notes: params.notes,
    lang: params.lang,
  });
  const [, logoDataUrl] = await Promise.all([
    Promise.resolve<string | null>(null),
    toDataUrl(`${origin}/fclogo.png`),
  ]);
  const doc = React.createElement(AnalysisSectionPdf, {
    data: {
      scriptTitle: params.scriptTitle,
      clientName: params.clientName,
      createdAt: params.createdAt,
      collections,
      scriptSummary: params.scriptSummary ?? undefined,
      lang: params.lang,
    },
    dateFormat: params.dateFormat,
    logoUrl: logoDataUrl ?? undefined,
    coverImageDataUrl: null,
  });
  const blob = await pdf(doc).toBlob();
  /** Empty/corrupt react-pdf output is often under ~300 bytes; real reports are larger. */
  const MIN_PDF_BYTES = 500;
  if (blob.size < MIN_PDF_BYTES) {
    const msg =
      params.lang === "ar"
        ? "الملف الناتج غير صالح (حجم صغير جداً). أعد المحاولة أو استخدم الطباعة."
        : "Generated PDF is invalid (file too small). Retry or use print.";
    throw new Error(msg);
  }
  const objectUrl = URL.createObjectURL(blob);
  const safeTitle = (params.scriptTitle || (params.lang === "ar" ? "تقرير" : "report"))
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  const datePart = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `raawi_report_${safeTitle}_${datePart}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
