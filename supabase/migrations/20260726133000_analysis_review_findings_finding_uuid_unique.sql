-- Make review findings unique per persisted finding occurrence instead of per canonical summary id.
-- Canonical findings can now legitimately repeat within the same report.
DROP INDEX IF EXISTS public.idx_arf_report_canonical_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_arf_report_finding_uuid_unique
  ON public.analysis_review_findings(report_id, finding_uuid)
  WHERE finding_uuid IS NOT NULL;
