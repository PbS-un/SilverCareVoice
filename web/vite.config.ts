/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  // 相對路徑：GitHub Pages 部署友好
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 所有 AI / 同步 / 即時通訊流量一律經本地 server 代理，
      // 密鑰只存在 server 端，絕不下發到前端。
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/sync': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e'],
  },
})
