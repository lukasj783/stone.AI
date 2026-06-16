"use client";
import React, { useState, useEffect, useRef } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { X, Scissors, Loader2 } from 'lucide-react';

interface VideoTrimmerModalProps {
  file: File;
  maxDuration: number;
  minDuration?: number;
  onClose: () => void;
  onTrim: (trimmedFile: File) => void;
}

export default function VideoTrimmerModal({ file, maxDuration, minDuration = 1, onClose, onTrim }: VideoTrimmerModalProps) {
  const [loaded, setLoaded] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  
  const ffmpegRef = useRef(new FFmpeg());
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setVideoUrl(url);

    const loadFFmpeg = async () => {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      const ffmpeg = ffmpegRef.current;
      ffmpeg.on('log', ({ message }) => console.log(message));
      ffmpeg.on('progress', ({ progress }) => setProgress(`${Math.round(progress * 100)}%`));
      
      try {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setLoaded(true);
      } catch (err) {
        console.error('Failed to load FFmpeg', err);
      }
    };

    loadFFmpeg();

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const vidDuration = videoRef.current.duration;
      setDuration(vidDuration);
      setEndTime(Math.min(vidDuration, maxDuration));
    }
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseFloat(e.target.value);
    setStartTime(val);
    let newEnd = val + maxDuration;
    if (newEnd > duration) newEnd = duration;
    
    // Enforce minDuration
    if (newEnd - val < minDuration) {
      if (newEnd >= duration) {
        val = Math.max(0, duration - minDuration);
      } else {
        newEnd = val + minDuration;
      }
    }
    
    setEndTime(newEnd);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
    }
  };

  const handleTrim = async () => {
    setIsProcessing(true);
    try {
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile('input.mp4', await fetchFile(file));

      const durationToTrim = endTime - startTime;
      
      await ffmpeg.exec([
        '-ss', startTime.toString(),
        '-i', 'input.mp4',
        '-t', durationToTrim.toString(),
        '-c:v', 'libx264',
        '-c:a', 'aac',
        'output.mp4'
      ]);

      const data = (await ffmpeg.readFile('output.mp4')) as Uint8Array;
      const blob = new Blob([new Uint8Array(data)], { type: 'video/mp4' });
      const trimmedFile = new File([blob], file.name.replace('.mp4', '_trimmed.mp4'), { type: 'video/mp4' });
      
      onTrim(trimmedFile);
    } catch (e) {
      console.error(e);
      alert('An error occurred while trimming the video.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-none shadow-xl flex flex-col gap-6 p-6 mb-4 animate-in fade-in slide-in-from-top-4 duration-300" onClick={(e) => e.stopPropagation()}>
      <div className="flex justify-between items-center bg-zinc-800 p-4 rounded-xl">
          <div>
            <h2 className="text-xl font-bold text-white">Trim Video to Match Model Limits</h2>
            <p className="text-sm text-zinc-400">Duration constraints: Min {minDuration}s | Max {maxDuration}s. Choose the exact timeframe to animate.</p>
          </div>
          <button type="button" title="Close" aria-label="Close" onClick={onClose} className="w-10 h-10 flex items-center justify-center hover:bg-zinc-700/50 rounded-full text-zinc-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="bg-black rounded-xl overflow-hidden aspect-21/9 flex justify-center border border-zinc-800">
          {videoUrl && (
            <video
              ref={videoRef}
              src={videoUrl}
              onLoadedMetadata={handleLoadedMetadata}
              controls
              className="w-full h-full object-contain"
            />
          )}
        </div>

        <div className="bg-zinc-800/50 p-4 rounded-xl space-y-4">
            <div className="flex justify-between">
                <span className="text-xs font-bold text-zinc-300">Start Time: {startTime.toFixed(2)}s</span>
                <span className="text-xs font-bold text-zinc-300">End Time: {endTime.toFixed(2)}s</span>
            </div>

            <div className="flex items-center gap-4">
                <span className="text-xs font-mono text-zinc-500 font-bold bg-zinc-950 px-2 py-1 rounded inline-block w-14 text-center">{startTime.toFixed(1)}s</span>
                <div className="flex-1 relative flex h-2 bg-zinc-800 rounded-lg group cursor-pointer accent-blue-500">
                    <input
                        type="range"
                        min="0"
                        max={Math.max(0, duration - minDuration)}
                        step="0.01"
                        value={startTime}
                        onChange={handleTimeChange}
                        aria-label="Video start time"
                        title="Video start time"
                        className="w-full h-full absolute inset-0 appearance-none cursor-pointer bg-transparent z-10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
                    />
                    <div 
                        className="absolute h-full bg-blue-500/50 pointer-events-none rounded-lg border-y border-blue-500/50" 
                        style={{
                            left: `${(startTime / duration) * 100}%`,
                            width: `${((endTime - startTime) / duration) * 100}%`
                        }}
                    />
                </div>
                <span className="text-xs font-mono text-zinc-500 font-bold bg-zinc-950 px-2 py-1 rounded inline-block w-14 text-center">{endTime.toFixed(1)}s</span>
            </div>
        </div>

        <div className="flex justify-end gap-3 pt-6 border-t border-zinc-800/50">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl font-bold text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleTrim}
            disabled={!loaded || isProcessing}
            className="px-8 py-2.5 rounded-xl font-black text-sm bg-white text-black hover:bg-zinc-200 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
          >
            {isProcessing ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span className="animate-pulse">{progress?.includes('%') ? `Processing ${progress}` : 'Initializing FFmpeg...'}</span>
              </>
            ) : !loaded ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span className="animate-pulse">Loading Video Engine...</span>
              </>
            ) : (
              <>
                <Scissors size={16} />
                Confirm & Use Selection
              </>
            )}
          </button>
        </div>
    </div>
  );
}
