// Layer type definitions for the blend board

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'soft-light'
  | 'hard-light';

export type ExportFormat = 'png' | 'jpeg';

export interface BlendBoardSize {
  id: 'square' | 'portrait' | 'landscape' | 'canvas';
  label: string;
  width: number;
  height: number;
}

export type InpaintTool = 'click-area' | 'manual-brush' | 'erase';

export interface InpaintMaskPoint {
  x: number;
  y: number;
}

export interface InpaintMaskStroke {
  id: string;
  tool: InpaintTool;
  size: number;
  points: InpaintMaskPoint[];
}

export interface InpaintMaskSnapshot {
  strokes: InpaintMaskStroke[];
  isInverted: boolean;
}

export interface InpaintExportResult {
  baseFile: File;
  maskFile: File;
  width: number;
  height: number;
}

export interface BaseLayer {
  id: string;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  url: string;
  width: number;
  height: number;
  name: string;
  blendMode?: BlendMode;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline' | 'line-through';
  textAlign: 'left' | 'center' | 'right';
  color: string;
  strokeColor: string;
  strokeWidth: number;
  letterSpacing: number;
  lineHeight: number;
  width: number;
  height: number;
}

export type Layer = ImageLayer | TextLayer;

export interface TextProperties {
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline' | 'line-through';
  textAlign: 'left' | 'center' | 'right';
  color: string;
  strokeColor: string;
  strokeWidth: number;
  letterSpacing: number;
  lineHeight: number;
}

export const DEFAULT_TEXT_PROPERTIES: TextProperties = {
  fontSize: 32,
  fontFamily: 'Inter',
  fontWeight: 'normal',
  fontStyle: 'normal',
  textDecoration: 'none',
  textAlign: 'left',
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 0,
  letterSpacing: 0,
  lineHeight: 1.2,
};

export const AVAILABLE_FONTS = [
  { value: 'Inter', label: 'Inter' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Playfair Display', label: 'Playfair Display' },
  { value: 'Montserrat', label: 'Montserrat' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman' },
] as const;

export const AVAILABLE_BLEND_MODES: Array<{ value: BlendMode; label: string }> = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'hard-light', label: 'Hard Light' },
];

export const BLEND_BOARD_SIZE_PRESETS: BlendBoardSize[] = [
  { id: 'square', label: 'Square 400x400', width: 400, height: 400 },
  { id: 'portrait', label: 'Portrait 768x1024', width: 768, height: 1024 },
  { id: 'landscape', label: 'Landscape 1024x768', width: 1024, height: 768 },
  { id: 'canvas', label: 'Canvas 800x500', width: 800, height: 500 },
];

export interface EditorImageElement {
  id: string;
  type: 'image';
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  opacity: number;
  blendMode: BlendMode;
  // Original source (preserved when background-removed src is applied)
  originalSrc?: string;
  // Cached background-removed blob URL or data URL
  bgRemovedSrc?: string;
  // Toggle state: when true, use bgRemovedSrc as displayed src
  isBgHidden?: boolean;
  // Processing flag indicates background removal in progress
  bgProcessing?: boolean;
}

export interface EditorTextElement {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline' | 'line-through';
  textAlign: 'left' | 'center' | 'right';
  fill: string;
  stroke: string;
  strokeWidth: number;
  letterSpacing: number;
  lineHeight: number;
  opacity: number;
  rotation?: number;
}

export type EditorShapeKind = 'rectangle' | 'circle' | 'triangle' | 'dialog-bubble';

export interface EditorRectElement {
  id: string;
  type: 'rect';
  shapeKind?: EditorShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  cornerRadius?: number;
  dash?: number[];
}

export type EditorElement = EditorImageElement | EditorTextElement | EditorRectElement;

export interface BaseImageSettings {
  opacity: number;
  blendMode: BlendMode;
}

export interface BaseImageTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface BlendableTarget {
  id: string;
  kind: 'base-image' | 'image';
  label: string;
  blendMode: BlendMode;
  opacity: number;
}

export const DEFAULT_BASE_IMAGE_SETTINGS: BaseImageSettings = {
  opacity: 1,
  blendMode: 'source-over',
};

// ─── Timeline Editor Types ────────────────────────────────────────────────────

export type TimelineTrackType = 'video' | 'audio' | 'text' | 'image' | 'caption';

export interface TimelineElement {
  id: string;
  assetId: string;
  assetUrl: string;
  assetName: string;
  assetType: 'video' | 'image' | 'audio' | 'text';
  sourceDuration?: number; // original media duration when known
  textContent?: string;
  text?: string;
  startTime: number;     // position on timeline (seconds)
  duration: number;       // display duration (seconds)
  trimStart: number;      // in-point trim offset (seconds)
  trimEnd: number;        // out-point trim offset (seconds)
  volume: number;         // 0–100
  speed: number;          // 0.5–2.0
  fadeIn: number;         // seconds
  fadeOut: number;        // seconds
  opacity: number;        // 0–100
  locked: boolean;
}

export interface TimelineTrack {
  id: string;
  type: TimelineTrackType;
  label: string;
  elements: TimelineElement[];
  muted: boolean;
  solo: boolean;
  locked: boolean;
  collapsed: boolean;
}

export type TimelineTool = 'select' | 'razor' | 'hand';

export interface TimelineState {
  tracks: TimelineTrack[];
  currentTime: number;
  totalDuration: number;
  isPlaying: boolean;
  zoomLevel: number;        // pixels per second (0.1–1000)
  selectedElementId: string | null;
  selectedTrackId: string | null;
  snapEnabled: boolean;
  activeTool: TimelineTool;
  loopStart: number | null;
  loopEnd: number | null;
}

export interface ExportConfig {
  resolution: { width: number; height: number };
  aspectRatio: '9:16' | '16:9' | '1:1';
  format: 'mp4' | 'webm' | 'gif';
  quality: 'low' | 'medium' | 'high';
  startTime: number;
  endTime: number;
}

export const DEFAULT_TIMELINE_ELEMENT: Omit<TimelineElement, 'id' | 'assetId' | 'assetUrl' | 'assetName' | 'assetType'> = {
  startTime: 0,
  duration: 5,
  trimStart: 0,
  trimEnd: 0,
  volume: 100,
  speed: 1,
  fadeIn: 0,
  fadeOut: 0,
  opacity: 100,
  locked: false,
};

export const INITIAL_TIMELINE_STATE: TimelineState = {
  tracks: [
    { id: 'track-video-1', type: 'video', label: 'Video', elements: [], muted: false, solo: false, locked: false, collapsed: false },
    { id: 'track-audio-1', type: 'audio', label: 'Audio', elements: [], muted: false, solo: false, locked: false, collapsed: false },
    { id: 'track-text-1', type: 'text', label: 'Text', elements: [], muted: false, solo: false, locked: false, collapsed: false },
    { id: 'track-image-1', type: 'image', label: 'Image', elements: [], muted: false, solo: false, locked: false, collapsed: false },
  ],
  currentTime: 0,
  totalDuration: 60,
  isPlaying: false,
  zoomLevel: 40,
  selectedElementId: null,
  selectedTrackId: null,
  snapEnabled: true,
  activeTool: 'select',
  loopStart: null,
  loopEnd: null,
};

export interface TimelineHistoryEntry {
  tracks: TimelineTrack[];
  totalDuration: number;
}

export interface EditorAction {
  id: string;
  label: string;
  undo: () => TimelineState | null;
  redo: () => TimelineState | null;
}

// ─── Project Types ────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  timelineState: TimelineState;
  userId?: string;
  description?: string | null;
  status?: string;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
