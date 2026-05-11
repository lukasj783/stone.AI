import React, { useRef } from 'react';
import { Layers, ImagePlus, FileImage, MousePointer2, User, Crop, Type, Download, Undo, Redo, Pipette, PenTool, Eraser, Trash2, Copy, MoveUp, MoveDown, Maximize } from 'lucide-react';
import dynamic from 'next/dynamic';
import { DEFAULT_BASE_IMAGE_SETTINGS, type BaseImageSettings, type EditorElement, type EditorImageElement, type InpaintMaskStroke, type InpaintTool } from '@/lib/types/layers.types';

const KonvaCanvas = dynamic(() => import('./KonvaCanvas'), { ssr: false });

interface WorkspaceDropzoneProps {
  imageSrc?: string | null;
  onImageUpload?: (src: string) => void;
  activeMode?: string;
  zoomLevel?: number;
  viewportPosition?: { x: number; y: number };
  setViewportPosition?: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  elements?: EditorElement[];
  setElements?: React.Dispatch<React.SetStateAction<EditorElement[]>>;
  selectedId?: string | null;
  setSelectedId?: (id: string | null) => void;
  baseImageSettings?: BaseImageSettings;
  isBlendMode?: boolean;
  inpaintTool?: InpaintTool;
  brushSize?: number;
  maskStrokes?: InpaintMaskStroke[];
  isMaskInverted?: boolean;
  canUndoMask?: boolean;
  canRedoMask?: boolean;
  onStartBlend?: () => void;
  onStopBlend?: () => void;
  onFitSelectedLayer?: () => void;
  onSelectClickAreaTool?: () => void;
  onSelectManualBrushTool?: () => void;
  onSelectEraseTool?: () => void;
  onToggleMaskInverse?: () => void;
  onUndoMask?: () => void;
  onRedoMask?: () => void;
  onBrushSizeChange?: (size: number) => void;
  onMaskStrokesCommit?: (strokes: InpaintMaskStroke[]) => void;
  onExportReady?: (exportFn: (() => void) | null) => void;
}

