/** A point in PDF user space (origin bottom-left, y up, units = points). */
export interface Pt {
  x: number;
  y: number;
}

/** An axis-aligned rectangle in PDF user space; (x, y) is the lower-left corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Page geometry needed to map between PDF user space and on-screen view space. */
export interface PageGeom {
  /** Visible page box [x0, y0, x1, y1] in user space (crop box). */
  view: [number, number, number, number];
  /** Page rotation in degrees, one of 0/90/180/270. */
  rotation: number;
}

interface AnnotBase {
  id: string;
  color: string;
  opacity: number;
  author: string;
  createdAt: number;
  /** Optional comment attached to any annotation. */
  comment?: string;
}

/**
 * Annotations whose content has an "up" direction (text, stamps, images, text
 * markup) remember the page rotation they were created at, so they turn with
 * the page like any other page content.
 */
interface Oriented {
  rot?: number;
}

export type TextMarkupKind = 'highlight' | 'underline' | 'strikeout';

export interface TextMarkupAnnot extends AnnotBase, Oriented {
  type: TextMarkupKind;
  rects: Rect[];
  /** The text that was marked, if known. */
  text?: string;
}

export interface InkAnnot extends AnnotBase {
  type: 'ink';
  paths: Pt[][];
  width: number;
}

export interface ShapeAnnot extends AnnotBase {
  type: 'rect' | 'ellipse';
  rect: Rect;
  width: number;
  fill: string | null;
}

export interface LineAnnot extends AnnotBase {
  type: 'line' | 'arrow';
  p1: Pt;
  p2: Pt;
  width: number;
}

export interface TextBoxAnnot extends AnnotBase, Oriented {
  type: 'text';
  rect: Rect;
  text: string;
  fontSize: number;
  border: boolean;
}

export interface NoteAnnot extends AnnotBase {
  type: 'note';
  /** Top-left anchor of the note icon. */
  at: Pt;
  text: string;
}

export interface ImageAnnot extends AnnotBase, Oriented {
  type: 'image';
  rect: Rect;
  /** PNG or JPEG data URL. */
  src: string;
  /** Signatures are images too; this only affects labelling in the UI. */
  signature?: boolean;
}

export interface StampAnnot extends AnnotBase, Oriented {
  type: 'stamp';
  rect: Rect;
  label: string;
}

export interface RedactAnnot extends AnnotBase {
  type: 'redact';
  rect: Rect;
}

export type Annotation =
  | TextMarkupAnnot
  | InkAnnot
  | ShapeAnnot
  | LineAnnot
  | TextBoxAnnot
  | NoteAnnot
  | ImageAnnot
  | StampAnnot
  | RedactAnnot;

export type AnnotType = Annotation['type'];

export type Tool =
  | 'select'
  | 'hand'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'ink'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text'
  | 'note'
  | 'stamp'
  | 'redact'
  /** Drag a box for a visible digital signature. */
  | 'sign'
  /** Form design: drag a box to create a field of that kind. */
  | 'fieldText'
  | 'fieldCheckbox'
  | 'fieldDropdown'
  | 'fieldList'
  | 'fieldRadio';

export const NOTE_SIZE = 20;
