import React from 'react';
import { createRoot } from 'react-dom/client';
// Every face is self-hosted: the app reads local files and must look the same with no network.
import '@fontsource-variable/funnel-display';
import '@fontsource-variable/funnel-sans';
import '@fontsource/sometype-mono/400.css';
import '@fontsource/sometype-mono/500.css';
// Ordered deliberately: the shared sheet is loaded before any view, so a view's own sheet can
// override it without having to out-specify it.
import './styles.css';
import { App } from './App';

// The online preview answers /api from a captured snapshot. The check is on the literal so the
// normal build drops the whole branch, snapshot included.
const preview = import.meta.env.VITE_DEMO === '1' ? Promise.all([import('./demo/install'), import('./demo/Banner')]) : undefined;

(preview ?? Promise.resolve(undefined)).then((mods) => {
  const Banner = mods?.[1].Banner;
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {Banner && <Banner />}
      <App />
    </React.StrictMode>,
  );
});
