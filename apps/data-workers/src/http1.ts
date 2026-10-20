import { spawn } from 'node:child_process';

/** Marker stripped before the request is sent. Node's fetch is challenged by this host. */
export const HTTP1_HEADER = 'x-local-events-http1';
const DESTINATION_HALSINGLAND_HOST = 'visit.destinationhalsingland.se';
/** The user agent curl sends. Cloudflare challenges Node and a bare curl HTTP/2 client. */
export const DESTINATION_HALSINGLAND_USER_AGENT = 'PostmanRuntime/2.11.0';

const STATUS_MARK = '\n__LOCAL_EVENTS_CURL_STATUS__:';

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key === HTTP1_HEADER) return;
    record[key] = value;
  });
  return record;
}

/**
 * Node fetch for other hosts. `visit.destinationhalsingland.se` goes through curl,
 * because Cloudflare answers Node's TLS fingerprint with a challenge page.
 */
export function fetchPublicDocument(
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
  base: typeof fetch,
  curl: typeof http1Fetch = http1Fetch,
): Promise<Response> {
  const url = requestUrl(input);
  if (url?.hostname.toLowerCase() !== DESTINATION_HALSINGLAND_HOST) return base(input, init);
  const headers = new Headers(init?.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', DESTINATION_HALSINGLAND_USER_AGENT);
  return curl(url, { ...init, headers });
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL | undefined {
  try {
    if (typeof input === 'string' || input instanceof URL) return new URL(input);
    return new URL(input.url);
  } catch {
    return undefined;
  }
}

/**
 * The calendar host answers Node's TLS fingerprint with a Cloudflare challenge, including
 * HTTP/1.1. curl over HTTP/1.1 receives the page. Redirects are not followed.
 */
export function http1Fetch(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const headers = headerRecord(new Headers(init?.headers));
  const userAgent = headers['user-agent'];
  delete headers['user-agent'];
  const args = [
    '--http1.1',
    '--silent',
    '--show-error',
    '--max-time',
    '30',
    '--max-redirs',
    '0',
    '--url',
    url.href,
  ];
  if (userAgent) args.push('-A', userAgent);
  for (const [key, value] of Object.entries(headers)) args.push('-H', `${key}: ${value}`);
  args.push('-w', `${STATUS_MARK}%{http_code}`);

  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const abort = () => child.kill();
    if (init?.signal?.aborted) abort();
    else init?.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('curl is required to fetch the Destination Hälsingland calendar'));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      if (init?.signal?.aborted) {
        reject(new DOMException('The operation was aborted', 'AbortError'));
        return;
      }
      const output = Buffer.concat(stdout).toString('utf8');
      const mark = output.lastIndexOf(STATUS_MARK);
      if (code !== 0 || mark < 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(detail || `curl exited ${code}`));
        return;
      }
      const status = Number(output.slice(mark + STATUS_MARK.length).trim());
      const body = output.slice(0, mark);
      resolve(new Response(body, { status: Number.isInteger(status) ? status : 0 }));
    });
  });
}
