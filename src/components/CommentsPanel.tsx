import { Trash2 } from 'lucide-react';
import { useStore } from '../store/store';
import { useCan } from '../store/permissions';
import { ANNOT_LABELS, annotSummary } from '../lib/annotGeom';
import { flattenAnnotations } from '../store/commands';

export function CommentsPanel() {
  const pageIds = useStore((s) => s.pageIds);
  const annotations = useStore((s) => s.annotations);
  const geoms = useStore((s) => s.geoms);
  const selected = useStore((s) => s.selected);
  const editable = useCan('annotate');
  const canFlatten = useCan('modify');
  const total = pageIds.reduce((n, id) => n + (annotations[id]?.length ?? 0), 0);

  return (
    <div className="panel">
      <div className="panel-title">
        Comments <span className="muted">({total})</span>
        <button className="small-btn" disabled={!canFlatten || !total} onClick={flattenAnnotations} title="Burn all annotations into the page content">Flatten all</button>
      </div>
      {total === 0 && <p className="muted pad">No comments yet. Use the Comment tab to highlight, draw, or add notes.</p>}
      <div className="comment-list">
        {pageIds.map((pid, i) => {
          const list = annotations[pid] ?? [];
          if (!list.length) return null;
          return (
            <div key={pid}>
              <div className="comment-page">Page {i + 1}</div>
              {list.map((a) => {
                const summary = annotSummary(a);
                return (
                  <div
                    key={a.id}
                    className={`comment ${selected?.id === a.id ? 'selected' : ''}`}
                    onClick={() => {
                      const s = useStore.getState();
                      s.setTool('select');
                      s.select({ pageId: pid, id: a.id });
                      const anchor = 'rect' in a ? { x: a.rect.x, y: a.rect.y + a.rect.h } : 'rects' in a ? { x: a.rects[0].x, y: a.rects[0].y + a.rects[0].h } : 'at' in a ? a.at : 'p1' in a ? a.p1 : a.paths[0]?.[0];
                      // goToPage takes a user-space y; for rotated pages fall back to the page top.
                      s.goToPage(i, anchor && geoms[i].rotation === 0 ? anchor.y : undefined);
                    }}
                  >
                    <span className="swatch" style={{ background: a.type === 'redact' ? '#000' : a.color }} />
                    <div className="comment-body">
                      <div className="comment-head">
                        <b>{ANNOT_LABELS[a.type]}</b>
                        <span className="muted small">{a.author} · {new Date(a.createdAt).toLocaleString()}</span>
                      </div>
                      {summary && <div className="comment-text">{summary}</div>}
                      {a.comment && <div className="comment-text reply">{a.comment}</div>}
                    </div>
                    {editable && (
                      <button className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); useStore.getState().deleteAnnotation(pid, a.id); }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
