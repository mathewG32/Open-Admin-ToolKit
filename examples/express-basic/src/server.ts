import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const { app } = createApp({
  metricsEnabled: process.env.DISABLE_METRICS !== '1',
  logAudit: process.env.AUDIT_LOG === '1',
});

// Bind to localhost by default: this is a demo with fake logins.
const host = process.env.HOST ?? '127.0.0.1';
app.listen(port, host, () => {
  console.log(`OpenAdmin Kit demo running at http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`);
  console.log('Admin API mounted at /internal/admin/api');
});
