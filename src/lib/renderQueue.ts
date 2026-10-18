/**
 * Render queue, like pdf.js's own viewer: pdf.js draws each page in 15 ms slices
 * per animation frame, so with every visible page and thumbnail drawing at once a
 * frame takes N × 15 ms and scrolling stutters. At most two renders run at a time,
 * main-view pages before thumbnails.
 */
export const PRIORITY = { page: 0, thumbnail: 1 } as const;
const MAX_ACTIVE = 2;

interface Waiter {
  priority: number;
  grant: () => void;
  seq: number;
}

let active = 0;
let seq = 0;
const queue: Waiter[] = [];

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    // Highest priority first, first come first served within a priority.
    queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    active++;
    queue.shift()!.grant();
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
        active--;
        pump();
      } else {
        const i = queue.indexOf(waiter!);
        if (i >= 0) queue.splice(i, 1);
      }
    },
  };
}
