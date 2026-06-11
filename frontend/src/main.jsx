import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './designTokens.css';
import './styles.css';

// Clear potentially corrupted localStorage data to prevent quota exceeded errors
try {
  const saved = window.localStorage.getItem('sk2c:notifPreview');
  if (saved && saved.length > 10000) {
    // Clear if data is too large
    window.localStorage.removeItem('sk2c:notifPreview');
  }
} catch { }

// Error Boundary for debugging render crashes
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('React Error Boundary caught:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: 'white', background: '#be123c' }}>
          <h1>Erreur de rendu</h1>
          <pre>{this.state.error?.message}</pre>
          <button onClick={() => window.location.reload()}>Rafraîchir</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

// Service worker disabled for debugging - may cause caching issues
// if ('serviceWorker' in navigator && import.meta.env.PROD) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/sw.js').catch(() => {});
//   });
// }
