"use client";
import React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import ActionCard from '@/components/ui/ActionCard';
import { Video, Type, Image as LucideImage, Layers, Sparkles, Wand2, Play, CreditCard } from 'lucide-react';
import { motion } from 'framer-motion';

export default function VideoSection() {
  const pathname = usePathname();

  const videoTools = [
    { title: "Text to Video", desc: "Generate motion-driven scenes from natural language prompts.", icon: Type, color: "text-blue-500", isPopular: true, href: "/video/text-to-video" },
    { title: "Image to Video", desc: "Animate portraits and images with voice-driven lip movement.", icon: LucideImage, color: "text-purple-500", href: "/video/image-to-video" },
    { title: "Elements to Video", desc: "Combine elements and text to create dynamic scenes.", icon: Layers, color: "text-orange-500", href: "/video/elements-to-video" },
    { title: "Motion-Transfer & Lypsinc", desc: "Transform existing footage with motion control and lypsinc workflows.", icon: Video, color: "text-emerald-500", href: "/video/video-to-video" },
  ];

  const secondaryNav = [
    { label: "Video Home", href: "/video" },
    { label: "Text to Video", href: "/video/text-to-video" },
    { label: "Image to Video", href: "/video/image-to-video" },
    { label: "Elements to Video", href: "/video/elements-to-video" },
    { label: "Motion-Transfer & Lypsinc", href: "/video/video-to-video" },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-5">
        {/* Secondary Sidebar (Left) */}
        <aside className="lg:w-52 space-y-8 shrink-0">
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-4">Video Controls</h3>
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

          <div className="p-5 rounded-2xl bg-linear-to-br from-zinc-900 to-black border border-zinc-800 space-y-4">
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
            <button className="w-full py-2 rounded-lg bg-purple-500 text-white text-xs font-bold hover:bg-purple-400 transition-colors">
              Upgrade Now
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 space-y-12 min-w-0">
          <header className="space-y-4">
            <motion.h1 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-4xl font-extrabold tracking-tight text-white"
            >
              All-in-One <span className="text-purple-500">Motion & Lypsinc</span> Tools
            </motion.h1>
            <p className="text-zinc-400 text-lg max-w-2xl">
              Professional-grade video workflows for prompt-based motion, image lypsinc, and motion-controlled clip transformation.
            </p>
          </header>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {videoTools.map((tool, idx) => (
              <motion.div
                key={tool.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
              >
                <Link href={tool.href}>
                  <ActionCard {...tool} className="h-44 px-7 py-6 cursor-pointer" />
                </Link>
              </motion.div>
            ))}
          </section>

          <section className="space-y-6 pt-6 border-t border-zinc-900">
            <h2 className="text-xl font-bold text-zinc-200">Additional Tools</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 transition-all flex items-center justify-between group cursor-pointer">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-zinc-800 ring-1 ring-white/5 transition-transform group-hover:scale-110"><Wand2 className="text-purple-400" size={20}/></div>
                  <div>
                    <div className="font-bold text-white group-hover:text-purple-400 transition-colors">Motion-Sync Video</div>
                    <div className="text-sm text-zinc-500">Sync actions to beats automatically</div>
                  </div>
                </div>
                <Play size={18} className="text-zinc-600 group-hover:text-white transition-all transform group-hover:translate-x-1" />
              </div>

              <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 transition-all flex items-center justify-between group cursor-pointer text-left">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-zinc-800 ring-1 ring-white/5 transition-transform group-hover:scale-110"><Sparkles className="text-blue-400" size={20}/></div>
                  <div>
                    <div className="font-bold text-white group-hover:text-blue-400 transition-colors">Lip-Sync Video</div>
                    <div className="text-sm text-zinc-500">Professional audio-visual alignment</div>
                  </div>
                </div>
                <Play size={18} className="text-zinc-600 group-hover:text-white transition-all transform group-hover:translate-x-1" />
              </div>
            </div>
          </section>
        </div>
      </div>
  );
}
