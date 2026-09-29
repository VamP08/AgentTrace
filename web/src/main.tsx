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

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
