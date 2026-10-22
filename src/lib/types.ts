import type { Measure } from './measure';

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
  /** Displayed rotation in degrees, one of 0/90/180/270 (page rotation plus view rotation). */
  rotation: number;
  /** The page's own /Rotate when the view is rotated on top of it. */
  pageRotation?: number;
}

/** An answer to a comment, in its thread (a /Text annotation with /IRT in the file). */
export interface Reply {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

interface AnnotBase {
  id: string;
  color: string;
  opacity: number;
  author: string;
  createdAt: number;
  /** Optional comment attached to any annotation. */
  comment?: string;
  /** The title other editors give a comment (/Subj, e.g. a stamp's name), kept as is. */
  subject?: string;
  /** Answers to the comment, oldest first. */
  replies?: Reply[];
  /** The comment's popup window on the page (a /Popup annotation in the file). */
  popup?: PopupState;
}

/**
 * A popup window showing a comment's text on the page. `rect` is in user space with the
 * size in points at 100 % (popups keep their size when zooming, like /NoZoom); missing
 * until it is first placed.
 */
export interface PopupState {
  open: boolean;
  rect?: Rect;
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
  /** A distance measurement (Measure tools). */
  measure?: Measure;
}

/** Polygon (closed), polyline (open) and cloud (closed, scalloped border). */
export interface PolygonAnnot extends AnnotBase {
  type: 'polygon' | 'polyline' | 'cloud';
  vertices: Pt[];
  width: number;
  fill: string | null;
  /** A perimeter (polyline) or area (polygon) measurement. */
  measure?: Measure;
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
  /**
   * A stamp made by another program: its own drawing, as a one-page PDF (base64)
   * that is drawn into the rect, on screen and when saving. Without it the label is drawn.
   */
  appearance?: string;
  /** The stamp's /Name in that program (kept for round trips). */
  name?: string;
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
  | PolygonAnnot
  | TextBoxAnnot
  | NoteAnnot
  | ImageAnnot
  | StampAnnot
  | RedactAnnot;

export type AnnotType = Annotation['type'];

export type Tool =
  /** Select and move comments ("Edit Comments"). */
  | 'select'
  /** Select page text only; comments are not picked up. */
  | 'selectText'
  | 'hand'
  /** Drag a box to copy that part of the page as an image. */
  | 'snapshot'
  /** Click to zoom in (Alt+click out), drag a box to zoom to it. */
  | 'zoom'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'ink'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'polygon'
  | 'polyline'
  | 'cloud'
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
  | 'fieldRadio'
  /** Page content: select and edit objects; add text and shapes as content. */
  | 'content'
  | 'contentText'
  | 'contentRect'
  | 'contentEllipse'
  | 'contentLine'
  /** Measure tools: distance (drag), perimeter and area (click the points, double-click to finish). */
  | 'measureDistance'
  | 'measurePerimeter'
  | 'measureArea';

export const NOTE_SIZE = 20;
