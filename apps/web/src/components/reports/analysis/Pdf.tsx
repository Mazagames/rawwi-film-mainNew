import React from "react";
import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { formatDate, formatDateLong } from "@/utils/dateFormat";
import { getGlossarySentenceContext, type ViewerPageSlice } from "@/utils/findingContext";
import { logFindingFlightRecorderStage } from "@/utils/findingFlightRecorder";
import { analysisStyles as s } from "./styles";
import type { AnalysisPdfFinding } from "./mapper";
import type { NoteCategoryKey, ReportNote } from "@/api/models";
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const NOTE_CATEGORY_ORDER: Array<{ key: NoteCategoryKey; labelAr: string; labelEn: string }> = [
  { key: "security_scenes", labelAr: "مشاهد أمنية", labelEn: "Security Scenes" },
  { key: "saudi_names", labelAr: "أسماء سعودية", labelEn: "Saudi Names" },
  { key: "commercial_entities", labelAr: "كيانات تجارية", labelEn: "Commercial Entities" },
  { key: "medical_notes", labelAr: "ملاحظات طبية", labelEn: "Medical Notes" },
  { key: "media_credibility", labelAr: "مصداقية الوسائط", labelEn: "Media Credibility" },
  { key: "classified_documents", labelAr: "وثائق مصنفة", labelEn: "Classified Documents" },
  { key: "religious_content", labelAr: "محتوى ديني / مذهبي حساس", labelEn: "Religious Content" },
];

export interface ScriptSummaryForPdf {
  synopsis_ar: string;
  key_risky_events_ar?: string;
  narrative_stance_ar?: string;
  compliance_posture_ar?: string;
  confidence: number;
}

export interface RevisitMentionPdf {
  term: string;
  snippet: string;
  start_offset: number;
  end_offset: number;
}

export interface AnalysisSectionPdfData {
  jobId?: string;
  scriptTitle: string;
  clientName: string;
  createdAt: string;
  findings: AnalysisPdfFinding[];
  reportHints?: AnalysisPdfFinding[];
  notes?: Partial<Record<NoteCategoryKey, ReportNote[]>>;
  scriptSummary?: ScriptSummaryForPdf | null;
  wordsToRevisit?: RevisitMentionPdf[];
  viewerPages?: ViewerPageSlice[] | null;
  lang?: "ar" | "en";
}

export interface AnalysisSectionPdfProps {
  data: AnalysisSectionPdfData;
  dateFormat?: string;
  logoUrl?: string;
  coverImageDataUrl?: string | null;
}

