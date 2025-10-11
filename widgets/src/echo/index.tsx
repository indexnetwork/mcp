import { createRoot } from 'react-dom/client';
import { Echo } from './Echo';

const container = document.getElementById('echo-root');
if (container) {
  createRoot(container).render(<Echo />);
}
