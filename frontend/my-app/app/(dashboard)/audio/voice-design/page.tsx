"use client";

import { useState } from 'react';
import Link from 'next/link';
import type { SavedDesignedVoice } from '@/lib/api/audio';
import { DesignVoiceForm } from '@/components/audio/DesignVoiceForm';
import { ProjectAssignPicker } from '@/components/audio/ProjectAssignPicker';
import { HelpHint, SuccessNotice, ToolPageHeader } from '@/components/audio/Feedback';

export default function VoiceDesignPage() {
  const [saved, setSaved] = useState<{ voice: SavedDesignedVoice; target: string | null; projectId: string } | null>(null);
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <ToolPageHeader title="Design a voice">
        Describe a voice in words and ElevenLabs makes a few to choose from. No recordings needed.
      </ToolPageHeader>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          {saved && (
            <SuccessNotice onDismiss={() => setSaved(null)}>
              Saved &ldquo;{saved.voice.name}&rdquo;{saved.target ? ` and gave it to ${saved.target}` : ' to your voices'}.{' '}
              <Link href={`/studio?project=${encodeURIComponent(saved.projectId)}&view=voices`} className="font-semibold underline underline-offset-2">Open in Studio</Link>
            </SuccessNotice>
          )}
          <ProjectAssignPicker>
            {({ projectId, overview }, reload) => (
              <DesignVoiceForm
                key={`${projectId}-${formKey}`}
                projectId={projectId}
                cast={overview.cast}
                initialAssignTo={null}
                onSaved={(voice) => {
                  const target = voice.assigned_to === 'narrator'
                    ? 'the narrator'
                    : overview.cast.find((member) => member.character_id === voice.assigned_to)?.name ?? null;
                  setSaved({ voice, target, projectId });
                  setFormKey((key) => key + 1);
                  reload();
                }}
              />
            )}
          </ProjectAssignPicker>
        </div>

        <aside className="space-y-4">
          <HelpHint title="Writing a good description">
            <p>Say who is speaking and how they sound: age, accent, tone and pace. For example, &ldquo;An elderly Swahili storyteller, warm and slow, with a slight rasp.&rdquo;</p>
            <p>Pick a character in <span className="text-zinc-200">For</span> and the description is filled in from your script. You can still change it.</p>
          </HelpHint>
          <HelpHint title="What happens next">
            <p>You get a few previews to compare. Nothing is saved until you choose one and press <span className="text-zinc-200">Keep this voice</span>.</p>
            <p>A kept voice also appears in the <Link href="/audio/voices" className="text-purple-300 underline underline-offset-2">voice library</Link>.</p>
          </HelpHint>
        </aside>
      </div>
    </>
  );
}
