-- Notes pipeline storage for V5.
-- Notes are informational observations and must remain separate from analysis_findings.

CREATE TABLE IF NOT EXISTS public.analysis_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.analysis_jobs(id) ON DELETE CASCADE,
  reviewer text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  snippet text NOT NULL,
  event_id int NOT NULL,
  confidence numeric NOT NULL DEFAULT 0.7,
  status text NOT NULL DEFAULT 'new',
  included_in_report boolean NOT NULL DEFAULT true,
  reviewer_comment text,
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_notes_job_id ON public.analysis_notes(job_id);
CREATE INDEX IF NOT EXISTS idx_analysis_notes_category ON public.analysis_notes(job_id, category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_notes_dedup
  ON public.analysis_notes(job_id, reviewer, event_id, category, title);

ALTER TABLE public.analysis_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY analysis_notes_all ON public.analysis_notes FOR ALL
TO authenticated
USING (
  is_admin_user()
  OR EXISTS (SELECT 1 FROM public.analysis_jobs j WHERE j.id = analysis_notes.job_id AND j.created_by = auth.uid())
)
WITH CHECK (
  is_admin_user()
  OR EXISTS (SELECT 1 FROM public.analysis_jobs j WHERE j.id = analysis_notes.job_id AND j.created_by = auth.uid())
);
