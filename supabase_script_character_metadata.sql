-- Script-derived character metadata migration.
-- Apply after supabase_studio_schema.sql for existing projects.

ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS gender TEXT,
    ADD COLUMN IF NOT EXISTS race TEXT,
    ADD COLUMN IF NOT EXISTS character_type TEXT NOT NULL DEFAULT 'supporting';

ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_character_type_check;
ALTER TABLE characters ADD CONSTRAINT characters_character_type_check
    CHECK (character_type IN ('main', 'supporting'));

NOTIFY pgrst, 'reload schema';
