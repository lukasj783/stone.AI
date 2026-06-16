import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer, Text, Rect, Circle, Line, Group, Shape } from 'react-konva';
import type { Layer as KonvaLayer } from 'konva/lib/Layer';
import type { KonvaEventObject, Node as KonvaNode } from 'konva/lib/Node';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import type { Image as KonvaImageNode } from 'konva/lib/shapes/Image';
import type { Transformer as KonvaTransformer } from 'konva/lib/shapes/Transformer';
import useImage from 'use-image';
import { FileImage } from 'lucide-react';
import { DEFAULT_BASE_IMAGE_SETTINGS, DEFAULT_TEXT_PROPERTIES, type BaseImageSettings, type BaseImageTransform, type EditorElement, type EditorImageElement, type EditorRectElement, type EditorShapeKind, type EditorTextElement, type ExportFormat, type InpaintExportResult, type InpaintMaskStroke, type InpaintTool } from '@/lib/types/layers.types';

type KonvaCanvasEvent = KonvaEventObject<Event>;
type CanvasBox = { x: number; y: number; width: number; height: number };

interface URLImageProps {
  element: EditorImageElement;
  isDraggable: boolean;
  onSelect: () => void;
  onDragEnd: (e: KonvaCanvasEvent) => void;
  onTransformEnd: (e: KonvaCanvasEvent) => void;
  dragBoundFunc?: (pos: { x: number; y: number }) => { x: number; y: number };
}

const URLImage = ({ element, isDraggable, onSelect, onDragEnd, onTransformEnd, dragBoundFunc }: URLImageProps) => {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const setImgElement = (el: HTMLImageElement | null) => {
    imgElRef.current = el;
    setImgEl(el);
  };

  useEffect(() => {
    let cancelled = false;
    let clearTimer: number | undefined;

    if (!element.src) {
      // Defer clearing state to avoid synchronous setState inside effect
      if (imgElRef.current !== null) {
        clearTimer = window.setTimeout(() => {
          if (!cancelled) setImgElement(null);
        }, 0);
      }
      return () => {
        cancelled = true;
        if (clearTimer) clearTimeout(clearTimer);
      };
    }

    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    const handleLoad = () => {
      if (!cancelled) setImgElement(image);
    };
    image.addEventListener('load', handleLoad);
    image.src = element.src;

    return () => {
      cancelled = true;
      image.removeEventListener('load', handleLoad);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, [element.src]);

  return (
    <KonvaImage
      id={element.id}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      crop={element.crop}
      image={imgEl ?? undefined}
      opacity={element.opacity ?? 1}
      globalCompositeOperation={element.blendMode ?? 'source-over'}
      draggable={isDraggable}
      dragBoundFunc={dragBoundFunc}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    />
  );
};

const canvasToBlob = (canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> => (
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('Could not export canvas image'));
    }, type);
  })
);

interface KonvaCanvasProps {
  imageSrc: string;
  width?: number;
  height?: number;
  activeMode?: string;
  zoomLevel?: number;
  viewportPosition?: { x: number; y: number };
  setViewportPosition?: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  inpaintTool?: InpaintTool;
  brushSize?: number;
  maskStrokes?: InpaintMaskStroke[];
  isMaskInverted?: boolean;
  onMaskStrokesCommit?: (strokes: InpaintMaskStroke[]) => void;
  elements?: EditorElement[];
  setElements?: React.Dispatch<React.SetStateAction<EditorElement[]>>;
  selectedId?: string | null;
  setSelectedId?: (id: string | null) => void;
  baseImageSettings?: BaseImageSettings;
  baseImageTransform?: BaseImageTransform | null;
  setBaseImageTransform?: React.Dispatch<React.SetStateAction<BaseImageTransform | null>>;
  isBlendMode?: boolean;
  exportFormat?: ExportFormat;
  selectedShapeKind?: EditorShapeKind;
  onImageUpload: (src: string) => void;
  onUploadClick?: () => void;
  onExportReady?: (exportFn: (() => void) | null) => void;
  onInpaintExportReady?: (exportFn: (() => Promise<InpaintExportResult | null>) | null) => void;
  onFlattenReady?: (flattenFn: (() => void) | null) => void;
  onAddTextReady?: (addTextFn: (() => void) | null) => void;
  onTextEditingChange?: (isEditing: boolean) => void;
}

const KONVA_CANVAS_DEFAULTS = {
  width: 800,
  height: 500,
  activeMode: 'select' as string,
  inpaintTool: 'manual-brush' as InpaintTool,
  brushSize: 36,
  maskStrokes: [] as InpaintMaskStroke[],
  isMaskInverted: false,
  onMaskStrokesCommit: (() => {}) as (strokes: InpaintMaskStroke[]) => void,
  elements: [] as EditorElement[],
  setElements: (() => undefined) as React.Dispatch<React.SetStateAction<EditorElement[]>>,
  selectedId: null as string | null,
  setSelectedId: (() => {}) as (id: string | null) => void,
  baseImageSettings: DEFAULT_BASE_IMAGE_SETTINGS,
  baseImageTransform: null as BaseImageTransform | null,
  setBaseImageTransform: (() => undefined) as React.Dispatch<React.SetStateAction<BaseImageTransform | null>>,
  isBlendMode: false,
  exportFormat: 'png' as ExportFormat,
  selectedShapeKind: 'rectangle' as EditorShapeKind,
  onUploadClick: (() => {}) as () => void,
  onExportReady: (() => {}) as () => void,
  onInpaintExportReady: (() => {}) as () => void,
  onFlattenReady: (() => {}) as () => void,
  onAddTextReady: (() => {}) as () => void,
  onTextEditingChange: (() => {}) as (isEditing: boolean) => void,
};

