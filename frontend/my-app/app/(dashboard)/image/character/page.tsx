"use client";
import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  CreditCard,
  User,
  Sparkles,
  Image as ImageIcon,
  ChevronDown,
  Plus,
  Search,
} from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';

// Sample character styles
const characterStyles = [
  { id: 1, name: 'Realistic', thumbnail: 'from-amber-900 to-orange-900' },
  { id: 2, name: 'Anime', thumbnail: 'from-pink-900 to-rose-900' },
  { id: 3, name: 'Cartoon', thumbnail: 'from-blue-900 to-indigo-900' },
  { id: 4, name: '3D Model', thumbnail: 'from-purple-900 to-violet-900' },
  { id: 5, name: 'Fantasy', thumbnail: 'from-green-900 to-emerald-900' },
  { id: 6, name: 'Cyberpunk', thumbnail: 'from-cyan-900 to-teal-900' },
  { id: 7, name: 'Watercolor', thumbnail: 'from-yellow-900 to-amber-900' },
  { id: 8, name: 'Oil Painting', thumbnail: 'from-red-900 to-rose-900' },
];

export default function CharacterPage() {
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
  const [numImages, setNumImages] = useState(2);
  const [selectedCharacter, setSelectedCharacter] = useState('mbosa');
  const [selectedStyle, setSelectedStyle] = useState<number | null>(null);

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
        <div className="flex-1 space-y-8 min-w-0">
          <header className="space-y-2">
            <motion.h1 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-4xl font-extrabold tracking-tight text-white"
            >
              Create <span className="text-purple-500">Character</span> Visual
            </motion.h1>
            <p className="text-zinc-400 text-sm">
              Generate consistent character images with AI
            </p>
          </header>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Left Panel - Character Setup */}
            <div className="xl:col-span-2 space-y-6">
              {/* Character Selector */}
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-linear-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                      <User className="text-white" size={24} />
                    </div>
                    <div>
                      <h3 className="text-white font-bold">{selectedCharacter}</h3>
                      <p className="text-xs text-zinc-400">Active Character</p>
                    </div>
                  </div>
                  <button className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium transition-colors flex items-center gap-2">
                    Switch <ChevronDown size={16} />
                  </button>
                </div>
                
                <button className="w-full py-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold transition-colors flex items-center justify-center gap-2">
                  <Plus size={18} />
                  Add Character
                </button>
              </div>

              {/* Prompt Section */}
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-white font-bold flex items-center gap-2">
                    <Sparkles size={18} className="text-yellow-500" />
                    Prompt
                  </label>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="@mbosa is playing guitar"
                    className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                  />
                </div>
              </div>

              {/* Character Styles Gallery */}
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-bold">Character Styles</h3>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <input
                      type="text"
                      placeholder="Search styles..."
                      className="pl-10 pr-4 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4">
                  {characterStyles.map((style) => (
                    <motion.button
                      key={style.id}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setSelectedStyle(style.id)}
                      className={`relative rounded-xl overflow-hidden aspect-square ${
                        selectedStyle === style.id ? 'ring-2 ring-purple-500' : ''
                      }`}
                    >
                      <div className={`w-full h-full bg-linear-to-br ${style.thumbnail}`} />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="text-white text-xs font-bold text-center px-2">{style.name}</span>
                      </div>
                    </motion.button>
                  ))}
                </div>

                <button className="w-full py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800/50 text-sm font-medium transition-colors flex items-center justify-center gap-2">
                  <Plus size={16} />
                  41+ Styles
                </button>
              </div>

              {/* Generation Settings */}
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 space-y-4">
                <label htmlFor="num-images" className="text-white font-bold">Number of Images</label>
                <div className="flex items-center gap-4">
                  <input
                    id="num-images"
                    type="range"
                    min="1"
                    max="4"
                    value={numImages}
                    onChange={(e) => setNumImages(parseInt(e.target.value))}
                    className="flex-1 h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer range-input"
                    aria-label="Number of images to generate"
                  />
                  <span className="text-white font-bold w-8 text-center">{numImages}</span>
                </div>

                <button className="w-full py-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold transition-colors">
                  Create
                </button>
                
                <p className="text-center text-sm text-green-500 flex items-center justify-center gap-1">
                  <Sparkles size={14} />
                  40 credits will be charged
                </p>
              </div>
            </div>

            {/* Right Panel - Preview */}
            <div className="space-y-6">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 space-y-4">
                <h3 className="text-white font-bold">Generation Preview</h3>
                <div className="space-y-3">
                  <div className="aspect-square bg-linear-to-br from-zinc-800 to-zinc-900 rounded-xl flex items-center justify-center">
                    <ImageIcon className="text-zinc-600" size={48} />
                  </div>
                  <p className="text-xs text-zinc-500 text-center">
                    Your generated character images will appear here
                  </p>
                </div>
              </div>

              {/* Recent Generations */}
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 space-y-4">
                <h3 className="text-white font-bold text-sm">Recent Generations</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="aspect-square bg-linear-to-br from-zinc-800 to-zinc-900 rounded-lg" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}
