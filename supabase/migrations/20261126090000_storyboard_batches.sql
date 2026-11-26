-- Project-wide storyboard batches: "Generate All Scenes at Once".
--
-- A batch has one generation_jobs row per scene (kind 'storyboard', storyboard_batch_id set).
-- Scene jobs plan their shots on the storyboard-plan Celery queue; every shot's frame is then
-- rendered as its own task on the storyboard-image queue, whose worker count caps how many
-- images run at the same time. Progress is read from the scene jobs and their shots.

create table if not exists public.storyboard_batches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  model text not null,
  settings jsonb not null default '{}',
  status generation_status not null default 'queued',
  total_scenes integer not null default 0,
  error_message text,
  created_at timestamptz default current_timestamp,
  updated_at timestamptz default current_timestamp,
  completed_at timestamptz
);

create index if not exists storyboard_batches_project_status_idx
  on public.storyboard_batches (project_id, status, created_at desc);

drop trigger if exists storyboard_batches_updated_at on public.storyboard_batches;
create trigger storyboard_batches_updated_at
  before update on public.storyboard_batches
  for each row
  execute function update_updated_at();

alter table public.generation_jobs
  add column if not exists storyboard_batch_id uuid references public.storyboard_batches(id) on delete set null;

create index if not exists generation_jobs_storyboard_batch_idx
  on public.generation_jobs (storyboard_batch_id, status);

alter table public.storyboard_batches enable row level security;
drop policy if exists "public select" on public.storyboard_batches;
drop policy if exists "public insert" on public.storyboard_batches;
drop policy if exists "public update" on public.storyboard_batches;
drop policy if exists "public delete" on public.storyboard_batches;
create policy "public select" on public.storyboard_batches for select using (true);
create policy "public insert" on public.storyboard_batches for insert with check (true);
create policy "public update" on public.storyboard_batches for update using (true) with check (true);
create policy "public delete" on public.storyboard_batches for delete using (true);

notify pgrst, 'reload schema';
