type ApiErrorLike = {
  name?: string;
  status?: number;
  code?: string;
};

/**
 * The stored device credential no longer maps to an active user.
 * `invalid_credentials` (401): device revoked or the user/device row is gone.
 * `user_banned` (403): the user was inactivated.
 * Any other failure, including the network, is left alone.
 */
export function isRejectedIdentity(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as ApiErrorLike;
  if (candidate.name !== 'ApiError') return false;
  return (
    candidate.status === 401 ||
    candidate.code === 'invalid_credentials' ||
    candidate.code === 'user_banned'
  );
}
