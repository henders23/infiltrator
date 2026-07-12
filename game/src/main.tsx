import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

// Note: intentionally not wrapped in <StrictMode>. Its double-invoked effects would
// init/destroy the async Pixi Application twice on mount; the engine owns a single
// canvas + ticker and is cleaned up explicitly on unmount instead.
createRoot(document.getElementById('root')!).render(<App />);
