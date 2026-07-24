-- Add the story_summary column expected by scripts, reports, and client portal views.
-- Safe to run on the new Supabase project and on older projects that already have the column.

ALTER TABLE public.scripts
ADD COLUMN IF NOT EXISTS story_summary text;

COMMENT ON COLUMN public.scripts.story_summary IS
  'Optional story summary used by scripts, reports, and client portal views.';

-- Backfill from synopsis where story_summary is empty so existing scripts keep showing content.
UPDATE public.scripts
SET story_summary = synopsis
WHERE story_summary IS NULL
  AND synopsis IS NOT NULL
  AND btrim(synopsis) <> '';