export default function KonvaCanvas({
  imageSrc,
  onImageUpload,
  width = KONVA_CANVAS_DEFAULTS.width,
  height = KONVA_CANVAS_DEFAULTS.height,
  activeMode = KONVA_CANVAS_DEFAULTS.activeMode,
  inpaintTool = KONVA_CANVAS_DEFAULTS.inpaintTool,
  brushSize = KONVA_CANVAS_DEFAULTS.brushSize,
  maskStrokes = KONVA_CANVAS_DEFAULTS.maskStrokes,
  isMaskInverted = KONVA_CANVAS_DEFAULTS.isMaskInverted,
  onMaskStrokesCommit = KONVA_CANVAS_DEFAULTS.onMaskStrokesCommit,
  elements = KONVA_CANVAS_DEFAULTS.elements,
  setElements = KONVA_CANVAS_DEFAULTS.setElements,
  selectedId = KONVA_CANVAS_DEFAULTS.selectedId,
  setSelectedId = KONVA_CANVAS_DEFAULTS.setSelectedId,
  baseImageSettings = KONVA_CANVAS_DEFAULTS.baseImageSettings,
  baseImageTransform = KONVA_CANVAS_DEFAULTS.baseImageTransform,
  setBaseImageTransform = KONVA_CANVAS_DEFAULTS.setBaseImageTransform,
  isBlendMode = KONVA_CANVAS_DEFAULTS.isBlendMode,
  exportFormat = KONVA_CANVAS_DEFAULTS.exportFormat,
  selectedShapeKind = KONVA_CANVAS_DEFAULTS.selectedShapeKind,
  onUploadClick = KONVA_CANVAS_DEFAULTS.onUploadClick,
  onExportReady = KONVA_CANVAS_DEFAULTS.onExportReady,
  onInpaintExportReady = KONVA_CANVAS_DEFAULTS.onInpaintExportReady,
  onFlattenReady = KONVA_CANVAS_DEFAULTS.onFlattenReady,
  onAddTextReady = KONVA_CANVAS_DEFAULTS.onAddTextReady,
  onTextEditingChange = KONVA_CANVAS_DEFAULTS.onTextEditingChange,
}: KonvaCanvasProps) {
  const [image] = useImage(imageSrc, 'anonymous');
  const stageRef = useRef<KonvaStage | null>(null);
  const imageRef = useRef<KonvaImageNode | null>(null);
  const trRef = useRef<KonvaTransformer | null>(null);
  const layerRef = useRef<KonvaLayer | null>(null);
  const maskStrokeIdRef = useRef(0);
  const textElementIdRef = useRef(0);
  const rectElementIdRef = useRef(0);
  const exportIdRef = useRef(0);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingElement, setDrawingElement] = useState<EditorRectElement | null>(null);
  const [editingText, setEditingText] = useState<{id: string, x: number, y: number, value: string} | null>(null);
  const [draftMaskStroke, setDraftMaskStroke] = useState<InpaintMaskStroke | null>(null);
  const canvasZoomLevel = 1;
  const canvasViewportPosition = { x: 0, y: 0 };

  const maskOverlayColor = isMaskInverted ? 'rgba(244, 114, 182, 0.32)' : 'rgba(244, 114, 182, 0.78)';
  const maskFillColor = 'rgba(17, 24, 39, 0.52)';
  const canUseInpaintMask = activeMode === 'inpaint' && !isBlendMode && Boolean(imageSrc);
  const canTransformBaseImage = activeMode === 'select' || activeMode === 'move';
  const blendGuardRect = isBlendMode && !imageSrc
    ? {
        x: 0,
        y: 0,
        width,
        height,
      }
    : null;

  const createMaskStroke = (id: string, tool: InpaintTool, x: number, y: number, size: number): InpaintMaskStroke => ({
    id,
    tool,
    size,
    points: [{ x, y }],
  });

  const createTextElement = (x: number, y: number): EditorTextElement => {
    textElementIdRef.current += 1;

    return {
      id: `text-${textElementIdRef.current}`,
      type: 'text',
      x,
      y,
      width: 240,
      text: 'Double click to edit',
      fontSize: 32,
      fontFamily: DEFAULT_TEXT_PROPERTIES.fontFamily,
      fontWeight: DEFAULT_TEXT_PROPERTIES.fontWeight,
      fontStyle: DEFAULT_TEXT_PROPERTIES.fontStyle,
      textDecoration: DEFAULT_TEXT_PROPERTIES.textDecoration,
      textAlign: DEFAULT_TEXT_PROPERTIES.textAlign,
      fill: DEFAULT_TEXT_PROPERTIES.color,
      stroke: DEFAULT_TEXT_PROPERTIES.strokeColor,
      strokeWidth: DEFAULT_TEXT_PROPERTIES.strokeWidth,
      letterSpacing: DEFAULT_TEXT_PROPERTIES.letterSpacing,
      lineHeight: DEFAULT_TEXT_PROPERTIES.lineHeight,
      opacity: 1,
      rotation: 0,
    };
  };

  const renderShapeElement = (
    element: EditorRectElement,
    isDraggable: boolean,
    isDraft = false,
  ) => {
    const shapeKind = element.shapeKind ?? 'rectangle';
    const x = element.width < 0 ? element.x + element.width : element.x;
    const y = element.height < 0 ? element.y + element.height : element.y;
    const shapeWidth = Math.abs(element.width);
    const shapeHeight = Math.abs(element.height);
    const commonProps = {
      id: isDraft ? undefined : element.id,
      x,
      y,
      width: shapeWidth,
      height: shapeHeight,
      fill: element.fill,
      stroke: element.stroke,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity ?? 1,
      draggable: !isDraft && isDraggable,
      onClick: isDraft ? undefined : () => handleMaskSelect(element.id),
      onTap: isDraft ? undefined : () => handleMaskSelect(element.id),
      onDragEnd: isDraft ? undefined : (event: KonvaCanvasEvent) => handleDragEnd(event, element.id),
      onTransformEnd: isDraft ? undefined : (event: KonvaCanvasEvent) => handleTransformEnd(event, element.id),
    };

    if (shapeKind === 'rectangle') {
      return (
        <Rect
          key={element.id}
          {...commonProps}
          dash={element.dash}
          cornerRadius={element.cornerRadius}
        />
      );
    }

    return (
      <Shape
        key={element.id}
        {...commonProps}
        sceneFunc={(context, shape) => {
          const widthValue = shape.width();
          const heightValue = shape.height();

          context.beginPath();

          if (shapeKind === 'circle') {
            context.ellipse(
              widthValue / 2,
              heightValue / 2,
              widthValue / 2,
              heightValue / 2,
              0,
              0,
              Math.PI * 2,
            );
          } else if (shapeKind === 'triangle') {
            context.moveTo(widthValue / 2, 0);
            context.lineTo(widthValue, heightValue);
            context.lineTo(0, heightValue);
            context.closePath();
          } else {
            const tailHeight = Math.min(18, Math.max(10, heightValue * 0.22));
            const bodyHeight = Math.max(heightValue - tailHeight, 5);
            const radius = Math.min(12, widthValue / 4, bodyHeight / 4);
            const tailStart = Math.min(widthValue * 0.38, widthValue - 18);
            const tailEnd = Math.min(tailStart + 16, widthValue - radius);
            const tailPoint = Math.min(tailStart + 6, widthValue - radius);

            context.moveTo(radius, 0);
            context.lineTo(widthValue - radius, 0);
            context.quadraticCurveTo(widthValue, 0, widthValue, radius);
            context.lineTo(widthValue, bodyHeight - radius);
            context.quadraticCurveTo(widthValue, bodyHeight, widthValue - radius, bodyHeight);
            context.lineTo(tailEnd, bodyHeight);
            context.lineTo(tailPoint, heightValue);
            context.lineTo(tailStart, bodyHeight);
            context.lineTo(radius, bodyHeight);
            context.quadraticCurveTo(0, bodyHeight, 0, bodyHeight - radius);
            context.lineTo(0, radius);
            context.quadraticCurveTo(0, 0, radius, 0);
            context.closePath();
          }

          context.fillStrokeShape(shape);
        }}
      />
    );
  };

  const flattenMaskPoints = (stroke: InpaintMaskStroke) => stroke.points.flatMap((point) => [point.x, point.y]);

  const getPointDistance = (a: { x: number; y: number }, b: { x: number; y: number }) => (
    Math.hypot(a.x - b.x, a.y - b.y)
  );

  const clampValue = (value: number, minimum: number, maximum: number) => (
    Math.min(Math.max(value, minimum), maximum)
  );

  const getPointToSegmentDistance = (
    point: { x: number; y: number },
    segmentStart: { x: number; y: number },
    segmentEnd: { x: number; y: number },
  ) => {
    const dx = segmentEnd.x - segmentStart.x;
    const dy = segmentEnd.y - segmentStart.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      return getPointDistance(point, segmentStart);
    }

    const t = Math.max(0, Math.min(1, (
      ((point.x - segmentStart.x) * dx) + ((point.y - segmentStart.y) * dy)
    ) / lengthSquared));

    return getPointDistance(point, {
      x: segmentStart.x + t * dx,
      y: segmentStart.y + t * dy,
    });
  };

  const doesPointHitStroke = (
    point: { x: number; y: number },
    stroke: InpaintMaskStroke,
    threshold: number,
  ) => {
    if (stroke.points.length === 0) {
      return false;
    }

    if (stroke.points.length === 1) {
      return getPointDistance(point, stroke.points[0]) <= threshold;
    }

    return stroke.points.some((strokePoint, index) => {
      if (index === 0) {
        return getPointDistance(point, strokePoint) <= threshold;
      }

      return getPointToSegmentDistance(point, stroke.points[index - 1], strokePoint) <= threshold;
    });
  };

  const doesEraserHitStroke = (eraserStroke: InpaintMaskStroke, stroke: InpaintMaskStroke) => {
    const threshold = (eraserStroke.size + stroke.size) / 2;

    if (stroke.tool === 'click-area') {
      const [center] = stroke.points;
      return Boolean(center) && doesPointHitStroke(center, eraserStroke, threshold);
    }

    return (
      eraserStroke.points.some((point) => doesPointHitStroke(point, stroke, threshold)) ||
      stroke.points.some((point) => doesPointHitStroke(point, eraserStroke, threshold))
    );
  };

  const buildEraserGrid = (eraser: InpaintMaskStroke, cellSize: number) => {
    const grid = new Set<string>();
    const radius = eraser.size / 2 + cellSize;
    const range = Math.ceil(radius / cellSize);
    for (const p of eraser.points) {
      const cx = Math.floor(p.x / cellSize);
      const cy = Math.floor(p.y / cellSize);
      for (let dx = -range; dx <= range; dx++) {
        for (let dy = -range; dy <= range; dy++) {
          grid.add(`${cx + dx},${cy + dy}`);
        }
      }
    }
    return grid;
  };

  const removeStrokesTouchedByEraser = (
    currentStrokes: InpaintMaskStroke[],
    eraserStroke: InpaintMaskStroke,
  ) => {
    const cellSize = Math.max(eraserStroke.size, 20);
    const eraserGrid = buildEraserGrid(eraserStroke, cellSize);
    return currentStrokes.filter((stroke) => {
      if (stroke.tool === 'erase') return false;
      // Fast path: skip strokes whose points aren't even in an eraser-occupied cell
      const anyNearby = stroke.points.some((p) =>
        eraserGrid.has(`${Math.floor(p.x / cellSize)},${Math.floor(p.y / cellSize)}`)
      );
      if (!anyNearby) return true;
      // Slow path: only do full distance check when cells overlap
      return !doesEraserHitStroke(eraserStroke, stroke);
    });
  };

  const getMaskStrokeCompositeOperation = (tool: InpaintTool) => {
    if (tool === 'erase') {
      return isMaskInverted ? 'destination-out' : 'source-over';
    }

    return isMaskInverted ? 'source-over' : 'destination-out';
  };

  const getMaskStrokeColor = (tool: InpaintTool) => {
    if (tool === 'erase') {
      return 'transparent';
    }

    return isMaskInverted ? maskOverlayColor : '#000000';
  };

  const handleMaskSelect = (id: string | null) => {
    if (id === 'blend-guard') {
      return;
    }

    if (activeMode === 'inpaint') {
      return;
    }

    setSelectedId(id);
  };

  const absoluteBoxToCanvasBox = (box: CanvasBox): CanvasBox => {
    const stage = stageRef.current;
    if (!stage) {
      return box;
    }

    const stageScaleX = stage.scaleX() || canvasZoomLevel;
    const stageScaleY = stage.scaleY() || canvasZoomLevel;

    return {
      x: (box.x - stage.x()) / stageScaleX,
      y: (box.y - stage.y()) / stageScaleY,
      width: box.width / stageScaleX,
      height: box.height / stageScaleY,
    };
  };

  const canvasPointToAbsolutePoint = (point: { x: number; y: number }) => {
    const stage = stageRef.current;
    if (!stage) {
      return point;
    }

    const stageScaleX = stage.scaleX() || canvasZoomLevel;
    const stageScaleY = stage.scaleY() || canvasZoomLevel;

    return {
      x: stage.x() + point.x * stageScaleX,
      y: stage.y() + point.y * stageScaleY,
    };
  };

  const isBlendImageSelected = useMemo(() => {
    if (!selectedId || selectedId === 'base-image') return false;
    return elements.some((el) => el.id === selectedId && el.type === 'image');
  }, [selectedId, elements]);

  const clampBoxToBlendGuard = (box: CanvasBox): CanvasBox => {
    if (!blendGuardRect) {
      return box;
    }

    if (box.width > blendGuardRect.width || box.height > blendGuardRect.height) {
      return box;
    }

    const minX = blendGuardRect.x;
    const minY = blendGuardRect.y;
    const maxX = blendGuardRect.x + blendGuardRect.width - box.width;
    const maxY = blendGuardRect.y + blendGuardRect.height - box.height;

    return {
      ...box,
      x: Math.min(Math.max(box.x, minX), maxX),
      y: Math.min(Math.max(box.y, minY), maxY),
    };
  };

  const isBoxInsideBlendGuard = (box: CanvasBox) => {
    if (!blendGuardRect) {
      return true;
    }

    return (
      box.width <= blendGuardRect.width &&
      box.height <= blendGuardRect.height &&
      box.x >= blendGuardRect.x &&
      box.y >= blendGuardRect.y &&
      box.x + box.width <= blendGuardRect.x + blendGuardRect.width &&
      box.y + box.height <= blendGuardRect.y + blendGuardRect.height
    );
  };

  const clampImagePositionToBlendGuard = (node: KonvaImageNode, nextPosition: { x: number; y: number }) => {
    if (!blendGuardRect) {
      return nextPosition;
    }

    const canvasPosition = absoluteBoxToCanvasBox({
      x: nextPosition.x,
      y: nextPosition.y,
      width: 0,
      height: 0,
    });
    const canvasBox = {
      x: canvasPosition.x,
      y: canvasPosition.y,
      width: node.width() * Math.abs(node.scaleX()),
      height: node.height() * Math.abs(node.scaleY()),
    };

    if (canvasBox.width > blendGuardRect.width || canvasBox.height > blendGuardRect.height) {
      return node.absolutePosition();
    }

    const clampedBox = clampBoxToBlendGuard(canvasBox);
    const clampedPosition = canvasPointToAbsolutePoint(clampedBox);

    return {
      x: clampedPosition.x,
      y: clampedPosition.y,
    };
  };

  const clampImageElementBoxToBlendGuard = (box: CanvasBox): CanvasBox => {
    if (!blendGuardRect) {
      return box;
    }

    const clampedSize = {
      ...box,
      width: Math.min(box.width, blendGuardRect.width),
      height: Math.min(box.height, blendGuardRect.height),
    };

    return clampBoxToBlendGuard(clampedSize);
  };

  const getImageElementCrop = (element: EditorImageElement, node: KonvaNode) => {
    const sourceWidth = Math.max(element.naturalWidth ?? node.width(), 1);
    const sourceHeight = Math.max(element.naturalHeight ?? node.height(), 1);

    return element.crop ?? {
      x: 0,
      y: 0,
      width: sourceWidth,
      height: sourceHeight,
    };
  };

  const getCroppedImageElement = (
    element: EditorImageElement,
    node: KonvaNode,
    nextBox: CanvasBox,
  ): EditorImageElement => {
    const currentCrop = getImageElementCrop(element, node);
    const sourceWidth = Math.max(element.naturalWidth ?? currentCrop.width, 1);
    const sourceHeight = Math.max(element.naturalHeight ?? currentCrop.height, 1);
    const cropScaleX = currentCrop.width / Math.max(element.width, 1);
    const cropScaleY = currentCrop.height / Math.max(element.height, 1);
    const nextCropX = currentCrop.x + (nextBox.x - element.x) * cropScaleX;
    const nextCropY = currentCrop.y + (nextBox.y - element.y) * cropScaleY;
    const nextCropWidth = nextBox.width * cropScaleX;
    const nextCropHeight = nextBox.height * cropScaleY;
    const cropWidth = clampValue(nextCropWidth, 1, sourceWidth);
    const cropHeight = clampValue(nextCropHeight, 1, sourceHeight);

    return {
      ...element,
      ...nextBox,
      naturalWidth: sourceWidth,
      naturalHeight: sourceHeight,
      crop: {
        x: clampValue(nextCropX, 0, sourceWidth - cropWidth),
        y: clampValue(nextCropY, 0, sourceHeight - cropHeight),
        width: cropWidth,
        height: cropHeight,
      },
    };
  };

  useEffect(() => {
    onFlattenReady(() => {
      const stage = stageRef.current;
      if (!stage) {
        return;
      }

      const transformer = trRef.current;
      const selectedNodes = transformer?.nodes() ?? [];
      if (transformer) {
        transformer.nodes([]);
        transformer.getLayer()?.batchDraw();
      }

      const dataUrl = stage.toDataURL({
        pixelRatio: 2,
      });

      if (transformer) {
        transformer.nodes(selectedNodes);
        transformer.getLayer()?.batchDraw();
      }

      onImageUpload(dataUrl);
    });

    return () => {
      onFlattenReady(null);
    };
  }, [onFlattenReady, onImageUpload]);

  useEffect(() => {
    onExportReady(() => {
      const stage = stageRef.current;
      if (!stage) {
        return;
      }

      const transformer = trRef.current;
      const selectedNodes = transformer?.nodes() ?? [];
      if (transformer) {
        transformer.nodes([]);
        transformer.getLayer()?.batchDraw();
      }

      const mimeType = exportFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
      const dataUrl = stage.toDataURL({
        mimeType,
        pixelRatio: 2,
      });

      if (transformer) {
        transformer.nodes(selectedNodes);
        transformer.getLayer()?.batchDraw();
      }

      const downloadLink = document.createElement('a');
      downloadLink.href = dataUrl;
      exportIdRef.current += 1;
      downloadLink.download = `blend-board-${exportIdRef.current}.${exportFormat}`;
      downloadLink.click();
    });

    return () => {
      onExportReady(null);
    };
  }, [exportFormat, onExportReady]);

  useEffect(() => {
    onAddTextReady(() => {
      const newText = createTextElement((width - 240) / 2, Math.max((height - 48) / 2, 0));
      setElements((prev) => [...prev, newText]);
      setSelectedId(newText.id);
    });

    return () => {
      onAddTextReady(null);
    };
  }, [height, onAddTextReady, setElements, setSelectedId, width]);

  useEffect(() => {
    onTextEditingChange(Boolean(editingText));
  }, [editingText, onTextEditingChange]);

  useEffect(() => {
    const transformer = trRef.current;
    const layer = layerRef.current;

    if (transformer && layer) {
      if (!selectedId) {
        transformer.nodes([]);
      } else if (selectedId === 'base-image') {
        transformer.nodes(canTransformBaseImage && imageRef.current ? [imageRef.current] : []);
      } else {
        const node = layer.findOne(`#${selectedId}`);
        if (node) {
          transformer.nodes([node]);
        }
      }
      transformer.getLayer()?.batchDraw();
    }
  }, [selectedId, elements, canTransformBaseImage, baseImageTransform]);

  const fallbackBaseImageTransform = image ? (() => {
    const scale = Math.min(width / image.width, height / image.height);
    const imageWidth = image.width * scale;
    const imageHeight = image.height * scale;

    return {
      x: (width - imageWidth) / 2,
      y: (height - imageHeight) / 2,
      width: imageWidth,
      height: imageHeight,
      rotation: 0,
    };
  })() : null;
  const effectiveBaseImageTransform = baseImageTransform ?? fallbackBaseImageTransform;

  useEffect(() => {
    onInpaintExportReady(async () => {
      if (!image || !effectiveBaseImageTransform) {
        return null;
      }

      const drawableStrokes = maskStrokes.filter((stroke) => stroke.tool !== 'erase' && stroke.points.length > 0);
      if (drawableStrokes.length === 0) {
        return null;
      }

      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = sourceWidth;
      baseCanvas.height = sourceHeight;
      const baseContext = baseCanvas.getContext('2d');
      if (!baseContext) {
        return null;
      }
      baseContext.drawImage(image, 0, 0, sourceWidth, sourceHeight);

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = sourceWidth;
      maskCanvas.height = sourceHeight;
      const maskContext = maskCanvas.getContext('2d');
      if (!maskContext) {
        return null;
      }

      const scaleX = sourceWidth / Math.max(effectiveBaseImageTransform.width, 1);
      const scaleY = sourceHeight / Math.max(effectiveBaseImageTransform.height, 1);
      const strokeScale = (scaleX + scaleY) / 2;
      maskContext.fillStyle = isMaskInverted ? '#ffffff' : '#000000';
      maskContext.fillRect(0, 0, sourceWidth, sourceHeight);
      maskContext.fillStyle = isMaskInverted ? '#000000' : '#ffffff';
      maskContext.strokeStyle = isMaskInverted ? '#000000' : '#ffffff';
      maskContext.lineCap = 'round';
      maskContext.lineJoin = 'round';

      for (const stroke of drawableStrokes) {
        if (stroke.tool === 'click-area') {
          const [point] = stroke.points;
          maskContext.beginPath();
          maskContext.arc(
            point.x * scaleX,
            point.y * scaleY,
            (stroke.size * strokeScale) / 2,
            0,
            Math.PI * 2,
          );
          maskContext.fill();
          continue;
        }

        if (stroke.points.length === 1) {
          const [point] = stroke.points;
          maskContext.beginPath();
          maskContext.arc(
            point.x * scaleX,
            point.y * scaleY,
            (stroke.size * strokeScale) / 2,
            0,
            Math.PI * 2,
          );
          maskContext.fill();
          continue;
        }

        maskContext.beginPath();
        maskContext.lineWidth = stroke.size * strokeScale;
        stroke.points.forEach((point, index) => {
          const x = point.x * scaleX;
          const y = point.y * scaleY;
          if (index === 0) {
            maskContext.moveTo(x, y);
          } else {
            maskContext.lineTo(x, y);
          }
        });
        maskContext.stroke();
      }

      const [baseBlob, maskBlob] = await Promise.all([
        canvasToBlob(baseCanvas, 'image/png'),
        canvasToBlob(maskCanvas, 'image/png'),
      ]);

      return {
        baseFile: new File([baseBlob], 'inpaint-base.png', { type: 'image/png' }),
        maskFile: new File([maskBlob], 'inpaint-mask.png', { type: 'image/png' }),
        width: sourceWidth,
        height: sourceHeight,
      };
    });

    return () => {
      onInpaintExportReady(null);
    };
  }, [
    effectiveBaseImageTransform,
    image,
    isMaskInverted,
    maskStrokes,
    onInpaintExportReady,
  ]);

  const getRelativePointerPosition = (stage: KonvaStage) => {
    const pointerPosition = stage.getPointerPosition();
    if (!pointerPosition) {
      return null;
    }

    const x = (pointerPosition.x - stage.x()) / canvasZoomLevel;
    const y = (pointerPosition.y - stage.y()) / canvasZoomLevel;
    return { x, y };
  };

  const getBaseImagePointerPosition = (stage: KonvaStage) => {
    const imageNode = imageRef.current;
    const pointerPosition = stage.getPointerPosition();

    if (!imageNode || !pointerPosition) {
      return null;
    }

    const transform = imageNode.getAbsoluteTransform().copy();
    transform.invert();

    return transform.point(pointerPosition);
  };

  const handleStageMouseDown = (e: KonvaCanvasEvent) => {
    const stage = e.target.getStage();
    if (!stage) {
      return;
    }

    const pos = getRelativePointerPosition(stage);
    const clickedOnEmpty = e.target === stage;
    const clickedOnBackground = e.target.id() === 'base-image';

    if (canUseInpaintMask) {
      const baseImagePos = getBaseImagePointerPosition(stage);

      if (!baseImagePos) {
        return;
      }

      if (inpaintTool === 'click-area') {
        maskStrokeIdRef.current += 1;
        onMaskStrokesCommit([
          ...maskStrokes,
          createMaskStroke(
            `click-area-${maskStrokeIdRef.current}`,
            'click-area',
            baseImagePos.x,
            baseImagePos.y,
            Math.max(brushSize * 1.6, 20),
          ),
        ]);
        setSelectedId(null);
        return;
      }

      const nextStrokeTool = inpaintTool === 'erase' ? 'erase' : 'manual-brush';
      maskStrokeIdRef.current += 1;
      const nextStroke = createMaskStroke(
        `${nextStrokeTool}-${maskStrokeIdRef.current}`,
        nextStrokeTool,
        baseImagePos.x,
        baseImagePos.y,
        brushSize,
      );
      setDraftMaskStroke(nextStroke);
      setSelectedId(null);
      return;
    }
    
    if (activeMode === 'select' && clickedOnEmpty) {
      setSelectedId(null);
    } else if (activeMode === 'text' && (clickedOnEmpty || clickedOnBackground) && pos) {
      const newText = createTextElement(pos.x, pos.y);
      setElements([...elements, newText]);
      setSelectedId(newText.id);
    } else if (activeMode === 'shape' && (clickedOnEmpty || clickedOnBackground) && pos) {
      rectElementIdRef.current += 1;
      setIsDrawing(true);
      setDrawingElement({
        id: `rect-${rectElementIdRef.current}`,
        type: 'rect',
        shapeKind: selectedShapeKind,
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        fill: 'transparent',
        stroke: '#22c55e',
        strokeWidth: 3,
        opacity: 1,
      });
      setSelectedId(null);
    }
  };

  const handleStageMouseMove = (e: KonvaCanvasEvent) => {
    if (canUseInpaintMask && draftMaskStroke) {
      const stage = e.target.getStage();
      if (!stage) {
        return;
      }

      const pos = getBaseImagePointerPosition(stage);

      if (!pos) {
        return;
      }

      setDraftMaskStroke((currentStroke) => currentStroke ? {
        ...currentStroke,
        points: [...currentStroke.points, pos],
      } : currentStroke);
      return;
    }

    if (!isDrawing || activeMode !== 'shape' || !drawingElement) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = getRelativePointerPosition(stage);
    if (!pos) return;
    setDrawingElement({
      ...drawingElement,
      width: pos.x - drawingElement.x,
      height: pos.y - drawingElement.y
    });
  };

  const handleStageMouseUp = () => {
    if (draftMaskStroke) {
      if (draftMaskStroke.tool === 'erase') {
        const nextStrokes = removeStrokesTouchedByEraser(maskStrokes, draftMaskStroke);

        if (nextStrokes.length !== maskStrokes.length) {
          onMaskStrokesCommit(nextStrokes);
        }

        setDraftMaskStroke(null);
        return;
      }

      const nextStrokes = [...maskStrokes, draftMaskStroke];
      onMaskStrokesCommit(nextStrokes);
      setDraftMaskStroke(null);
      return;
    }

    if (isDrawing && drawingElement) {
      setIsDrawing(false);
      const elementToAdd = { ...drawingElement };
      if (elementToAdd.width < 0) {
        elementToAdd.x += elementToAdd.width;
        elementToAdd.width = Math.abs(elementToAdd.width);
      }
      if (elementToAdd.height < 0) {
        elementToAdd.y += elementToAdd.height;
        elementToAdd.height = Math.abs(elementToAdd.height);
      }
      if (elementToAdd.width > 5 && elementToAdd.height > 5) {
        setElements([...elements, elementToAdd]);
        setSelectedId(elementToAdd.id);
      }
      setDrawingElement(null);
    }
  };

  const handleDragEnd = (e: KonvaCanvasEvent, id: string) => {
    const node = e.target;
    setElements(elements.map(el => {
      if (el.id !== id) {
        return el;
      }

      if (isBlendMode && blendGuardRect && el.type === 'image') {
        const clampedBox = clampImageElementBoxToBlendGuard({
          x: node.x(),
          y: node.y(),
          width: el.width,
          height: el.height,
        });

        return { ...el, x: clampedBox.x, y: clampedBox.y };
      }

      return { ...el, x: node.x(), y: node.y() };
    }));
  };

  const handleBaseImageDragEnd = (e: KonvaCanvasEvent) => {
    const node = e.target;

    setBaseImageTransform((currentTransform) => currentTransform ? {
      ...currentTransform,
      x: node.x(),
      y: node.y(),
    } : currentTransform);
  };

  const handleTransformEnd = (_e: KonvaCanvasEvent, id: string) => {
    const node = layerRef.current?.findOne(`#${id}`);
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    setElements(elements.map(el => {
      if (el.id !== id) {
        return el;
      }

      let nextBox = {
        x: node.x(),
        y: node.y(),
        width: Math.max(5, node.width() * scaleX),
        height: Math.max(5, el.type === 'text' ? node.height() : node.height() * scaleY),
      };

      if (isBlendMode && blendGuardRect && el.type === 'image') {
        nextBox = clampImageElementBoxToBlendGuard(nextBox);
      }

      if (activeMode === 'crop' && el.type === 'image') {
        return getCroppedImageElement(el, node, nextBox);
      }

      return {
        ...el,
        ...nextBox,
        ...(el.type === 'text' ? { fontSize: el.fontSize * scaleX, rotation: node.rotation() } : {})
      };
    }));
  };

  const handleBaseImageTransformEnd = () => {
    const node = imageRef.current;

    if (!node) return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    if ((scaleX !== 1 || scaleY !== 1) && maskStrokes.length > 0) {
      const strokeScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
      onMaskStrokesCommit(maskStrokes.map((stroke) => ({
        ...stroke,
        size: stroke.size * strokeScale,
        points: stroke.points.map((point) => ({
          x: point.x * scaleX,
          y: point.y * scaleY,
        })),
      })));
    }

    setBaseImageTransform({
      x: node.x(),
      y: node.y(),
      width: Math.max(5, node.width() * scaleX),
      height: Math.max(5, node.height() * scaleY),
      rotation: node.rotation(),
    });
  };

  const handleTextDblClick = (e: KonvaCanvasEvent, el: EditorTextElement) => {
    if (activeMode !== 'select' && activeMode !== 'move' && activeMode !== 'text') return;
    const textNode = e.target as KonvaNode;
    const absPos = textNode.getAbsolutePosition();
    setEditingText({ id: el.id, x: absPos.x, y: absPos.y, value: el.text });
  };

  return (
    <div className="flex items-center justify-center relative shadow-lg">
      <Stage 
        ref={stageRef}
        width={width} 
        height={height}
        x={canvasViewportPosition.x}
        y={canvasViewportPosition.y}
        scale={{ x: canvasZoomLevel, y: canvasZoomLevel }}
        draggable={false}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onTouchStart={handleStageMouseDown}
        onTouchMove={handleStageMouseMove}
        onTouchEnd={handleStageMouseUp}
        className={activeMode === 'pan' ? 'cursor-grab active:cursor-grabbing' : activeMode === 'text' ? 'cursor-text' : activeMode === 'shape' ? 'cursor-crosshair' : activeMode === 'select' ? 'cursor-default' : ''}
      >
        <Layer ref={layerRef}>
          {(image || isBlendMode || elements.length > 0 || activeMode === 'text' || activeMode === 'shape') && (
            <>
              {image && effectiveBaseImageTransform && (
                <KonvaImage
                  id="base-image"
                  ref={imageRef}
                  image={image}
                  x={effectiveBaseImageTransform.x}
                  y={effectiveBaseImageTransform.y}
                  width={effectiveBaseImageTransform.width}
                  height={effectiveBaseImageTransform.height}
                  rotation={effectiveBaseImageTransform.rotation}
                  opacity={baseImageSettings.opacity}
                  globalCompositeOperation={baseImageSettings.blendMode}
                  draggable={canTransformBaseImage}
                  onClick={() => handleMaskSelect('base-image')}
                  onTap={() => handleMaskSelect('base-image')}
                  onDragEnd={handleBaseImageDragEnd}
                  onTransformEnd={handleBaseImageTransformEnd}
                />
              )}
              {elements.map((el) => {
                const isDraggable = activeMode === 'select' || activeMode === 'move';
                
                if (el.type === 'rect') {
                  return renderShapeElement(el, isDraggable || activeMode === 'shape');
                }

                if (el.type === 'text') {
                  const isTextDraggable = isDraggable || activeMode === 'text';
                  return (
                    <Text
                      key={el.id}
                      id={el.id}
                      x={el.x}
                      y={el.y}
                      text={editingText?.id === el.id ? '' : el.text}
                      fontSize={el.fontSize}
                      fontFamily={el.fontFamily}
                      fontStyle={`${el.fontStyle} ${el.fontWeight}`.trim()}
                      fill={el.fill}
                      stroke={el.stroke}
                      strokeWidth={el.strokeWidth}
                      textDecoration={el.textDecoration}
                      align={el.textAlign}
                      letterSpacing={el.letterSpacing}
                      lineHeight={el.lineHeight}
                      width={el.width}
                      opacity={el.opacity ?? 1}
                      rotation={el.rotation ?? 0}
                      draggable={isTextDraggable}
                      onClick={() => handleMaskSelect(el.id)}
                      onTap={() => handleMaskSelect(el.id)}
                      onDblClick={(e) => handleTextDblClick(e, el)}
                      onDblTap={(e) => handleTextDblClick(e, el)}
                      onDragEnd={(e) => handleDragEnd(e, el.id)}
                      onTransformEnd={(e) => handleTransformEnd(e, el.id)}
                    />
                  );
                }

                if (el.type === 'image') {
                  return (
                    <URLImage
                      key={el.id}
                      element={el}
                      isDraggable={isDraggable}
                      dragBoundFunc={isBlendMode && blendGuardRect ? (pos) => {
                        const node = layerRef.current?.findOne(`#${el.id}`) as KonvaImageNode | null;
                        return node ? clampImagePositionToBlendGuard(node, pos) : pos;
                      } : undefined}
                      onSelect={() => handleMaskSelect(el.id)}
                      onDragEnd={(e) => handleDragEnd(e, el.id)}
                      onTransformEnd={(e) => handleTransformEnd(e, el.id)}
                    />
                  );
                }

                return null;
              })}
              
              {drawingElement && drawingElement.type === 'rect' && (
                renderShapeElement(drawingElement, false, true)
              )}
              <Transformer
                ref={trRef}
                boundBoxFunc={(oldBox, newBox) => {
                  // limit minimum size logic so text doesn't lock
                  if (newBox.width < 5 || newBox.height < 5) {
                    return oldBox;
                  }

                  if (isBlendMode && blendGuardRect && isBlendImageSelected) {
                    const canvasBox = absoluteBoxToCanvasBox(newBox);
                    if (!isBoxInsideBlendGuard(canvasBox)) {
                      return oldBox;
                    }
                  }

                  return newBox;
                }}
                borderStroke="#22c55e"
                borderStrokeWidth={2}
                anchorStroke="#22c55e"
                anchorFill="#ffffff"
                anchorSize={16}
                anchorCornerRadius={2}
                rotateAnchorOffset={35}
                padding={14}
                ignoreStroke={true}
                flipEnabled={false}
              />
            </>
          )}
        </Layer>
        {blendGuardRect && (
          <Layer listening={false}>
            <Rect
              x={blendGuardRect.x}
              y={blendGuardRect.y}
              width={blendGuardRect.width}
              height={blendGuardRect.height}
              fill="rgba(34, 197, 94, 0.04)"
              stroke="#22c55e"
              strokeWidth={2}
              opacity={1}
              cornerRadius={14}
              dash={[8, 6]}
            />
          </Layer>
        )}
        {canUseInpaintMask && effectiveBaseImageTransform && (
          <Layer listening={false}>
            <Group
              x={effectiveBaseImageTransform.x}
              y={effectiveBaseImageTransform.y}
              rotation={effectiveBaseImageTransform.rotation}
              clipX={0}
              clipY={0}
              clipWidth={effectiveBaseImageTransform.width}
              clipHeight={effectiveBaseImageTransform.height}
            >
              {!isMaskInverted && (
                <Rect
                  x={0}
                  y={0}
                  width={effectiveBaseImageTransform.width}
                  height={effectiveBaseImageTransform.height}
                  fill={maskFillColor}
                />
              )}
              {[...maskStrokes, ...(draftMaskStroke ? [draftMaskStroke] : [])].map((stroke) => {
                if (stroke.tool === 'erase') {
                  return null;
                }

                if (stroke.tool === 'click-area') {
                  const [point] = stroke.points;
                  if (!point) {
                    return null;
                  }

                  return (
                    <Circle
                      key={stroke.id}
                      x={point.x}
                      y={point.y}
                      radius={stroke.size / 2}
                      fill={isMaskInverted ? maskOverlayColor : '#000000'}
                      opacity={isMaskInverted ? 1 : 0.95}
                      globalCompositeOperation={!isMaskInverted ? 'destination-out' : 'source-over'}
                    />
                  );
                }

                return (
                  <Line
                    key={stroke.id}
                    points={flattenMaskPoints(stroke)}
                    stroke={getMaskStrokeColor(stroke.tool)}
                    strokeWidth={stroke.size}
                    lineCap="round"
                    lineJoin="round"
                    tension={0.2}
                    opacity={isMaskInverted ? 1 : 0.95}
                    globalCompositeOperation={getMaskStrokeCompositeOperation(stroke.tool)}
                  />
                );
              })}
            </Group>
          </Layer>
        )}
      </Stage>

      {editingText && (
        <textarea
          autoFocus
          title="Edit Text"
          aria-label="Edit Text"
          placeholder="Enter text..."
          value={editingText.value}
          onChange={(e) => setEditingText({ ...editingText, value: e.target.value })}
          onBlur={() => {
            setElements(elements.map(el => el.id === editingText.id ? { ...el, text: editingText.value } : el));
            setEditingText(null);
            setSelectedId(editingText.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          style={{
            position: 'absolute',
            top: (editingText.y * canvasZoomLevel) + canvasViewportPosition.y + 'px',
            left: (editingText.x * canvasZoomLevel) + canvasViewportPosition.x + 'px',
            background: 'none',
            border: '1px dashed #22c55e',
            outline: 'none',
            color: '#ffffff',
            fontSize: (24 * canvasZoomLevel) + 'px',
            fontFamily: 'sans-serif',
            lineHeight: 1,
            padding: '6px',
            margin: 0,
            overflow: 'hidden',
            resize: 'none',
            zIndex: 50,
            minWidth: '200px'
          }}
        />
      )}

      {blendGuardRect && elements.filter(el => el.type === 'image').length === 0 && activeMode !== 'text' && activeMode !== 'shape' && (
        <div 
          style={{
            position: 'absolute',
            top: (blendGuardRect.y * canvasZoomLevel) + canvasViewportPosition.y,
            left: (blendGuardRect.x * canvasZoomLevel) + canvasViewportPosition.x,
            width: blendGuardRect.width * canvasZoomLevel,
            height: blendGuardRect.height * canvasZoomLevel,
          }}
          className="flex flex-col items-center justify-center pointer-events-none"
        >
          <div 
            className="flex flex-col items-center justify-center cursor-pointer pointer-events-auto group p-6 rounded-lg text-zinc-400 hover:text-white transition-colors h-full w-full"
            onClick={onUploadClick}
          >
            <div className="flex items-center justify-center bg-[#2a2a2a] p-4 rounded-xl mb-4 group-hover:bg-[#333] transition-colors border border-zinc-700/50 relative">
               <FileImage size={40} className="text-white" />
            </div>
            <p className="text-xs text-center font-bold">Click or drop to upload a background image..</p>
            <p className="text-[10px] text-zinc-500 mt-1">Then, add layers on top to blend.</p>
          </div>
        </div>
      )}
    </div>
  );
}
