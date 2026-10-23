/**
 * Base URL for server-rendered fetches, including the `/v1` prefix.
 * On the test server `API_URL` is the address on the Docker network. The browser
 * keeps `NEXT_PUBLIC_API_URL`, which is baked in when the image is built.
 */
export function serverApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const internal = env.API_URL?.trim();
  const base = internal || env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:13000/v1';
  return base.replace(/\/$/, '');
}
