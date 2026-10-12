import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.DEV) {
  // Handy for debugging and end-to-end tests.
  import('./store/store').then(({ useStore }) => ((window as unknown as { __store: unknown }).__store = useStore));
}
