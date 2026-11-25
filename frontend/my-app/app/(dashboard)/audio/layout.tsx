import type { Metadata } from 'next';
import { AudioNav } from '@/components/audio/AudioNav';

export const metadata: Metadata = { title: 'Audio' };

export default function AudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
      <AudioNav />
      <div className="min-w-0 flex-1 space-y-8">{children}</div>
    </div>
  );
}
