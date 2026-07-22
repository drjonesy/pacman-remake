import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Note: no <StrictMode> wrapper. The game engine is imperative and not designed
// to be mounted twice, which StrictMode intentionally does in development.
createRoot(document.getElementById('root')).render(<App />);
