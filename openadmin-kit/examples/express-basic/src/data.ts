/**
 * Stand-in for the host application's own database and services.
 * Everything here is fake demo data — no real people, no real secrets.
 */

export type HostUser = {
  id: string;
  email: string;
  displayName: string;
  plan: 'free' | 'pro';
  status: 'active' | 'suspended';
  createdAt: Date;
  // Fields that must never reach the admin UI. The resource below doesn't declare
  // them, so OpenAdmin Kit drops them even though the "database" returns them.
  passwordHash: string;
  resetToken: string | null;
};

const FIRST = ['Ana', 'Ben', 'Carla', 'Dev', 'Eli', 'Fatima', 'Gus', 'Hana', 'Ivan', 'Jo', 'Kai', 'Luz'];
const LAST = ['Rivera', 'Chen', 'Okafor', 'Silva', 'Novak', 'Haddad', 'Kim', 'Moreau', 'Patel', 'Lopez'];

export const USERS: HostUser[] = Array.from({ length: 120 }, (_, i) => {
  const first = FIRST[i % FIRST.length]!;
  const last = LAST[(i * 7) % LAST.length]!;
  return {
    id: `usr_${String(i + 1).padStart(4, '0')}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${i + 1}@example.test`,
    displayName: `${first} ${last}`,
    plan: i % 4 === 0 ? 'pro' : 'free',
    status: i % 9 === 0 ? 'suspended' : 'active',
    createdAt: new Date(Date.UTC(2026, 6, 1) + i * 18 * 3600 * 1000),
    passwordHash: `$argon2id$v=19$DEMO-NOT-A-REAL-HASH-${i}`,
    resetToken: i % 10 === 0 ? `rst_DEMO_${i}` : null,
  };
});

/** Demo staff accounts. In a real app these are your existing users with an admin role. */
export const STAFF = {
  admin: { id: 'staff_admin', roles: ['admin'] },
  support: { id: 'staff_support', roles: ['support'] },
  viewer: { id: 'staff_viewer', roles: ['viewer'] },
} as const;

export type StaffName = keyof typeof STAFF;
