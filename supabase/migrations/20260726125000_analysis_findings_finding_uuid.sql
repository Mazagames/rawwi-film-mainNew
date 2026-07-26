-- Store a stable finding identity assigned by the reviewer parsing path.
ALTER TABLE analysis_findings
  ADD COLUMN IF NOT EXISTS finding_uuid uuid NULL;

COMMENT ON COLUMN analysis_findings.finding_uuid IS 'Stable identity assigned immediately after reviewer JSON parsing and copied forward unchanged through downstream stages.';
