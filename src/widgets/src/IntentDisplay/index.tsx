import '../main.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { IntentDisplay } from './IntentDisplay';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <IntentDisplay />
    </React.StrictMode>
  );
}
