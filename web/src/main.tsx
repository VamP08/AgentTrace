import React from 'react';
import { createRoot } from 'react-dom/client';
// Both faces are self-hosted: the app reads local files and must look the same with no network.
import '@fontsource-variable/archivo';
import '@fontsource-variable/jetbrains-mono';
// Ordered deliberately: the shared sheet is loaded before any view, so a view's own sheet can
// override it without having to out-specify it.
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
