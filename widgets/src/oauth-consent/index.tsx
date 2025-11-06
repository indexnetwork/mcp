import { createRoot } from 'react-dom/client';
import App from './App';
import './oauth-consent.css';

const container = document.getElementById('oauth-root');

if (container) {
  const root = createRoot(container);
  root.render(<App />);
} else {
  console.error('Missing #oauth-root container');
}
