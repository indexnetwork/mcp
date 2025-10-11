import { createRoot } from 'react-dom/client';
import { Echo } from './Echo';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<Echo />);
}
