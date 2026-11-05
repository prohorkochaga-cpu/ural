import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Простейшая конфигурация: приложение обращается к API «Проценка» напрямую
// (сервис отдаёт Access-Control-Allow-Origin: *), поэтому прокси не нужен.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
})