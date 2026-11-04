import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { serviceWorkerPlugin } from './vite.sw.ts'

export default defineConfig({
  plugins: [react(), serviceWorkerPlugin()],
})
