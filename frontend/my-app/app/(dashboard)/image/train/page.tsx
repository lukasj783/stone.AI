"use client";
import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  CreditCard,
  Upload,
  BrainCircuit,
  Image as ImageIcon,
  User,
  Package,
  Sparkles,
  Info,
  CheckCircle2,
  Plus,
  Palette,
  Heart,
  Share2,
  Play,
  MessageSquare,
  Share,
  Lock,
  Clock
} from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';

// Mock cn if it doesn't exist or just use template literals
const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ');

const modelTypes = [
  { 
    id: 'style', 
    name: 'Style', 
    icon: Palette, 
    description: 'Train a model to replicate a specific artistic style or aesthetic.',
    gradient: 'from-purple-500/20 to-indigo-500/20 border-purple-500/50',
    iconColor: 'text-purple-400',
    imgClass: 'bg-linear-to-br from-purple-900 via-indigo-900 to-violet-950' 
  },
  { 
    id: 'face', 
    name: 'Face', 
    icon: User, 
    description: 'Train a model to recognize and generate a specific face.',
    gradient: 'from-blue-500/20 to-cyan-500/20 border-blue-500/50',
    iconColor: 'text-blue-400',
    imgClass: 'bg-linear-to-br from-blue-900 via-cyan-900 to-sky-950'
  },
  { 
    id: 'character', 
    name: 'Character', 
    icon: Sparkles, 
    description: 'Create a consistent character for various scenarios.',
    gradient: 'from-pink-500/20 to-rose-500/20 border-pink-500/50',
    iconColor: 'text-pink-400',
    imgClass: 'bg-linear-to-br from-pink-900 via-rose-900 to-red-950'
  },
  { 
    id: 'object', 
    name: 'Object', 
    icon: Package, 
    description: 'Train a model to generate specific objects or items.',
    gradient: 'from-emerald-500/20 to-teal-500/20 border-emerald-500/50',
    iconColor: 'text-emerald-400',
    imgClass: 'bg-linear-to-br from-emerald-900 via-teal-900 to-green-950'
  },
];

// Sample trained models
const myModels = [
  { id: 1, name: 'My Art Style', type: 'Style', status: 'Ready', thumbnail: 'from-purple-900 to-pink-900', date: '2 days ago' },
  { id: 2, name: 'Portrait Model', type: 'Face', status: 'Training', thumbnail: 'from-blue-900 to-cyan-900', date: 'Just now' },
];

