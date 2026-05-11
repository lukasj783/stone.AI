"use client";
import React, { useRef, useState } from 'react';
import EditToolbar from '@/components/image-editor/EditToolbar';
import WorkspaceDropzone from '@/components/image-editor/WorkspaceDropzone';
import InpaintPanel from '@/components/image-editor/InpaintPanel';
import BlendPanel from '@/components/image-editor/BlendPanel';
import {
  DEFAULT_BASE_IMAGE_SETTINGS,
  type BaseImageSettings,
  type BlendMode,
  type BlendableTarget,
  type EditorElement,
  type EditorImageElement,
  type InpaintMaskSnapshot,
  type InpaintMaskStroke,
  type InpaintTool,
} from '@/lib/types/layers.types';

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const FIT_PADDING = 32;

type ViewportPosition = {
  x: number;
  y: number;
};

const getContainSize = (
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
) => {
  const safeSourceWidth = Math.max(sourceWidth, 1);
  const safeSourceHeight = Math.max(sourceHeight, 1);
  const scale = Math.min(maxWidth / safeSourceWidth, maxHeight / safeSourceHeight);

  return {
    width: safeSourceWidth * scale,
    height: safeSourceHeight * scale,
  };
};

const cloneMaskStrokes = (strokes: InpaintMaskStroke[]) => strokes.map((stroke) => ({
  ...stroke,
  points: stroke.points.map((point) => ({ ...point })),
}));

const createMaskSnapshot = (
  strokes: InpaintMaskStroke[],
  isInverted: boolean,
): InpaintMaskSnapshot => ({
  strokes: cloneMaskStrokes(strokes),
  isInverted,
});

