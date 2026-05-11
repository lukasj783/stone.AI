import React, { useRef, useEffect, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer, Text, Rect, Circle, Line } from 'react-konva';
import useImage from 'use-image';
import { FileImage, UploadCloud } from 'lucide-react';
import { DEFAULT_BASE_IMAGE_SETTINGS, type BaseImageSettings, type EditorElement, type EditorImageElement, type EditorRectElement, type EditorTextElement, type InpaintMaskStroke, type InpaintTool } from '@/lib/types/layers.types';

interface URLImageProps {
  element: EditorImageElement;
  isDraggable: boolean;
  onSelect: () => void;
  onDragEnd: (e: any) => void;
  onTransformEnd: (e: any) => void;
}

const URLImage = ({ element, isDraggable, onSelect, onDragEnd, onTransformEnd }: URLImageProps) => {
  const [img] = useImage(element.src);
  return (
    <KonvaImage
      id={element.id}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      image={img}
      opacity={element.opacity ?? 1}
      globalCompositeOperation={element.blendMode ?? 'source-over'}
      draggable={isDraggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    />
  );
};

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
  isBlendMode?: boolean;
  onUploadClick?: () => void;
  onExportReady?: (exportFn: (() => void) | null) => void;
}

export default function KonvaCanvas({ 
  imageSrc, 
  width = 800, 
  height = 500,
  activeMode = 'select',
  zoomLevel = 1,
  viewportPosition = { x: 0, y: 0 },
  setViewportPosition = () => undefined,
  inpaintTool = 'manual-brush',
  brushSize = 36,
  maskStrokes = [],
  isMaskInverted = false,
  onMaskStrokesCommit = () => {},
  elements = [],
  setElements = () => undefined,
  selectedId = null,
  setSelectedId = () => {},
  baseImageSettings = DEFAULT_BASE_IMAGE_SETTINGS,
  isBlendMode = false,
  onUploadClick = () => {},
  onExportReady = () => {}
}: KonvaCanvasProps) {
  const [image] = useImage(imageSrc);
  const stageRef = useRef<any>(null);
  const imageRef = useRef<any>(null);
  const trRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingElement, setDrawingElement] = useState<EditorRectElement | null>(null);
  const [editingText, setEditingText] = useState<{id: string, x: number, y: number, value: string} | null>(null);
  const [draftMaskStroke, setDraftMaskStroke] = useState<InpaintMaskStroke | null>(null);

  const maskOverlayColor = isMaskInverted ? 'rgba(244, 114, 182, 0.32)' : 'rgba(244, 114, 182, 0.78)';
  const maskFillColor = 'rgba(17, 24, 39, 0.52)';
  const canUseInpaintMask = activeMode === 'inpaint' && !isBlendMode && Boolean(imageSrc);

  const createMaskStroke = (tool: InpaintTool, x: number, y: number, size: number): InpaintMaskStroke => ({
    id: `${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tool,
    size,
    points: [{ x, y }],
  });

  const flattenMaskPoints = (stroke: InpaintMaskStroke) => stroke.points.flatMap((point) => [point.x, point.y]);

  const getPointDistance = (a: { x: number; y: number }, b: { x: number; y: number }) => (
    Math.hypot(a.x - b.x, a.y - b.y)
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

  const removeStrokesTouchedByEraser = (
    currentStrokes: InpaintMaskStroke[],
    eraserStroke: InpaintMaskStroke,
  ) => currentStrokes.filter((stroke) => (
    stroke.tool !== 'erase' && !doesEraserHitStroke(eraserStroke, stroke)
  ));

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
    if (activeMode === 'inpaint') {
      return;
    }

    setSelectedId(id);
  };

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

      const dataUrl = stage.toDataURL({
        mimeType: 'image/png',
        pixelRatio: 2,
      });

      if (transformer) {
        transformer.nodes(selectedNodes);
        transformer.getLayer()?.batchDraw();
      }

      const downloadLink = document.createElement('a');
      downloadLink.href = dataUrl;
      downloadLink.download = `blend-board-${Date.now()}.png`;
      downloadLink.click();
    });

    return () => {
      onExportReady(null);
    };
  }, [onExportReady]);

  useEffect(() => {
    if (isBlendMode && elements.length === 0 && !imageSrc) {
      setElements([{
        id: 'blend-guard',
        type: 'rect',
        x: (width - 400) / 2,
        y: (height - 400) / 2,
        width: 400,
        height: 400,
        fill: 'transparent',
        stroke: '#22c55e',
        strokeWidth: 2,
        opacity: 1,
        dash: [5, 5]
      }]);
      setSelectedId('blend-guard');
    }
  }, [isBlendMode, imageSrc, width, height, elements.length, setElements, setSelectedId]);

  useEffect(() => {
    if (trRef.current && layerRef.current) {
      if (!selectedId) {
        trRef.current.nodes([]);
      } else {
        const node = layerRef.current.findOne(`#${selectedId}`);
        if (node) {
          trRef.current.nodes([node]);
        } else if (selectedId === 'base-image' && imageRef.current) {
          trRef.current.nodes([imageRef.current]);
        }
      }
      trRef.current.getLayer().batchDraw();
    }
  }, [selectedId, elements]);

  // Calculate scaled dimensions to fit within the container while maintaining aspect ratio
  let initialWidth = 0;
  let initialHeight = 0;
  
  if (image) {
    const scale = Math.min(width / image.width, height / image.height);
    initialWidth = image.width * scale;
    initialHeight = image.height * scale;
  }

  const getRelativePointerPosition = (stage: any) => {
    const pointerPosition = stage.getPointerPosition();
    const stageAttrs = stage.attrs;
    const x = (pointerPosition.x - (stageAttrs.x || 0)) / zoomLevel;
    const y = (pointerPosition.y - (stageAttrs.y || 0)) / zoomLevel;
    return { x, y };
  };

  const handleStageMouseDown = (e: any) => {
    const stage = e.target.getStage();
    const pos = getRelativePointerPosition(stage);
    const clickedOnEmpty = e.target === stage;

    if (canUseInpaintMask) {
      if (inpaintTool === 'click-area') {
        onMaskStrokesCommit([
          ...maskStrokes,
          createMaskStroke('click-area', pos.x, pos.y, Math.max(brushSize * 1.6, 20)),
        ]);
        setSelectedId(null);
        return;
      }

      const nextStroke = createMaskStroke(inpaintTool === 'erase' ? 'erase' : 'manual-brush', pos.x, pos.y, brushSize);
      setDraftMaskStroke(nextStroke);
      setSelectedId(null);
      return;
    }
    
    if (activeMode === 'select' && clickedOnEmpty) {
      setSelectedId(null);
    } else if (activeMode === 'text' && clickedOnEmpty) {
      const id = `text-${Date.now()}`;
      const newText: EditorTextElement = {
        id,
        type: 'text',
        x: pos.x,
        y: pos.y,
        text: 'Double click to edit',
        fontSize: 24,
        fill: '#ffffff',
        width: 200,
        opacity: 1,
      };
      setElements([...elements, newText]);
      setSelectedId(id);
    } else if (activeMode === 'shape' && clickedOnEmpty) {
      setIsDrawing(true);
      setDrawingElement({
        id: `rect-${Date.now()}`,
        type: 'rect',
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

  const handleStageMouseMove = (e: any) => {
    if (canUseInpaintMask && draftMaskStroke) {
      const stage = e.target.getStage();
      const pos = getRelativePointerPosition(stage);
      setDraftMaskStroke((currentStroke) => currentStroke ? {
        ...currentStroke,
        points: [...currentStroke.points, pos],
      } : currentStroke);
      return;
    }

    if (!isDrawing || activeMode !== 'shape' || !drawingElement) return;
    const stage = e.target.getStage();
    const pos = getRelativePointerPosition(stage);
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

  const handleDragEnd = (e: any, id: string) => {
    const node = e.target;
    setElements(elements.map(el => el.id === id ? { ...el, x: node.x(), y: node.y() } : el));
  };

  const handleTransformEnd = (e: any, id: string) => {
    const node = layerRef.current?.findOne(`#${id}`);
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    setElements(elements.map(el => el.id === id ? { 
      ...el, 
      x: node.x(), 
      y: node.y(),
      width: Math.max(5, node.width() * scaleX),
      height: Math.max(5, el.type === 'text' ? node.height() : node.height() * scaleY),
      ...(el.type === 'text' ? { fontSize: el.fontSize * scaleX } : {})
    } : el));
  };

  const handleStageDragEnd = (e: any) => {
    setViewportPosition({
      x: e.target.x(),
      y: e.target.y(),
    });
  };

  const handleTextDblClick = (e: any, el: any) => {
    if (activeMode !== 'select' && activeMode !== 'move' && activeMode !== 'text') return;
    const textNode = e.target;
    const absPos = textNode.getAbsolutePosition();
    setEditingText({ id: el.id, x: absPos.x, y: absPos.y, value: el.text });
  };

  const blendGuardEl = elements.find((el): el is EditorRectElement => el.id === 'blend-guard' && el.type === 'rect');

  return (
    <div className="flex items-center justify-center relative shadow-lg">
      <Stage 
        ref={stageRef}
        width={width} 
        height={height}
        x={viewportPosition.x}
        y={viewportPosition.y}
        scale={{ x: zoomLevel, y: zoomLevel }}
        draggable={activeMode === 'pan'}
        onDragEnd={handleStageDragEnd}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onTouchStart={handleStageMouseDown}
        onTouchMove={handleStageMouseMove}
        onTouchEnd={handleStageMouseUp}
        className={activeMode === 'pan' ? 'cursor-grab active:cursor-grabbing' : activeMode === 'text' ? 'cursor-text' : activeMode === 'shape' ? 'cursor-crosshair' : activeMode === 'select' ? 'cursor-default' : ''}
      >
        <Layer ref={layerRef}>
          {(image || isBlendMode) && (
            <>
              {image && (
                <KonvaImage
                  id="base-image"
                  ref={imageRef}
                  image={image}
                  x={(width - initialWidth) / 2}
                  y={(height - initialHeight) / 2}
                  width={initialWidth}
                  height={initialHeight}
                  opacity={baseImageSettings.opacity}
                  globalCompositeOperation={baseImageSettings.blendMode}
                  draggable={activeMode === 'select' || activeMode === 'move'}
                  onClick={() => handleMaskSelect('base-image')}
                  onTap={() => handleMaskSelect('base-image')}
                />
              )}
              {elements.map((el) => {
                const isDraggable = activeMode === 'select' || activeMode === 'move';
                
                if (el.type === 'rect') {
                  return (
                    <Rect
                      key={el.id}
                      id={el.id}
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                      fill={el.fill}
                      stroke={el.stroke}
                      strokeWidth={el.strokeWidth}
                      opacity={el.opacity ?? 1}
                      dash={el.dash}
                      draggable={isDraggable}
                      onClick={() => handleMaskSelect(el.id)}
                      onTap={() => handleMaskSelect(el.id)}
                      onDragEnd={(e) => handleDragEnd(e, el.id)}
                      onTransformEnd={(e) => handleTransformEnd(e, el.id)}
                    />
                  );
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
                      fill={el.fill}
                      width={el.width}
                      opacity={el.opacity ?? 1}
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
                      onSelect={() => handleMaskSelect(el.id)}
                      onDragEnd={(e: any) => handleDragEnd(e, el.id)}
                      onTransformEnd={(e: any) => handleTransformEnd(e, el.id)}
                    />
                  );
                }

                return null;
              })}
              
              {drawingElement && drawingElement.type === 'rect' && (
                <Rect
                  x={drawingElement.x}
                  y={drawingElement.y}
                  width={drawingElement.width}
                  height={drawingElement.height}
                  fill={drawingElement.fill}
                  stroke={drawingElement.stroke}
                  strokeWidth={drawingElement.strokeWidth}
                />
              )}
              <Transformer
                ref={trRef}
                boundBoxFunc={(oldBox, newBox) => {
                  // limit minimum size logic so text doesn't lock
                  if (newBox.width < 5 || newBox.height < 5) {
                    return oldBox;
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
                padding={5}
                ignoreStroke={true}
              />
            </>
          )}
        </Layer>
        {canUseInpaintMask && (
          <Layer listening={false}>
            {!isMaskInverted && (
              <Rect
                x={0}
                y={0}
                width={width}
                height={height}
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
            top: (editingText.y * zoomLevel) + viewportPosition.y + 'px',
            left: (editingText.x * zoomLevel) + viewportPosition.x + 'px',
            background: 'none',
            border: '1px dashed #22c55e',
            outline: 'none',
            color: '#ffffff',
            fontSize: (24 * zoomLevel) + 'px',
            fontFamily: 'sans-serif',
            lineHeight: 1,
            padding: 0,
            margin: 0,
            overflow: 'hidden',
            resize: 'none',
            zIndex: 50,
            minWidth: '200px'
          }}
        />
      )}

      {isBlendMode && !imageSrc && elements.filter(el => el.type === 'image').length === 0 && blendGuardEl && (
        <div 
          style={{
            position: 'absolute',
            top: (blendGuardEl.y * zoomLevel) + viewportPosition.y,
            left: (blendGuardEl.x * zoomLevel) + viewportPosition.x,
            width: blendGuardEl.width * zoomLevel,
            height: blendGuardEl.height * zoomLevel,
          }}
          className="flex flex-col items-center justify-center pointer-events-none"
        >
          <div 
            className="flex flex-col items-center justify-center cursor-pointer pointer-events-auto group p-6 rounded-lg text-zinc-400 hover:text-white transition-colors"
            onClick={onUploadClick}
          >
            <div className="bg-[#2a2a2a] p-4 rounded-xl mb-4 group-hover:bg-[#333] transition-colors border border-zinc-700/50 relative">
               <FileImage size={40} className="text-white" />
               <UploadCloud size={20} className="absolute -top-2 -right-2 text-white bg-zinc-800 rounded p-0.5 border border-zinc-600" />
            </div>
            <p className="text-xs text-center font-bold">Click or drop to upload a background image..</p>
            <p className="text-[10px] text-zinc-500 mt-1">Then, add layers on top to blend.</p>
          </div>
        </div>
      )}
    </div>
  );
}
