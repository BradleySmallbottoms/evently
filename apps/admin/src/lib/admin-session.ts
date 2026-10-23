export const ADMIN_ME_QUERY_KEY = ['admin-me'] as const;

function isUnauthorized(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'AdminApiError' &&
    'status' in error &&
    error.status === 401
  );
}

export function isAdminSignedIn(data: unknown, error: unknown): boolean {
  if (isUnauthorized(error)) return false;
  return data != null;
}

/** What the admin shell should show for this session and path. */
export function adminShellMode(input: {
  pending: boolean;
  signedIn: boolean;
  pathname: string;
}): 'pending' | 'login' | 'redirect' | 'app' {
  if (input.pathname === '/login' && !input.signedIn) return 'login';
  if (input.pending) return 'pending';
  if (!input.signedIn) return 'redirect';
  return 'app';
}
