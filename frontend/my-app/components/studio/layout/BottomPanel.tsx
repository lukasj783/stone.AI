"use client";

import { History, MessageSquare, Bot, Video } from 'lucide-react';

interface BottomPanelProps {
  activeView: string;
}

export function StudioBottomPanel({ activeView }: BottomPanelProps) {
  const isTimeline = activeView === 'timeline';

  if (isTimeline) {
    return (
      <div className="h-64 border-t border-zinc-800 bg-[#0A0A0B] flex flex-col shrink-0">
        <div className="h-10 border-b border-zinc-800 flex items-center px-4 justify-between bg-zinc-900/50">
          <div className="flex gap-4 text-xs font-medium text-zinc-400">
            <span className="text-zinc-100 flex items-center gap-2"><Video className="w-3.5 h-3.5" /> Timeline Assembly</span>
            <span>00:00:00:00</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-32 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-zinc-600 w-1/3"></div>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-zinc-950 p-2 flex flex-col gap-1">
          {/* V1 */}
          <div className="flex group">
            <div className="w-20 shrink-0 bg-zinc-900 border border-zinc-800/50 rounded-l flex items-center px-2 text-[10px] uppercase text-zinc-500 font-bold group-hover:bg-zinc-800">
              V1 Video
            </div>
            <div className="flex-1 border-y border-r border-zinc-800/50 rounded-r relative h-10 bg-zinc-900/30">
              <div className="absolute left-8 w-64 h-full bg-violet-600/20 border border-violet-500/50 rounded flex items-center px-2 shadow-sm text-xs text-violet-200">
                Scene_1_establishing_shot.mp4
              </div>
            </div>
          </div>
          {/* A1 */}
          <div className="flex group">
            <div className="w-20 shrink-0 bg-zinc-900 border border-zinc-800/50 rounded-l flex items-center px-2 text-[10px] uppercase text-zinc-500 font-bold group-hover:bg-zinc-800">
              A1 Dialog
            </div>
            <div className="flex-1 border-y border-r border-zinc-800/50 rounded-r relative h-10 bg-zinc-900/30">
              <div className="absolute left-8 w-64 h-full bg-blue-600/20 border border-blue-500/50 rounded flex items-center px-2 text-xs text-blue-200">
                <div className="w-full h-4 bg-blue-500/30 rounded-sm" style={{ clipPath: 'polygon(0 50%, 10% 20%, 20% 50%, 30% 80%, 40% 10%, 50% 60%, 60% 30%, 70% 90%, 80% 40%, 90% 60%, 100% 50%, 100% 100%, 0 100%)' }}></div>
              </div>
            </div>
          </div>
          {/* A2 */}
          <div className="flex group">
            <div className="w-20 shrink-0 bg-zinc-900 border border-zinc-800/50 rounded-l flex items-center px-2 text-[10px] uppercase text-zinc-500 font-bold group-hover:bg-zinc-800">
              A2 Music
            </div>
            <div className="flex-1 border-y border-r border-zinc-800/50 rounded-r relative h-10 bg-zinc-900/30">
              <div className="absolute left-0 w-full h-full bg-green-600/10 border border-green-500/30 rounded flex items-center px-2 text-xs text-green-200">
                Tension_Build_Loop_01.wav
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-10 border-t border-zinc-800 bg-zinc-900 flex items-center justify-between px-4 shrink-0 text-sm z-10">
      <div className="flex items-center gap-6 text-zinc-400">
        <button className="flex items-center gap-2 hover:text-zinc-100 transition-colors">
          <Bot className="w-4 h-4 text-violet-500" />
          <span>AI Assistant</span>
        </button>
        <button className="flex items-center gap-2 hover:text-zinc-100 transition-colors">
          <History className="w-4 h-4" />
          <span>Version History</span>
        </button>
      </div>
      
      <div className="flex items-center gap-4 text-zinc-400">
        <button className="flex items-center gap-2 hover:text-zinc-100 transition-colors">
          <MessageSquare className="w-4 h-4" />
          <span>Comments (3)</span>
        </button>
      </div>
    </div>
  );
}