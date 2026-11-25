"use client";

import { useState } from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import type { ClonedVoice } from '@/lib/api/audio';
import { CloneVoiceForm } from '@/components/audio/CloneVoiceForm';
import { ProjectAssignPicker } from '@/components/audio/ProjectAssignPicker';
import { HelpHint, SuccessNotice, ToolPageHeader } from '@/components/audio/Feedback';

/** The clone exists but ElevenLabs won't let it speak until the speaker verifies it. */
function VerificationRequiredNotice({ name }: { name: string }) {
  return (
    <div role="status" className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      <p>
        &ldquo;{name}&rdquo; needs the speaker to verify it before it can speak. On elevenlabs.io, open My Voices, select the voice and
        follow the verification step. It takes about a minute.
      </p>
    </div>
  );
}

export default function VoiceClonePage() {
  const [cloned, setCloned] = useState<{ voice: ClonedVoice; target: string | null; projectId: string } | null>(null);
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <ToolPageHeader title="Clone a voice">
        Upload recordings of one person and use their voice for a character or the narrator. Only clone a voice with the speaker&apos;s permission.
      </ToolPageHeader>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          {cloned && (
            <>
              <SuccessNotice onDismiss={() => setCloned(null)}>
                Cloned &ldquo;{cloned.voice.name}&rdquo;{cloned.target ? ` and gave it to ${cloned.target}` : ' and added it to your voices'}.{' '}
                <Link href={`/studio?project=${encodeURIComponent(cloned.projectId)}&view=voices`} className="font-semibold underline underline-offset-2">Open in Studio</Link>
              </SuccessNotice>
              {cloned.voice.requires_verification && <VerificationRequiredNotice name={cloned.voice.name} />}
            </>
          )}
          <ProjectAssignPicker>
            {({ projectId, overview }, reload) => (
              <CloneVoiceForm
                key={`${projectId}-${formKey}`}
                projectId={projectId}
                cast={overview.cast}
                initialAssignTo={null}
                initialName=""
                onCloned={(voice) => {
                  const target = voice.assigned_to === 'narrator'
                    ? 'the narrator'
                    : overview.cast.find((member) => member.character_id === voice.assigned_to)?.name ?? null;
                  setCloned({ voice, target, projectId });
                  setFormKey((key) => key + 1);
                  reload();
                }}
              />
            )}
          </ProjectAssignPicker>
        </div>

        <aside className="space-y-4">
          <HelpHint title="Recording tips">
            <p>One to two minutes of one person speaking naturally works best. Several short files are fine.</p>
            <p>Record somewhere quiet, with no music and no other voices. Vary the tone a little: a question, a laugh, a calm sentence.</p>
            <p>Up to 10 files, in MP3, WAV, M4A, OGG, FLAC or WebM.</p>
          </HelpHint>
          <HelpHint title="Permission">
            <p>You must be the speaker or have their permission. ElevenLabs may ask the speaker to read a short text aloud to confirm it before the voice can be used.</p>
          </HelpHint>
        </aside>
      </div>
    </>
  );
}
