import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Web deploy must use absolute `/` so deep links like /employees/:id
// still load /assets/*.js after refresh. Capacitor mobile builds keep `./`.
const isCapacitorBuild = process.env.CAPACITOR_BUILD === '1'

export default defineConfig({
  plugins: [react()],
  base: isCapacitorBuild ? './' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
})
