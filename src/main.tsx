import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { loadLanguage, useLang } from './lib/i18n';
import { warmUpWorker } from './lib/worker';
import { setupPwa } from './lib/pwa';
import { openFiles } from './store/commands';
import { useStore } from './store/store';
import { loadRecent, restoreSession, startAutosave } from './store/session';

// German strings come in their own chunk; render once the interface language is available.
loadLanguage(useLang.getState().lang).finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);

// The command search matches German names too: fetch them when the browser is idle,
// so the first search does not wait for them.
const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 3000));
idle(() => {
  void loadLanguage('de');
  warmUpWorker();
}, { timeout: 10000 });

// Reopen the last session's tabs (files handed over by the system open after them).
loadRecent();
void useStore.getState().run('Restoring the last session…', async () => {
  await restoreSession();
});
startAutosave();

setupPwa({
  openFiles,
  onReady: () => useStore.getState().notify('PDF-Xploder is ready to work offline.'),
});

if (import.meta.env.DEV) {
  // Handy for debugging and end-to-end tests.
  import('./store/store').then(({ useStore }) => ((window as unknown as { __store: unknown }).__store = useStore));
}
