"use client";

import React, { useEffect, useState, useMemo } from 'react';

interface VideoTimelineFilmstripProps {
  url: string;
  duration: number;
  trimStart?: number;
  sourceDuration?: number;
}

const THUMB_W = 120;
const THUMB_H = 68;
const MAX_THUMBS = 30;
const MIN_THUMBS = 4;

/**
 * **Dynamic Filmstrip** — captures multiple frames at evenly-spaced intervals
 * across the video and composites them into a sprite-sheet displayed as a
 * background image on the clip. Each thumbnail aligns with its timeline position.
 *
 * Feature name: "Dynamic Filmstrip" (aka "Live Filmstrip" / "Video Thumbnail Strip")
 *
 * Strategy:
 * 1. A native <video> element is always rendered as the base layer (immediate visual)
 * 2. The video is fetched as a blob to bypass CORS for canvas operations
 * 3. Frame extraction uses the blob URL — no canvas tainting, toDataURL works
 * 4. The sprite sheet overlays the base video when ready
 */
export function VideoTimelineFilmstrip({
  url,
  duration,
  trimStart = 0,
  sourceDuration,
}: VideoTimelineFilmstripProps) {
  const captureKey = useMemo(
    () => `${url}|${duration}|${trimStart}|${sourceDuration}`,
    [url, duration, trimStart, sourceDuration],
  );

  // Sprite result tagged with the captureKey it was produced from
  const [sprite, setSprite] = useState<{ key: string; url: string } | null>(null);
  const isReady = sprite !== null && sprite.key === captureKey;
  const spriteDataUrl = isReady ? sprite!.url : null;

  useEffect(() => {
    if (!url) return;

    const thisKey = captureKey;
    let cancelled = false;
    let blobUrl: string | null = null;

    const run = async () => {
      try {
        // ── Step 1: Fetch video as blob to bypass CORS ──
        // This guarantees canvas.toDataURL() won't be blocked by CORS.
        try {
          const resp = await fetch(url, { mode: 'cors' });
          if (resp.ok) {
            const blob = await resp.blob();
            blobUrl = URL.createObjectURL(blob);
          }
        } catch {
          // If fetch with cors mode fails, try without (same-origin)
          try {
            const resp = await fetch(url);
            if (resp.ok) {
              const blob = await resp.blob();
              blobUrl = URL.createObjectURL(blob);
            }
          } catch {
            // Fetch failed entirely — will try direct URL as last resort
          }
        }

        if (cancelled) return;

        // Use blob URL if available, otherwise fall back to original URL
        const videoSrc = blobUrl || url;

        // ── Step 2: Create off-DOM video for frame extraction ──
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        // No crossOrigin attribute — not needed with blob URL

        // ── Step 3: Wait for video to be ready ──
        await new Promise<void>((resolve) => {
          const onReady = () => { video.removeEventListener('loadeddata', onReady); video.removeEventListener('error', onErr); resolve(); };
          const onErr = () => { video.removeEventListener('loadeddata', onReady); video.removeEventListener('error', onErr); resolve(); };
          video.addEventListener('loadeddata', onReady, { once: true });
          video.addEventListener('error', onErr, { once: true });
          setTimeout(resolve, 10000);
          video.src = videoSrc;
        });

        if (cancelled) {
          video.removeAttribute('src'); video.load();
          return;
        }

        // ── Step 4: Calculate frame positions ──
        const srcDur = (sourceDuration && sourceDuration > 0)
          ? sourceDuration
          : (isFinite(video.duration) && video.duration > 0)
            ? video.duration
            : duration;

        const trim = Math.max(0, Math.min(trimStart, srcDur - 0.1));
        const endTime = Math.min(trim + duration, srcDur);
        const range = endTime - trim;

        if (range <= 0) {
          video.removeAttribute('src'); video.load();
          return;
        }

        const count = Math.min(MAX_THUMBS, Math.max(MIN_THUMBS, Math.ceil(range)));
        const interval = range / count;

        // ── Step 5: Create sprite canvas ──
        const spriteCanvas = document.createElement('canvas');
        spriteCanvas.width = count * THUMB_W;
        spriteCanvas.height = THUMB_H;
        const ctx = spriteCanvas.getContext('2d');
        if (!ctx) {
          video.removeAttribute('src'); video.load();
          return;
        }
        ctx.fillStyle = '#18181b';
        ctx.fillRect(0, 0, spriteCanvas.width, spriteCanvas.height);

        // ── Step 6: Capture frames ──
        const seekAndWait = (t: number) => new Promise<void>((resolve) => {
          const onDone = () => { video.removeEventListener('seeked', onDone); clearTimeout(fb); resolve(); };
          const fb = setTimeout(() => { video.removeEventListener('seeked', onDone); resolve(); }, 3000);
          video.addEventListener('seeked', onDone, { once: true });
          video.currentTime = t;
        });

        let captured = 0;
        for (let i = 0; i < count; i++) {
          if (cancelled) break;

          const t = Math.min(trim + i * interval + interval / 2, srcDur - 0.05);
          await seekAndWait(Math.max(0, t));
          if (cancelled) break;

          await new Promise(r => setTimeout(r, 60));

          try {
            ctx.drawImage(video, i * THUMB_W, 0, THUMB_W, THUMB_H);
            captured++;
          } catch {
            // Frame decode error — placeholder already drawn
          }
        }

        // Cleanup video
        video.removeAttribute('src');
        video.load();

        if (cancelled || captured === 0) return;

        // ── Step 7: Export sprite sheet ──
        try {
          const dataUrl = spriteCanvas.toDataURL('image/jpeg', 0.5);
          if (!cancelled) {
            setSprite({ key: thisKey, url: dataUrl });
          }
        } catch {
          // Canvas tainted — shouldn't happen with blob URL
        }
      } catch {
        // Entire process failed — base video remains
      } finally {
        // Revoke blob URL to free memory
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
        }
      }
    };

    run();

    return () => { cancelled = true; };
  }, [captureKey, url, duration, trimStart, sourceDuration]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Base layer: native video element — always visible, provides immediate feedback */}
      <video
        src={url}
        className="absolute inset-0 w-full h-full object-cover"
        preload="metadata"
        muted
        playsInline
        aria-hidden="true"
        style={{ opacity: spriteDataUrl ? 0 : 0.4 }}
      />

      {/* Overlay: Dynamic Filmstrip sprite sheet */}
      {spriteDataUrl && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${spriteDataUrl})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: '100% 100%',
            opacity: 0.8,
          }}
        />
      )}
    </div>
  );
}