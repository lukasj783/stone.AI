"use client";
import React from 'react';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

export default function StorageBanner() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20 flex flex-col sm:flex-row items-center justify-between gap-4 transition-all hover:bg-emerald-950/30 group"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 group-hover:scale-110 transition-transform">
          <ShieldCheck size={20} strokeWidth={2.5} />
        </div>
        <p className="text-emerald-500/90 text-sm font-medium leading-relaxed">
          Your private creations will be stored for <span className="font-bold text-emerald-400">7 days</span>. 
          Upgrade now to unlock unlimited private history and priority generation.
        </p>
      </div>
      
      <button className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black px-5 py-2 rounded-lg font-bold text-xs transition-all hover:scale-105 active:scale-95 whitespace-nowrap shadow-lg shadow-emerald-500/10">
        Upgrade Now
        <ArrowRight size={14} strokeWidth={3} />
      </button>
    </motion.div>
  );
}
