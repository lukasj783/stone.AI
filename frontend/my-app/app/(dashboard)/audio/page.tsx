"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Clapperboard, Copy, Library, Mic2, Sparkles } from 'lucide-react';
import ActionCard from '@/components/ui/ActionCard';
import { type AudioOverview, getAudioOverview } from '@/lib/api/audio';
import { useProject } from '@/lib/useProject';
import type { Project } from '@/lib/types/layers.types';
import { EmptyState, ErrorBanner, NotConfiguredNotice, SkeletonRows, ToolPageHeader } from '@/components/audio/Feedback';
import { errorText } from '@/components/audio/shared';

const TOOLS = [
  { title: 'Text to speech', desc: 'Type a line, pick a voice and hear it. Download the clip.', icon: Mic2, color: 'text-purple-400', href: '/audio/text-to-speech', isPopular: true },
  { title: 'Voice library', desc: 'Browse every voice you can use and play its sample.', icon: Library, color: 'text-zinc-300', href: '/audio/voices' },
  { title: 'Design a voice', desc: 'Describe a voice in words and choose from a few previews.', icon: Sparkles, color: 'text-sky-400', href: '/audio/voice-design' },
  { title: 'Clone a voice', desc: 'Turn recordings of a consenting speaker into a voice.', icon: Copy, color: 'text-violet-400', href: '/audio/voice-clone' },
];

/** How many recent projects show their audio progress. */
const RECENT_PROJECTS = 6;

type ProjectAudio = { project: Project; overview: AudioOverview | null; error: string | null };

/** The most recent Studio projects with their audio overview; one failed project doesn't hide the rest. */
async function loadProjectAudio(listStudioProjects: () => Promise<Project[]>): Promise<ProjectAudio[]> {
  const recent = (await listStudioProjects()).slice(0, RECENT_PROJECTS);
  const results = await Promise.allSettled(recent.map((project) => getAudioOverview(project.id)));
  return recent.map((project, index) => {
    const result = results[index];
    return result.status === 'fulfilled'
      ? { project, overview: result.value, error: null }
      : { project, overview: null, error: errorText(result.reason, 'Could not load this project') };
  });
}

function ProjectAudioRow({ project, overview, error }: ProjectAudio) {
  const studioHref = `/studio?project=${encodeURIComponent(project.id)}&view=voices`;
  const totalLines = overview?.scenes.reduce((sum, scene) => sum + scene.line_count, 0) ?? 0;
  const voicedLines = overview?.scenes.reduce((sum, scene) => sum + Math.min(scene.generated_count, scene.line_count), 0) ?? 0;
  const speaking = overview?.cast.filter((member) => member.line_count > 0) ?? [];
  const withVoice = speaking.filter((member) => member.voice_id).length;
  const needsNarrator = Boolean(overview && overview.narrator_line_count > 0 && !overview.narrator_voice_id);
  const percent = totalLines ? Math.round((voicedLines / totalLines) * 100) : 0;

  let status: string;
  if (error) status = error;
  else if (!overview) status = 'Loading...';
  else if (totalLines === 0) status = 'No narration or dialogue in the script yet';
  else status = `${voicedLines} of ${totalLines} lines voiced`;

  return (
    <li className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <p className="truncate font-semibold text-zinc-100">{project.name}</p>
        {overview && speaking.length > 0 && (
          <p className="mt-0.5 text-sm text-zinc-400">
            {withVoice} of {speaking.length} speaking character{speaking.length === 1 ? ' has' : 's have'} a voice
            {needsNarrator && <span className="text-amber-300">. The narrator needs a voice</span>}
          </p>
        )}
      </div>
      <div>
        <p className={error ? 'text-sm text-red-300' : 'text-sm tabular-nums text-zinc-300'}>{status}</p>
        {overview && totalLines > 0 && (
          <div
            role="progressbar"
            aria-label={`${project.name} lines voiced`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800"
          >
            <div className="h-full rounded-full bg-purple-500" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      <Link href={studioHref} className="justify-self-start rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500 hover:text-white sm:justify-self-end">
        Open in Studio
      </Link>
    </li>
  );
}

export default function AudioHomePage() {
  const { listStudioProjects, projectsError } = useProject();
  const [rows, setRows] = useState<ProjectAudio[] | null>(null);

  const load = useCallback(() => loadProjectAudio(listStudioProjects), [listStudioProjects]);

  useEffect(() => {
    let isMounted = true;
    void load().then((loaded) => { if (isMounted) setRows(loaded); });
    return () => { isMounted = false; };
  }, [load]);
  const retry = () => { setRows(null); void load().then(setRows); };

  const notConfigured = rows?.some((row) => row.overview && !row.overview.configured) ?? false;

  return (
    <>
      <ToolPageHeader title="Give your stories a voice">
        Narration and character dialogue with ElevenLabs. Try voices here, then give them to the cast of a story project.
      </ToolPageHeader>

      <section aria-label="Audio tools" className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {TOOLS.map(({ href, ...tool }) => (
          <Link key={href} href={href} className="rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-purple-400">
            <ActionCard {...tool} className="h-44 px-7 py-6" />
          </Link>
        ))}
      </section>

      <section className="space-y-4 border-t border-zinc-900 pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold text-zinc-100">Story projects</h2>
          <Link href="/studio" className="text-sm font-semibold text-purple-300 hover:text-purple-200">Open Studio</Link>
        </div>

        {notConfigured && <NotConfiguredNotice />}
        {projectsError ? (
          <ErrorBanner message={projectsError} onRetry={retry} />
        ) : rows === null ? (
          <SkeletonRows count={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Clapperboard}
            title="No story projects yet"
            action={<Link href="/studio" className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-500">Start a story</Link>}
          >
            Write a script in Studio and its narration and dialogue show up here, ready to voice.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-900 rounded-2xl border border-zinc-800 bg-zinc-950/60">
            {rows.map((row) => <ProjectAudioRow key={row.project.id} {...row} />)}
          </ul>
        )}
      </section>
    </>
  );
}
