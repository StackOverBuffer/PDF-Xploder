/** Recognition results in pixel coordinates of the image that was recognised. */
import type { Box, RGB } from './raster';

export interface OcrSymbol {
  text: string;
  box: Box;
}

export interface OcrWord {
  text: string;
  /** 0–100. */
  conf: number;
  box: Box;
  symbols: OcrSymbol[];
}

export interface OcrLine {
  box: Box;
  /** Baseline through two points (image y grows downwards). */
  baseline: { x0: number; y0: number; x1: number; y1: number };
  /** Ascender-to-descender height in pixels (0 when unknown). */
  rowHeight: number;
  words: OcrWord[];
}

export interface OcrPage {
  width: number;
  height: number;
  lines: OcrLine[];
  /** Mean word confidence (0–100). */
  confidence: number;
}

export type FontFamily = 'sans' | 'serif' | 'mono';

export interface WordStyle {
  color: RGB;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeout: boolean;
  family: FontFamily;
  /** Font size in pixels. */
  size: number;
  /** Rows of an underline or strikeout below/through the word, to erase with it. */
  decorations: Box[];
}

export interface RulingLine {
  /** Centre line from (x0, y0) to (x1, y1). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  thickness: number;
  color: RGB;
  dir: 'h' | 'v';
}

export interface Table {
  box: Box;
  /** Row and column boundaries (y and x of the ruling lines). */
  rows: number[];
  cols: number[];
  cells: Box[];
}

/** A recognised word with its style, in image pixels. */
export interface StyledWord extends OcrWord {
  style: WordStyle;
  /** Baseline y at the word (image pixels). */
  baselineY: number;
}

export interface StyledLine {
  words: StyledWord[];
  box: Box;
}
