// Layer type definitions for the blend board

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
