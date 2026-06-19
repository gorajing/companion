// src/renderer.ts — renderer entry. Loaded by Vite (module bundle) AFTER the
// classic <script> that installs window.Live2DCubismCore in index.html.
//
// All real work lives in src/renderer/** modules; this file just boots them once
// the DOM is ready.

import './index.css';
import { bootstrap } from './renderer/bootstrap';

function start(): void {
  bootstrap().catch((err) => {
    console.error('[renderer] bootstrap failed', err);
    const s = document.getElementById('status');
    if (s) s.textContent = `Renderer failed to start: ${err instanceof Error ? err.message : String(err)}`;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
