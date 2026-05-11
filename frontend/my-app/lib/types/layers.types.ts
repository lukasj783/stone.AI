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

export interface EditorImageElement {
  id: string;
  type: 'image';
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  blendMode: BlendMode;
}

export interface EditorTextElement {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number;
  fill: string;
  opacity: number;
}

export interface EditorRectElement {
  id: string;
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  dash?: number[];
}

export type EditorElement = EditorImageElement | EditorTextElement | EditorRectElement;

export interface BaseImageSettings {
  opacity: number;
  blendMode: BlendMode;
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
