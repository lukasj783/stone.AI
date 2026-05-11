import { Sparkles, Info, ArrowRight, ChevronDown } from 'lucide-react';

export default function InpaintPanel() {
  return (
    <div className="w-80 bg-[#1e1e1e] border-l border-zinc-800 flex flex-col h-full shrink-0 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800/50">
        <div className="flex items-center gap-2 text-zinc-100 font-medium">
          <Sparkles size={18} className="text-zinc-400" />
          <span>InPaint Area</span>
          <Info size={14} className="text-zinc-500" />
        </div>
        <button className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
          Results <ArrowRight size={14} />
        </button>
      </div>

      <div className="p-4 space-y-6">
        {/* Upgrade Banner */}
        <div className="bg-[#2a2a21] border border-[#4a4a25] rounded-xl p-4 relative overflow-hidden">
          <div className="flex items-center gap-2 mb-2 relative z-10">
            <Sparkles size={18} className="text-yellow-400 fill-yellow-400" />
            <span className="text-yellow-400 font-bold text-sm">Upgrade to use this feature</span>
          </div>
          <p className="text-zinc-300 text-xs font-medium relative z-10 leading-relaxed">
            Upgrade to Essential plan or higher to use this feature
          </p>
        </div>

        {/* Prompt Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm font-medium text-zinc-200">
            <span>Prompt</span>
            <ChevronDown size={14} className="text-zinc-500" />
          </div>
          <textarea 
            className="w-full h-24 bg-[#1a1a1a] border border-zinc-800 rounded-lg p-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 resize-none"
            placeholder="What do you want to generate in the selected area?"
          />
        </div>

        {/* Number of Images & Slider */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-300">Number of Images</span>
            <div className="bg-[#1a1a1a] border border-zinc-800 px-3 py-1 rounded text-sm text-zinc-300">
              4
            </div>
          </div>
          <div className="relative h-1.5 bg-zinc-800 rounded-full">
            <div className="absolute left-0 top-0 h-full w-full bg-blue-600 rounded-full"></div>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-zinc-300 rounded-full border-2 border-blue-600 shadow cursor-pointer"></div>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-2">
          <button 
            disabled
            className="w-full py-3 bg-[#3a3a3a] text-zinc-500 rounded-lg font-medium text-sm transition-colors"
          >
            Create
          </button>
          <div className="flex items-center justify-center gap-1.5 mt-3 text-xs font-medium text-emerald-500/70">
            <Sparkles size={12} />
            <span>40 credits will be charged</span>
          </div>
        </div>
      </div>
    </div>
  );
}