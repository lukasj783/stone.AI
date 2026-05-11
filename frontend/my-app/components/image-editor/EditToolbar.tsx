import { 
  MousePointer2, 
  Hand, 
  Move, 
  Type, 
  Square,
  ChevronDown,
  Wand2,
  Eraser,
  Maximize,
  History,
  Undo,
  Redo
} from 'lucide-react';

export default function EditToolbar({ 
  activeMode = 'select', 
  setActiveMode = (mode: string) => {},
  zoomLevel = 1,
  setZoomLevel = (zoom: number) => {},
  onFitView = () => {}
}: { 
  activeMode?: string; 
  setActiveMode?: (mode: string) => void; 
  zoomLevel?: number;
  setZoomLevel?: (zoom: number) => void;
  onFitView?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[#1e1e1e] border-b border-zinc-800 text-zinc-400 shrink-0 z-20 relative shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <button 
            title="Select" 
            aria-label="Select" 
            onClick={() => setActiveMode('select')}
            className={`p-2 rounded-md transition-colors ${activeMode === 'select' ? 'bg-blue-600 text-white' : 'hover:bg-zinc-800 text-zinc-300'}`}
          >
            <MousePointer2 size={18} />
          </button>
          <button 
            title="Pan" 
            aria-label="Pan" 
            onClick={() => setActiveMode('pan')}
            className={`p-2 rounded-md transition-colors ${activeMode === 'pan' ? 'bg-blue-600 text-white' : 'hover:bg-zinc-800 text-zinc-300'}`}
          >
            <Hand size={18} />
          </button>
          <button 
            title="Move" 
            aria-label="Move" 
            onClick={() => setActiveMode('move')}
            className={`p-2 rounded-md transition-colors ${activeMode === 'move' ? 'bg-blue-600 text-white' : 'hover:bg-zinc-800 text-zinc-300'}`}
          >
            <Move size={18} />
          </button>
          <button 
            title="Text" 
            aria-label="Text" 
            onClick={() => setActiveMode('text')}
            className={`p-2 rounded-md transition-colors ${activeMode === 'text' ? 'bg-blue-600 text-white' : 'hover:bg-zinc-800 text-zinc-300'}`}
          >
            <Type size={18} />
          </button>
          <button 
            title="Shape" 
            aria-label="Shape" 
            onClick={() => setActiveMode('shape')}
            className={`flex items-center gap-1 p-2 rounded-md transition-colors ${activeMode === 'shape' ? 'bg-blue-600 text-white' : 'hover:bg-zinc-800 text-zinc-300'}`}
          >
            <Square size={18} />
            <ChevronDown size={14} />
          </button>
        </div>

        <div className="w-px h-6 bg-zinc-700 mx-1"></div>

        <button 
          onClick={() => setZoomLevel(zoomLevel === 1 ? 1.5 : zoomLevel === 1.5 ? 2 : zoomLevel === 2 ? 0.5 : 1)}
          className="flex items-center gap-2 hover:bg-zinc-800 px-3 py-1.5 rounded-md transition-colors text-zinc-200"
        >
          <span className="text-sm font-semibold">{Math.round(zoomLevel * 100)}%</span>
          <ChevronDown size={14} />
        </button>

        <button
          type="button"
          onClick={onFitView}
          className="flex items-center gap-2 border border-zinc-700 px-3 py-1.5 rounded-md transition-colors text-zinc-200 hover:bg-zinc-800"
        >
          <Maximize size={16} />
          <span className="text-sm font-medium">Fit View</span>
        </button>

        <div className="flex items-center gap-1 pl-4">
          <button 
            onClick={() => setActiveMode('inpaint')}
            className={`flex flex-col items-center justify-center p-1.5 px-3 rounded-md transition-colors ${
              activeMode === 'inpaint' ? 'bg-blue-600 text-white' : 'hover:bg-zinc-800/50 hover:text-white'
            }`}
          >
            <Wand2 size={18} />
            <span className="text-[10px] mt-1 font-medium">Inpaint</span>
          </button>
          <button className="flex flex-col items-center justify-center p-1.5 px-3 hover:text-white rounded-md hover:bg-zinc-800/50 transition-colors">
            <Eraser size={18} />
            <span className="text-[10px] mt-1 font-medium">Remove</span>
          </button>
          <button className="flex flex-col items-center justify-center p-1.5 px-3 hover:text-white rounded-md hover:bg-zinc-800/50 transition-colors">
            <Maximize size={18} />
            <span className="text-[10px] mt-1 font-medium">Expand</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-md hover:bg-zinc-800 transition-colors text-zinc-200 text-sm font-medium">
          <History size={16} />
          Editing History
        </button>
        <button title="Undo" aria-label="Undo" className="p-2 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-md transition-colors">
          <Undo size={18} />
        </button>
        <button title="Redo" aria-label="Redo" className="p-2 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-md transition-colors">
          <Redo size={18} />
        </button>
      </div>
    </div>
  );
}
