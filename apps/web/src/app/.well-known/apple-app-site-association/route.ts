export const dynamic = 'force-dynamic';

const IOS_BUNDLE_ID = process.env.IOS_BUNDLE_ID ?? 'se.example.localevents';

/**
 * Apple Universal Links association.
 * Served only when APPLE_TEAM_ID is set (production / staging).
 */
export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  if (!teamId) {
    return new Response('Not configured', { status: 404 });
  }

  const appID = `${teamId}.${IOS_BUNDLE_ID}`;
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
