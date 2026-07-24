-- Add script metadata fields expected by scripts, reports, and client portal views.
-- Safe to run on the new Supabase project and on older projects that already have some of these columns.

ALTER TABLE public.scripts
ADD COLUMN IF NOT EXISTS story_summary text,
ADD COLUMN IF NOT EXISTS script_summary_pdf_url text,
ADD COLUMN IF NOT EXISTS has_security_scenes boolean,
ADD COLUMN IF NOT EXISTS security_content_attachment_url text;

COMMENT ON COLUMN public.scripts.story_summary IS
  'Optional story summary used by scripts, reports, and client portal views.';

COMMENT ON COLUMN public.scripts.script_summary_pdf_url IS
  'Optional generated script summary PDF URL.';

COMMENT ON COLUMN public.scripts.has_security_scenes IS
  'Whether the script contains security-related scenes.';

COMMENT ON COLUMN public.scripts.security_content_attachment_url IS
  'Optional attachment URL for security-related supporting content.';

-- Backfill from synopsis where it helps preserve existing UI content.
UPDATE public.scripts
SET story_summary = synopsis
WHERE story_summary IS NULL
  AND synopsis IS NOT NULL
  AND btrim(synopsis) <> '';
