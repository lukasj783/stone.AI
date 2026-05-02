"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Plus, 
  Layout, 
  Edit3, 
  Music, 
  Users, 
  Play, 
  ArrowRight, 
  Mic, 
  User, 
  Clock,
  Film
} from 'lucide-react';
import { motion } from 'framer-motion';

// --- Sub-components ---

const CreationCard = ({ 
  title, 
  icon: Icon, 
  gradient, 
  buttonText = "Create", 
  isPrimary = false 
}: { 
  title: string; 
  icon: React.ComponentType<{ size: number }>; 
  gradient: string; 
  buttonText?: string; 
  isPrimary?: boolean;
}) => (
  <motion.div 
    whileHover={{ y: -5, scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    transition={{ duration: 0.2 }}
    className={`relative h-60 rounded-2xl overflow-hidden p-6 flex flex-col justify-between group cursor-pointer border border-white/5 shadow-lg ${gradient}`}
  >
    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors duration-300" />
    
    <div className="relative z-10 flex justify-between items-start">
      <div className="bg-white/10 p-2.5 rounded-xl backdrop-blur-md text-white shadow-inner">
        <Icon size={20} />
      </div>
    </div>

    <div className="relative z-10 space-y-3">
      <h3 className="text-lg font-bold text-white leading-tight tracking-tight">{title}</h3>
      <button className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${
        isPrimary 
          ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30' 
          : 'bg-white/10 hover:bg-white/20 text-white backdrop-blur-md border border-white/10'
      }`}>
        {buttonText}
        {isPrimary && <ArrowRight size={14} />}
      </button>
    </div>
  </motion.div>
);

const ActionRowCard = ({ 
  title, 
  icon: Icon,
  href
}: { 
  title: string; 
  icon: React.ComponentType<{ size: number }>;
  href?: string;
}) => {
  const content = (
    <motion.div 
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className="h-20 bg-zinc-900/50 border border-zinc-800 px-6 py-4 rounded-2xl flex items-center justify-between cursor-pointer hover:bg-zinc-900 hover:border-zinc-700 transition-all group shadow-sm"
    >
      <div className="flex items-center gap-4">
        <div className="bg-zinc-800 p-2.5 rounded-xl group-hover:bg-zinc-700 transition-colors text-zinc-400 group-hover:text-white">
          <Icon size={20} />
        </div>
        <div>
          <h3 className="text-base font-bold text-zinc-200 group-hover:text-white transition-colors">{title}</h3>
        </div>
      </div>
      <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center group-hover:translate-x-1 transition-transform">
          <ArrowRight size={14} className="text-zinc-500 group-hover:text-white" />
      </div>
    </motion.div>
  );

  return href ? <Link href={href} className="block">{content}</Link> : content;
};

const StoryThumbnail = ({ title }: { title: string }) => (
  <div className="shrink-0 w-64 group cursor-pointer space-y-3">
    <div className="aspect-video bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800 group-hover:border-zinc-700 transition-all relative">
      <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent opacity-60" />
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 backdrop-blur-[2px]">
        <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30">
            <Play size={20} className="text-white fill-white ml-1" />
        </div>
      </div>
    </div>
    <div className="px-1">
        <h4 className="font-bold text-zinc-300 group-hover:text-white transition-colors truncate">{title}</h4>
        <p className="text-xs text-zinc-500">Edited 2 hours ago</p>
    </div>
  </div>
);

const CommunityCard = ({ 
  title, 
  duration, 
  author, 
  imageClass 
}: { 
  title: string; 
  duration: string; 
  author: string; 
  imageClass: string; 
}) => (
  <div className="break-inside-avoid mb-6 group cursor-pointer">
    <div className="rounded-xl overflow-hidden border border-zinc-800/50 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900 transition-all">
      <div className={`relative w-full ${imageClass} bg-zinc-800 group-hover:brightness-110 transition-all`}>
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[10px] font-bold text-white flex items-center gap-1">
          <Clock size={10} /> {duration}
        </div>
        <div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="p-4 space-y-2">
        <h4 className="font-bold text-zinc-200 text-sm leading-snug group-hover:text-purple-400 transition-colors line-clamp-2">{title}</h4>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] text-zinc-400">
            {author[0]}
          </div>
          <span className="text-xs text-zinc-500 font-medium group-hover:text-zinc-400">{author}</span>
        </div>
      </div>
    </div>
  </div>
);

export default function StoryPage() {
  const [activeTab, setActiveTab] = useState("All");

  return (
    <div className="flex flex-col lg:flex-row gap-8 min-h-[calc(100vh-120px)]">
        
        {/* Secondary Sidebar */}
        <aside className="lg:w-52 shrink-0 space-y-8 hidden lg:block">
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-2">
              Story Controls
            </h3>
            <div className="space-y-1">
              <button className="w-full text-left px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-white font-bold text-sm flex items-center gap-3 shadow-sm">
                <Plus size={16} />
                Create Story
              </button>
              <button className="w-full text-left px-3 py-2.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50 font-bold text-sm flex items-center gap-3 transition-all">
                <Film size={16} />
                My Stories
              </button>
              <button className="w-full text-left px-3 py-2.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50 font-bold text-sm flex items-center gap-3 transition-all">
                <Users size={16} />
                Community Stories
              </button>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-linear-to-br from-zinc-900 to-black border border-zinc-800 shadow-xl">
             <div className="flex items-center gap-2 text-zinc-400 mb-3">
                <div className="p-1 rounded bg-zinc-800"><Layout size={12}/></div>
                <span className="text-[10px] font-bold uppercase tracking-wider">Remaining Credits</span>
              </div>
            <div className="space-y-2">
               <div className="flex items-end justify-between">
                   <span className="text-2xl font-black text-white">0</span>
                   <span className="text-[10px] font-bold text-zinc-500 mb-1">/ 40 trial credits left</span>
               </div>
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="w-[0%] h-full bg-yellow-500 rounded-full" /> 
              </div>
            </div>
            <button className="mt-4 w-full py-2.5 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-black uppercase tracking-wide transition-colors shadow-lg shadow-yellow-500/20">
              Upgrade
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 space-y-12 min-w-0">
            
            <header className="space-y-6">
               <motion.h1 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-4xl font-extrabold text-white tracking-tight"
               >
                 Create Your Way
               </motion.h1>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <CreationCard 
                    title="Music Video" 
                    icon={Music} 
                    gradient="bg-linear-to-br from-violet-900/80 to-purple-900/80" 
                  />
                  <CreationCard 
                    title="Explainer Video" 
                    icon={Layout} 
                    gradient="bg-linear-to-br from-blue-900/80 to-cyan-900/80" 
                  />
                  <CreationCard 
                    title="Character Vlog" 
                    icon={User} 
                    gradient="bg-linear-to-br from-pink-900/80 to-rose-900/80"
                    buttonText="Create"
                    isPrimary={true}
                  />
                  <CreationCard 
                    title="ASMR Video" 
                    icon={Mic} 
                    gradient="bg-linear-to-br from-emerald-900/80 to-teal-900/80" 
                  />
               </div>
            </header>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ActionRowCard title="Build Storyboard" icon={Layout} href="/storyboard" />
              <ActionRowCard title="Open Editor" icon={Edit3} href="/editor" />
            </section>

            <section className="space-y-6">
                <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
                    <h2 className="text-xl font-bold text-white">My Story</h2>
                    <button className="text-xs font-bold text-zinc-500 hover:text-white transition-colors flex items-center gap-1 group">
                        View All 
                        <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform"/>
                    </button>
                </div>
                <div className="flex gap-6 overflow-x-auto pb-6 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                   {[1, 2, 3, 4].map((i) => (
                       <StoryThumbnail key={i} title={`Untitled Project ${i}`} />
                   ))}
                </div>
            </section>

            <section className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
                    <h2 className="text-xl font-bold text-white shrink-0">Community Stories</h2>
                    <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none min-w-0 flex-1 justify-end">
                        {["All", "Music video", "Character vlog", "Explainer video", "ASMR"].map((tab) => (
                             <button 
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                                    activeTab === tab 
                                    ? "bg-white text-black" 
                                    : "bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                                }`}
                             >
                                {tab}
                             </button>
                        ))}
                    </div>
                </div>

                <div className="columns-1 md:columns-2 lg:columns-3 xl:columns-4 gap-6 space-y-6">
                    <CommunityCard title="Neon Nights: Cyberpunk City" duration="0:58" author="PixelPioneer" imageClass="aspect-[3/4]" />
                    <CommunityCard title="The Last Astronaut" duration="2:15" author="CosmicWanderer" imageClass="aspect-video" />
                    <CommunityCard title="Morning Routine ASMR" duration="3:30" author="CalmVibes" imageClass="aspect-square" />
                    <CommunityCard title="Fantasy RPG Character Intro" duration="1:20" author="DragonSlayer" imageClass="aspect-[4/5]" />
                    <CommunityCard title="Product Launch: Tech Gadget" duration="0:45" author="MarketingGuru" imageClass="aspect-video" />
                    <CommunityCard title="Lo-Fi Study Beats Visualizer" duration="10:00" author="ChillHop" imageClass="aspect-square" />
                    <CommunityCard title="Horror Short: The Mirror" duration="1:50" author="SpookyTales" imageClass="aspect-[3/5]" />
                    <CommunityCard title="Travel Vlog: Tokyo" duration="5:12" author="Wanderlust" imageClass="aspect-video" />
                </div>
            </section>

        </main>
      </div>
  );
}
