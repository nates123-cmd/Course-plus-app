import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'
import { AuthGate } from './auth/AuthGate.jsx'
import { DataProvider } from './DataContext.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthGate>
        <DataProvider>
          <App />
        </DataProvider>
      </AuthGate>
    </ErrorBoundary>
  </StrictMode>,
)

// NOTE: the service worker is registered INLINE in index.html, not here — the
// rolldown minifier drops navigator.serviceWorker.register() from this module
// bundle as a dead expression. See index.html + public/sw.js.
