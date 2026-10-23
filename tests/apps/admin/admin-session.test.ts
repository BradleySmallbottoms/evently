import { describe, expect, it } from 'vitest';
import { AdminApiError } from '../../../apps/admin/src/lib/api';
import { adminShellMode, isAdminSignedIn } from '../../../apps/admin/src/lib/admin-session';

describe('isAdminSignedIn', () => {
  it('accepts a session payload', () => {
    expect(isAdminSignedIn({ adminId: 'a' }, null)).toBe(true);
  });

  it('rejects a missing session and a 401 even when cached data remains', () => {
    expect(isAdminSignedIn(undefined, null)).toBe(false);
    expect(isAdminSignedIn({ adminId: 'a' }, new AdminApiError(401, 'unauthorized', 'no'))).toBe(
      false,
    );
  });
});

describe('adminShellMode', () => {
  it('waits while the session check is in flight', () => {
    expect(adminShellMode({ pending: true, signedIn: false, pathname: '/events' })).toBe('pending');
  });

  it('shows only the login form on the login route, including while the session check is in flight', () => {
    expect(adminShellMode({ pending: false, signedIn: false, pathname: '/login' })).toBe('login');
    expect(adminShellMode({ pending: true, signedIn: false, pathname: '/login' })).toBe('login');
  });

  it('sends every other route to login when signed out', () => {
    expect(adminShellMode({ pending: false, signedIn: false, pathname: '/' })).toBe('redirect');
    expect(adminShellMode({ pending: false, signedIn: false, pathname: '/events/manage' })).toBe(
      'redirect',
    );
  });

  it('shows the app when signed in', () => {
    expect(adminShellMode({ pending: false, signedIn: true, pathname: '/review' })).toBe('app');
  });
});
