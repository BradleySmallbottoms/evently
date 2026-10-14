import { ADMIN_SESSION_COOKIE } from '@local-events/auth';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

export function readAdminSessionToken(c: Context): string | undefined {
  const header = c.req.header('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (token.length > 0) return token;
  }
  const cookie = getCookie(c, ADMIN_SESSION_COOKIE);
  return cookie;
}

export function setAdminSessionCookie(c: Context, token: string, expiresAt: Date): void {
  setCookie(c, ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearAdminSessionCookie(c: Context): void {
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: '/' });
}
