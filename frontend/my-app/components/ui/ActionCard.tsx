"use client";
import React from 'react';
import { LucideIcon, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ActionCardProps {
  title: string;
  desc: string;
  icon: LucideIcon;
  color?: string;
  href?: string;
  isPopular?: boolean;
  badgeText?: string;
  className?: string;
}

export default function ActionCard({ title, desc, icon: Icon, color, isPopular, badgeText, className }: ActionCardProps) {
  return (
    <motion.div 
      whileHover={{ y: -5 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "group relative h-60 p-8 rounded-2xl bg-zinc-900/40 border border-zinc-800/50 hover:bg-zinc-900 shadow-2xl shadow-black/40 hover:border-zinc-700 transition-all cursor-pointer overflow-hidden backdrop-blur-sm",
        className
      )}
    >
      {/* Badge */}
      {(isPopular || badgeText) && (
        <div className={cn(
          "absolute top-4 right-4 px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-widest z-10",
          badgeText === "New" 
            ? "bg-blue-500/10 text-blue-400 border-blue-500/20" 
            : "bg-purple-500/10 text-purple-400 border-purple-500/20"
        )}>
          {badgeText || "Popular"}
        </div>
      )}

      {/* Background Icon Decoration */}
      <div className="absolute -right-8 -bottom-8 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity">
        <Icon size={160} strokeWidth={1.5} />
      </div>

      <div className="relative h-full flex flex-col items-start justify-between">
        <div className="space-y-3">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center bg-zinc-800 shadow-inner ring-1 ring-white/5 group-hover:scale-110 group-active:scale-95 transition-all duration-300",
            color || "text-zinc-400"
          )}>
            <Icon size={20} strokeWidth={2.5} />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-lg text-white group-hover:text-purple-400 transition-colors tracking-tight line-clamp-1">{title}</h3>
            <p className="text-zinc-500 text-xs leading-relaxed group-hover:text-zinc-400 transition-colors line-clamp-2 max-w-[95%]">{desc}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-zinc-600 group-hover:text-zinc-300 transition-colors text-[10px] font-bold uppercase tracking-wider group-hover:translate-x-1 duration-300">
          Open Tool
          <ArrowRight size={12} strokeWidth={2.5}/>
        </div>
      </div>
    </motion.div>
  );
}
