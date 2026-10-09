import { APP_USER_SESSION_COOKIE, PUBLISHER_SESSION_COOKIE } from '@local-events/auth';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

export function readPublisherSessionToken(c: Context): string | undefined {
  return getCookie(c, PUBLISHER_SESSION_COOKIE);
}

export function setPublisherSessionCookie(c: Context, token: string, expiresAt: Date): void {
  setCookie(c, PUBLISHER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearPublisherSessionCookie(c: Context): void {
  deleteCookie(c, PUBLISHER_SESSION_COOKIE, { path: '/' });
}

export function readAppUserSessionToken(c: Context): string | undefined {
  return getCookie(c, APP_USER_SESSION_COOKIE);
}

/** Bearer token (mobile) or app-user pairing cookie (web). */
export function readUserSessionToken(c: Context): string | undefined {
  const header = c.req.header('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (token.length > 0) return token;
  }
  return readAppUserSessionToken(c);
}

export function setAppUserSessionCookie(c: Context, token: string, expiresAt: Date): void {
  setCookie(c, APP_USER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearAppUserSessionCookie(c: Context): void {
  deleteCookie(c, APP_USER_SESSION_COOKIE, { path: '/' });
}
