import {
  ADMIN_CHALLENGE_TTL_SECONDS,
  ADMIN_LOGIN_OTP_MAX_ATTEMPTS,
  ADMIN_LOGIN_OTP_MAX_REQUESTS,
  ADMIN_LOGIN_OTP_TTL_SECONDS,
  ADMIN_LOGIN_OTP_WINDOW_SECONDS,
  ADMIN_SESSION_TTL_SECONDS,
  decideLoginOtpConfirm,
  generateLoginOtp,
  generateSessionToken,
  generateTotpSecret,
  hashPassword,
  hashToken,
  loginOtpHash,
  loginOtpMatches,
  totpOtpauthUrl,
  verifyPassword,
  verifyTotpCode,
} from '@local-events/auth';
import type { AdminSessionResponse } from '@local-events/contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import { createEmailWindowLimit } from './rate-limit';
import { AdminAuthError, type AdminAuthServices } from './types';

const DUMMY_LOGIN_OTP_HASH = hashToken('dummy-login-otp');

export type MemoryAdminUser = {
  id: string;
  email: string;
  passwordHash: string;
  totpSecret: string | null;
  role: string;
  createdAt: Date;
};

export type MemoryAdminSession = {
  id: string;
  adminId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type MemoryAdminChallenge = {
  tokenHash: string;
  adminId: string;
  kind: 'totp' | 'setup';
  pendingSecret: string | null;
  expiresAt: Date;
};

export type MemoryAdminLoginOtp = {
  id: string;
  adminId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
};

export type AdminMemoryAuthStore = {
  admins: Map<string, MemoryAdminUser>;
  sessions: MemoryAdminSession[];
  challenges: MemoryAdminChallenge[];
  loginOtps: MemoryAdminLoginOtp[];
};

export function createAdminMemoryAuthStore(): AdminMemoryAuthStore {
  return {
    admins: new Map(),
    sessions: [],
    challenges: [],
    loginOtps: [],
  };
}

function addSeconds(d: Date, seconds: number): Date {
  return new Date(d.getTime() + seconds * 1000);
}

export function createMemoryAdminAuthServices(
  store: AdminMemoryAuthStore = createAdminMemoryAuthStore(),
  env: { now?: () => Date; includeLoginOtp?: boolean; otpPepper?: string } = {},
): AdminAuthServices {
  const now = env.now ?? (() => new Date());
  const includeLoginOtp = env.includeLoginOtp ?? false;
  const otpPepper = env.otpPepper ?? randomBytes(32).toString('hex');
  const allowOtpRequest = createEmailWindowLimit({
    now,
    windowSeconds: ADMIN_LOGIN_OTP_WINDOW_SECONDS,
    max: ADMIN_LOGIN_OTP_MAX_REQUESTS,
  });

  function issueSession(
    admin: MemoryAdminUser,
    at: Date,
  ): AdminSessionResponse & { sessionToken: string } {
    const sessionToken = generateSessionToken();
    const expiresAt = addSeconds(at, ADMIN_SESSION_TTL_SECONDS);
    store.sessions.push({
      id: randomUUID(),
      adminId: admin.id,
      tokenHash: hashToken(sessionToken),
      expiresAt,
      revokedAt: null,
    });
    return {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      expiresAt: expiresAt.toISOString(),
      sessionToken,
    };
  }

  async function requireSession(sessionToken: string | undefined) {
    if (!sessionToken) throw new AdminAuthError('unauthorized');
    const tokenHash = hashToken(sessionToken);
    const at = now();
    const session = store.sessions.find(
      (s) => s.tokenHash === tokenHash && !s.revokedAt && s.expiresAt > at,
    );
    if (!session) throw new AdminAuthError('unauthorized');
    const admin = store.admins.get(session.adminId);
    if (!admin) throw new AdminAuthError('unauthorized');
    return { adminId: admin.id, email: admin.email, role: admin.role };
  }

  return {
    async ensureBootstrapAdmin({ email, password }) {
      if (store.admins.size > 0) return { created: false };
      const id = randomUUID();
      store.admins.set(id, {
        id,
        email: email.toLowerCase(),
        passwordHash: await hashPassword(password),
        totpSecret: null,
        role: 'admin',
        createdAt: now(),
      });
      return { created: true };
    },

    async login(input) {
      const email = input.email.toLowerCase();
      const admin = [...store.admins.values()].find((a) => a.email === email);
      if (!admin || !(await verifyPassword(input.password, admin.passwordHash))) {
        throw new AdminAuthError('invalid_credentials');
      }
      const challengeToken = generateSessionToken();
      const expiresAt = addSeconds(now(), ADMIN_CHALLENGE_TTL_SECONDS);
      if (!admin.totpSecret) {
        const secret = generateTotpSecret();
        store.challenges.push({
          tokenHash: hashToken(challengeToken),
          adminId: admin.id,
          kind: 'setup',
          pendingSecret: secret,
          expiresAt,
        });
        return {
          status: 'totp_setup' as const,
          setupToken: challengeToken,
          otpauthUrl: totpOtpauthUrl({ secret, accountName: admin.email }),
          secret,
        };
      }
      store.challenges.push({
        tokenHash: hashToken(challengeToken),
        adminId: admin.id,
        kind: 'totp',
        pendingSecret: null,
        expiresAt,
      });
      return { status: 'totp_required' as const, challengeToken };
    },

    async confirmTotp(input) {
      const at = now();
      const tokenHash = hashToken(input.token);
      const challengeIdx = store.challenges.findIndex(
        (c) => c.tokenHash === tokenHash && c.expiresAt > at,
      );
      if (challengeIdx < 0) throw new AdminAuthError('challenge_expired');
      const challenge = store.challenges[challengeIdx]!;
      store.challenges.splice(challengeIdx, 1);
      const admin = store.admins.get(challenge.adminId);
      if (!admin) throw new AdminAuthError('invalid_credentials');

      if (challenge.kind === 'setup') {
        if (
          !challenge.pendingSecret ||
          !verifyTotpCode(challenge.pendingSecret, input.code, at.getTime())
        ) {
          throw new AdminAuthError('invalid_totp');
        }
        admin.totpSecret = challenge.pendingSecret;
      } else {
        if (!admin.totpSecret || !verifyTotpCode(admin.totpSecret, input.code, at.getTime())) {
          throw new AdminAuthError('invalid_totp');
        }
      }

      return issueSession(admin, at);
    },

    async requestOtp(input) {
      const email = input.email.toLowerCase();
      if (!allowOtpRequest(email)) throw new AdminAuthError('otp_rate_limited');
      const admin = [...store.admins.values()].find((a) => a.email === email);
      if (!admin) return { status: 'code_sent' as const };
      const at = now();
      for (const row of store.loginOtps) {
        if (row.adminId === admin.id && !row.usedAt) row.usedAt = at;
      }
      const code = generateLoginOtp();
      store.loginOtps.push({
        id: randomUUID(),
        adminId: admin.id,
        tokenHash: loginOtpHash(code, otpPepper),
        expiresAt: addSeconds(at, ADMIN_LOGIN_OTP_TTL_SECONDS),
        usedAt: null,
        attempts: 0,
      });
      return includeLoginOtp
        ? { status: 'code_sent' as const, code }
        : { status: 'code_sent' as const };
    },

    async confirmOtp(input) {
      const email = input.email.toLowerCase();
      const at = now();
      const admin = [...store.admins.values()].find((a) => a.email === email);
      if (!admin) {
        loginOtpMatches(input.code, otpPepper, DUMMY_LOGIN_OTP_HASH);
        throw new AdminAuthError('invalid_otp');
      }
      const open = store.loginOtps.filter((row) => row.adminId === admin.id && !row.usedAt);
      const decision = decideLoginOtpConfirm({
        code: input.code,
        pepper: otpPepper,
        records: open.map((row) => ({
          id: row.id,
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
          attempts: row.attempts,
        })),
        now: at,
        maxAttempts: ADMIN_LOGIN_OTP_MAX_ATTEMPTS,
      });
      if (!decision.ok) {
        for (const next of decision.attempts) {
          const row = store.loginOtps.find((item) => item.id === next.id);
          if (row) row.attempts = next.attempts;
        }
        for (const id of decision.burnIds) {
          const row = store.loginOtps.find((item) => item.id === id);
          if (row) row.usedAt = at;
        }
        throw new AdminAuthError(decision.code);
      }
      const matched = store.loginOtps.find((row) => row.id === decision.id && !row.usedAt);
      if (!matched) throw new AdminAuthError('invalid_otp');
      matched.usedAt = at;
      return issueSession(admin, at);
    },

    async me(sessionToken) {
      const { adminId, email, role } = await requireSession(sessionToken);
      const tokenHash = hashToken(sessionToken!);
      const session = store.sessions.find((s) => s.tokenHash === tokenHash)!;
      return {
        adminId,
        email,
        role,
        expiresAt: session.expiresAt.toISOString(),
      };
    },

    async logout(sessionToken) {
      if (!sessionToken) return;
      const tokenHash = hashToken(sessionToken);
      const session = store.sessions.find((s) => s.tokenHash === tokenHash && !s.revokedAt);
      if (session) session.revokedAt = now();
    },

    requireSession,
  };
}
