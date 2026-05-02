"use client";

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  CreditCard,
  Upload,
  Sparkles,
  Image as ImageIcon,
  Download,
  Save,
  RotateCcw,
  Wand2,
  Clock,
} from 'lucide-react';

type UpscaleFactor = '2x' | '4x';
type OutputFormat = 'PNG' | 'JPG' | 'WEBP';
type JobState = 'idle' | 'processing' | 'done';

export default function ImageUpscalePage() {
  const pathname = usePathname();

  const secondaryNav = [
    { label: 'Image Home', href: '/image' },
    { label: 'Create Image', href: '/image/create' },
    { label: 'Edit Image', href: '/image/edit' },
    { label: 'Chat to Edit', href: '/image/chat' },
    { label: 'Face Swap', href: '/image/face-swap' },
    { label: 'Character', href: '/image/character' },
    { label: 'Image Upscale', href: '/image/upscale' },
    { label: 'Train a Model', href: '/image/train' },
  ];

  const [hasImage, setHasImage] = useState(false);
  const [factor, setFactor] = useState<UpscaleFactor>('2x');
  const [format, setFormat] = useState<OutputFormat>('PNG');
  const [quality, setQuality] = useState(90);
  const [faceEnhancement, setFaceEnhancement] = useState(true);
  const [stylePreservation, setStylePreservation] = useState(true);
  const [jobState, setJobState] = useState<JobState>('idle');
  const [progress, setProgress] = useState(0);

  const isProcessing = jobState === 'processing';
  const hasResult = jobState === 'done';

  const startUpscale = () => {
    if (!hasImage || isProcessing) return;

    setJobState('processing');
    setProgress(0);

    const timer = window.setInterval(() => {
      setProgress((prev) => {
        const next = prev + 10;
        if (next >= 100) {
          window.clearInterval(timer);
          setJobState('done');
          return 100;
        }
        return next;
      });
    }, 250);
  };

  const startNew = () => {
    setHasImage(false);
    setJobState('idle');
    setProgress(0);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-5">
        <aside className="lg:w-52 space-y-8 shrink-0">
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-4">Image Controls</h3>
            <div className="space-y-1">
              {secondaryNav.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`block w-full text-left px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
                    pathname === item.href
                      ? 'bg-zinc-900 text-white border border-zinc-800'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-linear-to-br from-zinc-900 to-black border border-zinc-800 space-y-4">
            <div className="flex items-center gap-2 text-zinc-400">
              <CreditCard size={14} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Remaining Credits</span>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-black text-white">480</div>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className="w-[40%] h-full bg-yellow-500" />
              </div>
            </div>
            <button type="button" className="w-full py-2 rounded-lg bg-yellow-500 text-black text-xs font-bold hover:bg-yellow-400 transition-colors">
              Upgrade Now
            </button>
          </div>
        </aside>

        <div className="flex-1 min-w-0 space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-8 space-y-6">
              {!hasImage ? (
                <div className="bg-zinc-900/40 border-2 border-dashed border-zinc-700 rounded-2xl p-12 min-h-105 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-18 h-18 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Upload className="text-blue-400" size={30} />
                  </div>
                  <h2 className="text-white font-bold text-xl">Upload image to upscale</h2>
                  <p className="text-zinc-500 text-sm">Supports JPG, PNG, WEBP • max 10MB</p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setHasImage(true);
                        setJobState('idle');
                        setProgress(0);
                      }}
                      className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors flex items-center gap-2"
                    >
                      <Upload size={16} />
                      Upload Image
                    </button>
                    <button type="button" className="px-5 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800/60 text-sm font-bold transition-colors flex items-center gap-2">
                      <Clock size={16} />
                      Select from History
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-4 md:p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950">
                      <div className="px-3 py-2 border-b border-zinc-800 text-xs font-bold text-zinc-400">Before • 1024 x 1024</div>
                      <div className="aspect-square flex items-center justify-center relative">
                        <img
                          src="https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80"
                          alt="Source image"
                          className="w-full h-full object-cover opacity-90"
                        />
                      </div>
                    </div>

                    <div className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950">
                      <div className="px-3 py-2 border-b border-zinc-800 text-xs font-bold text-zinc-400">After • {factor === '2x' ? '2048 x 2048' : '4096 x 4096'}</div>
                      <div className="aspect-square flex items-center justify-center relative">
                        {hasResult ? (
                          <img
                            src="https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1400&q=95"
                            alt="Upscaled image"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 gap-2">
                            <ImageIcon size={28} />
                            <span className="text-xs">Result preview appears here</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-zinc-400">
                      <span>Upscale Progress</span>
                      <span>{progress}%</span>
                    </div>
                    <progress
                      value={progress}
                      max={100}
                      className="w-full h-2 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-zinc-800 [&::-webkit-progress-value]:bg-blue-500 [&::-moz-progress-bar]:bg-blue-500"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="xl:col-span-4 space-y-5">
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-5 space-y-5">
                <h3 className="text-white font-bold text-sm flex items-center gap-2">
                  <Wand2 size={16} className="text-blue-400" />
                  Upscale Settings
                </h3>

                {/* ── Factor ── */}
                <div className="space-y-2">
                  <label className="text-zinc-400 text-xs font-bold uppercase tracking-wide">Upscale Factor</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['2x', '4x'] as UpscaleFactor[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={isProcessing}
                        onClick={() => setFactor(option)}
                        className={`h-10 rounded-lg border text-sm font-bold transition-all ${
                          factor === option
                            ? 'bg-blue-600 text-white border-blue-500'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200 hover:bg-zinc-800'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Format + Quality row ── */}
                <div className="grid grid-cols-2 gap-3 items-start">
                  <div className="space-y-1.5">
                    <div className="flex items-center text-xs font-bold uppercase tracking-wide text-zinc-400 h-4">
                      <label htmlFor="output-format">Format</label>
                    </div>
                    <select
                      id="output-format"
                      disabled={isProcessing}
                      value={format}
                      onChange={(event) => setFormat(event.target.value as OutputFormat)}
                      className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 h-10"
                    >
                      <option value="PNG">PNG</option>
                      <option value="JPG">JPG</option>
                      <option value="WEBP">WEBP</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-zinc-400 h-4">
                      <label htmlFor="quality">Quality</label>
                      <span className="text-zinc-300">{quality}%</span>
                    </div>
                    <div className="flex items-center h-10">
                      <input
                        id="quality"
                        type="range"
                        min={60}
                        max={100}
                        step={1}
                        value={quality}
                        disabled={isProcessing}
                        onChange={(event) => setQuality(Number(event.target.value))}
                        className="w-full accent-blue-500 disabled:opacity-50 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* ── Enhancements ── */}
                <div className="space-y-2">
                  <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 cursor-pointer">
                    <span className="text-sm text-zinc-300 font-medium">Face enhancement</span>
                    <input
                      type="checkbox"
                      checked={faceEnhancement}
                      disabled={isProcessing}
                      onChange={() => setFaceEnhancement((prev) => !prev)}
                      className="w-4 h-4 accent-blue-500"
                    />
                  </label>

                  <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 cursor-pointer">
                    <span className="text-sm text-zinc-300 font-medium">Style preservation</span>
                    <input
                      type="checkbox"
                      checked={stylePreservation}
                      disabled={isProcessing}
                      onChange={() => setStylePreservation((prev) => !prev)}
                      className="w-4 h-4 accent-blue-500"
                    />
                  </label>
                </div>

                {/* ── Divider ── */}
                <div className="border-t border-zinc-800" />

                {/* ── Output summary ── */}
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>Output: <span className="text-zinc-200 font-bold">{factor === '2x' ? '2048×2048' : '4096×4096'}</span></span>
                  <span>~<span className="text-zinc-200 font-bold">{factor === '2x' ? '5.8' : '12.6'} MB</span> {format}</span>
                </div>

                {/* ── Primary action ── */}
                <button
                  type="button"
                  onClick={startUpscale}
                  disabled={!hasImage || isProcessing}
                  className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-bold text-sm transition-colors"
                >
                  {isProcessing ? 'Upscaling...' : 'Upscale Image'}
                </button>

                {/* ── Export actions ── */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!hasResult}
                    className="py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-100 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Download size={14} />
                    Download
                  </button>
                  <button
                    type="button"
                    disabled={!hasResult}
                    className="py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-100 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Save size={14} />
                    Save to Assets
                  </button>
                </div>

                <button
                  type="button"
                  onClick={startNew}
                  className="w-full py-2.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800/60 text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                >
                  <RotateCcw size={14} />
                  Start New
                </button>
              </div>

              <div className="bg-linear-to-br from-blue-900/20 to-cyan-900/20 border border-blue-800/40 rounded-2xl p-5 space-y-2">
                <h4 className="text-white text-sm font-bold flex items-center gap-2">
                  <Sparkles size={14} className="text-blue-400" />
                  Pro Tip
                </h4>
                <p className="text-zinc-300 text-xs leading-relaxed">
                  For portraits, keep face enhancement on and use 2x first. Use 4x when the source is already sharp.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}
