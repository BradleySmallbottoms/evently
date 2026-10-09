import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';

export async function fetchProfile(identity: StoredIdentity) {
  return throwIfError(
    await api.GET('/me/profile', {
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
    }),
  );
}

export async function updateProfile(
  identity: StoredIdentity,
  body: {
    choice: 'named' | 'anonymous';
    displayName?: string;
    recoveryEmail?: string | null;
  },
) {
  return throwIfError(
    await api.PUT('/me/profile', {
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
      body,
    }),
  );
}
