import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * Reads one object from a Garage website endpoint.
 * `fetch` is not allowed to set Host, and Garage picks the bucket from that header.
 */
export function readWebsiteObject(input: {
  origin: string;
  host: string;
  key: string;
  maxBytes: number;
}): Promise<Buffer | null> {
  const url = new URL(`${input.origin.replace(/\/$/, '')}/${input.key}`);
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    const req = request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { host: input.host },
        timeout: 10_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const tooLarge = () => {
          response.destroy();
          resolve(null);
        };
        const advertised = Number(response.headers['content-length'] ?? 0);
        if (response.statusCode !== 200 || advertised > input.maxBytes) {
          response.resume();
          resolve(null);
          return;
        }
        response.on('data', (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > input.maxBytes) {
            tooLarge();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (size < 1) {
            resolve(null);
            return;
          }
          resolve(Buffer.concat(chunks));
        });
        response.on('error', () => resolve(null));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}
