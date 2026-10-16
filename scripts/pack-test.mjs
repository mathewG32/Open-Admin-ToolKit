#!/usr/bin/env node
/**
 * Packed-package consumer test (OA-064).
 *
 * Proves the packages work the way a stranger will get them, not via monorepo
 * symlinks or source aliases:
 *   1. build and `pnpm pack` each package (workspace:* is rewritten to a version)
 *   2. inspect each tarball: only dist/, README, LICENSE, package.json allowed
 *   3. create a throwaway app OUTSIDE the repo and `npm install` the tarballs
 *   4. typecheck a TypeScript consumer against the installed .d.ts files
 *   5. run a real Express server from the installed packages and hit it over HTTP
 *
 * Usage: node scripts/pack-test.mjs   (run after `pnpm install`)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packages = ['core', 'express'];
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const step = (msg) => console.log(`\n▸ ${msg}`);

const work = mkdtempSync(join(tmpdir(), 'openadmin-pack-'));
const tarballs = join(work, 'tarballs');
const app = join(work, 'consumer');

try {
  step('Building packages');
  run('pnpm', ['build'], root);

  step('Packing');
  const tgz = {};
  for (const name of packages) {
    run('pnpm', ['pack', '--pack-destination', tarballs], join(root, 'packages', name));
  }
  for (const file of readdirSync(tarballs)) {
    const name = packages.find((p) => file.startsWith(`openadminkit-${p}-`));
    if (name) tgz[name] = join(tarballs, file);
  }
  for (const name of packages) if (!tgz[name]) throw new Error(`No tarball produced for ${name}`);

  step('Inspecting tarball contents');
  const allowed = /^package\/(dist\/.+|README\.md|LICENSE|package\.json)$/;
  for (const [name, file] of Object.entries(tgz)) {
    const entries = run('tar', ['-tzf', file]).trim().split('\n');
    const bad = entries.filter((e) => !allowed.test(e));
    if (bad.length) throw new Error(`${name} tarball contains unexpected files:\n  ${bad.join('\n  ')}`);
    for (const required of ['package/dist/index.js', 'package/dist/index.d.ts', 'package/LICENSE', 'package/README.md']) {
      if (!entries.includes(required)) throw new Error(`${name} tarball is missing ${required}`);
    }
    const manifest = JSON.parse(run('tar', ['-xzOf', file, 'package/package.json']));
    if (JSON.stringify(manifest).includes('workspace:')) throw new Error(`${name} package.json still contains a workspace: protocol`);
    console.log(`  ${name}: ${entries.length} files, OK`);
  }

  step('Installing tarballs into an external app');
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({
    name: 'openadmin-consumer-fixture',
    private: true,
    type: 'module',
    dependencies: {
      '@openadminkit/core': `file:${tgz.core}`,
      '@openadminkit/express': `file:${tgz.express}`,
      express: '^5.1.0',
    },
    // The express tarball depends on core by version; point that at the local tarball too.
    overrides: { '@openadminkit/core': '$@openadminkit/core' },
    devDependencies: { '@types/express': '^5.0.0', '@types/node': '^22.10.0' },
  }, null, 2));
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], app);
  // Exactly one copy of core, and it must be OUR tarball (not something fetched from the registry).
  if (existsSync(join(app, 'node_modules/@openadminkit/express/node_modules/@openadminkit/core'))) {
    throw new Error('express resolved a second copy of @openadminkit/core');
  }
  const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8'));
  const resolved = lock.packages?.['node_modules/@openadminkit/core']?.resolved ?? '';
  if (!resolved.startsWith('file:')) throw new Error(`@openadminkit/core resolved from "${resolved}", expected the local tarball`);
  console.log('  single local copy of core: OK');

  step('Typechecking a TypeScript consumer against installed types');
  writeFileSync(join(app, 'consumer.ts'), `
import express from 'express';
import { createRolePolicy, defineAdminModule, defineResource, type AdminActor } from '@openadminkit/core';
import { createExpressAdmin } from '@openadminkit/express';

const users = defineResource<{ id: string; email: string; passwordHash: string }>({
  id: 'users', label: 'Users', permissionPrefix: 'users', idField: 'id',
  fields: { id: { type: 'string' }, email: { type: 'string', filterable: true } },
  list: async (_ctx, q) => ({ items: [{ id: 'u1', email: 'a@example.test', passwordHash: 'SECRET' }].slice(0, q.limit) }),
});
const actor: AdminActor = { id: 'admin', roles: ['admin'] };
const app = express();
app.use('/admin/api', createExpressAdmin({
  authenticate: (req) => (req.get('authorization') === 'Bearer ok' ? actor : null),
  authorize: createRolePolicy({ admin: ['users.read'] }),
  audit: () => {},
  modules: [defineAdminModule({ id: 'users', label: 'Users', permissions: ['users.read'], resources: [users] })],
}));
export default app;
`);
  writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, types: ['node'] },
    files: ['consumer.ts'],
  }));
  run(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], app);
  console.log('  types OK');

  step('Running a real server from the installed packages');
  writeFileSync(join(app, 'smoke.mjs'), `
import express from 'express';
import { createRolePolicy, defineAdminModule, defineResource } from '@openadminkit/core';
import { createExpressAdmin } from '@openadminkit/express';

const users = defineResource({
  id: 'users', label: 'Users', permissionPrefix: 'users', idField: 'id',
  fields: { id: { type: 'string' }, email: { type: 'string' } },
  list: async () => ({ items: [{ id: 'u1', email: 'a@example.test', passwordHash: 'SECRET' }] }),
});
const app = express();
app.use('/admin/api', createExpressAdmin({
  authenticate: (req) => (req.get('authorization') === 'Bearer ok' ? { id: 'admin', roles: ['admin'] } : null),
  authorize: createRolePolicy({ admin: ['users.read'] }),
  audit: () => {},
  modules: [defineAdminModule({ id: 'users', label: 'Users', permissions: ['users.read'], resources: [users] })],
}));
const server = app.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port + '/admin/api/resources/users';
  const anon = await fetch(base);
  const ok = await fetch(base, { headers: { authorization: 'Bearer ok' } });
  const body = await ok.text();
  server.close();
  if (anon.status !== 401) throw new Error('expected 401, got ' + anon.status);
  if (ok.status !== 200) throw new Error('expected 200, got ' + ok.status);
  if (body.includes('SECRET')) throw new Error('undeclared field leaked');
  console.log('  401 anonymous, 200 authorized, no leaked fields: OK');
});
`);
  console.log(run(process.execPath, ['smoke.mjs'], app).trimEnd());

  console.log('\n✔ Packed-package consumer test passed');
} finally {
  rmSync(work, { recursive: true, force: true });
}
