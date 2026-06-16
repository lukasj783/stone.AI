import React, { useEffect, useRef, useState } from 'react';
import { Layers, ImagePlus, FileImage, MousePointer2, User, Crop, Type, Download, Undo, Redo, Pipette, PenTool, Eraser, Trash2, Copy, MoveUp, MoveDown, Maximize, Eye, EyeOff, Loader2, Square, Circle, Triangle, MessageSquare } from 'lucide-react';
import dynamic from 'next/dynamic';
import { BLEND_BOARD_SIZE_PRESETS, DEFAULT_BASE_IMAGE_SETTINGS, type BaseImageSettings, type BaseImageTransform, type BlendBoardSize, type EditorElement, type EditorImageElement, type EditorRectElement, type EditorShapeKind, type EditorTextElement, type ExportFormat, type InpaintExportResult, type InpaintMaskStroke, type InpaintTool } from '@/lib/types/layers.types';
import FloatingTextFormatPanel from './FloatingTextFormatPanel';
import FloatingShapeFormatPanel from './FloatingShapeFormatPanel';

const KonvaCanvas = dynamic(() => import('./KonvaCanvas'), { ssr: false });

const SHAPE_OPTIONS: Array<{ kind: EditorShapeKind; label: string }> = [
  { kind: 'rectangle', label: 'Rectangle' },
  { kind: 'circle', label: 'Circle' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'dialog-bubble', label: 'Dialog Bubble' },
];

