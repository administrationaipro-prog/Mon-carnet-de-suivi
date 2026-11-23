import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './install'; // capte « beforeinstallprompt » avant le rendu
import '@fontsource-variable/inter';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
