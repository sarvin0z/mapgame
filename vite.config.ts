import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Dev-server only: POST /__capture?name=x with a PNG data URL saves it to
 * data/preview/x.png, so automated visual checks work even when the browser
 * window is not on screen.
 */
function captureEndpoint(): Plugin {
  return {
    name: 'capture-endpoint',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'capture').replace(/[^\w-]/g, '');
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          mkdirSync('data/preview', { recursive: true });
          writeFileSync(`data/preview/${name}.png`, Buffer.from(body.replace(/^data:image\/png;base64,/, ''), 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any static host sub-path.
  base: './',
  plugins: [captureEndpoint()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
