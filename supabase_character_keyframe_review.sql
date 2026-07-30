-- Character keyframe review and repair migration.
-- Apply in the Supabase SQL Editor after supabase_studio_schema.sql.

ALTER TABLE generation_outputs
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready',
    ADD COLUMN IF NOT EXISTS replaces_output_id UUID REFERENCES generation_outputs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMPTZ;

-- Existing character outputs become active reviewable keyframes.
UPDATE generation_outputs
SET is_active = TRUE,
    status = COALESCE(NULLIF(status, ''), 'ready')
WHERE is_active IS DISTINCT FROM TRUE
   OR status IS NULL
   OR status = '';

-- A character turnaround has one current asset per named view. Replaced versions
-- remain in the table with is_active = FALSE for audit and restoration.
CREATE UNIQUE INDEX IF NOT EXISTS generation_outputs_active_character_view_idx
    ON generation_outputs (generation_job_id, (metadata ->> 'view'))
    WHERE is_active = TRUE
      AND metadata ? 'view';

CREATE INDEX IF NOT EXISTS generation_outputs_job_view_history_idx
    ON generation_outputs (generation_job_id, (metadata ->> 'view'), created_at DESC);

NOTIFY pgrst, 'reload schema';
