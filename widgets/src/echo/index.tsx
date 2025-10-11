import { createRoot } from 'react-dom/client';
import { Echo } from './Echo';

// Initialize the Echo widget in the DOM
const container = document.getElementById('echo-root');
if (container) {
  createRoot(container).render(<Echo />);
}
