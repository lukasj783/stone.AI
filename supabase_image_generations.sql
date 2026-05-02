-- Apply this SQL in your Supabase SQL Editor:

CREATE TABLE image_generations (
    id SERIAL PRIMARY KEY,
    model TEXT,
    prompt TEXT,
    aspect_ratio TEXT,
    num_images INTEGER,
    resolution TEXT,
    image_mapping JSONB,
    result_images TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Note: Depending on your RLS (Row Level Security) settings, you may need to allow public viewing/inserting
-- (if you do not authenticate users yet):
-- ALTER TABLE image_generations ENABLE ROW LEVEL SECURITY;
-- create policy "public select" on image_generations for select using (true);
-- create policy "public insert" on image_generations for insert with check (true);