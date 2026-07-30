-- Durable project-wide storyboard-to-video rendering batches.

CREATE TABLE IF NOT EXISTS video_generation_batches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    model TEXT NOT NULL DEFAULT 'bytedance/seedance-2.0/image-to-video',
    settings JSONB NOT NULL DEFAULT '{}',
    status generation_status NOT NULL DEFAULT 'queued',
    total_jobs INTEGER NOT NULL DEFAULT 0,
    completed_jobs INTEGER NOT NULL DEFAULT 0,
    failed_jobs INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS video_generation_batches_project_status_idx
    ON video_generation_batches(project_id, status, created_at DESC);

DROP TRIGGER IF EXISTS video_generation_batches_updated_at ON video_generation_batches;
CREATE TRIGGER video_generation_batches_updated_at
    BEFORE UPDATE ON video_generation_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

ALTER TABLE generation_jobs
    ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES video_generation_batches(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS provider_prediction_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_result_url TEXT,
    ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_poll_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS generation_jobs_batch_status_idx
    ON generation_jobs(batch_id, status, created_at);

ALTER TABLE video_generation_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public select" ON video_generation_batches;
DROP POLICY IF EXISTS "public insert" ON video_generation_batches;
DROP POLICY IF EXISTS "public update" ON video_generation_batches;
DROP POLICY IF EXISTS "public delete" ON video_generation_batches;
CREATE POLICY "public select" ON video_generation_batches FOR SELECT USING (true);
CREATE POLICY "public insert" ON video_generation_batches FOR INSERT WITH CHECK (true);
CREATE POLICY "public update" ON video_generation_batches FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public delete" ON video_generation_batches FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';