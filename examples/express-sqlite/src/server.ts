import { openDatabase } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
// Bind to localhost by default: this demo has one-click logins.
const host = process.env.HOST ?? '127.0.0.1';
// DB_FILE=./shelfwise.db keeps data (and the audit log) between restarts. Default is in-memory.
const db = openDatabase(process.env.DB_FILE ?? ':memory:');
const app = createApp({ db, logAudit: process.env.AUDIT_LOG === '1' });

app.listen(port, host, () => {
  const shown = host === '127.0.0.1' ? 'localhost' : host;
  console.log(`Shelfwise admin demo: http://${shown}:${port}/admin`);
  console.log(`Database: ${process.env.DB_FILE ?? 'in-memory (set DB_FILE to persist)'}`);
});
