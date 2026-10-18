/**
 * Port of pdf.js' TextLayerBuilder selection handling. Without it, dragging a
 * selection across the gaps between text spans makes the browser extend the
 * selection to the end of the page. The trick is to move an invisible
 * full-size "endOfContent" element next to the selection's moving end.
 */
const layers = new Set<HTMLElement>();
const endOf = (layer: HTMLElement) => layer.querySelector<HTMLElement>('.endOfContent');
let prevRange: Range | null = null;
let listening = false;

function reset(layer: HTMLElement) {
  const end = endOf(layer);
  // Nothing to undo on layers that were not part of a selection (the common case: keeps
  // selection changes elsewhere, e.g. typing in a form field, from touching every page).
  if (!layer.classList.contains('selecting') && (!end || (!end.nextSibling && end.parentElement === layer))) return;
  layer.classList.remove('selecting');
  if (!end) return;
  layer.append(end);
  end.style.width = '';
  end.style.height = '';
}

function onSelectionChange() {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) {
    layers.forEach(reset);
    prevRange = null;
    return;
  }
  const active = new Set<HTMLElement>();
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    for (const layer of layers) if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
  }
  for (const layer of layers) {
    if (active.has(layer)) layer.classList.add('selecting');
    else reset(layer);
  }
  const range = selection.getRangeAt(0);
  const modifyStart =
    prevRange &&
    (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
  let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
  if (anchor?.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
  const parentLayer = (anchor as HTMLElement | null)?.parentElement?.closest<HTMLElement>('.textLayer');
  const end = parentLayer && layers.has(parentLayer) ? endOf(parentLayer) : null;
  if (end && parentLayer && anchor) {
    end.style.width = parentLayer.style.width;
    end.style.height = parentLayer.style.height;
    (anchor as HTMLElement).parentElement!.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
  }
  prevRange = range.cloneRange();
}

function onPointerUp() {
  layers.forEach(reset);
}

export function registerTextLayer(layer: HTMLElement): () => void {
  layers.add(layer);
  const onDown = () => layer.classList.add('selecting');
  layer.addEventListener('mousedown', onDown);
  if (!listening) {
    listening = true;
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerup', onPointerUp);
  }
  return () => {
    layer.removeEventListener('mousedown', onDown);
    layers.delete(layer);
  };
}
