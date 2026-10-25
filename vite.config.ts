import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

/**
 * Stamps the copied `dist/sw.js` with a unique build id so every deploy
 * activates a fresh service-worker cache instead of serving stale assets.
 */
function serviceWorkerVersion(): Plugin {
  return {
    name: 'tasker-sw-version',
    apply: 'build',
    closeBundle() {
      const swPath = fileURLToPath(new URL('./dist/sw.js', import.meta.url));
      if (!existsSync(swPath)) return;
      const buildId = `${Date.now().toString(36)}-${pkg.version}`;
      writeFileSync(swPath, readFileSync(swPath, 'utf8').replace('__BUILD_ID__', buildId));
    },
  };
}

/**
 * The build is fully self-describing: `mode` selects Vite's native `.env`
 * files, and the constants below are inlined into the bundle so the running
 * app can report exactly which build it is. No server-side configuration is
 * required — Tasker deploys as static files.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react(), serviceWorkerVersion()],

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_MODE__: JSON.stringify(mode),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },

  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },

  server: {
    port: 5173,
    strictPort: false,
  },

  preview: {
    port: 4173,
  },
}));
