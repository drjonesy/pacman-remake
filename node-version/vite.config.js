import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import leaderboard from './server/vite-plugin-leaderboard.js';

export default defineConfig({
  plugins: [react(), leaderboard()],
  server: {
    open: true,
  },
});
