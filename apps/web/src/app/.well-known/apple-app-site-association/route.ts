import { connection } from 'next/server';

/**
 * Apple Universal Links association.
 * Served only when APPLE_TEAM_ID is set (production / staging).
 * `connection()` keeps the team id out of the build and reads it per request.
 */
export async function GET() {
  await connection();
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  if (!teamId) {
    return new Response('Not configured', { status: 404 });
  }

  const bundleId = process.env.IOS_BUNDLE_ID ?? 'se.candybanana.lcly';
  const appID = `${teamId}.${bundleId}`;
  const body = {
    applinks: {
      apps: [] as string[],
      details: [
        {
          appID,
          paths: ['/events/*', '/en/events/*', '/sv/events/*'],
        },
      ],
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
