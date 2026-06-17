import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import './styles/index.css';

// Provider ordering: ErrorBoundary is outermost so it catches anything
// in the rest of the tree (including AuthProvider init errors).
// BrowserRouter sits inside ErrorBoundary so route-driven errors are
// also caught. AuthProvider goes inside the router so auth-aware
// redirects work without further wrapping.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