export default function TrainModelPage() {
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
  
  const [selectedType, setSelectedType] = useState('style');
  const [activeTab, setActiveTab] = useState<'myModels' | 'community'>('myModels');
  const [uploadedImages, setUploadedImages] = useState(0);

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
              <CreditCard size={14}/>
              <span className="text-[10px] font-bold uppercase tracking-wider">Remaining Credits</span>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-black text-white">480</div>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className="w-[40%] h-full bg-yellow-500" /> 
              </div>
            </div>
            <button className="w-full py-2 rounded-lg bg-yellow-500 text-black text-xs font-bold hover:bg-yellow-400 transition-colors">
              Upgrade Now
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 min-w-0">
          
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Left Column - Main Action Flow */}
            <div className="xl:col-span-2 space-y-6">
              
              {/* Upgrade Banner */}
              <div className="bg-linear-to-r from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-yellow-500/10 rounded-lg shrink-0">
                    <Sparkles className="text-yellow-500" size={20} />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm flex items-center gap-2">
                      Upgrade to use this feature
                    </h3>
                    <p className="text-zinc-400 text-xs">
                       Upgrade to Essential plan or higher
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                    <div className="flex items-center gap-2 text-red-500 text-xs font-bold bg-red-500/10 px-3 py-1.5 rounded-full whitespace-nowrap">
                        <Info size={14} />
                        0 trial credits left
                    </div>
                    <button className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-lg transition-colors border border-zinc-700">
                        Upgrade
                    </button>
                </div>
              </div>

              {/* Step 1: Select Type */}
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center text-xs font-bold border border-zinc-700">1</div>
                    <h3 className="text-lg font-bold text-white">Select a type of model</h3>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {modelTypes.map((type) => {
                    const isSelected = selectedType === type.id;
                    return (
                      <button
                        key={type.id}
                        onClick={() => setSelectedType(type.id)}
                        className={`group relative flex flex-col items-center text-center p-3 rounded-xl border-2 transition-all ${
                          isSelected 
                            ? 'bg-zinc-900 border-blue-600 shadow-lg shadow-blue-900/20' 
                            : 'bg-zinc-900/30 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900'
                        }`}
                      >
                         <div className={`w-full aspect-square rounded-lg mb-3 overflow-hidden ${type.imgClass} flex items-center justify-center relative shadow-inner`}>
                            {/* Icon Placeholder */}
                            <type.icon size={32} className="text-white/80 drop-shadow-md" />
                            
                            {isSelected && (
                                <div className="absolute top-2 right-2 bg-blue-600 text-white rounded-full p-0.5 shadow-md">
                                    <CheckCircle2 size={14} fill="currentColor" className="text-white" />
                                </div>
                            )}
                         </div>
                         <span className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                            {type.name}
                         </span>
                      </button>
                    );
                  })}
                </div>
              </div>

               {/* Step 2: Upload */}
               <div className="space-y-4">
                 <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center text-xs font-bold border border-zinc-700">2</div>
                    <h3 className="text-lg font-bold text-white">Upload images</h3>
                </div>
                 
                  <div className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all ${
                      uploadedImages > 0 
                        ? 'border-blue-500/50 bg-blue-500/5' 
                        : 'border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/50'
                  }`}>
                      {uploadedImages === 0 ? (
                        <>
                             <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
                                <Upload className="text-zinc-500" size={24} />
                            </div>
                            <div className="text-center space-y-1 mb-4">
                                <p className="text-zinc-300 font-medium text-sm">Drag & drop or click to upload</p>
                                <p className="text-zinc-500 text-xs">5-20 images (JPG, PNG)</p>
                            </div>
                            <button 
                                onClick={() => setUploadedImages(10)} 
                                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors shadow-lg shadow-blue-900/20"
                            >
                                Select Files
                            </button>
                        </>
                      ) : (
                          <div className="w-full space-y-4">
                               <div className="flex justify-between items-center text-sm px-2">
                                   <span className="text-zinc-300 font-medium">{uploadedImages} images selected</span>
                                   <button 
                                    onClick={() => setUploadedImages(0)}
                                    className="text-red-400 hover:text-red-300 text-xs font-bold"
                                   >
                                    Clear
                                   </button>
                               </div>
                               <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                                  {Array.from({length: uploadedImages}).map((_, i) => (
                                      <motion.div 
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: i * 0.05 }}
                                        key={i} 
                                        className="aspect-square bg-zinc-800 rounded-lg border border-zinc-700" 
                                      />
                                  ))}
                                  <button onClick={() => setUploadedImages(p => p + 1)} aria-label="Add image" title="Add image" className="aspect-square border border-dashed border-zinc-700 rounded-lg flex items-center justify-center hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors">
                                      <Plus size={16} />
                                  </button>
                               </div>
                          </div>
                      )}
                  </div>
               </div>

              {/* Train Button */}
              <button className="w-full py-4 rounded-xl bg-zinc-800 text-zinc-500 font-bold text-lg flex items-center justify-center gap-2 cursor-not-allowed border border-zinc-700 mt-8 hover:bg-zinc-800/80 transition-colors">
                Train your model
              </button>

            </div>

             {/* Right Column - Info & Context */}
            <div className="space-y-6">
                
                {/* Hero Box */}
                <div className="bg-black rounded-3xl p-6 sm:p-8 space-y-6 relative overflow-hidden border border-zinc-800 h-fit">
                     {/* Decorative background element */}
                     <div className="absolute top-0 right-0 w-64 h-64 bg-slate-800/20 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/2" />
                    
                    <div className="flex justify-end gap-2 relative z-10">
                        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 text-xs font-bold rounded-lg border border-zinc-800 transition-colors">
                            <MessageSquare size={14} />
                            Feedback
                        </button>
                         <button className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 text-xs font-bold rounded-lg border border-zinc-800 transition-colors">
                            <Share size={14} />
                            Share
                        </button>
                    </div>

                    <div className="space-y-4 relative z-10">
                        <h2 className="text-3xl font-bold text-white tracking-tight">Model training</h2>
                        <p className="text-zinc-400 text-sm leading-relaxed">
                            Train your unique AI model with just a few images. 
                            Simply upload a few images to teach AI what you want and you will get your custom model. 
                            Learn more from <a href="#" className="text-blue-400 hover:underline hover:text-blue-300">our model training book for beginners</a>.
                        </p>
                        
                        <button className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-bold rounded-lg border border-zinc-800 transition-colors group">
                            <Play size={14} fill="currentColor" className="group-hover:text-blue-400 transition-colors" />
                            Video Tutorial
                        </button>
                    </div>

                    <div className="pt-6 border-t border-zinc-900/50 flex flex-wrap gap-2 relative z-10">
                         <button 
                            onClick={() => setActiveTab('myModels')}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                                activeTab === 'myModels' 
                                ? 'bg-zinc-800 text-white border-zinc-700 shadow-sm' 
                                : 'bg-transparent text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-zinc-900/50'
                            }`}
                         >
                            <User size={14} />
                            My models
                         </button>
                          <button 
                            onClick={() => setActiveTab('community')}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                                activeTab === 'community' 
                                ? 'bg-zinc-800 text-white border-zinc-700 shadow-sm' 
                                : 'bg-transparent text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-zinc-900/50'
                            }`}
                         >
                            <Package size={14} />
                            View All The Community Models
                         </button>
                    </div>
                </div>

                {/* Content based on active tab in right panel? Or just list below? */}
                {/* The reference suggests this layout might just be informative, or content loads below. 
                    Given the structure, I'll place the "My Models" list here if active. */}
                
                {activeTab === 'myModels' && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                         <h3 className="text-zinc-500 text-xs font-bold uppercase tracking-wider px-2">Recent Models</h3>
                         {myModels.length > 0 ? (
                            myModels.map(model => (
                                <div key={model.id} className="bg-zinc-900/30 border border-zinc-800 p-3 rounded-xl flex items-center gap-3 hover:border-zinc-700 hover:bg-zinc-900/50 transition-all cursor-pointer group">
                                    <div className={`w-12 h-12 rounded-lg ${model.thumbnail} bg-linear-to-br shrink-0 shadow-sm`} />
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-white font-bold text-sm truncate group-hover:text-blue-400 transition-colors">{model.name}</h4>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700">{model.type}</span>
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                                                model.status === 'Ready' 
                                                ? 'bg-green-900/10 text-green-500 border-green-900/20' 
                                                : 'bg-blue-900/10 text-blue-500 border-blue-900/20'
                                            }`}>{model.status}</span>
                                        </div>
                                    </div>
                                    <div className="text-zinc-600 group-hover:text-zinc-400">
                                        <Clock size={14} />
                                    </div>
                                </div>
                            ))
                         ) : (
                             <div className="text-center p-8 border border-zinc-800 rounded-xl bg-zinc-900/20">
                                 <p className="text-zinc-500 text-sm">No models trained yet.</p>
                             </div>
                         )}
                    </div>
                )}
            </div>
          </div>
        </div>
      </div>
  );
}