const TEXT_PANEL_WIDTH = 640;
const TEXT_PANEL_HEIGHT = 96;
const TEXT_PANEL_VISIBLE_EDGE = 48;

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
  baseImageTransform?: BaseImageTransform | null;
  setBaseImageTransform?: React.Dispatch<React.SetStateAction<BaseImageTransform | null>>;
  boardSize?: BlendBoardSize;
  exportFormat?: ExportFormat;
  isBlendMode?: boolean;
  inpaintTool?: InpaintTool;
  brushSize?: number;
  maskStrokes?: InpaintMaskStroke[];
  isMaskInverted?: boolean;
  selectedShapeKind?: EditorShapeKind;
  canUndoMask?: boolean;
  canRedoMask?: boolean;
  onStartBlend?: () => void;
  onStopBlend?: () => void;
  onCenterSelectedLayer?: () => void;
  onSelectClickAreaTool?: () => void;
  onSelectManualBrushTool?: () => void;
  onSelectSelectTool?: () => void;
  onSelectEraseTool?: () => void;
  onSelectShapeTool?: () => void;
  onSelectTextTool?: () => void;
  onSelectedShapeKindChange?: (shapeKind: EditorShapeKind) => void;
  onToggleMaskInverse?: () => void;
  onUndoMask?: () => void;
  onRedoMask?: () => void;
  onBrushSizeChange?: (size: number) => void;
  onMaskStrokesCommit?: (strokes: InpaintMaskStroke[]) => void;
  onExportReady?: (exportFn: (() => void) | null) => void;
  onInpaintExportReady?: (exportFn: (() => Promise<InpaintExportResult | null>) | null) => void;
  onAddImageLayerReady?: (addImageLayerFn: (() => void) | null) => void;
  onAddTextReady?: (addTextFn: (() => void) | null) => void;
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
  baseImageTransform = null,
  setBaseImageTransform = () => undefined,
  boardSize = BLEND_BOARD_SIZE_PRESETS[3],
  exportFormat = 'png',
  isBlendMode = false,
  inpaintTool = 'manual-brush',
  brushSize = 36,
  maskStrokes = [],
  isMaskInverted = false,
  selectedShapeKind = 'rectangle',
  canUndoMask = false,
  canRedoMask = false,
  onStartBlend = () => {},
  onStopBlend = () => {},
  onCenterSelectedLayer = () => {},
  onSelectClickAreaTool = () => {},
  onSelectManualBrushTool = () => {},
  onSelectSelectTool = () => {},
  onSelectEraseTool = () => {},
  onSelectShapeTool = () => {},
  onSelectTextTool = () => {},
  onSelectedShapeKindChange = () => {},
  onToggleMaskInverse = () => {},
  onUndoMask = () => {},
  onRedoMask = () => {},
  onBrushSizeChange = () => {},
  onMaskStrokesCommit = () => {},
  onExportReady = () => {},
  onInpaintExportReady = () => {},
  onAddImageLayerReady = () => {},
  onAddTextReady = () => {}
}: WorkspaceDropzoneProps) {
  const flattenRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isCropMode, setIsCropMode] = useState(false);
  const [isShapeMenuOpen, setIsShapeMenuOpen] = useState(false);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const [textPanelPosition, setTextPanelPosition] = useState<{ x: number; y: number } | null>(null);
  const textPanelDragRef = useRef<{
    pointerId: number;
    startPointer: { x: number; y: number };
    startPanel: { x: number; y: number };
  } | null>(null);

  const [shapePanelPosition, setShapePanelPosition] = useState<{ x: number; y: number } | null>(null);
  const shapePanelDragRef = useRef<{
    pointerId: number;
    startPointer: { x: number; y: number };
    startPanel: { x: number; y: number };
  } | null>(null);

  const renderShapeIcon = (shapeKind: EditorShapeKind, size = 18) => {
    if (shapeKind === 'circle') {
      return <Circle size={size} />;
    }

    if (shapeKind === 'triangle') {
      return <Triangle size={size} />;
    }

    if (shapeKind === 'dialog-bubble') {
      return <MessageSquare size={size} />;
    }

    return <Square size={size} />;
  };

  const handleSelectShapeKind = (shapeKind: EditorShapeKind) => {
    onSelectedShapeKindChange(shapeKind);
    onSelectShapeTool();
    setIsShapeMenuOpen(false);
  };

  const handleOpenShapeMenu = (event: React.MouseEvent | React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsShapeMenuOpen(true);
  };

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
              const blendGuardRect = { x: 0, y: 0, width: boardSize.width, height: boardSize.height };
              const maxWidth = isBlendMode ? blendGuardRect.width - 48 : 300;
              const maxHeight = isBlendMode ? blendGuardRect.height - 48 : Number.POSITIVE_INFINITY;
              const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
              const imageWidth = img.width * scale;
              const imageHeight = img.height * scale;
              const newImage: EditorImageElement = {
                id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'image',
                src: dataUrl,
                x: 50,
                y: 50,
                width: imageWidth,
                height: imageHeight,
                naturalWidth: img.naturalWidth || img.width,
                naturalHeight: img.naturalHeight || img.height,
                crop: {
                  x: 0,
                  y: 0,
                  width: img.naturalWidth || img.width,
                  height: img.naturalHeight || img.height,
                },
                opacity: 1,
                blendMode: 'source-over'
              };
              setElements((prev) => {
                const layerOffset = prev.filter((element) => element.type === 'image').length * 18;
                const x = isBlendMode
                  ? Math.min(blendGuardRect.x + 24 + layerOffset, blendGuardRect.x + blendGuardRect.width - imageWidth)
                  : newImage.x;
                const y = isBlendMode
                  ? Math.min(blendGuardRect.y + 24 + layerOffset, blendGuardRect.y + blendGuardRect.height - imageHeight)
                  : newImage.y;

                return [
                  ...prev,
                  { ...newImage, x, y }
                ];
              });
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
  const selectedTextElement = selectedElement?.type === 'text' ? selectedElement : null;
  const selectedShapeElement = selectedElement?.type === 'rect' ? (selectedElement as EditorRectElement) : null;
  const [localProcessing, setLocalProcessing] = useState<boolean>(false);
  const canvasMode = isCropMode && selectedImageElement ? 'crop' : activeMode;
  const shouldShowInpaintSettings = activeMode === 'inpaint' && !isBlendMode && Boolean(imageSrc);
  const canvasSize = isBlendMode ? boardSize : BLEND_BOARD_SIZE_PRESETS[3];
  const addTextRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!selectedImageElement) {
      setIsCropMode(false);
    }
  }, [selectedImageElement]);

  useEffect(() => {
    onAddImageLayerReady(() => {
      fileInputRef.current?.click();
    });

    return () => {
      onAddImageLayerReady(null);
    };
  }, [onAddImageLayerReady]);

  const updateSelectedText = (updates: Partial<EditorTextElement>) => {
    if (!selectedTextElement) {
      return;
    }

    setElements((prev) => prev.map((element) => (
      element.id === selectedTextElement.id && element.type === 'text'
        ? { ...element, ...updates }
        : element
    )));
  };

  const deleteSelectedText = () => {
    if (!selectedTextElement) {
      return;
    }

    setElements((prev) => prev.filter((element) => element.id !== selectedTextElement.id));
    setSelectedId(null);
  };

  const updateSelectedShape = (updates: Partial<EditorRectElement>) => {
    if (!selectedShapeElement) {
      return;
    }

    setElements((prev) => prev.map((element) => (
      element.id === selectedShapeElement.id && element.type === 'rect'
        ? { ...element, ...updates }
        : element
    )));
  };

  const deleteSelectedShape = () => {
    if (!selectedShapeElement) {
      return;
    }

    setElements((prev) => prev.filter((element) => element.id !== selectedShapeElement.id));
    setSelectedId(null);
  };

  const getTextPanelPosition = (textElement: EditorTextElement) => {
    if (textPanelPosition) {
      return textPanelPosition;
    }

    const panelGap = 20;
    const transformerPadding = 14;
    const leftOverflowAllowance = 120;
    const maxX = Math.max(canvasSize.width - TEXT_PANEL_WIDTH, -leftOverflowAllowance);
    const textHeight = textElement.fontSize * textElement.lineHeight;
    const preferredX = textElement.x + (textElement.width / 2) - (TEXT_PANEL_WIDTH / 2);
    const x = Math.min(Math.max(preferredX, -leftOverflowAllowance), maxX);
    const preferredY = textElement.y + textHeight + transformerPadding + panelGap;
    const fallbackY = textElement.y - transformerPadding - panelGap - TEXT_PANEL_HEIGHT;
    const y = preferredY + TEXT_PANEL_HEIGHT <= canvasSize.height
      ? preferredY
      : Math.max(fallbackY, 0);

    return { x, y };
  };

  useEffect(() => {
    setTextPanelPosition(null);
    setIsTextEditing(false);
  }, [selectedTextElement?.id]);

  const getShapePanelPosition = (shapeElement: EditorRectElement) => {
    if (shapePanelPosition) {
      return shapePanelPosition;
    }

    const panelGap = 20;
    const transformerPadding = 14;
    const leftOverflowAllowance = 120;
    const PANEL_WIDTH = 500;
    const PANEL_HEIGHT = 60;
    const maxX = Math.max(canvasSize.width - PANEL_WIDTH, -leftOverflowAllowance);
    const preferredX = shapeElement.x + (shapeElement.width / 2) - (PANEL_WIDTH / 2);
    const x = Math.min(Math.max(preferredX, -leftOverflowAllowance), maxX);
    const preferredY = shapeElement.y + shapeElement.height + transformerPadding + panelGap;
    const fallbackY = shapeElement.y - transformerPadding - panelGap - PANEL_HEIGHT;
    const y = preferredY + PANEL_HEIGHT <= canvasSize.height
      ? preferredY
      : Math.max(fallbackY, 0);

    return { x, y };
  };

  useEffect(() => {
    setShapePanelPosition(null);
  }, [selectedShapeElement?.id]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = textPanelDragRef.current;
      const shapeDragState = shapePanelDragRef.current;

      if (shapeDragState && event.pointerId === shapeDragState.pointerId) {
        const nextX = shapeDragState.startPanel.x + event.clientX - shapeDragState.startPointer.x;
        const nextY = shapeDragState.startPanel.y + event.clientY - shapeDragState.startPointer.y;
        const minX = Math.min(TEXT_PANEL_VISIBLE_EDGE - 500, 0);
        const maxX = Math.max(canvasSize.width - TEXT_PANEL_VISIBLE_EDGE, 0);

        setShapePanelPosition({
          x: Math.min(Math.max(nextX, minX), maxX),
          y: Math.min(Math.max(nextY, 0), Math.max(canvasSize.height - TEXT_PANEL_VISIBLE_EDGE, 0)),
        });
        return;
      }

      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const nextX = dragState.startPanel.x + event.clientX - dragState.startPointer.x;
      const nextY = dragState.startPanel.y + event.clientY - dragState.startPointer.y;
      const minX = Math.min(TEXT_PANEL_VISIBLE_EDGE - TEXT_PANEL_WIDTH, 0);
      const maxX = Math.max(canvasSize.width - TEXT_PANEL_VISIBLE_EDGE, 0);

      setTextPanelPosition({
        x: Math.min(Math.max(nextX, minX), maxX),
        y: Math.min(Math.max(nextY, 0), Math.max(canvasSize.height - TEXT_PANEL_VISIBLE_EDGE, 0)),
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (textPanelDragRef.current?.pointerId === event.pointerId) {
        textPanelDragRef.current = null;
      }
      if (shapePanelDragRef.current?.pointerId === event.pointerId) {
        shapePanelDragRef.current = null;
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [canvasSize.height, canvasSize.width]);

  useEffect(() => {
    if (!selectedTextElement && !selectedShapeElement) return;

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      
      if (canvasContainerRef.current?.contains(target)) {
        return;
      }
      
      if (target.closest('[data-prevent-deselect="true"]')) {
        return;
      }

      setSelectedId(null);
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown);

    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
    };
  }, [selectedTextElement, selectedShapeElement, setSelectedId]);

  useEffect(() => {
    if (!isShapeMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!shapeMenuRef.current?.contains(event.target as Node)) {
        setIsShapeMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsShapeMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isShapeMenuOpen]);

  const bgRemovedBlobUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const nextBlobUrls = new Set<string>();

    for (const element of elements) {
      if (element.type !== 'image') continue;

      const imageElement = element as EditorImageElement;
      if (imageElement.bgRemovedSrc?.startsWith('blob:')) {
        nextBlobUrls.add(imageElement.bgRemovedSrc);
      }
    }

    for (const previousUrl of bgRemovedBlobUrlsRef.current) {
      if (!nextBlobUrls.has(previousUrl)) {
        URL.revokeObjectURL(previousUrl);
      }
    }

    bgRemovedBlobUrlsRef.current = nextBlobUrls;
  }, [elements]);

  useEffect(() => () => {
    for (const blobUrl of bgRemovedBlobUrlsRef.current) {
      URL.revokeObjectURL(blobUrl);
    }
    bgRemovedBlobUrlsRef.current.clear();
  }, []);

  const toggleBackground = async () => {
    if (!selectedImageElement || !setElements) return;
    const id = selectedImageElement.id;

    // If currently hidden, restore the original image source from the latest state.
    if (selectedImageElement.isBgHidden) {
      setElements((prev) => prev.map((el) => {
        if (el.id !== id || el.type !== 'image') return el;
        const img = el as EditorImageElement;
        return {
          ...img,
          src: img.originalSrc ?? img.src,
          isBgHidden: false,
          bgProcessing: false,
        };
      }));
      return;
    }

    // If we already have a bgRemovedSrc, use it
    if (selectedImageElement.bgRemovedSrc) {
      setElements((prev) => prev.map((el) => {
        if (el.id !== id || el.type !== 'image') return el;
        const img = el as EditorImageElement;
        return {
          ...img,
          src: img.bgRemovedSrc ?? img.src,
          isBgHidden: true,
          bgProcessing: false,
        };
      }));
      return;
    }

    // Otherwise run background removal
    try {
      setLocalProcessing(true);
      // preserve original
      const orig = selectedImageElement.src;
      setElements((prev) => prev.map((el) => {
        if (el.id !== id || el.type !== 'image') return el;
        const img = el as EditorImageElement;
        return { ...img, originalSrc: img.originalSrc ?? orig, bgProcessing: true };
      }));
      const bg = await (await import('@/lib/bgRemoval')).removeBackgroundFromSource(orig);
      const url = URL.createObjectURL(bg);
      setElements((prev) => prev.map((el) => {
        if (el.id !== id || el.type !== 'image') return el;
        const img = el as EditorImageElement;
        if (img.bgRemovedSrc?.startsWith('blob:') && img.bgRemovedSrc !== url) {
          URL.revokeObjectURL(img.bgRemovedSrc);
        }

        return { ...img, bgRemovedSrc: url, src: url, isBgHidden: true, bgProcessing: false };
      }));
    } catch (err) {
      console.error('Background removal failed', err);
      setElements((prev) => prev.map((el) => {
        if (el.id !== id || el.type !== 'image') return el;
        const img = el as EditorImageElement;
        return { ...img, bgProcessing: false };
      }));
    } finally {
      setLocalProcessing(false);
    }
  };

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
      <div data-prevent-deselect="true" className="absolute top-4 left-4 z-30 flex gap-3">
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
        <div data-prevent-deselect="true" className="absolute top-4 right-4 z-20 flex gap-2 bg-[#2a2a2a] border border-zinc-700/50 p-2 rounded-lg shadow-xl text-white">
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
            <button onClick={onCenterSelectedLayer} title="Center Layer" className="p-1.5 hover:bg-zinc-700 rounded transition-colors">
              <Maximize size={16} />
            </button>
          )}
          {selectedImageElement && (
            <button onClick={toggleBackground} title={selectedImageElement.isBgHidden ? 'Show Background' : 'Hide Background'} className="p-1.5 hover:bg-zinc-700 rounded transition-colors">
              {localProcessing || selectedImageElement.bgProcessing ? <Loader2 size={16} className="animate-spin" /> : (selectedImageElement.isBgHidden ? <EyeOff size={16} /> : <Eye size={16} />)}
            </button>
          )}
          <button onClick={bringForward} title="Bring Forward" className="p-1.5 hover:bg-zinc-700 rounded transition-colors"><MoveUp size={16} /></button>
          <button onClick={sendBackward} title="Send Backward" className="p-1.5 hover:bg-zinc-700 rounded transition-colors"><MoveDown size={16} /></button>
          <button onClick={duplicateSelected} title="Duplicate" className="p-1.5 hover:bg-zinc-700 rounded transition-colors"><Copy size={16} /></button>
          <button onClick={deleteSelected} title="Delete" className="p-1.5 hover:bg-zinc-700 text-red-400 hover:text-red-300 rounded transition-colors"><Trash2 size={16} /></button>
        </div>
      )}

      {(!imageSrc && !isBlendMode && activeMode !== 'text' && activeMode !== 'shape') ? (
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
          
          <div data-prevent-deselect="true" className="absolute -left-5 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2 bg-[#2a2a2a] border border-zinc-700 p-2 rounded-lg shadow-xl text-zinc-300">
            <button 
              title="Select" 
              aria-label="Select" 
              onClick={onSelectSelectTool}
              className={`p-2 rounded transition-colors ${
                activeMode === 'select' ? 'bg-blue-600 text-white' : 'hover:bg-zinc-700 hover:text-white'
              }`}
            >
              <MousePointer2 size={18} />
            </button>
            <button title="User" aria-label="User" className="p-2 hover:bg-zinc-700 hover:text-white rounded transition-colors"><User size={18} /></button>
            <button
              type="button"
              title="Crop"
              aria-label="Crop"
              disabled={!selectedImageElement}
              onClick={() => setIsCropMode((current) => !current)}
              className={`p-2 rounded transition-colors ${
                isCropMode
                  ? 'bg-blue-600 text-white'
                  : selectedImageElement
                    ? 'hover:bg-zinc-700 hover:text-white'
                    : 'opacity-40 cursor-not-allowed'
              }`}
            >
              <Crop size={18} />
            </button>
            <button 
              title="Layers" 
              aria-label="Layers" 
              onClick={() => flattenRef.current?.()}
              className="p-2 hover:bg-zinc-700 hover:text-white rounded transition-colors"
            >
              <Layers size={18} />
            </button>
            {activeMode !== 'inpaint' && (
              <>
                <div ref={shapeMenuRef} className="relative">
                  <button
                    type="button"
                    title="Add Shape"
                    aria-label="Add Shape"
                    onClick={onSelectShapeTool}
                    onPointerDown={(event) => {
                      if (event.button === 2) {
                        handleOpenShapeMenu(event);
                      }
                    }}
                    onContextMenu={handleOpenShapeMenu}
                    className={`p-2 rounded transition-colors ${
                      activeMode === 'shape' ? 'bg-blue-600 text-white' : 'hover:bg-zinc-700 hover:text-white'
                    }`}
                  >
                    {renderShapeIcon(selectedShapeKind)}
                  </button>
                  {isShapeMenuOpen && (
                    <div className="absolute left-full top-0 ml-2 w-44 rounded-lg border border-zinc-700 bg-[#2a2a2a] p-1.5 shadow-xl z-50">
                      {SHAPE_OPTIONS.map((option) => (
                        <button
                          key={option.kind}
                          type="button"
                          onClick={() => handleSelectShapeKind(option.kind)}
                          className={`flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                            selectedShapeKind === option.kind ? 'bg-blue-600 text-white' : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                          }`}
                        >
                          {renderShapeIcon(option.kind, 16)}
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  title="Type"
                  aria-label="Type"
                  onClick={() => {
                    onSelectTextTool();
                    addTextRef.current?.();
                  }}
                  className={`p-2 rounded transition-colors ${
                    activeMode === 'text' ? 'bg-blue-600 text-white' : 'hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  <Type size={18} />
                </button>
              </>
            )}
            <div className="h-px bg-zinc-700 my-1 w-full"></div>
            <button title="Download" aria-label="Download" className="p-2 hover:bg-zinc-700 hover:text-white rounded transition-colors"><Download size={18} /></button>
          </div>

          {/* Interactive Image Canvas via Konva */}
          <div ref={canvasContainerRef} className="relative max-w-full max-h-full">
            <KonvaCanvas 
              imageSrc={imageSrc || ''} 
              width={canvasSize.width} 
              height={canvasSize.height} 
              activeMode={canvasMode}
              zoomLevel={zoomLevel}
              viewportPosition={viewportPosition}
              setViewportPosition={setViewportPosition}
              elements={elements}
              setElements={setElements}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              baseImageSettings={baseImageSettings}
              baseImageTransform={baseImageTransform}
              setBaseImageTransform={setBaseImageTransform}
              isBlendMode={isBlendMode}
              exportFormat={exportFormat}
              selectedShapeKind={selectedShapeKind}
              inpaintTool={inpaintTool}
              brushSize={brushSize}
              maskStrokes={maskStrokes}
              isMaskInverted={isMaskInverted}
              onMaskStrokesCommit={onMaskStrokesCommit}
              onImageUpload={onImageUpload || (() => {})}
              onUploadClick={() => fileInputRef.current?.click()}
              onExportReady={onExportReady}
              onInpaintExportReady={onInpaintExportReady}
              onFlattenReady={(flattenFn) => {
                flattenRef.current = flattenFn;
              }}
              onAddTextReady={(addTextFn) => {
                addTextRef.current = addTextFn;
                onAddTextReady(addTextFn);
              }}
              onTextEditingChange={setIsTextEditing}
            />
            {selectedTextElement && !isTextEditing && (
              <div ref={panelRef}>
                <FloatingTextFormatPanel
                  textElement={selectedTextElement}
                  position={getTextPanelPosition(selectedTextElement)}
                  onChange={updateSelectedText}
                  onBringForward={bringForward}
                  onSendBackward={sendBackward}
                  onDelete={deleteSelectedText}
                  onDragStart={(event) => {
                    event.preventDefault();
                    event.stopPropagation();

                    const currentPosition = getTextPanelPosition(selectedTextElement);
                    textPanelDragRef.current = {
                      pointerId: event.pointerId,
                      startPointer: { x: event.clientX, y: event.clientY },
                      startPanel: currentPosition,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                />
              </div>
            )}
            {selectedShapeElement && (
              <div ref={panelRef}>
                <FloatingShapeFormatPanel
                  shapeElement={selectedShapeElement}
                  position={getShapePanelPosition(selectedShapeElement)}
                  onChange={updateSelectedShape}
                  onBringForward={bringForward}
                  onSendBackward={sendBackward}
                  onDelete={deleteSelectedShape}
                  onDragStart={(event) => {
                    event.preventDefault();
                    event.stopPropagation();

                    const currentPosition = getShapePanelPosition(selectedShapeElement);
                    shapePanelDragRef.current = {
                      pointerId: event.pointerId,
                      startPointer: { x: event.clientX, y: event.clientY },
                      startPanel: currentPosition,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                />
              </div>
            )}
          </div>

          {/* Horizontal Floating Brush Toolbar */}
          {shouldShowInpaintSettings && (
            <div data-prevent-deselect="true" className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[#2a2a2a] border border-zinc-700 p-1.5 rounded-lg shadow-xl text-zinc-300 z-20">
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
          )}
        </div>
      )}
    </div>
  );
}
 
