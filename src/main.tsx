import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Initialize settings from localStorage
const storedUI = localStorage.getItem('ui-config');
if (storedUI) {
  try {
    const config = JSON.parse(storedUI);
    if (config.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (config.theme === 'light') {
      document.documentElement.classList.remove('dark');
    }
    if (config.fontSize) {
      const sizes: Record<string, string> = { small: '13px', medium: '14px', large: '16px' };
      document.documentElement.style.fontSize = sizes[config.fontSize] || '14px';
    }
    if (config.bubbleStyle) {
      document.documentElement.setAttribute('data-bubble-style', config.bubbleStyle);
    }
  } catch { /* ignore */ }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
