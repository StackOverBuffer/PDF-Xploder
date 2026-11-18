/**
 * Render queue, like pdf.js's own viewer: pdf.js draws each page in 15 ms slices
 * per animation frame, so with every visible page and thumbnail drawing at once a
 * frame takes N × 15 ms and scrolling stutters. Main-view pages go before thumbnails,
 * one render at a time of each kind, and a thumbnail starts only while no page is being
 * drawn: pdf.js prepares pages one after another in its worker, so anything started
 * alongside a page (a huge scan: seconds of image decoding) makes that page appear later.
 * A thumbnail already running does not hold a page back.
 */
export const PRIORITY = { page: 0, thumbnail: 1 } as const;

interface Waiter {
  priority: number;
  grant: () => void;
  seq: number;
}

/** Priorities of the running renders (at most one each). */
const running = new Set<number>();
let seq = 0;
const queue: Waiter[] = [];

function pump() {
  // Highest priority first, first come first served within a priority.
  queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  for (let i = 0; i < queue.length; ) {
    const w = queue[i];
    // Waits while a render of its own kind or a more urgent one runs.
    if ([...running].some((r) => r <= w.priority)) {
      i++;
      continue;
    }
    queue.splice(i, 1);
    running.add(w.priority);
    w.grant();
  }
}

/** A place in the queue: `ready` resolves when it is this render's turn; call `done` when it ends (or is cancelled). */
export function renderSlot(priority: number): { ready: Promise<void>; done: () => void } {
  let granted = false;
  let finished = false;
  let waiter: Waiter | null = null;
  const ready = new Promise<void>((resolve) => {
    waiter = {
      priority,
      seq: seq++,
      grant: () => {
        granted = true;
        resolve();
      },
    };
    queue.push(waiter);
  });
  pump();
  return {
    ready,
    done: () => {
      if (finished) return;
      finished = true;
      if (granted) {
        running.delete(priority);
        pump();
      } else {
        const i = queue.indexOf(waiter!);
        if (i >= 0) queue.splice(i, 1);
      }
    },
  };
}
