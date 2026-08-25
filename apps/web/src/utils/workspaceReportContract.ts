import type { ReportListItem } from '@/api/models';

export function resolvePolledReportId(
  report: { id?: string | null } | null | undefined,
): string | null {
  const reportId = report?.id?.trim();
  return reportId || null;
}

export function validateSelectedReport(report: Partial<ReportListItem> | null | undefined): ReportListItem {
  if (!report?.id?.trim()) {
    throw new Error('Selected report is missing report.id');
  }
  if (!report.jobId?.trim()) {
    throw new Error('Selected report is missing jobId');
  }
  return report as ReportListItem;
}
