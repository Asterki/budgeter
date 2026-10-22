import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

const API_PATH = '/api/check-reminders';
const API_FILE = fileURLToPath(new URL('./api/check-reminders.ts', import.meta.url));

type ApiModule = { default: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void };

/**
 * Runs the Vercel serverless handler inside the local dev / preview server so
 * the cron endpoint can be exercised without deploying. In production Vercel
 * routes `/api/*` to the same file directly.
 */
function serverlessApiDev(): Plugin {
  const attach = (server: ViteDevServer | PreviewServer) => {
    // The dev server transforms TS on the fly; the preview server serves the
    // built bundle, so it loads the handler through Node's native type stripping.
    const load: () => Promise<ApiModule> =
      'ssrLoadModule' in server
        ? async () => (await server.ssrLoadModule('/api/check-reminders.ts')) as ApiModule
        : async () => (await import(pathToFileURL(API_FILE).href)) as ApiModule;

    server.middlewares.use(API_PATH, async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const mod = await load();
        await mod.default(req, res);
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: (error as Error).message }));
      }
    });
  };

  return {
    name: 'tasker-serverless-api',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), serverlessApiDev(), serviceWorkerVersion()],

    // Environment replacement: Vite injects `import.meta.env.VITE_*` from `.env`,
    // `.env.<mode>` and `.env.<mode>.local`. Compile-time constants below are
    // inlined into the production bundle so the build is fully self-describing.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_MODE__: JSON.stringify(mode),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __VAPID_PUBLIC_KEY__: JSON.stringify(env.VITE_VAPID_PUBLIC_KEY ?? ''),
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
  };
});
