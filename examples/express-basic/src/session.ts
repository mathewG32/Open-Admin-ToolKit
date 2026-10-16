import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { STAFF, type StaffName } from './data.js';

/**
 * A deliberately tiny stand-in for the host app's existing session system
 * (express-session, Passport, Auth.js, a JWT verifier...). OpenAdmin Kit
 * doesn't care which one you use — it only calls `currentStaff(req)`.
 */

const COOKIE = 'demo_sid';
const sessions = new Map<string, StaffName>();

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function login(res: Response, who: StaffName): void {
  const sid = randomBytes(32).toString('base64url');
  sessions.set(sid, who);
  res.cookie(COOKIE, sid, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
}

export function logout(req: Request, res: Response): void {
  const sid = readCookie(req, COOKIE);
  if (sid) sessions.delete(sid);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Returns the verified staff identity for this request, or null. */
export function currentStaff(req: Request): { id: string; roles: string[] } | null {
  const sid = readCookie(req, COOKIE);
  if (!sid) return null;
  const who = sessions.get(sid);
  if (!who) return null;
  const staff = STAFF[who];
  return { id: staff.id, roles: [...staff.roles] };
}

export function isStaffName(value: unknown): value is StaffName {
  return typeof value === 'string' && Object.hasOwn(STAFF, value);
}
