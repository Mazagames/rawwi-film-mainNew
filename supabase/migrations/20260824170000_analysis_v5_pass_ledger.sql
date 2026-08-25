CREATE TABLE IF NOT EXISTS public.analysis_v5_pass_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  pass_name text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  request_started_at timestamptz NOT NULL DEFAULT now(),
  request_completed_at timestamptz,
  raw_response_length integer,
  parsed_findings_count integer,
  early_filter_input_count integer,
  early_filter_output_count integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, chunk_id, pass_name)
);

CREATE INDEX IF NOT EXISTS analysis_v5_pass_ledger_job_chunk_idx
  ON public.analysis_v5_pass_ledger (job_id, chunk_id);

COMMENT ON TABLE public.analysis_v5_pass_ledger IS
  'Durable diagnostic ledger for V5 reviewer execution; does not affect detection decisions.';
