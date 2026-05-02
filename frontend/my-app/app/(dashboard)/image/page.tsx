"use client";
import React, { useState, useEffect } from 'react';
import ActionCard from '@/components/ui/ActionCard';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Camera, 
  RefreshCw, 
  Smile, 
  Scaling, 
  BrainCircuit, 
  CreditCard,
  ArrowRight
} from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';

// Inline HeroCard Component
const HeroCard = ({ title, subtitle, buttonText, gradient }: { title: string, subtitle: string, buttonText: string, gradient: string }) => {
  return (
    <motion.div 
      whileHover={{ y: -5, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.3 }}
      className={`relative overflow-hidden rounded-2xl border border-zinc-800 p-6 flex flex-col justify-end h-64 group cursor-pointer shadow-lg hover:shadow-2xl hover:shadow-purple-500/10 transition-shadow ${gradient}`}
    >
      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors duration-300" />
      
      {/* Content */}
      <div className="relative z-10 space-y-3">
        <h3 className="text-2xl font-bold text-white tracking-tight">{title}</h3>
        <p className="text-zinc-200 text-sm font-medium">{subtitle}</p>
        <motion.button 
          whileHover={{ x: 2, backgroundColor: "#f4f4f5" }}
          className="mt-2 w-full py-2.5 rounded-lg bg-white text-black font-bold text-sm flex items-center justify-center gap-2 transition-colors"
        >
          {buttonText}
          <motion.span
            initial={{ x: 0 }}
            whileHover={{ x: 3 }}
          >
            <ArrowRight size={14} />
          </motion.span>
        </motion.button>
      </div>
    </motion.div>
  );
};

export default function ImageSection() {
  const pathname = usePathname();
  
  const secondaryNav = [
    { label: "Image Home", href: "/image" },
    { label: "Create Image", href: "/image/create" },
    { label: "Edit Image", href: "/image/edit" },
    { label: "Chat to Edit", href: "/image/chat" },
    { label: "Face Swap", href: "/image/face-swap" },
    { label: "Character", href: "/image/character" },
    { label: "Multiple Angle", href: "/image/multiple-angle" },
    { label: "Image Upscale", href: "/image/upscale" },
    { label: "Train a Model", href: "/image/train" },
  ];

  const heroTools = [
    { 
      title: "Create Image", 
      subtitle: "Generate images from text prompts", 
      buttonText: "Create Now",
      gradient: "bg-linear-to-br from-purple-900/50 to-indigo-900/50" 
    },
    { 
      title: "Chat to Edit", 
      subtitle: "Edit images through natural conversation", 
      buttonText: "Edit in Chat",
      gradient: "bg-linear-to-br from-blue-900/50 to-cyan-900/50"
    },
    { 
      title: "Edit Image", 
      subtitle: "Powerful AI image editing tools", 
      buttonText: "Edit in Canvas",
      gradient: "bg-linear-to-br from-pink-900/50 to-rose-900/50"
    },
  ];

  const imageTools = [
    { title: "Camera Angle Control", desc: "Control the camera angle of your image.", icon: Camera, color: "text-blue-400", badgeText: "New" },
    { title: "Swap", desc: "Swap the face of your image with another image.", icon: RefreshCw, color: "text-green-400", badgeText: "New" },
    { title: "Face Realism", desc: "Enhance the realism of faces in your images.", icon: Smile, color: "text-yellow-400" },
    { title: "Image Upscale", desc: "Upscale your images to high resolution.", icon: Scaling, color: "text-purple-400" },
    { title: "Train a Model", desc: "Train a custom model on your own images.", icon: BrainCircuit, color: "text-red-400" },
  ];

  const [recentImages, setRecentImages] = useState<string[]>([]);

  useEffect(() => {
    async function fetchRecentGenerations() {
      try {
        const { data, error } = await supabase
          .from('image_generations')
          .select('result_images')
          .order('created_at', { ascending: false })
          .limit(4);

        if (!error && data) {
          const images: string[] = [];
          data.forEach((row: any) => {
            if (row.result_images && Array.isArray(row.result_images)) {
              images.push(...row.result_images);
            }
          });
          setRecentImages(images.slice(0, 4));
        }
      } catch (err) {
        console.error("Error fetching recent images:", err);
      }
    }
    fetchRecentGenerations();
  }, []);

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
        <div className="flex-1 space-y-10 min-w-0">
          <header className="space-y-2">
            <motion.h1 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-4xl font-extrabold tracking-tight text-white"
            >
              All-in-One <span className="text-yellow-500">Image Creation</span> Tools
            </motion.h1>
          </header>

          {/* Hero Grid */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
             {heroTools.map((tool, idx) => (
              <motion.div
                key={tool.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
              >
                <HeroCard {...tool} />
              </motion.div>
            ))}
          </section>

          {/* Tools Section */}
          <section className="space-y-6">
            <h2 className="text-xl font-bold text-zinc-200 border-l-4 border-yellow-500 pl-4">Image Tools</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {imageTools.map((tool, idx) => (
                <motion.div
                  key={tool.title}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 + (idx * 0.05) }}
                >
                  <ActionCard 
                    {...tool}
                  />
                </motion.div>
              ))}
            </div>
          </section>

          {/* Recent Generations Section */}
          {recentImages.length > 0 && (
            <section className="space-y-6 pt-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-zinc-200 border-l-4 border-yellow-500 pl-4">Recent Generations</h2>
                <Link href="/assets" className="text-sm text-zinc-400 hover:text-white transition-colors">
                  View all
                </Link>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {recentImages.map((url, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.1 }}
                    className="aspect-square rounded-2xl bg-zinc-900 border border-zinc-800/50 overflow-hidden"
                  >
                    <div 
                      className="w-full h-full bg-cover bg-center hover:scale-105 transition-transform duration-500"
                      style={{ backgroundImage: `url('${url}')` }}
                    />
                  </motion.div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
  );
}
