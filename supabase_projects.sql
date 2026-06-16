-- Apply this SQL in your Supabase SQL Editor:

CREATE TABLE projects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Untitled',
    timeline_state JSONB NOT NULL DEFAULT '{}',
    user_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Public access policies (adjust when auth is added)
CREATE POLICY "public select" ON projects FOR SELECT USING (true);
CREATE POLICY "public insert" ON projects FOR INSERT WITH CHECK (true);
CREATE POLICY "public update" ON projects FOR UPDATE USING (true);
CREATE POLICY "public delete" ON projects FOR DELETE USING (true);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();