export default function EditPage() {
  const [activeMode, setActiveMode] = useState('select');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [viewportPosition, setViewportPosition] = useState<ViewportPosition>({ x: 0, y: 0 });
  const [elements, setElements] = useState<EditorElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isBlendMode, setIsBlendMode] = useState(false);
  const [baseImageSettings, setBaseImageSettings] = useState<BaseImageSettings>(DEFAULT_BASE_IMAGE_SETTINGS);
  const [inpaintTool, setInpaintTool] = useState<InpaintTool>('manual-brush');
  const [maskStrokes, setMaskStrokes] = useState<InpaintMaskStroke[]>([]);
  const [brushSize, setBrushSize] = useState(36);
  const [isMaskInverted, setIsMaskInverted] = useState(false);
  const [maskHistory, setMaskHistory] = useState<InpaintMaskSnapshot[]>([]);
  const [maskFuture, setMaskFuture] = useState<InpaintMaskSnapshot[]>([]);
  const exportBlendBoardRef = useRef<(() => void) | null>(null);
  const baseImageDimensionsRef = useRef<{ width: number; height: number } | null>(null);

  const selectedImageLayer = elements.find((element): element is EditorImageElement => (
    element.id === selectedId && element.type === 'image'
  )) ?? null;

  const selectedBlendTarget: BlendableTarget | null = selectedId === 'base-image' && imageSrc
    ? {
        id: 'base-image',
        kind: 'base-image',
        label: 'Base Image',
        blendMode: baseImageSettings.blendMode,
        opacity: baseImageSettings.opacity,
      }
    : selectedImageLayer
      ? {
          id: selectedImageLayer.id,
          kind: 'image',
          label: 'Selected Layer',
          blendMode: selectedImageLayer.blendMode,
          opacity: selectedImageLayer.opacity,
        }
      : null;

  const handleBlendModeChange = (blendMode: BlendMode) => {
    if (selectedId === 'base-image') {
      setBaseImageSettings((prev) => ({ ...prev, blendMode }));
      return;
    }

    if (!selectedImageLayer) {
      return;
    }

    setElements((prev) => prev.map((element) => (
      element.id === selectedImageLayer.id
        ? { ...element, blendMode }
        : element
    )));
  };

  const handleOpacityChange = (opacity: number) => {
    if (selectedId === 'base-image') {
      setBaseImageSettings((prev) => ({ ...prev, opacity }));
      return;
    }

    if (!selectedImageLayer) {
      return;
    }

    setElements((prev) => prev.map((element) => (
      element.id === selectedImageLayer.id
        ? { ...element, opacity }
        : element
    )));
  };

  const handleImageUpload = (src: string) => {
    setImageSrc(src);
    setBaseImageSettings(DEFAULT_BASE_IMAGE_SETTINGS);
    setActiveMode('inpaint');
    setViewportPosition({ x: 0, y: 0 });
    setZoomLevel(1);
    setInpaintTool('manual-brush');
    setBrushSize(36);
    setMaskStrokes([]);
    setIsMaskInverted(false);
    setMaskHistory([]);
    setMaskFuture([]);

    const uploadedImage = new window.Image();
    uploadedImage.onload = () => {
      baseImageDimensionsRef.current = {
        width: uploadedImage.naturalWidth || uploadedImage.width,
        height: uploadedImage.naturalHeight || uploadedImage.height,
      };
    };
    uploadedImage.src = src;
  };

  const handleFitView = () => {
    const baseDimensions = baseImageDimensionsRef.current;
    const targetWidth = Math.max(CANVAS_WIDTH - FIT_PADDING * 2, 1);
    const targetHeight = Math.max(CANVAS_HEIGHT - FIT_PADDING * 2, 1);

    if (baseDimensions) {
      const fitted = getContainSize(baseDimensions.width, baseDimensions.height, targetWidth, targetHeight);
      setZoomLevel(fitted.width / CANVAS_WIDTH);
    } else {
      setZoomLevel(1);
    }

    setViewportPosition({ x: 0, y: 0 });
  };

  const handleFitSelectedLayer = () => {
    if (!selectedImageLayer) {
      return;
    }

    const targetWidth = Math.max(CANVAS_WIDTH - FIT_PADDING * 2, 1);
    const targetHeight = Math.max(CANVAS_HEIGHT - FIT_PADDING * 2, 1);
    const fitted = getContainSize(selectedImageLayer.width, selectedImageLayer.height, targetWidth, targetHeight);

    setElements((prev) => prev.map((element) => (
      element.id === selectedImageLayer.id
        ? {
            ...element,
            width: fitted.width,
            height: fitted.height,
            x: (CANVAS_WIDTH - fitted.width) / 2,
            y: (CANVAS_HEIGHT - fitted.height) / 2,
          }
        : element
    )));
  };

  const commitMaskUpdate = (
    nextStrokes: InpaintMaskStroke[],
    nextIsInverted = isMaskInverted,
  ) => {
    setMaskHistory((prev) => [
      ...prev,
      createMaskSnapshot(maskStrokes, isMaskInverted),
    ]);
    setMaskFuture([]);
    setMaskStrokes(cloneMaskStrokes(nextStrokes));
    setIsMaskInverted(nextIsInverted);
  };

  const handleMaskStrokesCommit = (nextStrokes: InpaintMaskStroke[]) => {
    commitMaskUpdate(nextStrokes);
  };

  const handleSelectClickAreaTool = () => {
    setActiveMode('inpaint');
    setInpaintTool('click-area');
  };

  const handleSelectManualBrushTool = () => {
    setActiveMode('inpaint');
    setInpaintTool('manual-brush');
  };

  const handleSelectEraseTool = () => {
    setActiveMode('inpaint');
    setInpaintTool('erase');
  };

  const handleToggleMaskInverse = () => {
    commitMaskUpdate(maskStrokes, !isMaskInverted);
  };

  const handleUndoMask = () => {
    if (maskHistory.length === 0) {
      return;
    }

    const previous = maskHistory[maskHistory.length - 1];
    setMaskHistory((prev) => prev.slice(0, -1));
    setMaskFuture((prev) => [
      createMaskSnapshot(maskStrokes, isMaskInverted),
      ...prev,
    ]);
    setMaskStrokes(cloneMaskStrokes(previous.strokes));
    setIsMaskInverted(previous.isInverted);
  };

  const handleRedoMask = () => {
    if (maskFuture.length === 0) {
      return;
    }

    const [next, ...rest] = maskFuture;
    setMaskHistory((prev) => [
      ...prev,
      createMaskSnapshot(maskStrokes, isMaskInverted),
    ]);
    setMaskFuture(rest);
    setMaskStrokes(cloneMaskStrokes(next.strokes));
    setIsMaskInverted(next.isInverted);
  };

  return (
    <div className="-mt-4 md:-mt-8 -mx-4 md:-mx-8 flex flex-col h-[calc(100vh-64px)] w-[calc(100%+2rem)] md:w-[calc(100%+4rem)] overflow-hidden z-10 relative">
      <EditToolbar 
        activeMode={activeMode} 
        setActiveMode={setActiveMode} 
        zoomLevel={zoomLevel}
        setZoomLevel={setZoomLevel}
        onFitView={handleFitView}
      />
      <div className="flex-1 flex overflow-hidden">
        <WorkspaceDropzone 
          imageSrc={imageSrc} 
          onImageUpload={handleImageUpload}
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
          canUndoMask={maskHistory.length > 0}
          canRedoMask={maskFuture.length > 0}
          onStartBlend={() => setIsBlendMode(true)}
          onStopBlend={() => setIsBlendMode(false)}
          onFitSelectedLayer={handleFitSelectedLayer}
          onSelectClickAreaTool={handleSelectClickAreaTool}
          onSelectManualBrushTool={handleSelectManualBrushTool}
          onSelectEraseTool={handleSelectEraseTool}
          onToggleMaskInverse={handleToggleMaskInverse}
          onUndoMask={handleUndoMask}
          onRedoMask={handleRedoMask}
          onBrushSizeChange={setBrushSize}
          onMaskStrokesCommit={handleMaskStrokesCommit}
          onExportReady={(exportFn) => {
            exportBlendBoardRef.current = exportFn;
          }}
        />
        {isBlendMode ? (
          <BlendPanel
            selectedTarget={selectedBlendTarget}
            onBlendModeChange={handleBlendModeChange}
            onOpacityChange={handleOpacityChange}
            onDownload={() => exportBlendBoardRef.current?.()}
          />
        ) : (
          imageSrc && <InpaintPanel />
        )}
      </div>
    </div>
  );
}