export default function WorkspaceDropzone({ 
  imageSrc, 
  onImageUpload,
  activeMode = 'select',
  zoomLevel = 1,
  viewportPosition = { x: 0, y: 0 },
  setViewportPosition = () => undefined,
  elements = [],
  setElements = () => undefined,
  selectedId = null,
  setSelectedId = () => {},
  baseImageSettings = DEFAULT_BASE_IMAGE_SETTINGS,
  isBlendMode = false,
  inpaintTool = 'manual-brush',
  brushSize = 36,
  maskStrokes = [],
  isMaskInverted = false,
  canUndoMask = false,
  canRedoMask = false,
  onStartBlend = () => {},
  onStopBlend = () => {},
  onFitSelectedLayer = () => {},
  onSelectClickAreaTool = () => {},
  onSelectManualBrushTool = () => {},
  onSelectEraseTool = () => {},
  onToggleMaskInverse = () => {},
  onUndoMask = () => {},
  onRedoMask = () => {},
  onBrushSizeChange = () => {},
  onMaskStrokesCommit = () => {},
  onExportReady = () => {}
}: WorkspaceDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList) => {
    if (files.length === 0) return;

    // If in inpaint mode with no background yet, set the first image as background
    if (!isBlendMode && !imageSrc) {
      if (files[0].type.startsWith('image/') && onImageUpload) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result) {
            onImageUpload(e.target.result as string);
          }
        };
        reader.readAsDataURL(files[0]);
      }
      return;
    }

    // Blend mode OR inpaint mode with existing image: add all images as layer elements
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result) {
            const dataUrl = e.target.result as string;
            const img = new window.Image();
            img.src = dataUrl;
            img.onload = () => {
              const maxWidth = 300;
              const scale = Math.min(1, maxWidth / img.width);
              const newImage: EditorImageElement = {
                id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'image',
                src: dataUrl,
                x: 50,
                y: 50,
                width: img.width * scale,
                height: img.height * scale,
                opacity: 1,
                blendMode: 'source-over'
              };
              setElements((prev) => [
                ...prev,
                newImage
              ]);
            };
          }
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const handleFile = (file: File) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    handleFiles(dt.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (isBlendMode) {
        handleFiles(e.dataTransfer.files);
      } else {
        handleFile(e.dataTransfer.files[0]);
      }
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (isBlendMode) {
        handleFiles(e.target.files);
      } else {
        handleFile(e.target.files[0]);
      }
    }
    // Reset the input value so you can upload the same image multiple times
    e.target.value = '';
  };

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedId) return;
    const newOpacity = parseFloat(e.target.value);
    setElements(elements.map(el => el.id === selectedId ? { ...el, opacity: newOpacity } : el));
  };

  const deleteSelected = () => {
    if (selectedId) {
      setElements(elements.filter(el => el.id !== selectedId));
      setSelectedId(null);
    }
  };

  const duplicateSelected = () => {
    if (selectedId) {
      const elToCopy = elements.find(el => el.id === selectedId);
      if (elToCopy) {
        const newEl = {
          ...elToCopy,
          id: `${elToCopy.type}-${Date.now()}`,
          x: elToCopy.x + 20,
          y: elToCopy.y + 20,
        };
        setElements([...elements, newEl]);
        setSelectedId(newEl.id);
      }
    }
  };

  const bringForward = () => {
    if (!selectedId) return;
    const idx = elements.findIndex(el => el.id === selectedId);
    if (idx >= 0 && idx < elements.length - 1) {
      const newElements = [...elements];
      const temp = newElements[idx];
      newElements[idx] = newElements[idx + 1];
      newElements[idx + 1] = temp;
      setElements(newElements);
    }
  };

  const sendBackward = () => {
    if (!selectedId) return;
    const idx = elements.findIndex(el => el.id === selectedId);
    if (idx > 0) {
      const newElements = [...elements];
      const temp = newElements[idx];
      newElements[idx] = newElements[idx - 1];
      newElements[idx - 1] = temp;
      setElements(newElements);
    }
  };

  const selectedElement = elements.find(el => el.id === selectedId);
  const selectedImageElement = selectedElement?.type === 'image' ? selectedElement : null;

  return (
    <div 
      className="relative flex-1 bg-[#1a1a1a] overflow-hidden w-full h-full flex flex-col items-center justify-center"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Dotted background pattern */}
      <div 
        className="absolute inset-0 z-0 opacity-30"
        style={{
          backgroundImage: 'radial-gradient(circle, #555 1.5px, transparent 1.5px)',
          backgroundSize: '24px 24px',
          backgroundPosition: '0 0'
        }}
      />

      {/* Hidden File Input */}
      <label htmlFor="file-upload" className="sr-only">Upload Image</label>
      <input 
        id="file-upload"
        type="file" 
        title="Upload Image"
        ref={fileInputRef} 
        onChange={onFileInputChange} 
        accept="image/*" 
        multiple={isBlendMode}
        className="hidden" 
      />

      {/* Top Left Buttons */}
      <div className="absolute top-4 left-4 z-30 flex gap-3">
        {!isBlendMode ? (
          <button 
            type="button"
            onClick={onStartBlend}
            className="flex items-center gap-2 px-4 py-2 bg-[#2a2a2a] hover:bg-[#333333] border border-zinc-700/50 text-white rounded-md text-sm font-semibold transition-colors shadow-sm cursor-pointer z-50 pointer-events-auto"
          >
            <Layers size={16} />
            Blend Board
          </button>
        ) : (
          <button 
            type="button"
            onClick={onStopBlend}
            className="flex items-center gap-2 px-4 py-2 bg-[#2a2a2a] hover:bg-[#333333] border border-zinc-700/50 text-white rounded-md text-sm font-semibold transition-colors shadow-sm cursor-pointer z-50 pointer-events-auto"
          >
            <Crop size={16} />
            Inpaint Mode
          </button>
        )}
        <button 
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 bg-[#2a2a2a] hover:bg-[#333333] border border-zinc-700/50 text-white rounded-md text-sm font-semibold transition-colors shadow-sm cursor-pointer z-50 pointer-events-auto"
        >
          <ImagePlus size={16} />
          Add Image
        </button>
      </div>

      {isBlendMode && selectedId && selectedElement && selectedId !== 'base-image' && selectedId !== 'blend-guard' && (
        <div className="absolute top-4 right-4 z-20 flex gap-2 bg-[#2a2a2a] border border-zinc-700/50 p-2 rounded-lg shadow-xl text-white">
          <div className="flex items-center gap-2 pr-3 border-r border-zinc-600">
            <span id="opacity-label" className="text-xs text-zinc-400">Opacity</span>
            <input 
              aria-labelledby="opacity-label"
              title="Opacity"
              type="range" 
              min="0.1" max="1" step="0.1" 
              value={selectedElement.opacity ?? 1} 
              onChange={handleOpacityChange}
              className="w-24 accent-blue-500"
            />
          </div>
          {selectedImageElement && (
            <button onClick={onFitSelectedLayer} title="Fit Layer" className="p-1.5 hover:bg-zinc-700 rounded transition-colors">
              <Maximize size={16} />
            </button>
          )}
          <button onClick={bringForward} title="Bring Forward" className="p-1.5 hover:bg-zinc-700 rounded transition-colors"><MoveUp size={16} /></button>
          <button onClick={sendBackward} title="Send Backward" className="p-1.5 hover:bg-zinc-700 rounded transition-colors"><MoveDown size={16} /></button>
          <button onClick={duplicateSelected} title="Duplicate" className="p-1.5 hover:bg-zinc-700 rounded transition-colors"><Copy size={16} /></button>
          <button onClick={deleteSelected} title="Delete" className="p-1.5 hover:bg-zinc-700 text-red-400 hover:text-red-300 rounded transition-colors"><Trash2 size={16} /></button>
        </div>
      )}

      {(!imageSrc && !isBlendMode) ? (
        <div 
          onClick={() => fileInputRef.current?.click()}
          className="relative z-10 flex flex-col items-center justify-center p-8 bg-[#2a2a2a]/90 rounded-2xl w-85 h-85 text-center shadow-xl hover:bg-[#2f2f2f] cursor-pointer transition-colors border border-[#3a3a3a] pointer-events-auto"
        >
          <p className="text-sm font-bold text-white mb-8 uppercase tracking-widest leading-snug">
            Drag and drop, upload,<br/>or select from history
          </p>
          <div className="bg-white p-3 rounded-br-3xl rounded-tl-xl rounded-tr-sm rounded-bl-sm transform rotate-12 drop-shadow-md">
             <FileImage size={64} className="text-black transform -rotate-12" strokeWidth={1.5} />
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex items-center justify-center w-full h-full max-w-200 max-h-150 p-12">
          
          <div className="absolute -left-5 top-1/2 -translate-y-1/2 flex flex-col gap-2 bg-[#2a2a2a] border border-zinc-700 p-2 rounded-lg shadow-xl text-zinc-300">
            <button title="Select" aria-label="Select" className="p-2 hover:bg-zinc-700 hover:text-white rounded transition-colors"><MousePointer2 size={18} /></button>
            <button title="User" aria-label="User" className="p-2 hover:bg-zinc-700 hover:text-white rounded transition-colors"><User size={18} /></button>
            <button title="Crop" aria-label="Crop" className="p-2 hover:bg-zinc-700 hover:text-white rounded transition-colors"><Crop size={18} /></button>
            <button title="Layers" aria-label="Layers" className="p-2 hover:bg-zinc-700 hover:text-white rounded transition-colors"><Layers size={18} /></button>
            <button title="Type" aria-label="Type" className="p-2 hover:bg-zinc-700 hover:text-white rounded transition-colors"><Type size={18} /></button>
            <div className="h-px bg-zinc-700 my-1 w-full"></div>
            <button title="Download" aria-label="Download" className="p-2 hover:bg-zinc-700 hover:text-white rounded transition-colors"><Download size={18} /></button>
          </div>

          {/* Interactive Image Canvas via Konva */}
          <div className="relative max-w-full max-h-full">
            <KonvaCanvas 
              imageSrc={imageSrc || ''} 
              width={800} 
              height={500} 
              activeMode={activeMode}
              zoomLevel={zoomLevel}
              viewportPosition={viewportPosition}
              setViewportPosition={setViewportPosition}
              elements={elements}
              setElements={setElements}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              baseImageSettings={baseImageSettings}
              isBlendMode={isBlendMode}
              inpaintTool={inpaintTool}
              brushSize={brushSize}
              maskStrokes={maskStrokes}
              isMaskInverted={isMaskInverted}
              onMaskStrokesCommit={onMaskStrokesCommit}
              onUploadClick={() => fileInputRef.current?.click()}
              onExportReady={onExportReady}
            />
          </div>

          {/* Horizontal Floating Brush Toolbar */}
          <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[#2a2a2a] border border-zinc-700 p-1.5 rounded-lg shadow-xl text-zinc-300 z-20">
            <button
              type="button"
              onClick={onSelectClickAreaTool}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
                inpaintTool === 'click-area' ? 'bg-blue-600 text-white' : 'hover:bg-zinc-700 hover:text-white'
              }`}
            >
              <Pipette size={16} /> Click Area
            </button>
            <button
              type="button"
              onClick={onSelectManualBrushTool}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
                inpaintTool === 'manual-brush' ? 'bg-blue-600 text-white' : 'hover:bg-zinc-700 hover:text-white'
              }`}
            >
              <PenTool size={16} /> Manual Brush
            </button>
            <button
              type="button"
              onClick={onSelectEraseTool}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
                inpaintTool === 'erase' ? 'bg-red-500 text-white' : 'hover:bg-zinc-700 hover:text-white'
              }`}
            >
              <Eraser size={16} /> Erase
            </button>
            <button
              type="button"
              onClick={onToggleMaskInverse}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors border-l border-zinc-700 pl-4 ${
                isMaskInverted ? 'bg-emerald-600/90 text-white' : 'hover:bg-zinc-700 hover:text-white'
              }`}
            >
              <div className="w-4 h-4 border border-current rounded-sm"></div> Inverse
            </button>
            <div className="w-px h-6 bg-zinc-700 mx-1"></div>
            <button
              type="button"
              title="Undo"
              aria-label="Undo"
              disabled={!canUndoMask}
              onClick={onUndoMask}
              className={`p-2 rounded transition-colors ${canUndoMask ? 'hover:bg-zinc-700 hover:text-white' : 'opacity-40 cursor-not-allowed'}`}
            ><Undo size={16} /></button>
            <button
              type="button"
              title="Redo"
              aria-label="Redo"
              disabled={!canRedoMask}
              onClick={onRedoMask}
              className={`p-2 rounded transition-colors ${canRedoMask ? 'hover:bg-zinc-700 hover:text-white' : 'opacity-40 cursor-not-allowed'}`}
            ><Redo size={16} /></button>
            <div className="flex items-center gap-2 px-3 pl-4 border-l border-zinc-700 ml-1">
              <span className="text-xs font-semibold">Size</span>
              <input
                title="Brush Size"
                aria-label="Brush Size"
                type="range"
                min="8"
                max="120"
                step="2"
                value={brushSize}
                onChange={(e) => onBrushSizeChange(Number(e.target.value))}
                className="w-24 accent-blue-500"
              />
              <span className="text-xs tabular-nums text-zinc-400 w-8 text-right">{brushSize}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
 