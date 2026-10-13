import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';

function auth(identity: StoredIdentity) {
  return { Authorization: `Bearer ${identity.sessionToken}` };
}

export async function listSubscriptions(identity: StoredIdentity) {
  return throwIfError(await api.GET('/me/subscriptions', { headers: auth(identity) }));
}

export async function followTarget(
  identity: StoredIdentity,
  targetType: 'publisher' | 'event',
  targetId: string,
) {
  return throwIfError(
    await api.POST('/me/subscriptions', {
      headers: auth(identity),
      body: { targetType, targetId },
    }),
  );
}

export async function unfollowTarget(
  identity: StoredIdentity,
  targetType: 'publisher' | 'event',
  targetId: string,
) {
  throwIfError(
    await api.DELETE('/me/subscriptions/{targetType}/{targetId}', {
      params: { path: { targetType, targetId } },
      headers: auth(identity),
    }),
  );
}
