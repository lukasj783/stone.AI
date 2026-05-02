-- Apply this SQL in your Supabase SQL Editor:

CREATE TABLE video_generations (
    id SERIAL PRIMARY KEY,
    generation_type TEXT,
    model TEXT,
    prompt TEXT,
    aspect_ratio TEXT,
    duration INTEGER,
    resolution TEXT,
    result_video_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Note: Depending on your RLS (Row Level Security) settings, you may need to allow public viewing/inserting
-- (if you do not authenticate users yet):
-- ALTER TABLE video_generations ENABLE ROW LEVEL SECURITY;
-- create policy "public select" on video_generations for select using (true);
-- create policy "public insert" on video_generations for insert with check (true);
