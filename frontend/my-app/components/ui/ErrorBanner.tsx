"use client";

import { AlertCircle, ExternalLink, X } from 'lucide-react';
import { ApiError } from '@/lib/api/errors';

interface ErrorBannerProps {
  /** A message, or a caught error. An ApiError with an action link shows that link as a button. */
  error: string | Error | null;
  onDismiss?: () => void;
  className?: string;
}

/** Inline error for a failed action. It never blocks the page: people can dismiss it and keep working. */
export function ErrorBanner({ error, onDismiss, className = '' }: ErrorBannerProps) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message;
  const action = error instanceof ApiError && error.actionUrl ? { url: error.actionUrl, label: error.actionLabel ?? 'Fix this' } : null;

  return (
    <div role="alert" className={`flex items-start gap-2 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 ${className}`}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p>{message}</p>
        {action && (
          <a href={action.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-red-200 underline underline-offset-2 hover:text-white">
            {action.label}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss error" className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center text-red-300/70 hover:text-red-100">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
