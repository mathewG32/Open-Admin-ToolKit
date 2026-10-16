// Bundles the dashboard page (client/main.tsx) into public/app.js + public/app.css.
// Uses the BUILT @openadminkit/react package, exactly as an adopter would.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: { app: 'client/main.tsx' },
  outdir: 'public',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});
