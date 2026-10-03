import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { prisma } from '@/server/db';
import { SessionUser } from '@/types';
import { unauthorizedError } from '@/lib/errors';

const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-change-in-production-min-32-chars-long';
const SESSION_COOKIE = 'session';
const TOKEN_EXPIRY = '7d';
const SALT_ROUNDS = 10;

// ─── Password ────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── JWT ─────────────────────────────────────────────────────

export function createToken(user: SessionUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, globalRole: user.globalRole },
    AUTH_SECRET,
    { expiresIn: TOKEN_EXPIRY },
  );
}

export function verifyToken(token: string): SessionUser {
  try {
    const payload = jwt.verify(token, AUTH_SECRET) as SessionUser;
    return payload;
  } catch {
    throw unauthorizedError('Invalid or expired session');
  }
}

// ─── Session ─────────────────────────────────────────────────

export async function setSession(user: SessionUser): Promise<void> {
  const token = createToken(user);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return verifyToken(token);
  } catch {
    return null;
  }
}

/**
 * Requires authentication. Throws 401 if no valid session.
 */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) {
    throw unauthorizedError();
  }
  return user;
}

// ─── Login ───────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<SessionUser> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw unauthorizedError('Invalid email or password');
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    throw unauthorizedError('Invalid email or password');
  }

  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    globalRole: user.globalRole,
  };

  await setSession(sessionUser);
  return sessionUser;
}
