"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Download, Share2 } from "lucide-react";

// Matches the structure we'll use in the main page
export interface ImagePreview {
  id: string;
  url: string;
  prompt: string;
  width?: number;
  height?: number;
  aspect_ratio?: string;
  model: string;
}

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: ImagePreview[];
  selectedIndex: number;
  onNavigate: (index: number) => void;
}

export default function ImagePreviewModal({
  isOpen,
  onClose,
  images,
  selectedIndex,
  onNavigate,
}: ImagePreviewModalProps) {
  const currentImage = images[selectedIndex];

  // Keyboard Listeners
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") {
        onNavigate((selectedIndex - 1 + images.length) % images.length);
      }
      if (e.key === "ArrowRight") {
        onNavigate((selectedIndex + 1) % images.length);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, onNavigate, selectedIndex, images.length]);

  if (!currentImage) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm"
          onClick={onClose} // Close on backdrop click
        >
          {/* Close Button */}
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="absolute top-4 right-4 z-50 p-2 text-white/70 hover:text-white bg-black/50 hover:bg-black/80 rounded-full transition-colors"
          >
            <X size={24} />
          </button>

          {/* Navigation Buttons */}
          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous image"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate((selectedIndex - 1 + images.length) % images.length);
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:text-white bg-black/50 hover:bg-black/80 rounded-full transition-colors z-50 hidden md:block"
              >
                <ChevronLeft size={32} />
              </button>
              <button
                type="button"
                aria-label="Next image"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate((selectedIndex + 1) % images.length);
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:text-white bg-black/50 hover:bg-black/80 rounded-full transition-colors z-50 hidden md:block"
              >
                <ChevronRight size={32} />
              </button>
            </>
          )}

          {/* Main Content Modal */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()} // Prevent close on modal click
            className="relative flex flex-col md:flex-row w-full max-w-[95vw] h-full md:h-[95vh] bg-zinc-900 rounded-none md:rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl"
          >
            {/* Image Section */}
            <div className="flex-1 relative flex items-center justify-center bg-zinc-950/50 p-2">
              <div className="relative w-full h-full max-h-[70vh] md:max-h-full flex items-center justify-center">
                <img
                  src={currentImage.url}
                  alt={currentImage.prompt}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            </div>

            {/* Metadata Section */}
            <div className="w-full md:w-96 shrink-0 bg-zinc-900 p-6 border-l border-zinc-800 overflow-y-auto">
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">
                    Prompt
                  </h3>
                  <p className="text-zinc-100 text-sm leading-relaxed whitespace-pre-wrap">
                    {currentImage.prompt}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                      Model
                    </h3>
                    <div className="text-sm text-zinc-300 font-mono bg-zinc-800 px-2 py-1 rounded inline-block">
                      {currentImage.model}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                      Resolution
                    </h3>
                    <p className="text-sm text-zinc-300">
                      {currentImage.width && currentImage.height
                        ? `${currentImage.width} x ${currentImage.height}`
                        : currentImage.aspect_ratio || "Unknown"}
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-zinc-800 flex gap-3">
                  <button type="button" className="flex-1 flex items-center justify-center gap-2 bg-white text-black py-2.5 px-4 rounded-lg font-medium hover:bg-zinc-200 transition-colors">
                    <Download size={18} />
                    Download
                  </button>
                  <button type="button" aria-label="Share image" className="flex items-center justify-center p-2.5 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors border border-zinc-700">
                    <Share2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
