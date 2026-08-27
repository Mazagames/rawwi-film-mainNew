import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { pdf } from '@react-pdf/renderer';

(globalThis as any).window = { location: { origin: 'http://127.0.0.1:4173' } };

const { AnalysisSectionPdf } = await import('./src/components/reports/analysis/Pdf.tsx');
const { buildPdfReportCollections } = await import('./src/components/reports/analysis/pdfModel.ts');

const collections = buildPdfReportCollections({
  findings: [
    {
      id: 'viol-1',
      titleAr: 'مخالفة 1',
      descriptionAr: 'وصف مخالفة',
      evidenceSnippet: 'دليل مخالفة',
      source: 'ai',
      articleId: 1,
      severity: 'high',
      confidence: 0.95,
      reviewStatus: 'violation',
      startOffsetGlobal: 10,
      endOffsetGlobal: 20,
      pageNumber: 3,
      location: {},
      jobId: 'job',
      scriptId: 'script',
      versionId: 'version',
      createdAt: '2026-01-01',
      reviewReason: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewedRole: null,
    },
    {
      id: 'viol-2',
      titleAr: 'مخالفة 2',
      descriptionAr: 'وصف مخالفة ثانية',
      evidenceSnippet: 'دليل مخالفة ثانية',
      source: 'ai',
      articleId: 2,
      severity: 'medium',
      confidence: 0.82,
      reviewStatus: 'violation',
      startOffsetGlobal: 30,
      endOffsetGlobal: 40,
      pageNumber: 4,
      location: {},
      jobId: 'job',
      scriptId: 'script',
      versionId: 'version',
      createdAt: '2026-01-01',
      reviewReason: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewedRole: null,
    },
    {
      id: 'manual-1',
      titleAr: 'ملاحظة يدوية',
      descriptionAr: 'وصف يدوي',
      evidenceSnippet: 'دليل يدوي',
      source: 'manual',
      articleId: 3,
      severity: 'medium',
      confidence: 0.8,
      reviewStatus: 'violation',
      startOffsetGlobal: 50,
      endOffsetGlobal: 60,
      pageNumber: 5,
      location: {},
      jobId: 'job',
      scriptId: 'script',
      versionId: 'version',
      createdAt: '2026-01-01',
      reviewReason: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewedRole: null,
    },
    {
      id: 'gloss-1',
      titleAr: 'مصطلح',
      descriptionAr: 'مصطلح في القاموس',
      evidenceSnippet: 'دليل قاعدي',
      source: 'lexicon_mandatory',
      articleId: 4,
      severity: 'low',
      confidence: 0.7,
      reviewStatus: 'violation',
      startOffsetGlobal: 70,
      endOffsetGlobal: 80,
      pageNumber: 6,
      location: {},
      jobId: 'job',
      scriptId: 'script',
      versionId: 'version',
      createdAt: '2026-01-01',
      reviewReason: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewedRole: null,
    },
  ],
  notes: {
    security_scenes: [
      { id: 'note-1', reviewer: null, category: 'security_scenes', title: 'ملاحظة أمنية', description: 'وصف ملاحظة أمنية', snippet: 'اقتباس', event_id: 1, confidence: 0.8, status: 'new', included_in_report: true },
    ],
    saudi_names: [
      { id: 'note-2', reviewer: null, category: 'saudi_names', title: 'ملاحظة أسماء', description: 'وصف ملاحظة أسماء', snippet: 'اقتباس 2', event_id: 2, confidence: 0.7, status: 'new', included_in_report: true },
    ],
  },
  lang: 'ar',
});

const doc = React.createElement(AnalysisSectionPdf, {
  data: {
    scriptTitle: 'تقرير اختبار PDF',
    clientName: 'المستفيد',
    createdAt: '2026-08-27',
    collections,
    lang: 'ar',
  },
  logoUrl: 'http://127.0.0.1:4173/fclogo.png',
  coverImageDataUrl: null,
});

const blob = await pdf(doc).toBlob();
const out = path.resolve('../tmp-pdf-validation.pdf');
fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
console.log(out);
console.log(blob.size);
