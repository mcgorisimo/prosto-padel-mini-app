import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: '/', // Use root-relative paths for all assets
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: true,
  },
}));
