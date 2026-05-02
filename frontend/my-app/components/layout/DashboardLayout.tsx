"use client";
import React, { useState } from 'react';
import Sidebar from '../navigation/Sidebar';
import TopNav from '../navigation/TopNav';
import { cn } from '@/lib/utils';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="min-h-screen bg-black text-zinc-50 font-sans selection:bg-purple-500/30">
      <TopNav />
      <div className="flex pt-16">
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
        <main 
          className={cn(
            "flex-1 transition-all duration-500 ease-in-out p-4 md:p-8 min-w-0",
            collapsed ? "ml-25" : "ml-56"
          )}
        >
          <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {children}
          </div>
        </main>
      </div>
      
      {/* Background radial gradient decoration */}
      <div className="fixed top-0 right-0 w-125 h-125 bg-purple-500/10 blur-[120px] pointer-events-none -z-10" />
      <div className="fixed bottom-0 left-0 w-125 h-125 bg-indigo-500/10 blur-[120px] pointer-events-none -z-10" />
    </div>
  );
}
