"use client";

import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';

interface AlertModalProps {
  isOpen: boolean;
  type?: 'info' | 'warning' | 'error' | 'success' | 'confirm';
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isPending?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
}

export default function AlertModal({
  isOpen,
  type = 'info',
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  isPending = false,
  onConfirm,
  onClose,
}: AlertModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPending, onClose]);

  // Determine Icon & Styling color scheme based on alert type
  let Icon = Info;
  let iconClass = "bg-violet-500/10 text-violet-400 border-violet-500/20";
  let actionButtonClass = "bg-violet-600 hover:bg-violet-500 text-white";

  switch (type) {
    case 'success':
      Icon = CheckCircle2;
      iconClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      actionButtonClass = "bg-emerald-600 hover:bg-emerald-500 text-white";
      break;
    case 'warning':
      Icon = AlertTriangle;
      iconClass = "bg-amber-500/10 text-amber-400 border-amber-500/20";
      actionButtonClass = "bg-amber-600 hover:bg-amber-500 text-white";
      break;
    case 'error':
      Icon = AlertCircle;
      iconClass = "bg-rose-500/10 text-rose-400 border-rose-500/20";
      actionButtonClass = "bg-rose-600 hover:bg-rose-500 text-white";
      break;
    case 'confirm':
      Icon = AlertTriangle;
      iconClass = "bg-amber-500/10 text-amber-400 border-amber-500/20";
      actionButtonClass = "bg-violet-600 hover:bg-violet-500 text-white";
      break;
  }

  const handleAction = () => {
    if (type === 'confirm' && onConfirm) {
      onConfirm();
    } else {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-[3px]"
          onClick={() => {
            if (!isPending) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(event) => event.stopPropagation()}
            className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-[#0F0F12] p-6 shadow-2xl shadow-black/80"
          >
            {/* Close Icon (Top Corner) */}
            <button
              type="button"
              aria-label="Close dialog"
              onClick={onClose}
              disabled={isPending}
              className="absolute right-4 top-4 rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={15} />
            </button>

            {/* Modal Body */}
            <div className="flex gap-4 items-start pb-2">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${iconClass}`}>
                <Icon size={20} />
              </div>
              <div className="space-y-1.5 flex-1 pr-6">
                <h3 className="text-base font-bold text-zinc-100 font-sans tracking-tight">{title}</h3>
                <p className="text-sm text-zinc-400 font-sans leading-relaxed whitespace-pre-wrap">{message}</p>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="mt-6 flex justify-end gap-2.5">
              {type === 'confirm' && (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isPending}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900 hover:border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cancelLabel}
                </button>
              )}
              <button
                type="button"
                onClick={handleAction}
                disabled={isPending}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${actionButtonClass}`}
              >
                {isPending && <Loader2 size={13} className="animate-spin" />}
                {isPending ? 'Processing...' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
