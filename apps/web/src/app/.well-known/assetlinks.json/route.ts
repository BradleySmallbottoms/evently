export const dynamic = 'force-dynamic';

const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE ?? 'se.candybanana.lcly';

/**
 * Android App Links Digital Asset Links.
 * Served only when ANDROID_SHA256_CERT_FINGERPRINTS is set (comma-separated).
 */
export async function GET() {
  const fingerprints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (fingerprints.length === 0) {
    return new Response('Not configured', { status: 404 });
  }

  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
