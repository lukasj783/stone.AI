"use client";
import React, { useRef, useState } from 'react';
import EditToolbar from '@/components/image-editor/EditToolbar';
import WorkspaceDropzone from '@/components/image-editor/WorkspaceDropzone';
import InpaintPanel from '@/components/image-editor/InpaintPanel';
import BlendPanel from '@/components/image-editor/BlendPanel';
import {
  BLEND_BOARD_SIZE_PRESETS,
  DEFAULT_BASE_IMAGE_SETTINGS,
  type BaseImageSettings,
  type BaseImageTransform,
  type BlendBoardSize,
  type BlendMode,
  type BlendableTarget,
  type EditorElement,
  type EditorImageElement,
  type EditorShapeKind,
  type ExportFormat,
  type InpaintExportResult,
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

const clampValue = (value: number, minimum: number, maximum: number) => (
  Math.min(Math.max(value, minimum), maximum)
);

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
  const [baseImageTransform, setBaseImageTransform] = useState<BaseImageTransform | null>(null);
  const [inpaintTool, setInpaintTool] = useState<InpaintTool>('manual-brush');
  const [maskStrokes, setMaskStrokes] = useState<InpaintMaskStroke[]>([]);
  const [brushSize, setBrushSize] = useState(36);
  const [isMaskInverted, setIsMaskInverted] = useState(false);
  const [selectedShapeKind, setSelectedShapeKind] = useState<EditorShapeKind>('rectangle');
  const [maskHistory, setMaskHistory] = useState<InpaintMaskSnapshot[]>([]);
  const [maskFuture, setMaskFuture] = useState<InpaintMaskSnapshot[]>([]);
  const [boardSize, setBoardSize] = useState<BlendBoardSize>(BLEND_BOARD_SIZE_PRESETS[3]);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [inpaintResultUrls, setInpaintResultUrls] = useState<string[]>([]);
  const exportBlendBoardRef = useRef<(() => void) | null>(null);
  const exportInpaintRef = useRef<(() => Promise<InpaintExportResult | null>) | null>(null);
  const addImageLayerRef = useRef<(() => void) | null>(null);
  const baseImageDimensionsRef = useRef<{ width: number; height: number } | null>(null);
  const imageLayerCount = elements.filter((element) => element.type === 'image').length;
  const blendLayerCount = imageLayerCount + (imageSrc ? 1 : 0);
  const canExportBlendBoard = blendLayerCount > 0;

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

  const handleResetSelectedTarget = () => {
    if (selectedId === 'base-image') {
      setBaseImageSettings(DEFAULT_BASE_IMAGE_SETTINGS);
      return;
    }

    if (!selectedImageLayer) {
      return;
    }

    setElements((prev) => prev.map((element) => (
      element.id === selectedImageLayer.id
        ? { ...element, blendMode: 'source-over', opacity: 1 }
        : element
    )));
  };

  const refitBaseImageToBoard = (nextBoardSize: BlendBoardSize) => {
    const baseDimensions = baseImageDimensionsRef.current;

    if (!baseDimensions) {
      return;
    }

    const fitted = getContainSize(
      baseDimensions.width,
      baseDimensions.height,
      Math.max(nextBoardSize.width - FIT_PADDING * 2, 1),
      Math.max(nextBoardSize.height - FIT_PADDING * 2, 1),
    );

    setBaseImageTransform({
      x: (nextBoardSize.width - fitted.width) / 2,
      y: (nextBoardSize.height - fitted.height) / 2,
      width: fitted.width,
      height: fitted.height,
      rotation: 0,
    });
  };

  const handleBoardSizeChange = (nextBoardSize: BlendBoardSize) => {
    setBoardSize(nextBoardSize);

    setElements((prev) => prev.map((element) => {
      if (element.type !== 'image') {
        return element;
      }

      const scale = Math.min(1, nextBoardSize.width / element.width, nextBoardSize.height / element.height);
      const width = element.width * scale;
      const height = element.height * scale;

      return {
        ...element,
        width,
        height,
        x: clampValue(element.x, 0, Math.max(nextBoardSize.width - width, 0)),
        y: clampValue(element.y, 0, Math.max(nextBoardSize.height - height, 0)),
      };
    }));

    if (isBlendMode && imageSrc) {
      refitBaseImageToBoard(nextBoardSize);
    }
  };

  const handleImageUpload = (src: string) => {
    setImageSrc(src);
    setElements([]); // Clear all layers when a new base image is set or stage is flattened
    setBaseImageSettings(DEFAULT_BASE_IMAGE_SETTINGS);
    setBaseImageTransform(null);
    setActiveMode('inpaint');
    setIsBlendMode(false); // Switch off blend mode if it was on
    setViewportPosition({ x: 0, y: 0 });
    setZoomLevel(1);
    setInpaintTool('manual-brush');
    setBrushSize(36);
    setMaskStrokes([]);
    setIsMaskInverted(false);
    setMaskHistory([]);
    setMaskFuture([]);
    setInpaintResultUrls([]);

    const uploadedImage = new window.Image();
    uploadedImage.onload = () => {
      baseImageDimensionsRef.current = {
        width: uploadedImage.naturalWidth || uploadedImage.width,
        height: uploadedImage.naturalHeight || uploadedImage.height,
      };
      const fitted = getContainSize(
        baseImageDimensionsRef.current.width,
        baseImageDimensionsRef.current.height,
        CANVAS_WIDTH - FIT_PADDING * 2,
        CANVAS_HEIGHT - FIT_PADDING * 2,
      );

      setBaseImageTransform({
        x: (CANVAS_WIDTH - fitted.width) / 2,
        y: (CANVAS_HEIGHT - fitted.height) / 2,
        width: fitted.width,
        height: fitted.height,
        rotation: 0,
      });
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

  const handleCenterSelectedLayer = () => {
    if (!selectedImageLayer) {
      return;
    }

    setElements((prev) => prev.map((element) => (
      element.id === selectedImageLayer.id
        ? {
            ...element,
            x: ((isBlendMode ? boardSize.width : CANVAS_WIDTH) - selectedImageLayer.width) / 2,
            y: ((isBlendMode ? boardSize.height : CANVAS_HEIGHT) - selectedImageLayer.height) / 2,
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

  const handleSelectShapeTool = () => {
    setActiveMode('shape');
  };

  const handleSelectTextTool = () => {
    setActiveMode('text');
  };

  const handleSelectSelectTool = () => {
    setActiveMode('select');
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
          baseImageTransform={baseImageTransform}
          setBaseImageTransform={setBaseImageTransform}
          boardSize={boardSize}
          exportFormat={exportFormat}
          isBlendMode={isBlendMode}
          inpaintTool={inpaintTool}
          brushSize={brushSize}
          maskStrokes={maskStrokes}
          isMaskInverted={isMaskInverted}
          selectedShapeKind={selectedShapeKind}
          canUndoMask={maskHistory.length > 0}
          canRedoMask={maskFuture.length > 0}
          onStartBlend={() => {
            setIsBlendMode(true);
            setActiveMode('select');
          }}
          onStopBlend={() => {
            setIsBlendMode(false);
            setActiveMode('inpaint');
          }}
          onCenterSelectedLayer={handleCenterSelectedLayer}
          onSelectClickAreaTool={handleSelectClickAreaTool}
          onSelectManualBrushTool={handleSelectManualBrushTool}
          onSelectSelectTool={handleSelectSelectTool}
          onSelectEraseTool={handleSelectEraseTool}
          onSelectShapeTool={handleSelectShapeTool}
          onSelectTextTool={handleSelectTextTool}
          onSelectedShapeKindChange={setSelectedShapeKind}
          onToggleMaskInverse={handleToggleMaskInverse}
          onUndoMask={handleUndoMask}
          onRedoMask={handleRedoMask}
          onBrushSizeChange={setBrushSize}
          onMaskStrokesCommit={handleMaskStrokesCommit}
          onExportReady={(exportFn) => {
            exportBlendBoardRef.current = exportFn;
          }}
          onInpaintExportReady={(exportFn) => {
            exportInpaintRef.current = exportFn;
          }}
          onAddImageLayerReady={(addImageLayerFn) => {
            addImageLayerRef.current = addImageLayerFn;
          }}
        />
        {isBlendMode ? (
          <BlendPanel
            selectedTarget={selectedBlendTarget}
            boardSize={boardSize}
            exportFormat={exportFormat}
            layerCount={blendLayerCount}
            canExport={canExportBlendBoard}
            onBlendModeChange={handleBlendModeChange}
            onOpacityChange={handleOpacityChange}
            onBoardSizeChange={handleBoardSizeChange}
            onExportFormatChange={setExportFormat}
            onResetSelectedTarget={handleResetSelectedTarget}
            onAddImageLayer={() => addImageLayerRef.current?.()}
            onDownload={() => exportBlendBoardRef.current?.()}
          />
        ) : (
          imageSrc && (
            <InpaintPanel
              imageSrc={imageSrc}
              onBaseImageUpload={handleImageUpload}
              hasMask={maskStrokes.length > 0}
              results={inpaintResultUrls}
              onResultsGenerated={setInpaintResultUrls}
              onResultSelect={handleImageUpload}
              onExportInpaintInputs={() => exportInpaintRef.current?.() ?? Promise.resolve(null)}
            />
          )
        )}
      </div>
    </div>
  );
}
