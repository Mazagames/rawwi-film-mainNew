import React from "react";
import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { formatDate, formatDateLong } from "@/utils/dateFormat";
import { analysisStyles as s } from "./styles";
import type { PdfReportCard, PdfReportCollections } from "./pdfModel";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

export interface ScriptSummaryForPdf {
  synopsis_ar: string;
  key_risky_events_ar?: string;
  narrative_stance_ar?: string;
  compliance_posture_ar?: string;
  confidence: number;
}

export interface AnalysisSectionPdfData {
  scriptTitle: string;
  clientName: string;
  createdAt: string;
  collections: PdfReportCollections;
  scriptSummary?: ScriptSummaryForPdf | null;
  lang?: "ar" | "en";
}

export interface AnalysisSectionPdfProps {
  data: AnalysisSectionPdfData;
  dateFormat?: string;
  logoUrl?: string;
  coverImageDataUrl?: string | null;
}

type SectionKey = "violations" | "notes" | "manual" | "glossary";

function sectionCopy(key: SectionKey, isAr: boolean) {
  const labels = isAr
    ? { violations: "المخالفات", notes: "الملاحظات", manual: "يدوية", glossary: "قاموس" }
    : { violations: "Violations", notes: "Notes", manual: "Manual", glossary: "Glossary" };
  return labels[key];
}

function sectionStyle(key: SectionKey) {
  if (key === "violations") return { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2", accent: "#991B1B" };
  if (key === "notes") return { borderColor: "#7DD3FC", backgroundColor: "#F0F9FF", accent: "#075985" };
  if (key === "manual") return { borderColor: "#D1D5DB", backgroundColor: "#F9FAFB", accent: "#374151" };
  return { borderColor: "#C4B5FD", backgroundColor: "#F5F3FF", accent: "#5B21B6" };
}

function FindingCard({ card, isAr }: { card: PdfReportCard; isAr: boolean }) {
  const style = sectionStyle(card.classification);
  return (
    <View wrap={false} style={[s.finding, { borderColor: style.borderColor, backgroundColor: style.backgroundColor }]}>
      <View style={[s.cardHeading, isAr ? { flexDirection: "row-reverse" as const } : {}]}>
        <Text style={[s.findingTitle, isAr ? s.rtl : {}]}>{card.title}</Text>
        <Text style={[s.cardClassification, { color: style.accent, borderColor: style.borderColor }, isAr ? s.rtl : {}]}>
          {sectionCopy(card.classification, isAr)}
        </Text>
      </View>
      {card.reference ? <Text style={[s.findingMeta, isAr ? s.rtl : {}]}>{isAr ? "المرجع: " : "Reference: "}{card.reference}</Text> : null}
      {card.pageNumber != null ? <Text style={[s.findingMeta, isAr ? s.rtl : {}]}>{isAr ? "الصفحة: " : "Page: "}{card.pageNumber}</Text> : null}
      {card.position != null && card.classification === "note" ? <Text style={[s.findingMeta, isAr ? s.rtl : {}]}>{isAr ? "الحدث: " : "Event: "}{card.position}</Text> : null}
      {card.evidence ? <Text style={[s.findingSnippet, isAr ? s.rtl : {}]}>{isAr ? "النص: " : "Evidence: "}"{card.evidence}"</Text> : null}
      {card.description ? <Text style={[s.findingBody, isAr ? s.rtl : {}]}>{card.description}</Text> : null}
      {card.confidence != null ? <Text style={[s.findingMeta, isAr ? s.rtl : {}]}>{isAr ? "الثقة: " : "Confidence: "}{Math.round(card.confidence * 100)}%</Text> : null}
    </View>
  );
}

function ReportSection({ section, cards, isAr }: { section: SectionKey; cards: PdfReportCard[]; isAr: boolean }) {
  const style = sectionStyle(section);
  return (
    <Page size="A4" style={[s.page, isAr ? s.pageAr : {}]}>
      <View minPresenceAhead={80} style={[s.sectionHeading, { borderBottomColor: style.borderColor }, isAr ? { flexDirection: "row-reverse" as const } : {}]}>
        <Text style={[s.sectionTitle, { color: style.accent }, isAr ? s.rtl : {}]}>{sectionCopy(section, isAr)}</Text>
        <Text style={[s.sectionCount, { color: style.accent, borderColor: style.borderColor }]}>{cards.length}</Text>
      </View>
      {cards.length > 0 ? cards.map((card) => <FindingCard key={`${section}-${card.id}`} card={card} isAr={isAr} />) : (
        <Text style={[s.emptySection, isAr ? s.rtl : {}]}>{isAr ? "لا توجد عناصر في هذا القسم." : "No items in this section."}</Text>
      )}
    </Page>
  );
}

export const AnalysisSectionPdf: React.FC<AnalysisSectionPdfProps> = ({ data, dateFormat, logoUrl }) => {
  const isAr = data.lang === "ar";
  const rtl = isAr ? s.rtl : {};
  const { totals } = data.collections;
  const stats: Array<{ key: keyof typeof totals; label: string; color: string }> = [
    { key: "all", label: isAr ? "الكل" : "All", color: "#374151" },
    { key: "violations", label: isAr ? "المخالفات" : "Violations", color: "#991B1B" },
    { key: "notes", label: isAr ? "الملاحظات" : "Notes", color: "#075985" },
    { key: "manual", label: isAr ? "يدوية" : "Manual", color: "#374151" },
    { key: "glossary", label: isAr ? "قاموس" : "Glossary", color: "#5B21B6" },
  ];

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
              <Text style={[s.coverText, rtl]}>{dateFormat ? formatDate(new Date(data.createdAt), { lang: isAr ? "ar" : "en", format: dateFormat }) : formatDateLong(new Date(data.createdAt), { lang: isAr ? "ar" : "en" })}</Text>
            </View>
          </View>
        </View>
      </Page>

      <Page size="A4" style={[s.page, isAr ? s.pageAr : {}]}>
        <Text style={[s.title, rtl]}>{isAr ? "إحصاءات التقرير" : "Report Statistics"}</Text>
        <Text style={[s.subtitle, rtl]}>{data.scriptTitle}</Text>
        <View style={[s.statisticsGrid, isAr ? { flexDirection: "row-reverse" as const } : {}]}>
          {stats.map((stat) => (
            <View key={stat.key} style={[s.stat, { borderColor: stat.color }]}>
              <Text style={[s.statValue, { color: stat.color }]}>{totals[stat.key]}</Text>
              <Text style={[s.statLabel, rtl]}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </Page>

      <ReportSection section="violations" cards={data.collections.violations} isAr={isAr} />
      <ReportSection section="notes" cards={data.collections.notes} isAr={isAr} />
      <ReportSection section="manual" cards={data.collections.manual} isAr={isAr} />
      <ReportSection section="glossary" cards={data.collections.glossary} isAr={isAr} />
    </Document>
  );
};
