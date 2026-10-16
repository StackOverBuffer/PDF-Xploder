/**
 * Installable app: offline service worker, the browser's install prompt and
 * PDFs opened from the operating system ("Open with…" → PDF-Xploder).
 */
import { create } from 'zustand';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface LaunchParams {
  files?: FileSystemFileHandle[];
}

interface PwaState {
  /** The deferred install prompt, when the browser offers installation. */
  prompt: InstallPromptEvent | null;
  /** Running as the installed app (own window). */
  installed: boolean;
}

const standalone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(display-mode: standalone), (display-mode: window-controls-overlay)').matches;

export const usePwa = create<PwaState>(() => ({ prompt: null, installed: standalone() }));

/** Show the browser's install dialog. Returns whether the app was installed. */
export async function installApp(): Promise<boolean> {
  const p = usePwa.getState().prompt;
  if (!p) return false;
  usePwa.setState({ prompt: null });
  await p.prompt();
  return (await p.userChoice).outcome === 'accepted';
}

/**
 * Hook up install prompt, service worker and file launches.
 * `onReady` fires once when the app was first cached for offline use;
 * `openFiles` receives files the operating system asked us to open.
 */
export function setupPwa(o: { onReady?: () => void; openFiles: (files: File[], handles: FileSystemFileHandle[]) => void }) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    usePwa.setState({ prompt: e as InstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => usePwa.setState({ prompt: null }));

  const queue = (window as unknown as { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue;
  queue?.setConsumer(async ({ files }) => {
    if (!files?.length) return;
    const opened = await Promise.all(files.map((h) => h.getFile()));
    o.openFiles(opened, files);
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const firstInstall = !navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((reg) => {
      if (!firstInstall) return;
      // Tell the user once the app is fully cached and works without a connection.
      const worker = reg.installing ?? reg.waiting;
      worker?.addEventListener('statechange', () => worker.state === 'activated' && o.onReady?.());
    })
    .catch((e) => console.warn('Service worker registration failed', e));
}
