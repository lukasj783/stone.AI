"use client";
import { readApiError } from '@/lib/api/errors';
import React, { useState, useRef } from 'react';
import { Upload, Loader, Download, Maximize2, Settings, UserCircle, CreditCard, Info, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

export default function FaceSwapPage() {
  const pathname = usePathname();

  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState<string | null>(null);

  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [targetPreview, setTargetPreview] = useState<string | null>(null);

  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | Error | null>(null);

  const refInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);

  // Settings
  const [seed, setSeed] = useState(0);
  const [randomizeSeed, setRandomizeSeed] = useState(true);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [inferenceSteps, setInferenceSteps] = useState(4);
  const [guidanceScale, setGuidanceScale] = useState(1.0);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, isReference: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const preview = URL.createObjectURL(file);
    if (isReference) {
      setReferenceFile(file);
      setReferencePreview(preview);
    } else {
      setTargetFile(file);
      setTargetPreview(preview);
    }
  };

  const handleGenerate = async () => {
    if (!referenceFile || !targetFile) {
      setError("Please provide both the Reference Face and Target Image (Body/Scene).");
      return;
    }
    
    setIsLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("reference_image", referenceFile);
    formData.append("target_image", targetFile);
    formData.append("seed", seed.toString());
    formData.append("randomize_seed", randomizeSeed ? "true" : "false");
    formData.append("width", width.toString());
    formData.append("height", height.toString());
    formData.append("inference_steps", inferenceSteps.toString());
    formData.append("guidance_scale", guidanceScale.toString());

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const response = await fetch(`${apiUrl}/api/image/face-swap`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) await readApiError(response, "Swap process failed");

      const data = await response.json();
      if (data.images && data.images.length > 0) {
        setGeneratedUrl(data.images[0]);
      } else {
        throw new Error("No image returned from server.");
      }
    } catch (err) {
      setError(err instanceof Error ? err : "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-5">
        {/* Secondary Sidebar (Left) */}
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
                      ? "bg-zinc-900 text-white border border-zinc-800"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Remaining Credits Box */}
          <div className="p-5 rounded-2xl bg-linear-to-br from-zinc-900 to-black border border-zinc-800 space-y-4">
            <div className="flex items-center gap-2 text-zinc-400">
              <CreditCard size={14} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Remaining Credits</span>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-black text-white">0 / 40 <span className="text-xs font-normal text-zinc-400">trial credits left</span></div>
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="w-full h-full bg-yellow-500 rounded-full" />
              </div>
            </div>
            <button className="w-full py-2.5 rounded-lg bg-yellow-500 text-black text-xs font-bold hover:bg-yellow-400 transition-colors">
              Upgrade
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* Header Row */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <UserCircle className="text-zinc-400" size={20} />
              <h1 className="text-lg font-bold text-white">Face Swap</h1>
              <Info size={14} className="text-zinc-500 cursor-pointer hover:text-zinc-300" />
            </div>
            {/* Model Badge */}
            <button
              type="button"
              className="ml-2 flex items-center gap-2 rounded-full border border-emerald-700/40 bg-emerald-900/30 px-3 py-1 transition-colors hover:border-emerald-600/60 hover:bg-emerald-900/45 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              <div className="w-2 h-2 bg-emerald-500 rounded-full" />
              <span className="text-sm text-emerald-300 font-medium">FLUX.2 Klein 9B</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
            {/* Left Column - Inputs & Settings */}
            <div className="space-y-6">
              
              {/* Image Inputs */}
              <div className="grid grid-cols-2 gap-4">
                {/* Reference Image Input */}
                <div 
                  className={`bg-zinc-900 border ${referencePreview ? 'border-zinc-700' : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/80'} transition-all rounded-xl p-4 flex flex-col items-center justify-center min-h-[240px] text-center relative overflow-hidden group ${!referencePreview && 'cursor-pointer'}`}
                  onClick={() => !referencePreview && refInputRef.current?.click()}
                >
                  {referencePreview ? (
                    <>
                      <img src={referencePreview} className="absolute inset-0 w-full h-full object-cover" alt="Reference Face" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setReferenceFile(null);
                            setReferencePreview(null);
                            if (refInputRef.current) refInputRef.current.value = "";
                          }}
                          className="absolute top-3 right-3 bg-red-500/80 hover:bg-red-500 text-white p-2.5 rounded-xl transition-transform hover:scale-105 shadow-xl"
                          title="Remove Image"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Upload size={32} className="text-zinc-500 mb-3 group-hover:text-amber-500 transition-colors" />
                      <p className="text-zinc-300 font-medium">Reference Face</p>
                      <p className="text-zinc-500 text-xs mt-1">Upload the face to swap<br/>(PNG/JPG max 10MB)</p>
                    </>
                  )}
                  <input type="file" title="Upload Reference Face" aria-label="Upload Reference Face" className="hidden" accept="image/*" ref={refInputRef} onChange={(e) => handleFileChange(e, true)} />
                </div>

                {/* Target Image Input */}
                <div 
                  className={`bg-zinc-900 border ${targetPreview ? 'border-zinc-700' : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/80'} transition-all rounded-xl p-4 flex flex-col items-center justify-center min-h-[240px] text-center relative overflow-hidden group ${!targetPreview && 'cursor-pointer'}`}
                  onClick={() => !targetPreview && targetInputRef.current?.click()}
                >
                  {targetPreview ? (
                    <>
                      <img src={targetPreview} className="absolute inset-0 w-full h-full object-cover" alt="Target Body" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTargetFile(null);
                            setTargetPreview(null);
                            if (targetInputRef.current) targetInputRef.current.value = "";
                          }}
                          className="absolute top-3 right-3 bg-red-500/80 hover:bg-red-500 text-white p-2.5 rounded-xl transition-transform hover:scale-105 shadow-xl"
                          title="Remove Image"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Upload size={32} className="text-zinc-500 mb-3 group-hover:text-blue-500 transition-colors" />
                      <p className="text-zinc-300 font-medium">Target Image</p>
                      <p className="text-zinc-500 text-xs mt-1">Upload the body/scene<br/>(PNG/JPG max 10MB)</p>
                    </>
                  )}
                  <input type="file" title="Upload Target Image" aria-label="Upload Target Image" className="hidden" accept="image/*" ref={targetInputRef} onChange={(e) => handleFileChange(e, false)} />
                </div>
              </div>

              {/* Advanced Settings */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <button 
                  onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                  className="w-full flex items-center justify-between p-5 hover:bg-zinc-800/50 transition-colors focus:outline-none"
                >
                  <div className="flex items-center gap-2 text-zinc-300 font-semibold text-sm">
                    <Settings size={16} /> Advanced Settings
                  </div>
                  <div className="text-zinc-500">
                    {showAdvancedSettings ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </button>
                
                {showAdvancedSettings && (
                  <div className="px-5 pb-5 space-y-5 border-t border-zinc-800/50 pt-5">
                    {/* Seed */}
                    <div>
                      <div className="flex justify-between text-xs text-zinc-400 mb-2">
                      <span className="font-semibold text-zinc-300">Seed</span>
                      <input 
                        type="number" 
                        title="Seed value"
                        aria-label="Seed value"
                        value={seed} 
                        onChange={(e) => setSeed(Number(e.target.value))}
                        className="bg-zinc-950 border border-zinc-800 rounded px-2 w-24 py-0.5 text-zinc-200 text-right focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all"
                      />
                    </div>
                    <input type="range" title="Seed selector" aria-label="Seed selector" min="0" max="2147483647" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="w-full accent-zinc-500" disabled={randomizeSeed}/>
                    <label className="flex items-center gap-2 mt-3 text-xs text-zinc-400 font-medium cursor-pointer max-w-fit">
                      <input 
                        type="checkbox" 
                        title="Randomize seed"
                        aria-label="Randomize seed"
                        checked={randomizeSeed} 
                        onChange={(e) => setRandomizeSeed(e.target.checked)} 
                        className="bg-zinc-950 border-zinc-800 rounded text-zinc-500 focus:ring-zinc-600 focus:ring-1 w-4 h-4"
                      />
                      Randomize seed
                    </label>
                  </div>

                  {/* Width & Height */}
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <div className="flex justify-between text-xs text-zinc-400 mb-2">
                        <span className="font-semibold text-zinc-300">Width</span>
                        <span className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-300">{width} px</span>
                      </div>
                      <input type="range" title="Image width" aria-label="Image width" min="256" max="1024" step="64" value={width} onChange={(e) => setWidth(Number(e.target.value))} className="w-full accent-zinc-500"/>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-zinc-400 mb-2">
                        <span className="font-semibold text-zinc-300">Height</span>
                        <span className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-300">{height} px</span>
                      </div>
                      <input type="range" title="Image height" aria-label="Image height" min="256" max="1024" step="64" value={height} onChange={(e) => setHeight(Number(e.target.value))} className="w-full accent-zinc-500"/>
                    </div>
                  </div>

                  {/* Steps & Guidance */}
                  <div className="grid grid-cols-2 gap-6 pt-1">
                    <div>
                      <div className="flex justify-between text-xs text-zinc-400 mb-2">
                        <span className="font-semibold text-zinc-300">Inference Steps</span>
                        <span className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-300">{inferenceSteps}</span>
                      </div>
                      <input type="range" title="Inference steps" aria-label="Inference steps" min="1" max="20" step="1" value={inferenceSteps} onChange={(e) => setInferenceSteps(Number(e.target.value))} className="w-full accent-zinc-500"/>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-zinc-400 mb-2">
                        <span className="font-semibold text-zinc-300">Guidance Scale</span>
                        <span className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-300">{guidanceScale}</span>
                      </div>
                      <input type="range" title="Guidance scale" aria-label="Guidance scale" min="0" max="5" step="0.1" value={guidanceScale} onChange={(e) => setGuidanceScale(Number(e.target.value))} className="w-full accent-zinc-500"/>
                    </div>
                  </div>
                </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                   onClick={handleGenerate}
                   disabled={isLoading || !referenceFile || !targetFile}
                   className="flex-1 py-4 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-bold tracking-wide transition-colors flex items-center justify-center gap-2 shadow-lg shadow-orange-900/20"
                >
                  {isLoading ? <Loader className="animate-spin" /> : "Run Face Swap"}
                </button>
              </div>
              
              <ErrorBanner error={error} onDismiss={() => setError(null)} className="rounded-xl p-4" />

            </div>

            {/* Right Column - Output */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl min-h-[600px] flex flex-col relative overflow-hidden group">
              {/* Output Header */}
              <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0 bg-zinc-900/50">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Output Result</h3>
                {generatedUrl && (
                   <button 
                     onClick={() => {
                       const a = document.createElement("a");
                       a.href = generatedUrl;
                       a.download = `faceswap-${Date.now()}.png`;
                       a.click();
                     }}
                     className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 transition-colors"
                     title="Download Image"
                   >
                     <Download size={14} />
                   </button>
                )}
              </div>
              
              <div className="flex-1 flex items-center justify-center p-4 bg-zinc-950">
                 {!generatedUrl && !isLoading && (
                   <div className="text-center text-zinc-600">
                     <Maximize2 size={48} className="mx-auto mb-4 opacity-50" />
                     <p className="font-medium text-sm">Your swapped image will appear here</p>
                   </div>
                 )}
                 {isLoading && (
                   <div className="text-center">
                     <Loader size={48} className="animate-spin text-orange-500 mx-auto mb-4" />
                     <p className="text-orange-400 font-medium animate-pulse text-sm">Running Face Swap model...</p>
                     <p className="text-zinc-500 text-xs mt-2">This may take up to a minute depending on settings.</p>
                   </div>
                 )}
                 {generatedUrl && !isLoading && (
                   <img 
                     src={generatedUrl} 
                     className="w-full h-full object-contain rounded-lg" 
                     alt="Result" 
                   />
                 )}
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}
