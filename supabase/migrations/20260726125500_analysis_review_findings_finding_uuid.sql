-- Preserve the original finding identity in review findings as well.
ALTER TABLE analysis_review_findings
  ADD COLUMN IF NOT EXISTS finding_uuid uuid NULL;

COMMENT ON COLUMN analysis_review_findings.finding_uuid IS 'Stable identity copied from the originating finding and preserved through summary/report review rows.';
