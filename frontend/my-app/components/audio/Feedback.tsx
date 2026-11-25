"use client";

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, CheckCircle2, KeyRound, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** ElevenLabs has no API key on the backend: say exactly what to set. */
export function NotConfiguredNotice({ className }: { className?: string }) {
  return (
    <div role="alert" className={cn('flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100', className)}>
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      <p>
        ElevenLabs isn&apos;t connected. Add <code className="font-mono text-amber-200">ELEVENLABS_API_KEY=...</code> to{' '}
        <code className="font-mono text-amber-200">backend/.env</code>, then restart the API.
      </p>
    </div>
  );
}

/** A failed request: the backend's own message, and a way to try again. */
export function ErrorBanner({ message, onRetry, onDismiss, className }: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200', className)}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
      <p className="flex-1">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold text-red-100 hover:bg-red-500/20">
          <RefreshCw className="h-3 w-3" />Try again
        </button>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-red-300 hover:text-red-100"><X className="h-4 w-4" /></button>
      )}
    </div>
  );
}

/** Confirms a finished action in the same words as the button that started it. */
export function SuccessNotice({ children, onDismiss, className }: { children: ReactNode; onDismiss?: () => void; className?: string }) {
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100', className)}>
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-emerald-300 hover:text-emerald-100"><X className="h-4 w-4" /></button>
      )}
    </div>
  );
}

/** Nothing here yet: say what goes here and how to get it. */
export function EmptyState({ icon: Icon, title, children, action, className }: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 px-6 py-12 text-center', className)}>
      <Icon className="h-7 w-7 text-zinc-600" />
      <p className="mt-3 text-base font-semibold text-zinc-200">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-zinc-400">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('space-y-3', className)}>
      {Array.from({ length: count }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-zinc-900/70" />)}
    </div>
  );
}

/** Short guidance next to a form. */
export function HelpHint({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <p className="text-sm font-semibold text-zinc-200">{title}</p>
      <div className="mt-1.5 space-y-1.5 text-sm leading-6 text-zinc-400">{children}</div>
    </div>
  );
}

/** Page title and one sentence on what the tool does. */
export function ToolPageHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="space-y-2">
      <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">{title}</h1>
      <p className="max-w-2xl text-base text-zinc-400">{children}</p>
    </header>
  );
}
