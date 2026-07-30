-- AI Movie Studio database structure
-- Apply this in the Supabase SQL Editor after your base project setup.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Shared updated_at trigger function.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Enum creation is wrapped so this file can be re-run safely.
DO $$
BEGIN
    CREATE TYPE project_document_type AS ENUM ('idea', 'outline', 'script');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE studio_stage_status AS ENUM ('pending', 'in_progress', 'complete', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE script_block_type AS ENUM (
        'scene_heading',
        'action',
        'dialogue',
        'transition',
        'shot',
        'title',
        'montage'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE dialogue_mode AS ENUM ('normal', 'voice_over', 'off_screen');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE asset_type AS ENUM ('image', 'video', 'audio', 'text');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE asset_source AS ENUM ('upload', 'generation', 'import');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE generation_kind AS ENUM (
        'image',
        'video',
        'audio',
        'lipsync',
        'storyboard',
        'character',
        'environment',
        'prop',
        'voice',
        'music',
        'sfx'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE generation_status AS ENUM ('queued', 'running', 'complete', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE timeline_track_type AS ENUM ('video', 'audio', 'image', 'text', 'caption');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE export_status AS ENUM ('queued', 'running', 'complete', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Root table. Existing projects table is extended instead of replaced.
CREATE TABLE IF NOT EXISTS projects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID,
    name TEXT NOT NULL DEFAULT 'Untitled',
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    timeline_state JSONB NOT NULL DEFAULT '{}',
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS aspect_ratio TEXT NOT NULL DEFAULT '16:9';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS timeline_state JSONB NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Dashboard pipeline: Story, Assets, Storyboard, Audio, Video, Export.
CREATE TABLE IF NOT EXISTS project_stages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    label TEXT NOT NULL,
    status studio_stage_status NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, stage_key)
);

DROP TRIGGER IF EXISTS project_stages_updated_at ON project_stages;
CREATE TRIGGER project_stages_updated_at
    BEFORE UPDATE ON project_stages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Big writing stages: idea -> outline -> full script.
CREATE TABLE IF NOT EXISTS project_documents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type project_document_type NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS project_documents_project_type_idx
    ON project_documents(project_id, type);

DROP TRIGGER IF EXISTS project_documents_updated_at ON project_documents;
CREATE TRIGGER project_documents_updated_at
    BEFORE UPDATE ON project_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Scenes are extracted from the script.
CREATE TABLE IF NOT EXISTS scenes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    script_document_id UUID REFERENCES project_documents(id) ON DELETE SET NULL,
    scene_number INTEGER,
    slugline_raw TEXT,
    location_type TEXT, -- INT, EXT, INT/EXT
    location TEXT,
    time_of_day TEXT,
    title TEXT,
    summary TEXT,
    script_excerpt TEXT,
    status studio_stage_status NOT NULL DEFAULT 'pending',
    sort_order INTEGER NOT NULL DEFAULT 0,
    duration_seconds NUMERIC(10, 3),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS scenes_project_sort_idx
    ON scenes(project_id, sort_order);

DROP TRIGGER IF EXISTS scenes_updated_at ON scenes;
CREATE TRIGGER scenes_updated_at
    BEFORE UPDATE ON scenes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Screenplay components inside a scene.
CREATE TABLE IF NOT EXISTS script_blocks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scene_id UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    block_type script_block_type NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    character_id UUID,
    character_name TEXT,
    parenthetical TEXT,
    dialogue_mode dialogue_mode NOT NULL DEFAULT 'normal',
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS script_blocks_scene_sort_idx
    ON script_blocks(scene_id, sort_order);

DROP TRIGGER IF EXISTS script_blocks_updated_at ON script_blocks;
CREATE TRIGGER script_blocks_updated_at
    BEFORE UPDATE ON script_blocks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Shots are the visual breakdown used for storyboard generation.
CREATE TABLE IF NOT EXISTS shots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scene_id UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    shot_number INTEGER,
    description TEXT,
    camera_angle TEXT,
    camera_motion TEXT,
    prompt TEXT,
    duration_seconds NUMERIC(10, 3),
    status studio_stage_status NOT NULL DEFAULT 'pending',
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS shots_scene_sort_idx
    ON shots(scene_id, sort_order);

DROP TRIGGER IF EXISTS shots_updated_at ON shots;
CREATE TRIGGER shots_updated_at
    BEFORE UPDATE ON shots
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Reusable project entities.
CREATE TABLE IF NOT EXISTS characters (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    character_type TEXT NOT NULL DEFAULT 'supporting' CHECK (character_type IN ('main', 'supporting')),
    role TEXT,
    age INTEGER,
    gender TEXT,
    race TEXT,
    voice_id UUID,
    appearance TEXT,
    personality TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    primary_asset_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE characters ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS race TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS character_type TEXT NOT NULL DEFAULT 'supporting';
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_character_type_check;
ALTER TABLE characters ADD CONSTRAINT characters_character_type_check
    CHECK (character_type IN ('main', 'supporting'));

CREATE INDEX IF NOT EXISTS characters_project_idx
    ON characters(project_id);

DROP TRIGGER IF EXISTS characters_updated_at ON characters;
CREATE TRIGGER characters_updated_at
    BEFORE UPDATE ON characters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS environments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    primary_asset_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS environments_updated_at ON environments;
CREATE TRIGGER environments_updated_at
    BEFORE UPDATE ON environments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS props (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    primary_asset_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS props_project_name_idx
    ON props(project_id, name);

DROP TRIGGER IF EXISTS props_updated_at ON props;
CREATE TRIGGER props_updated_at
    BEFORE UPDATE ON props
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- All uploaded and generated files.
CREATE TABLE IF NOT EXISTS assets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID,
    type asset_type NOT NULL,
    source asset_source NOT NULL DEFAULT 'upload',
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    storage_path TEXT,
    mime_type TEXT,
    size_bytes BIGINT,
    duration_seconds NUMERIC(10, 3),
    width INTEGER,
    height INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS assets_project_type_idx
    ON assets(project_id, type);

DROP TRIGGER IF EXISTS assets_updated_at ON assets;
CREATE TRIGGER assets_updated_at
    BEFORE UPDATE ON assets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Add asset references after assets exists.
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_primary_asset_fk;
ALTER TABLE characters
    ADD CONSTRAINT characters_primary_asset_fk
    FOREIGN KEY (primary_asset_id) REFERENCES assets(id) ON DELETE SET NULL;

ALTER TABLE environments DROP CONSTRAINT IF EXISTS environments_primary_asset_fk;
ALTER TABLE environments
    ADD CONSTRAINT environments_primary_asset_fk
    FOREIGN KEY (primary_asset_id) REFERENCES assets(id) ON DELETE SET NULL;

ALTER TABLE props DROP CONSTRAINT IF EXISTS props_primary_asset_fk;
ALTER TABLE props
    ADD CONSTRAINT props_primary_asset_fk
    FOREIGN KEY (primary_asset_id) REFERENCES assets(id) ON DELETE SET NULL;

ALTER TABLE script_blocks DROP CONSTRAINT IF EXISTS script_blocks_character_fk;
ALTER TABLE script_blocks
    ADD CONSTRAINT script_blocks_character_fk
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL;

-- Polymorphic links: storyboard image -> shot, reference image -> character, etc.
CREATE TABLE IF NOT EXISTS asset_links (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL, -- scene, shot, character, environment, prop, voice_line, export
    target_id UUID NOT NULL,
    role TEXT NOT NULL, -- storyboard, thumbnail, reference, final, variant, source
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (asset_id, target_type, target_id, role)
);

CREATE INDEX IF NOT EXISTS asset_links_target_idx
    ON asset_links(project_id, target_type, target_id, role);

-- AI jobs and outputs.
CREATE TABLE IF NOT EXISTS generation_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID,
    scene_id UUID REFERENCES scenes(id) ON DELETE SET NULL,
    shot_id UUID REFERENCES shots(id) ON DELETE SET NULL,
    kind generation_kind NOT NULL,
    model TEXT,
    prompt TEXT,
    negative_prompt TEXT,
    settings JSONB NOT NULL DEFAULT '{}',
    status generation_status NOT NULL DEFAULT 'queued',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS generation_jobs_project_status_idx
    ON generation_jobs(project_id, status, created_at DESC);

DROP TRIGGER IF EXISTS generation_jobs_updated_at ON generation_jobs;
CREATE TRIGGER generation_jobs_updated_at
    BEFORE UPDATE ON generation_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS generation_outputs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    generation_job_id UUID NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    output_index INTEGER NOT NULL DEFAULT 0,
    selected BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (generation_job_id, asset_id)
);

-- Dialogue/audio generation.
CREATE TABLE IF NOT EXISTS voice_lines (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scene_id UUID REFERENCES scenes(id) ON DELETE CASCADE,
    character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
    script_block_id UUID REFERENCES script_blocks(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    voice_model TEXT,
    audio_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    status generation_status NOT NULL DEFAULT 'queued',
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS voice_lines_scene_sort_idx
    ON voice_lines(scene_id, sort_order);

DROP TRIGGER IF EXISTS voice_lines_updated_at ON voice_lines;
CREATE TRIGGER voice_lines_updated_at
    BEFORE UPDATE ON voice_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Normalized timeline, while projects.timeline_state can still hold fast editor snapshots.
CREATE TABLE IF NOT EXISTS timeline_tracks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type timeline_track_type NOT NULL,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    muted BOOLEAN NOT NULL DEFAULT FALSE,
    solo BOOLEAN NOT NULL DEFAULT FALSE,
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    collapsed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS timeline_tracks_project_sort_idx
    ON timeline_tracks(project_id, sort_order);

DROP TRIGGER IF EXISTS timeline_tracks_updated_at ON timeline_tracks;
CREATE TRIGGER timeline_tracks_updated_at
    BEFORE UPDATE ON timeline_tracks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS timeline_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    track_id UUID NOT NULL REFERENCES timeline_tracks(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    start_time NUMERIC(10, 3) NOT NULL DEFAULT 0,
    duration NUMERIC(10, 3) NOT NULL DEFAULT 5,
    trim_start NUMERIC(10, 3) NOT NULL DEFAULT 0,
    trim_end NUMERIC(10, 3) NOT NULL DEFAULT 0,
    volume INTEGER NOT NULL DEFAULT 100 CHECK (volume >= 0 AND volume <= 100),
    speed NUMERIC(6, 3) NOT NULL DEFAULT 1,
    opacity INTEGER NOT NULL DEFAULT 100 CHECK (opacity >= 0 AND opacity <= 100),
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    text_content TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS timeline_items_track_time_idx
    ON timeline_items(track_id, start_time);

DROP TRIGGER IF EXISTS timeline_items_updated_at ON timeline_items;
CREATE TRIGGER timeline_items_updated_at
    BEFORE UPDATE ON timeline_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Final rendered files.
CREATE TABLE IF NOT EXISTS exports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status export_status NOT NULL DEFAULT 'queued',
    format TEXT NOT NULL DEFAULT 'mp4',
    resolution TEXT,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    settings JSONB NOT NULL DEFAULT '{}',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS exports_project_created_idx
    ON exports(project_id, created_at DESC);

DROP TRIGGER IF EXISTS exports_updated_at ON exports;
CREATE TRIGGER exports_updated_at
    BEFORE UPDATE ON exports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Enable RLS. Policies below are permissive to match the current app setup.
-- Tighten these once Supabase Auth is wired through the studio.
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE props ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'projects',
        'project_stages',
        'project_documents',
        'scenes',
        'script_blocks',
        'shots',
        'characters',
        'environments',
        'props',
        'assets',
        'asset_links',
        'generation_jobs',
        'generation_outputs',
        'voice_lines',
        'timeline_tracks',
        'timeline_items',
        'exports'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "public select" ON %I', table_name);
        EXECUTE format('DROP POLICY IF EXISTS "public insert" ON %I', table_name);
        EXECUTE format('DROP POLICY IF EXISTS "public update" ON %I', table_name);
        EXECUTE format('DROP POLICY IF EXISTS "public delete" ON %I', table_name);
        EXECUTE format('CREATE POLICY "public select" ON %I FOR SELECT USING (true)', table_name);
        EXECUTE format('CREATE POLICY "public insert" ON %I FOR INSERT WITH CHECK (true)', table_name);
        EXECUTE format('CREATE POLICY "public update" ON %I FOR UPDATE USING (true)', table_name);
        EXECUTE format('CREATE POLICY "public delete" ON %I FOR DELETE USING (true)', table_name);
    END LOOP;
END $$;
