import { DatabaseSync } from 'node:sqlite';

/**
 * A fictional reseller-inventory SaaS ("Shelfwise") with customers, orders,
 * staff, and a persisted audit log. Everything here is generated demo data.
 *
 * This file stands in for YOUR application's database. OpenAdmin Kit never
 * creates or migrates tables; the host app owns its schema.
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS staff (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  roles      TEXT NOT NULL            -- comma-separated, e.g. "admin" or "support"
);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  plan           TEXT NOT NULL CHECK (plan IN ('free', 'pro', 'team')),
  status         TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  country        TEXT NOT NULL,
  created_at     TEXT NOT NULL,        -- ISO-8601 UTC
  password_hash  TEXT NOT NULL,        -- never declared as an admin field
  api_token      TEXT                  -- never declared as an admin field
);
CREATE INDEX IF NOT EXISTS users_created ON users (created_at, id);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  status        TEXT NOT NULL CHECK (status IN ('paid', 'refunded', 'pending')),
  item          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at, id);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id       TEXT PRIMARY KEY,
  timestamp      TEXT NOT NULL,
  actor_id       TEXT,
  action         TEXT NOT NULL,
  resource_type  TEXT,
  resource_id    TEXT,
  tenant_id      TEXT,
  outcome        TEXT NOT NULL,
  request_id     TEXT NOT NULL,
  metadata       TEXT NOT NULL        -- JSON
);
CREATE INDEX IF NOT EXISTS audit_time ON audit_events (timestamp, event_id);
`;

/** Small deterministic PRNG so every fresh database has the same shape. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ana', 'Ben', 'Carla', 'Dev', 'Eli', 'Fatima', 'Gus', 'Hana', 'Ivan', 'Jo', 'Kai', 'Luz', 'Mo', 'Nia', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tomás'];
const LAST = ['Rivera', 'Chen', 'Okafor', 'Silva', 'Novak', 'Haddad', 'Kim', 'Moreau', 'Patel', 'Lopez', 'Nguyen', 'Garcia', 'Ali', 'Kowalski'];
const COUNTRIES = ['US', 'US', 'US', 'MX', 'CA', 'GB', 'DE', 'BR', 'ES', 'CO'];
const ITEMS = ['Vintage denim jacket', 'Graded trading card', 'Retro console bundle', 'Sneakers (used)', 'Mechanical keyboard', 'Manga box set', 'Vinyl record lot', 'Camera lens', 'Gaming GPU', 'Band tee'];

export const DEMO_STAFF = [
  { id: 'staff_admin', email: 'admin@shelfwise.test', name: 'Avery Admin', roles: 'admin' },
  { id: 'staff_support', email: 'support@shelfwise.test', name: 'Sky Support', roles: 'support' },
  { id: 'staff_analyst', email: 'analyst@shelfwise.test', name: 'Ari Analyst', roles: 'analyst' },
] as const;

export const SEED_USERS = 480;
const DAY = 86_400_000;

/** Opens (and if needed, creates and seeds) the database. Use ':memory:' for tests. */
export function openDatabase(file = ':memory:', now = new Date()): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (n === 0) seed(db, now);
  return db;
}

function seed(db: DatabaseSync, now: Date) {
  const rand = mulberry32(20261016);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;
  // Anchor the data to "now" so the dashboard always shows recent activity, never future rows.
  const end = now.getTime() - 60_000;
  const start = end - 180 * DAY;

  db.exec('BEGIN');
  try {
    const staff = db.prepare('INSERT INTO staff (id, email, name, roles) VALUES (?, ?, ?, ?)');
    for (const s of DEMO_STAFF) staff.run(s.id, s.email, s.name, s.roles);

    const user = db.prepare(
      'INSERT INTO users (id, email, name, plan, status, country, created_at, password_hash, api_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const userCreated: { id: string; at: number; plan: string }[] = [];
    for (let i = 0; i < SEED_USERS; i++) {
      // Steady growth: signups lean gently toward recent months.
      const t = start + rand() ** 0.8 * (end - start);
      const first = pick(FIRST);
      const last = pick(LAST);
      const id = `usr_${String(i + 1).padStart(4, '0')}`;
      const r = rand();
      const plan = r < 0.62 ? 'free' : r < 0.9 ? 'pro' : 'team';
      const status = rand() < 0.06 ? 'suspended' : 'active';
      user.run(
        id,
        `${first.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.${last.toLowerCase()}${i + 1}@example.test`,
        `${first} ${last}`,
        plan,
        status,
        pick(COUNTRIES),
        new Date(t).toISOString(),
        `$argon2id$v=19$DEMO-NOT-A-REAL-HASH-${i}`,
        rand() < 0.3 ? `sk_demo_${i}_DO_NOT_LEAK` : null,
      );
      userCreated.push({ id, at: t, plan });
    }

    const order = db.prepare('INSERT INTO orders (id, user_id, amount_cents, status, item, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    let o = 0;
    for (const u of userCreated) {
      // Order count scales with how long the customer has been around, so older
      // customers keep buying and recent periods aren't artificially crowded.
      const months = (end - u.at) / (30 * DAY);
      const count = Math.round(rand() * months * (u.plan === 'free' ? 0.8 : 2.2));
      for (let k = 0; k < count; k++) {
        const at = u.at + rand() * (end - u.at);
        const amount = Math.round((8 + rand() ** 2 * 240) * 100);
        const s = rand();
        order.run(
          `ord_${String(++o).padStart(5, '0')}`,
          u.id,
          amount,
          s < 0.88 ? 'paid' : s < 0.95 ? 'refunded' : 'pending',
          pick(ITEMS),
          new Date(Math.min(at, end)).toISOString(),
        );
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
