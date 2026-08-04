/** Webview entry point. Everything below here is pure presentation. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Webview root element is missing.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