export const AnalysisSectionPdf: React.FC<AnalysisSectionPdfProps> = ({
  data,
  dateFormat,
  logoUrl,
  coverImageDataUrl,
}) => {
  const findingFlightRecorderLoggedRef = React.useRef<string | null>(null);
  const isAr = data.lang === "ar";
  const rtl = isAr ? s.rtl : {};
  const safeFindings: AnalysisPdfFinding[] = (data.findings || [])
    .filter((f): f is AnalysisPdfFinding => !!f)
    .map((f, idx) => ({
      ...f,
      id: f.id ?? `finding-${idx}`,
      articleId: Number.isFinite(f.articleId) ? f.articleId : 0,
      titleAr: f.titleAr ?? "—",
      severity: f.severity ?? "info",
      confidence: f.confidence ?? 0,
      evidenceSnippet: f.evidenceSnippet ?? "",
    }));
  React.useEffect(() => {
    const recorderKey = [data.jobId ?? "", data.scriptTitle ?? "", String(safeFindings.length)].join("|");
    if (findingFlightRecorderLoggedRef.current === recorderKey) return;
    findingFlightRecorderLoggedRef.current = recorderKey;
    logFindingFlightRecorderStage({
      stage: "PDF Model",
      jobId: data.jobId ?? null,
      findings: safeFindings.map((finding) => ({
        finding_uuid: finding.id ?? null,
        article_id: Number.isFinite(finding.articleId) ? finding.articleId : null,
        title: finding.titleAr ?? null,
        event_id: null,
        chunk_index: null,
        page_number: finding.pageNumber ?? null,
        quote: finding.evidenceSnippet ?? null,
        confidence: finding.confidence ?? null,
      })),
    });
  }, [data.jobId, data.scriptTitle, safeFindings]);
  const safeReportHints: AnalysisPdfFinding[] = (data.reportHints || [])
    .filter((f): f is AnalysisPdfFinding => !!f)
    .map((f, idx) => ({
      ...f,
      id: f.id ?? `hint-${idx}`,
      articleId: Number.isFinite(f.articleId) ? f.articleId : 0,
      titleAr: f.titleAr ?? "—",
      severity: f.severity ?? "info",
      confidence: f.confidence ?? 0,
      evidenceSnippet: f.evidenceSnippet ?? "",
    }));
  const includedNotesByCategory = NOTE_CATEGORY_ORDER.map((category) => ({
    ...category,
    notes: (data.notes?.[category.key] ?? [])
      .filter((note): note is ReportNote => Boolean(note) && note.included_in_report !== false),
  })).filter((group) => group.notes.length > 0);

  const groups = safeFindings.reduce<Map<number, AnalysisPdfFinding[]>>((acc, f) => {
    const articleId = Number.isFinite(f.articleId) ? f.articleId : 0;
    if (!acc.has(articleId)) acc.set(articleId, []);
    acc.get(articleId)!.push(f);
    return acc;
  }, new Map<number, AnalysisPdfFinding[]>());

  const typeCounts = safeFindings.reduce(
    (acc, f) => {
      if (f.source === "manual") acc.manual++;
      else if (f.source === "lexicon_mandatory" || f.source === "glossary") acc.glossary++;
      else acc.ai++;
      return acc;
    },
    { ai: 0, manual: 0, glossary: 0 },
  );
  const specialNotesCount = safeReportHints.length;

  return (
    <Document>
      <Page size="A4" wrap={false} style={[s.cover, isAr ? s.pageAr : {}]}>
        <View style={{ width: A4_WIDTH, height: A4_HEIGHT, position: "relative" }}>
          <View style={{ position: "absolute", left: 44, right: 44, top: 70, alignItems: "center" }}>
            {logoUrl ? <Image src={logoUrl} style={{ width: 130, height: 42, objectFit: "contain", marginBottom: 22 }} /> : null}
          </View>
          <View style={{ position: "absolute", left: 44, right: 44, bottom: 110 }}>
            <View style={s.coverMetaBlock}>
              <Text style={[s.coverTitle, rtl]}>{isAr ? "تقرير التحليل" : "Analysis Report"}</Text>
              <Text style={[s.coverText, rtl]}>{data.scriptTitle}</Text>
              <Text style={[s.coverText, rtl]}>{isAr ? `المستفيد: ${data.clientName}` : `Beneficiary: ${data.clientName}`}</Text>
              <Text style={[s.coverText, rtl]}>
                {dateFormat ? formatDate(new Date(data.createdAt), { lang: isAr ? "ar" : "en", format: dateFormat }) : formatDateLong(new Date(data.createdAt), { lang: isAr ? "ar" : "en" })}
              </Text>
            </View>
          </View>
        </View>
      </Page>
      <Page size="A4" style={[s.page, isAr ? s.pageAr : {}]}>
        <Text style={[s.title, rtl]}>{isAr ? "تفاصيل التقرير" : "Report Details"}</Text>
        <Text style={[s.subtitle, rtl]}>{isAr ? `النص: ${data.scriptTitle}` : `Script: ${data.scriptTitle}`}</Text>
        <Text style={[s.subtitle, rtl]}>{isAr ? `إجمالي الملاحظات: ${safeFindings.length}` : `Total findings: ${safeFindings.length}`}</Text>

        <View style={s.row}>
          <View style={s.stat}><Text style={s.statValue}>{typeCounts.ai}</Text><Text style={s.statLabel}>{isAr ? "ملاحظات آلية" : "Automated findings"}</Text></View>
          <View style={s.stat}><Text style={s.statValue}>{typeCounts.glossary}</Text><Text style={s.statLabel}>{isAr ? "مطابقات القاموس" : "Glossary findings"}</Text></View>
          <View style={s.stat}><Text style={s.statValue}>{typeCounts.manual}</Text><Text style={s.statLabel}>{isAr ? "ملاحظات يدوية" : "Manual findings"}</Text></View>
          <View style={s.stat}><Text style={s.statValue}>{specialNotesCount}</Text><Text style={s.statLabel}>{isAr ? "ملاحظات خاصة" : "Special notes"}</Text></View>
        </View>

        {data.scriptSummary && (
          <View style={{ marginBottom: 14 }}>
            <Text style={[s.sectionTitle, rtl]}>{isAr ? "فهم النص (ملخص آلي)" : "Script understanding (automated summary)"}</Text>
            <Text style={[s.findingBody, rtl]}>{data.scriptSummary.synopsis_ar}</Text>
            {data.scriptSummary.key_risky_events_ar ? (
              <Text style={[s.findingMeta, rtl]}>{isAr ? "أهم المشاهد الحساسة: " : "Key risky events: "}{data.scriptSummary.key_risky_events_ar}</Text>
            ) : null}
            {data.scriptSummary.narrative_stance_ar ? (
              <Text style={[s.findingMeta, rtl]}>{isAr ? "موقف السرد: " : "Narrative stance: "}{data.scriptSummary.narrative_stance_ar}</Text>
            ) : null}
            {data.scriptSummary.compliance_posture_ar ? (
              <Text style={[s.findingMeta, rtl]}>{isAr ? "انطباع الامتثال: " : "Compliance posture: "}{data.scriptSummary.compliance_posture_ar}</Text>
            ) : null}
            <Text style={[s.findingMeta, rtl]}>{isAr ? "ثقة الملخص: " : "Summary confidence: "}{Math.round((data.scriptSummary.confidence ?? 0) * 100)}%</Text>
          </View>
        )}

        <Text style={[s.sectionTitle, rtl]}>{isAr ? "تفاصيل القضايا" : "Findings Details"}</Text>
        {groups.size === 0 ? (
          <View style={s.emptyState}>
            <Text style={[s.emptyStateTitle, rtl]}>
              {isAr ? "لا توجد مخالفات" : "No Violations Found"}
            </Text>
            <Text style={[s.emptyStateText, rtl]}>
              {isAr
                ? "هذا النص لا يحتوي على مخالفات ضد مواد GCAM وفق نتائج التحليل الحالية."
                : "This script has no violations against GCAM articles based on the current analysis results."}
            </Text>
          </View>
        ) : (
          Array.from(groups.entries())
            .sort(([a], [b]) => a - b)
            .map(([articleId, list]) => {
              if (!list?.length) return null;
              const groupTitle = list[0]?.titleAr?.trim() || (isAr ? `مادة ${articleId}` : `Article ${articleId}`);
              return (
                <View key={articleId} style={s.articleWrap}>
                  <Text style={[s.articleHeader, rtl]}>
                    {groupTitle}
                  </Text>
                  {list.filter(Boolean).map((f, idx) => {
                    return (
                      <View key={`${f?.id ?? `finding-${idx}`}-${idx}`} style={s.finding}>
                        <Text style={[s.findingTitle, rtl]}>{f.titleAr || "—"}</Text>
                        <Text style={[s.findingSnippet, rtl]}>
                          {isAr ? "النص المخالف: " : "Violation text: "}
                          "{f.evidenceSnippet || "—"}"
                        </Text>
                        {((f.source === "lexicon_mandatory" || f.source === "glossary") && data.viewerPages?.length) ? (() => {
                          const context = getGlossarySentenceContext({
                            evidenceSnippet: f.evidenceSnippet,
                            pageNumber: f.pageNumber ?? null,
                            startOffsetGlobal: f.startOffsetGlobal ?? null,
                            viewerPages: data.viewerPages ?? null,
                          });
                          return context ? (
                            <Text style={[s.findingContext, rtl]}>
                              {isAr ? "السياق: " : "Context: "}
                              {context}
                            </Text>
                          ) : null;
                        })() : null}
                        {(f.pageNumber != null && f.pageNumber > 0) && (
                          <Text style={[s.findingMeta, rtl]}>
                            {isAr ? `صفحة ${f.pageNumber}` : `Page ${f.pageNumber}`}
                          </Text>
                        )}
                        {f.startLineChunk != null && (
                          <Text style={[s.findingMeta, rtl]}>
                            {isAr
                              ? `السطر ${f.startLineChunk}${f.endLineChunk ? `-${f.endLineChunk}` : ""}`
                              : `Line ${f.startLineChunk}${f.endLineChunk ? `-${f.endLineChunk}` : ""}`}
                          </Text>
                        )}
                        {f.pillarId ? (
                          <Text style={[s.findingMeta, rtl]}>
                            {isAr ? "المحور: " : "Pillar: "}
                            {f.pillarId}
                          </Text>
                        ) : null}
                        <Text style={[s.findingRationaleLabel, rtl]}>
                          {isAr ? "لماذا اعتُبرت مخالفة:" : "Why considered a violation:"}
                        </Text>
                        <Text style={[s.findingRationaleText, rtl]}>{f.rationale || "—"}</Text>
                      </View>
                    );
                  })}
                </View>
              );
            })
            .filter(Boolean)
        )}

        {includedNotesByCategory.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={[s.sectionTitle, rtl]}>{isAr ? "الملاحظات" : "Notes"}</Text>
            <Text style={[s.findingMeta, rtl]}>
              {isAr
                ? "هذه ملاحظات معلوماتية للمراجعة البشرية وليست مخالفات."
                : "These are informational observations for human review, not violations."}
            </Text>
            {includedNotesByCategory.map((group) => (
              <View key={group.key} style={{ marginTop: 10 }}>
                <Text style={[s.articleHeader, rtl]}>
                  {isAr ? group.labelAr : group.labelEn}
                </Text>
                {group.notes.map((note, idx) => (
                  <View key={`${note.id}-${idx}`} style={[s.finding, { backgroundColor: "#f8fafc", borderColor: "#7dd3fc", marginTop: 8 }]}>
                    <Text style={[s.findingTitle, rtl]}>{note.title || "—"}</Text>
                    <Text style={[s.findingMeta, rtl]}>
                      {isAr ? "الحدث: " : "Event: "}#{note.event_id}
                    </Text>
                    <Text style={[s.findingSnippet, rtl]}>
                      {isAr ? "الفقرة: " : "Paragraph: "}
                      "{note.snippet || "—"}"
                    </Text>
                    <Text style={[s.findingBody, rtl]}>
                      {isAr ? "الوصف: " : "Description: "}{note.description || "—"}
                    </Text>
                    {(note.reviewer_comment ?? note.comment) ? (
                      <Text style={[s.findingMeta, rtl]}>
                        {isAr ? "ملاحظة المراجع: " : "Reviewer comment: "}{note.reviewer_comment ?? note.comment}
                      </Text>
                    ) : null}
                    <View style={[s.findingChipsRow, { flexDirection: isAr ? "row-reverse" : "row" }]}>
                      <Text style={[s.chip, s.chipInfo]}>{isAr ? "ملاحظة" : "Note"}</Text>
                      <Text style={[s.chip, s.chipInfo]}>{isAr ? "الثقة" : "Conf"} {Math.round((note.confidence || 0) * 100)}%</Text>
                      <Text style={[s.chip, s.chipInfo]}>
                        {note.included_in_report === false ? (isAr ? "مستبعد" : "Excluded") : (isAr ? "مضمن" : "Included")}
                      </Text>
                      {note.status ? <Text style={[s.chip, s.chipInfo]}>{note.status}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {safeReportHints.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={[s.sectionTitle, rtl]}>{isAr ? "ملاحظات خاصة" : "Special notes"}</Text>
            <Text style={[s.findingMeta, rtl]}>
              {isAr
                ? "هذه النقاط ليست مخالفات؛ يُنصح بمراعاتها عند التصوير (مثلاً ضوابط المظهر العام والقيم الإسلامية)."
                : "These are not violations; consider them when filming (e.g. modesty and Islamic guidelines)."}
            </Text>
            {safeReportHints.map((f, idx) => (
              <View key={`hint-${f.id ?? idx}`} style={[s.finding, { backgroundColor: "#f0f9ff", borderColor: "#7dd3fc", marginTop: 8 }]}>
                <Text style={[s.findingTitle, rtl]}>{isAr ? "ملاحظة" : "Note"}</Text>
                <Text style={[s.findingSnippet, rtl]}>
                  {isAr ? "النص: " : "Text: "}
                  "{f.evidenceSnippet || "—"}"
                </Text>
                <View style={[s.findingChipsRow, { flexDirection: isAr ? "row-reverse" : "row" }]}>
                  <Text style={[s.chip, s.chipInfo]}>{isAr ? "ملاحظة" : "Note"}</Text>
                  <Text style={[s.chip, s.chipInfo]}>{isAr ? "الثقة" : "Conf"} {Math.round((f.confidence || 0) * 100)}%</Text>
                </View>
                <Text style={[s.findingBody, rtl]}>
                  {isAr ? "لماذا ليست مخالفة: " : "Why not a violation: "}
                  {f.rationale || "—"}
                </Text>
              </View>
            ))}
          </View>
        )}

      </Page>
    </Document>
  );
};
