import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'
import { AuthGate } from './auth/AuthGate.jsx'
import { DataProvider } from './DataContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGate>
      <DataProvider>
        <App />
      </DataProvider>
    </AuthGate>
  </StrictMode>,
)

// Defensive cleanup for any stale service worker / caches from prior suite apps
// served on the same origin.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {})
  if ('caches' in window) {
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => {})
  }
}
