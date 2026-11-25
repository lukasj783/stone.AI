"use client";

import { AlertCircle, ExternalLink, RefreshCw, X } from 'lucide-react';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils';

interface ErrorBannerProps {
  /** A message, or a caught error. An ApiError with an action link (such as "Add credit") shows it as a link. */
  error: string | Error | null | undefined;
  onDismiss?: () => void;
  onRetry?: () => void;
  /** Smaller text and padding, for side panels and toolbars. */
  compact?: boolean;
  className?: string;
}

/**
 * The one inline error used across the app. It never blocks the page: people can read what went
 * wrong, follow the fix link when there is one, try again, or dismiss it and keep working.
 */
export function ErrorBanner({ error, onDismiss, onRetry, compact = false, className }: ErrorBannerProps) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message;
  const action = error instanceof ApiError && error.actionUrl ? { url: error.actionUrl, label: error.actionLabel ?? 'Fix this' } : null;

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 border border-red-500/30 bg-red-500/10 text-red-300',
        compact ? 'rounded-md px-2.5 py-2 text-xs' : 'px-4 py-3 text-sm',
        className,
      )}
    >
      <AlertCircle className={cn('shrink-0', compact ? 'mt-px h-3.5 w-3.5' : 'mt-0.5 h-4 w-4')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="break-words">{message}</p>
        {action && (
          <a href={action.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-red-200 underline underline-offset-2 hover:text-white">
            {action.label}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold text-red-100 hover:bg-red-500/20">
          <RefreshCw className="h-3 w-3" aria-hidden />Try again
        </button>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss error" className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center text-red-300/70 hover:text-red-100">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
