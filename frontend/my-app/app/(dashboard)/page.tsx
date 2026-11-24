"use client";
import React, { useState } from 'react';
import ActionCard from '@/components/ui/ActionCard';
import { BookOpen, Video, Image as LucideImage, UserCircle, Music, PlayCircle, Sparkles, Wand2, History, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export default function Home() {
  const [activeTab, setActiveTab] = useState('Story');
  
  const creatorModes = [
    { label: 'Story', icon: BookOpen },
    { label: 'Video', icon: Video },
    { label: 'Image', icon: LucideImage },
    { label: 'Character', icon: UserCircle },
    { label: 'Audio', icon: Music },
  ];

  const storyTools = [
    { title: "Music Video", desc: "Sync AI visual generation with background beats.", icon: Music, color: "text-purple-500 bg-purple-500/10", isPopular: true },
    { title: "Explainer Video", desc: "Turn facts and scripts into professional animations.", icon: PlayCircle, color: "text-blue-500 bg-blue-500/10" },
    { title: "Character Vlog", desc: "Animate your personal avatar with voice and facial motion.", icon: UserCircle, color: "text-emerald-500 bg-emerald-500/10" },
    { title: "ASMR Video", desc: "Immersive 3D soundscapes and calming aesthetics.", icon: Sparkles, color: "text-amber-500 bg-amber-500/10" },
    { title: "Build Storyboard", desc: "Sequence your vision visual by visual.", icon: History, color: "text-zinc-500 bg-zinc-500/10" },
    { title: "Open Editor", desc: "Professional timeline with multi-track editing.", icon: Wand2, color: "text-indigo-400 bg-indigo-500/10" },
  ];

  return (
    <>
      {/* Hero Section */}
      <section className="space-y-12 text-center md:text-left">
        <div className="space-y-4 max-w-3xl">
          <motion.h1 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="text-4xl md:text-6xl font-extrabold tracking-tight text-white leading-tight"
          >
            What would you like to <span className="text-transparent bg-clip-text bg-linear-to-r from-purple-400 via-indigo-400 to-blue-500">create today?</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease: "easeOut" }}
            className="text-zinc-400 text-lg md:text-xl font-medium max-w-2xl"
          >
            Access next-generation generative tools for every creative medium.
          </motion.p>
        </div>

        {/* Mode Switcher Pills */}
        <div className="flex flex-wrap items-center gap-2 md:gap-4 p-1.5 rounded-2xl bg-zinc-900/30 border border-zinc-900 w-fit backdrop-blur-xl ring-1 ring-white/5 mx-auto md:mx-0 overflow-x-auto no-scrollbar">
          {creatorModes.map((mode) => {
            const Icon = mode.icon;
            const isActive = activeTab === mode.label;
            return (
              <button
                key={mode.label}
                onClick={() => setActiveTab(mode.label)}
                className={cn(
                  "relative flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all duration-300",
                  isActive ? "text-white shadow-2xl" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                )}
              >
                {isActive && (
                  <motion.div 
                    layoutId="pillBg"
                    className="absolute inset-0 bg-zinc-800 rounded-xl shadow-inner border border-zinc-700/50" 
                  />
                )}
                <Icon size={18} strokeWidth={isActive ? 2.5 : 2} className="relative z-10" />
                <span className="relative z-10">{mode.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Create Story Section */}
      <section className="space-y-8">
        <div className="flex items-center justify-between group cursor-pointer w-fit gap-3">
          <h2 className="text-2xl font-extrabold text-white tracking-tight">Create {activeTab}</h2>
          <div className="h-0.5 w-12 bg-zinc-800 group-hover:w-24 group-hover:bg-purple-500 transition-all duration-500 rounded-full" />
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {storyTools.map((tool, idx) => (
            <motion.div
              key={tool.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 + 0.3 }}
            >
              <ActionCard {...tool} />
            </motion.div>
          ))}
        </div>
      </section>
    </>
  );
}
