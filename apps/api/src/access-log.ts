import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_REQUEST_ID_LENGTH = 255;
/** Same shape Hono's request-id middleware accepts: no spaces or control characters. */
const SAFE_REQUEST_ID = /^[\w\-=]+$/;

/** `TIMESTAMP - GET - /path?params - requestId - IP` */
export type AccessLogWriter = (line: string) => void;

function defaultAccessLog(line: string): void {
  if (process.env.VITEST) return;
  console.log(line);
}

function requestIdFrom(header: string | undefined): string {
  if (header && header.length <= MAX_REQUEST_ID_LENGTH && SAFE_REQUEST_ID.test(header)) {
    return header;
  }
  return crypto.randomUUID();
}

function normalizeIp(ip: string): string {
  const unbracketed = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  return unbracketed.startsWith('::ffff:') ? unbracketed.slice('::ffff:'.length) : unbracketed;
}

function firstForwardedIp(header: string | undefined): string | null {
  const first = header?.split(',')[0]?.trim();
  return first ? normalizeIp(first) : null;
}

function clientIp(c: Context): string | null {
  const forwarded = firstForwardedIp(c.req.header('x-forwarded-for'));
  if (forwarded) return forwarded;
  const realIp = c.req.header('x-real-ip')?.trim();
  if (realIp) return normalizeIp(realIp);
  try {
    const address = getConnInfo(c).remote.address;
    return address ? normalizeIp(address) : null;
  } catch {
    return null;
  }
}

function formatAccessLog(input: {
  time: string;
  method: string;
  path: string;
  search: string;
  requestId: string;
  ip: string | null;
}): string {
  const target = input.search ? `${input.path}${input.search}` : input.path;
  return `${input.time} - ${input.method} - ${target} - ${input.requestId} - ${input.ip ?? '-'}`;
}

/** One line per call: TIMESTAMP - METHOD - /path?params - requestId - IP */
export function accessLog(log: AccessLogWriter = defaultAccessLog): MiddlewareHandler {
  return async (c, next) => {
    const requestId = requestIdFrom(c.req.header(REQUEST_ID_HEADER));
    c.header('X-Request-Id', requestId);
    const time = new Date().toISOString();
    const ip = clientIp(c);
    try {
      await next();
    } finally {
      try {
        log(
          formatAccessLog({
            time,
            method: c.req.method,
            path: c.req.path,
            search: new URL(c.req.url).search,
            requestId,
            ip,
          }),
        );
      } catch {
        // A broken log sink must not fail the request.
      }
    }
  };
}
