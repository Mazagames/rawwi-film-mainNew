-- Preserve manual Note provenance and workspace location in the existing notes table.
ALTER TABLE public.analysis_notes
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS script_id uuid,
  ADD COLUMN IF NOT EXISTS version_id uuid,
  ADD COLUMN IF NOT EXISTS start_offset_global integer,
  ADD COLUMN IF NOT EXISTS end_offset_global integer;

ALTER TABLE public.analysis_notes
  DROP CONSTRAINT IF EXISTS analysis_notes_source_check;

ALTER TABLE public.analysis_notes
  ADD CONSTRAINT analysis_notes_source_check CHECK (source IN ('ai', 'manual'));

CREATE INDEX IF NOT EXISTS idx_analysis_notes_manual_location
  ON public.analysis_notes(job_id, source, script_id);
