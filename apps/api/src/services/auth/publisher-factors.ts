import {
  ADMIN_CHALLENGE_TTL_SECONDS,
  ADMIN_LOGIN_OTP_MAX_REQUESTS,
  ADMIN_LOGIN_OTP_WINDOW_SECONDS,
  generateSessionToken,
  hashToken,
} from '@local-events/auth';
import type { LoginPublisherTotpRequired } from '@local-events/contracts';
import { randomBytes } from 'node:crypto';
import { createEmailWindowLimit } from './rate-limit';
import { AuthError, type AuthEnv } from './types';

export function createPublisherLoginFactors(env: AuthEnv) {
  const includeLoginOtp = env.includeLoginOtp ?? env.includeVerificationToken;
  const otpPepper = env.otpPepper ?? randomBytes(32).toString('hex');
  const challenges = new Map<string, { accountId: string; expiresAt: Date }>();
  const otpAttempts = new Map<string, number>();
  const allowOtpRequest = createEmailWindowLimit({
    now: env.now,
    windowSeconds: ADMIN_LOGIN_OTP_WINDOW_SECONDS,
    max: ADMIN_LOGIN_OTP_MAX_REQUESTS,
  });

  function purge(at: Date) {
    for (const [key, challenge] of challenges) {
      if (challenge.expiresAt <= at) challenges.delete(key);
    }
  }

  function beginTotpChallenge(
    accountId: string,
    at: Date,
  ): {
    status: 'totp_required';
    body: LoginPublisherTotpRequired;
  } {
    purge(at);
    const challengeToken = generateSessionToken();
    challenges.set(hashToken(challengeToken), {
      accountId,
      expiresAt: new Date(at.getTime() + ADMIN_CHALLENGE_TTL_SECONDS * 1000),
    });
    return { status: 'totp_required', body: { status: 'totp_required', challengeToken } };
  }

  function readTotpChallenge(token: string, at: Date): string {
    purge(at);
    const challenge = challenges.get(hashToken(token));
    if (!challenge || challenge.expiresAt <= at) throw new AuthError('challenge_expired');
    return challenge.accountId;
  }

  function dropTotpChallenge(token: string): void {
    challenges.delete(hashToken(token));
  }

  return {
    includeLoginOtp,
    otpPepper,
    otpAttempts,
    allowOtpRequest,
    beginTotpChallenge,
    readTotpChallenge,
    dropTotpChallenge,
  };
}
