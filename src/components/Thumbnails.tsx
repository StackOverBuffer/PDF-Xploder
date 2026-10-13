import { memo, useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw, Trash2, FilePlus2, Copy, FileOutput } from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import * as cmd from '../store/commands';
import { viewSize } from '../lib/geometry';
import { tf, useT } from '../lib/i18n';

const THUMB_W = 130;

const Thumb = memo(function Thumb({ index }: { index: number }) {
  const pdf = useStore((s) => s.pdf);
  const docVersion = useStore((s) => s.docVersion);
  const opening = useStore((s) => s.opening);
  const geom = useStore((s) => s.geoms[index]);
  const hostRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const { width, height } = viewSize(geom);
  const scale = THUMB_W / width;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || !pdf || opening) return;
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    (async () => {
      try {
        const page = await pdf.getPage(index + 1);
        const viewport = page.getViewport({ scale: scale * Math.min(window.devicePixelRatio || 1, 2), rotation: geom.rotation });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const t = page.render({ canvasContext: canvas.getContext('2d')!, viewport });
        task = t;
        await t.promise;
        if (!cancelled) hostRef.current?.replaceChildren(canvas);
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [inView, pdf, docVersion, index, scale, geom.rotation, opening]);

  return <div ref={hostRef} className="thumb-canvas" style={{ width: THUMB_W, height: Math.round(height * scale) }} />;
});

export function Thumbnails() {
  const t = useT();
  const count = useStore((s) => s.geoms.length);
  const docSession = useStore((s) => s.docSession);
  const current = useStore((s) => s.currentPage);
  const selected = useStore((s) => s.selectedPages);
  const pageIds = useStore((s) => s.pageIds);
  const annotations = useStore((s) => s.annotations);
  const canAssemble = useCan('assemble');
  const canCopy = useCan('copy');
  const [dropAt, setDropAt] = useState<number | null>(null);
  const anchor = useRef(0);

  const onClick = (e: React.MouseEvent, i: number) => {
    const s = useStore.getState();
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      s.setSelectedPages(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else if (e.ctrlKey || e.metaKey) {
      s.setSelectedPages(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i]);
      anchor.current = i;
    } else {
      s.setSelectedPages([i]);
      anchor.current = i;
    }
    s.goToPage(i);
  };

  const onDragStart = (e: React.DragEvent, i: number) => {
    const s = useStore.getState();
    if (!selected.includes(i)) s.setSelectedPages([i]);
    e.dataTransfer.setData('application/x-awesome-pages', JSON.stringify(selected.includes(i) ? selected : [i]));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: React.DragEvent, i: number) => {
    if (!e.dataTransfer.types.includes('application/x-awesome-pages')) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
  };

  const onDrop = (e: React.DragEvent) => {
    const data = e.dataTransfer.getData('application/x-awesome-pages');
    const to = dropAt;
    setDropAt(null);
    if (!data || to === null) return;
    e.preventDefault();
    cmd.movePages(JSON.parse(data), to);
  };

  const n = selected.length || 1;
  return (
    <div className="panel thumbs-panel">
      <div className="panel-toolbar">
        <button title={t('Rotate left')} disabled={!canAssemble} onClick={() => cmd.rotate(-90)}><RotateCcw size={16} /></button>
        <button title={t('Rotate right')} disabled={!canAssemble} onClick={() => cmd.rotate(90)}><RotateCw size={16} /></button>
        <button title={t('Insert blank page after')} disabled={!canAssemble} onClick={() => cmd.insertBlank()}><FilePlus2 size={16} /></button>
        <button title={t('Duplicate')} disabled={!canAssemble} onClick={() => cmd.duplicate()}><Copy size={16} /></button>
        <button title={t('Extract to new file')} disabled={!canCopy} onClick={() => cmd.extract()}><FileOutput size={16} /></button>
        <button title={t('Delete')} disabled={!canAssemble} onClick={() => cmd.deletePages()}><Trash2 size={16} /></button>
        <span className="muted small">{tf('{n} sel.', { n })}</span>
      </div>
      <div className="thumbs" key={docSession} onDragLeave={() => setDropAt(null)} onDrop={onDrop}>
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className={`thumb ${i === current ? 'current' : ''} ${selected.includes(i) ? 'selected' : ''} ${dropAt === i ? 'drop-before' : ''} ${dropAt === i + 1 && i === count - 1 ? 'drop-after' : ''}`}
            draggable={canAssemble}
            onDragStart={(e) => onDragStart(e, i)}
            onDragOver={(e) => onDragOver(e, i)}
            onClick={(e) => onClick(e, i)}
          >
            <div className="thumb-frame">
              <Thumb index={i} />
              {(annotations[pageIds[i]]?.length ?? 0) > 0 && <span className="thumb-badge" title={t('Has annotations')}>{annotations[pageIds[i]].length}</span>}
            </div>
            <div className="thumb-label">{i + 1}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
