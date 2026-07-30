-- Script environment catalog migration.
-- Apply after supabase_studio_schema.sql.

CREATE UNIQUE INDEX IF NOT EXISTS environments_script_key_unique_idx
    ON environments (project_id, (metadata->>'script_key'))
    WHERE metadata->>'source' = 'script';

NOTIFY pgrst, 'reload schema';