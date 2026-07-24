alter table public.analysis_chunks
  add column if not exists current_pass_name text,
  add column if not exists current_pass_label text,
  add column if not exists current_findings_count integer not null default 0;

comment on column public.analysis_chunks.current_pass_name is 'Current detection pass or reviewer name being executed for the chunk.';
comment on column public.analysis_chunks.current_pass_label is 'Display label for the current pass or reviewer.';
comment on column public.analysis_chunks.current_findings_count is 'Live count of findings discovered so far for the active chunk.';
