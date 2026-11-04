import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './arcade/arcade.css'
import { registerServiceWorker } from './arcade/offline/register'
// Hosted Supabase is deliberately not initialised at boot: the app and the Arcade
// must start with no hosted configuration. Import './lib/supabase' lazily from the
// feature that needs it (it throws when VITE_SUPABASE_* are absent).

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
