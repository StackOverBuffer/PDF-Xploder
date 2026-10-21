/** Messages between the main thread and the page-drawing worker (renderWorker.ts). */
export type RenderRequest =
  /** The document comes as `data`, or over `port` from the editing worker (see worker/index.ts). */
  | { type: 'open'; doc: string; data?: Uint8Array; port?: MessagePort; password?: string; base: string }
  /** The bytes for a document whose port brought none. */
  | { type: 'data'; doc: string; data: Uint8Array }
  | { type: 'close'; doc: string }
  | { type: 'cancel'; id: number }
  | {
      type: 'render';
      id: number;
      doc: string;
      page: number;
      scale: number;
      rotation: number;
      offsetX: number;
      offsetY: number;
      /** Leave form fields off (the page view shows them as HTML controls). */
      noForms: boolean;
      /** Size of the picture in pixels. */
      width: number;
      height: number;
    };

export type RenderResult = { id: number; ok: true; bitmap: ImageBitmap } | { id: number; ok: false; error: 'cancelled' | 'fallback' };

export type RenderReply =
  | RenderResult
  /** The editing worker no longer had the document: send its bytes. */
  | { id: -1; need: string }
  /** The editing worker's copy arrived. */
  | { id: -1; got: string };
