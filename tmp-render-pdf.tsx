import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { AnalysisSectionPdf } from './apps/web/src/components/reports/analysis/Pdf.tsx';
import { buildPdfReportCollections } from './apps/web/src/components/reports/analysis/pdfModel.ts';

const collections = buildPdfReportCollections({
  findings: [],
  notes: {},
  lang: 'ar',
});

const doc = React.createElement(AnalysisSectionPdf, {
  data: {
    scriptTitle: 'تقرير',
    clientName: 'مستفيد',
    createdAt: '2026-08-27',
    collections,
    lang: 'ar',
  },
  logoUrl: undefined,
  coverImageDataUrl: null,
});

async function main() {
  const blob = await pdf(doc).toBlob();
  const out = path.resolve('tmp-pdf-validation.pdf');
  fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
  console.log(out);
  console.log(blob.size);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
