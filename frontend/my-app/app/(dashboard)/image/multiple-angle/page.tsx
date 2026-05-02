"use client";
import React, { useState, useRef, useEffect, Suspense } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  CreditCard,
  Upload,
  Sparkles,
  ChevronDown,
  Box as BoxIcon,
  Maximize,
  Grid,
  Download,
  Settings2,
  StopCircle,
  Camera
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { generateMultipleAngle } from '@/lib/api/image-generation';

const ThreeScene = dynamic(() => import('./ThreeScene'), { ssr: false });

export default function MultipleAnglePage() {
  const pathname = usePathname();
  
  const secondaryNav = [
    { label: 'Image Home', href: '/image' },
    { label: 'Create Image', href: '/image/create' },
    { label: 'Edit Image', href: '/image/edit' },
    { label: 'Chat to Edit', href: '/image/chat' },
    { label: 'Face Swap', href: '/image/face-swap' },
    { label: 'Character', href: '/image/character' },
    { label: 'Multiple Angle', href: '/image/multiple-angle' },
    { label: 'Image Upscale', href: '/image/upscale' },
    { label: 'Train a Model', href: '/image/train' },
  ];

  const [prompt, setPrompt] = useState('');
  const [azimuth, setAzimuth] = useState(180);
  const [tilt, setTilt] = useState(15);
  const [numImages, setNumImages] = useState(4);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const handleGenerate = async () => {
    if (!uploadedFile) {
      setErrorMsg('Please upload a reference image first.');
      return;
    }
    
    setIsGenerating(true);
    setProgress(0);
    setResults([]);
    setErrorMsg('');
    
    // Fake progress bar while waiting for the request
    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += 5;
      if (currentProgress < 90) {
        setProgress(currentProgress);
      }
    }, 500);

    try {
      const response = await generateMultipleAngle(uploadedFile, prompt || "Generate multiple angles of this character limit the background");
      setProgress(100);
      setResults(response.images || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Generation failed');
      setProgress(0);
    } finally {
      clearInterval(interval);
      setIsGenerating(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      const url = URL.createObjectURL(file);
      setUploadedImage(url);
    }
  };

  const applyPreset = (presetAzimuth: number, presetTilt: number) => {
    setAzimuth(presetAzimuth);
    setTilt(presetTilt);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-5 h-full">
        {/* Left Column: Navigation & Core Settings */}
        <aside className="lg:w-64 space-y-6 shrink-0 flex flex-col">
          {/* Navigation */}
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-4">Image Controls</h3>
            <div className="space-y-1">
              {secondaryNav.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`block w-full text-left px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
                    pathname === item.href 
                      ? "bg-zinc-900 text-white border border-zinc-800" 
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Credits */}
          <div className="p-5 rounded-2xl bg-linear-to-br from-zinc-900 to-black border border-zinc-800 space-y-4 hidden lg:block">
            <div className="flex items-center gap-2 text-zinc-400">
              <CreditCard size={14}/>
              <span className="text-[10px] font-bold uppercase tracking-wider">Remaining Credits</span>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-black text-white">480</div>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className="w-[40%] h-full bg-purple-500" /> 
              </div>
            </div>
            <button className="w-full py-2 rounded-lg bg-zinc-800 text-white text-xs font-bold hover:bg-zinc-700 transition-colors">
              Upgrade Now
            </button>
          </div>
        </aside>

        {/* Middle Column: Generator Controls */}
        <div className="lg:w-80 space-y-6 shrink-0 flex flex-col">
          <div className="bg-zinc-950 border border-zinc-800/60 rounded-2xl p-5 space-y-5">
            <div className="flex items-center gap-2 mb-2">
              <Camera className="text-purple-400" size={18} />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Multi-Angle Generator</h2>
            </div>

            {/* Upload Box */}
            <div 
              className="relative bg-zinc-900/50 rounded-xl p-4 border border-zinc-800 border-dashed hover:border-purple-500/50 transition-colors cursor-pointer group flex flex-col items-center justify-center py-8"
              onClick={() => document.getElementById('image-upload')?.click()}
            >
               {uploadedImage ? (
                 <div className="absolute inset-0 rounded-xl overflow-hidden opacity-40 group-hover:opacity-20 transition-opacity">
                    <img src={uploadedImage} alt="Reference" className="w-full h-full object-cover" />
                 </div>
               ) : null}
              <Upload className="text-zinc-500 group-hover:text-purple-400 mb-3 relative z-10 transition-colors" size={24} />
              <span className="text-[11px] uppercase font-bold tracking-widest text-zinc-400 group-hover:text-white relative z-10 transition-colors">Reference Image</span>
              <input id="image-upload" type="file" title="Upload Reference Image" aria-label="Upload Reference Image" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </div>

            {/* Prompt Area */}
            <div className="space-y-2">
              <label htmlFor="primary-prompt" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-1">Primary Prompt</label>
              <textarea 
                id="primary-prompt"
                title="Primary Prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full bg-black text-white text-sm rounded-xl border border-zinc-800 p-3 focus:ring-1 focus:ring-purple-500 resize-none h-24 placeholder:text-zinc-600 transition-all outline-none" 
                placeholder="Describe the material, lighting, and cinematic mood..."
              ></textarea>
            </div>

            {/* Angle Sliders */}
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="flex justify-between items-center px-1">
                  <label htmlFor="azimuth-angle" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Azimuth Angle</label>
                  <span className="text-[10px] text-purple-400 font-mono">{azimuth}°</span>
                </div>
                <input 
                  id="azimuth-angle" title="Azimuth Angle" aria-label="Azimuth Angle"
                  type="range" min="0" max="360" value={azimuth} onChange={(e) => setAzimuth(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500 range-sm" 
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center px-1">
                  <label htmlFor="vertical-tilt" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Vertical Tilt</label>
                  <span className="text-[10px] text-purple-400 font-mono">{tilt}°</span>
                </div>
                <input 
                  id="vertical-tilt" title="Vertical Tilt" aria-label="Vertical Tilt"
                  type="range" min="-45" max="90" value={tilt} onChange={(e) => setTilt(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500 range-sm" 
                />
              </div>
              
              <div className="space-y-1 pt-2">
                <div className="flex justify-between items-center px-1">
                  <label htmlFor="output-count" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Output Count</label>
                  <span className="text-[10px] text-purple-400 font-mono">{numImages}</span>
                </div>
                <input 
                  id="output-count" title="Output Count" aria-label="Output Count"
                  type="range" min="1" max="8" value={numImages} onChange={(e) => setNumImages(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500 range-sm" 
                />
              </div>
            </div>

            {/* Advanced Settings Accordion */}
            <div className="border-t border-zinc-800/60 pt-4 mt-4">
              <button 
                onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                className="flex items-center justify-between w-full text-[10px] font-bold text-zinc-500 uppercase tracking-widest hover:text-zinc-300 transition-colors"
              >
                Advanced Settings
                <ChevronDown size={14} className={`transition-transform duration-300 ${isAdvancedOpen ? 'rotate-180' : ''}`} />
              </button>
              
              <AnimatePresence>
                {isAdvancedOpen && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }} 
                    animate={{ height: 'auto', opacity: 1 }} 
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-4 space-y-4">
                      {/* Placeholder for advanced settings */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] text-zinc-500 uppercase">
                          <label htmlFor="guidance-scale">Guidance Scale</label>
                          <span className="text-purple-400">7.5</span>
                        </div>
                        <input id="guidance-scale" title="Guidance Scale" aria-label="Guidance Scale" type="range" min="1" max="20" step="0.5" defaultValue="7.5" className="w-full h-1 bg-zinc-800 rounded-lg appearance-none accent-purple-500" />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {errorMsg && (
              <div className="text-red-400 text-xs font-semibold px-2 py-1">
                {errorMsg}
              </div>
            )}

            <button 
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full bg-linear-to-br from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-purple-500/20 active:scale-[0.98]"
            >
              <Sparkles size={16} />
              {isGenerating ? 'Processing...' : 'Generate Multi-Angle'}
            </button>
          </div>
        </div>

        {/* Right Column: 3D Preview & Results */}
        <div className="flex flex-col flex-1 min-w-0 bg-zinc-950/50 rounded-2xl border border-zinc-800/40 relative overflow-hidden h-200 lg:h-auto">
          {/* Main 3D Canvas Area */}
          <div className="flex-1 relative w-full h-full min-h-100">
            {/* Background texture concept */}
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 pointer-events-none mix-blend-overlay"></div>
            <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(circle_at_50%_50%,#a3a6ff_0%,transparent_60%)]"></div>

            {/* Suspense is needed for r3f components that load textures */}
            <Suspense fallback={
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="animate-pulse flex flex-col items-center gap-2">
                  <BoxIcon className="text-zinc-600" size={32} />
                  <span className="text-xs uppercase tracking-widest text-zinc-600 font-bold">Loading Engine...</span>
                </div>
              </div>
            }>
              <ThreeScene azimuth={azimuth} tilt={tilt} imageUrl={uploadedImage} />
            </Suspense>

            {/* Overlays */}
            <div className="absolute top-6 left-6 pointer-events-none">
              <div className="bg-black/40 backdrop-blur-md px-4 py-2 border border-zinc-700/50 rounded-lg inline-flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-yellow-400 animate-pulse' : 'bg-cyan-400 shadow-[0_0_10px_#22d3ee]'}`}></span>
                <span className="text-[10px] font-bold text-white uppercase tracking-widest">
                  {isGenerating ? 'Active Inference' : 'Preview Engine V2'}
                </span>
              </div>
            </div>

            <div className="absolute top-6 right-6 flex flex-col gap-4">
              <div className="bg-black/40 backdrop-blur-md p-4 border border-zinc-700/50 rounded-xl flex flex-col gap-4 min-w-30">
                <div>
                  <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mb-1">VRAM</div>
                  <div className="text-lg font-mono font-bold text-white">2.4 GB</div>
                </div>
              </div>
            </div>

            {/* Perspective Compass Rotator (Bottom Center floating) */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-24 h-24 bg-black/40 backdrop-blur-md rounded-full border-2 border-zinc-800 shadow-[0_0_30px_rgba(0,0,0,0.5)] flex items-center justify-center">
              
              {/* Compass Crosshairs & Center Axis */}
              <div className="absolute w-full h-px bg-zinc-800/80"></div>
              <div className="absolute h-full w-px bg-zinc-800/80"></div>
              <div className="absolute w-2.5 h-2.5 rounded-full bg-zinc-600 border border-zinc-900 shadow-inner"></div>

              {/* 12 o'clock (Top / North) */}
              <button 
                onClick={() => applyPreset(0, 89)} 
                className={`absolute -top-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full border border-zinc-700 flex items-center justify-center text-[9px] font-bold uppercase transition-all shadow-lg ${azimuth===0 && tilt===89 ? 'bg-purple-500 text-white border-purple-400 shadow-[0_0_15px_#a855f7]' : 'bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                title="Top View"
              >
                Top
              </button>

              {/* 3 o'clock (Right Side / East) */}
              <button 
                onClick={() => applyPreset(90, 0)} 
                className={`absolute top-1/2 -right-3 -translate-y-1/2 w-7 h-7 rounded-full border border-zinc-700 flex items-center justify-center text-[9px] font-bold uppercase transition-all shadow-lg ${azimuth===90 && tilt===0 ? 'bg-purple-500 text-white border-purple-400 shadow-[0_0_15px_#a855f7]' : 'bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                title="Right Side View"
              >
                R
              </button>

              {/* 6 o'clock (Front / South) */}
              <button 
                onClick={() => applyPreset(0, 0)} 
                className={`absolute -bottom-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full border border-zinc-700 flex items-center justify-center text-[9px] font-bold uppercase transition-all shadow-lg ${azimuth===0 && tilt===0 ? 'bg-purple-500 text-white border-purple-400 shadow-[0_0_15px_#a855f7]' : 'bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                title="Front View"
              >
                Frt
              </button>

              {/* 9 o'clock (Left Side / West) */}
              <button 
                onClick={() => applyPreset(270, 0)} 
                className={`absolute top-1/2 -left-3 -translate-y-1/2 w-7 h-7 rounded-full border border-zinc-700 flex items-center justify-center text-[9px] font-bold uppercase transition-all shadow-lg ${azimuth===270 && tilt===0 ? 'bg-purple-500 text-white border-purple-400 shadow-[0_0_15px_#a855f7]' : 'bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                title="Left Side View"
              >
                L
              </button>

              {/* Iso (Diagonal / South-East) */}
              <button 
                onClick={() => applyPreset(45, 30)} 
                className={`absolute bottom-2 right-2 translate-x-1/2 translate-y-1/2 w-6 h-6 rounded-full border border-zinc-700 flex items-center justify-center text-[8px] font-bold uppercase transition-all shadow-lg ${azimuth===45 && tilt===30 ? 'bg-purple-500 text-white border-purple-400 shadow-[0_0_15px_#a855f7]' : 'bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                title="Isometric View"
              >
                Iso
              </button>
            </div>
          </div>

          {/* Bottom Generation Dock */}
          {isGenerating || results.length > 0 ? (
            <div className="h-auto min-h-35 bg-zinc-950 border-t border-zinc-800/60 p-6 flex flex-col gap-4 animate-in slide-in-from-bottom-8">
              {isGenerating ? (
                <div className="space-y-4 w-full max-w-2xl mx-auto flex flex-col items-center justify-center h-full">
                  <div className="flex justify-between items-center w-full">
                    <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Batch Process: {numImages} Angles</span>
                    <span className="text-[10px] text-purple-400 font-bold">{progress}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      className="h-full bg-linear-to-r from-purple-600 to-cyan-500 rounded-full"
                    />
                  </div>
                  <button onClick={() => setIsGenerating(false)} className="text-zinc-500 hover:text-red-400 transition-colors flex items-center gap-2 mt-2">
                    <StopCircle size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Abort</span>
                  </button>
                </div>
              ) : (
                <div className="w-full">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Generated Results ({results.length})</span>
                    <button className="text-purple-400 hover:text-purple-300 text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                      <Download size={14} /> Save All
                    </button>
                  </div>
                  <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-none">
                    {results.map((url, idx) => (
                      <div key={idx} className="w-24 h-24 shrink-0 rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden relative group">
                        <img src={url} alt={`Generated angle ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer">
                          <Maximize className="text-white bg-black/50 p-1.5 rounded-full" size={24} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
  );
}
