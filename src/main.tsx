import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { setupPwa } from './lib/pwa';
import { openFiles } from './store/commands';
import { useStore } from './store/store';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

setupPwa({
  openFiles,
  onReady: () => useStore.getState().notify('PDF-Xploder is ready to work offline.'),
});

if (import.meta.env.DEV) {
  // Handy for debugging and end-to-end tests.
  import('./store/store').then(({ useStore }) => ((window as unknown as { __store: unknown }).__store = useStore));
}
