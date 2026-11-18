import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, RequestHandler } from 'express';

function resolvePort(): number {
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--port' && process.argv[i + 1]) {
      const n = Number(process.argv[i + 1]);
      if (Number.isFinite(n) && n > 0) return n;
    } else if (arg.startsWith('--port=')) {
      const n = Number(arg.slice(7));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const envPort = Number(process.env.PORT || 3000);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

const PORT = resolvePort();
let viteInstance: { middlewares: RequestHandler; close: () => Promise<void> } | null = null;

async function initializeApp(): Promise<Express> {
  const isProd =
    process.env.NODE_ENV === 'production' &&
    fs.existsSync(path.resolve(process.cwd(), 'dist/index.html'));

  const appModulePromise = import('./server/app.ts');
  const hmrEnabled = process.env.DISABLE_HMR !== 'true';
  const vitePromise = isProd
    ? Promise.resolve(null)
    : import('vite').then(({ createServer: createViteServer }) =>
        createViteServer({
          server: {
            middlewareMode: true,
            hmr: hmrEnabled,
            ws: hmrEnabled ? undefined : false,
          },
          appType: 'spa',
        })
      );

  const [{ createApiApp, getDemoSeed }, vite] = await Promise.all([
    appModulePromise,
    vitePromise,
  ]);

  const app = createApiApp();

  if (isProd) {
    const express = (await import('express')).default;
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else if (vite) {
    viteInstance = vite;
    app.use(vite.middlewares);
  }

  // Ensure demo seed is ready in background without blocking HTTP requests
  void getDemoSeed().catch((err) => {
    console.error('Demo seed check failed:', err);
  });

  return app;
}

let resolveAppPromise!: (handler: Express) => void;
let rejectAppPromise!: (err: unknown) => void;
const appPromise = new Promise<Express>((resolve, reject) => {
  resolveAppPromise = resolve;
  rejectAppPromise = reject;
});

function startBackgroundInit(): void {
  initializeApp().then(resolveAppPromise).catch((err) => {
    console.error('Failed to initialize application:', err);
    rejectAppPromise(err);
  });
}

const server = http.createServer((req, res) => {
  appPromise
    .then((app) => {
      app(req as Parameters<Express>[0], res as Parameters<Express>[1], (err?: unknown) => {
        if (err) {
          console.error('Unhandled Express error:', err);
        }
        if (!res.headersSent) {
          res.statusCode = err ? 500 : 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err ? 'Internal server error.' : 'Not found.' }));
        }
      });
    })
    .catch((err) => {
      console.error('Request handling failed during startup:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Server initialization error.' }));
      }
    });
});

let listenHost: string | undefined = undefined;
let retries = 0;

server.on('error', (err: NodeJS.ErrnoException) => {
  if ((err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT') && listenHost !== '0.0.0.0') {
    listenHost = '0.0.0.0';
    server.listen(PORT, '0.0.0.0');
    return;
  }
  if (err.code === 'EADDRINUSE' && retries < 20) {
    retries++;
    setTimeout(() => {
      try {
        server.close();
      } catch {
        // ignore
      }
      if (listenHost) {
        server.listen(PORT, listenHost);
      } else {
        server.listen(PORT);
      }
    }, 200);
    return;
  }
  console.error('Server listen error:', err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Voice of Customer Copilot running on http://localhost:${PORT} (0.0.0.0:${PORT})`);
  setImmediate(startBackgroundInit);
});

const shutdown = () => {
  server.closeAllConnections?.();
  server.close();
  if (viteInstance) {
    void viteInstance.close().catch(() => {});
  }
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in server:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection in server:', err);
});
