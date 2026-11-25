"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AudioLines, Copy, Library, Mic2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export const AUDIO_TOOLS = [
  { label: 'Audio home', href: '/audio', icon: AudioLines },
  { label: 'Text to speech', href: '/audio/text-to-speech', icon: Mic2 },
  { label: 'Voice library', href: '/audio/voices', icon: Library },
  { label: 'Design a voice', href: '/audio/voice-design', icon: Sparkles },
  { label: 'Clone a voice', href: '/audio/voice-clone', icon: Copy },
] as const;

/** The Audio section's own menu: a column on wide screens, a scrolling row of tabs on phones. */
export function AudioNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Audio tools" className="lg:w-52 lg:shrink-0">
      <ul className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
        {AUDIO_TOOLS.map(({ label, href, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 whitespace-nowrap rounded-lg border px-4 py-2.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-purple-400',
                  isActive
                    ? 'border-zinc-800 bg-zinc-900 text-white'
                    : 'border-transparent text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
                )}
              >
                <Icon className={cn('h-4 w-4', isActive ? 'text-purple-400' : 'text-zinc-500')} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
