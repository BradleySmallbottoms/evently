import {
  APP_SESSION_TTL_SECONDS,
  EMAIL_VERIFICATION_TTL_SECONDS,
  generateDeviceCredential,
  generateEmailToken,
  generatePairingCode,
  generateSessionToken,
  hashPassword,
  hashToken,
  normalizePairingCode,
  PAIRING_CODE_TTL_SECONDS,
  PUBLISHER_SESSION_TTL_SECONDS,
  verifyPassword,
} from '@local-events/auth';
import type {
  CreateIdentityRequest,
  CreateSessionRequest,
  LoginPublisherRequest,
  PublisherSummary,
  RegisterPublisherRequest,
  VerifyPublisherEmailRequest,
} from '@local-events/contracts';
import { canPublisherLogin, slugifyPublisherName } from '@local-events/domain';
import { randomUUID } from 'node:crypto';
import { createMemoryStore, type MemoryStore } from '../memory-store';
import { AuthError, type AuthEnv, type AuthServices } from './types';

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

/** In-memory auth backend for unit tests (no Postgres required). */
export function createMemoryAuthServices(
  env: AuthEnv = defaultEnv(),
  store: MemoryStore = createMemoryStore(),
): AuthServices {
  const { users, devices, sessions, accounts, publishers, members, tokens } = store;

  function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  function publishersForAccount(accountId: string): PublisherSummary[] {
    return members
      .filter((m) => m.publisherAccountId === accountId)
      .map((m) => {
        const p = publishers.get(m.publisherId);
        if (!p) return null;
        return {
          id: p.id,
          name: p.name,
          slug: p.slug,
          type: p.type,
          verified: p.verified,
          role: m.role,
        };
      })
      .filter((p): p is PublisherSummary => p !== null);
  }

  async function resolvePublisherSession(sessionToken: string | undefined) {
    if (!sessionToken) throw new AuthError('unauthorized');
    const tokenHash = hashToken(sessionToken);
    const session = [...sessions.values()].find(
      (s) =>
        s.tokenHash === tokenHash &&
        s.subjectType === 'publisher_account' &&
        !s.revokedAt &&
        s.expiresAt > env.now(),
    );
    if (!session) throw new AuthError('unauthorized');
    const account = accounts.get(session.subjectId);
    if (!account) throw new AuthError('unauthorized');
    return account;
  }

  return {
    async createIdentity(input: CreateIdentityRequest) {
      const now = env.now();
      const userId = randomUUID();
      const deviceId = randomUUID();
      const deviceCredential = generateDeviceCredential();
      const sessionToken = generateSessionToken();
      const expiresAt = addSeconds(now, APP_SESSION_TTL_SECONDS);

      users.set(userId, { id: userId, createdAt: now });
      devices.set(deviceId, {
        id: deviceId,
        userId,
        credentialHash: hashToken(deviceCredential),
        platform: input.platform,
        locale: input.locale,
        revokedAt: null,
      });
      sessions.set(sessionToken, {
        id: randomUUID(),
        subjectType: 'user',
        subjectId: userId,
        tokenHash: hashToken(sessionToken),
        client: 'app',
        expiresAt,
        revokedAt: null,
      });

      return {
        userId,
        deviceId,
        deviceCredential,
        sessionToken,
        expiresAt: expiresAt.toISOString(),
      };
    },

    async createSession(input: CreateSessionRequest) {
      const credentialHash = hashToken(input.deviceCredential);
      const device = [...devices.values()].find(
        (d) => d.credentialHash === credentialHash && !d.revokedAt,
      );
      if (!device) throw new AuthError('invalid_credentials');

      const now = env.now();
      const sessionToken = generateSessionToken();
      const expiresAt = addSeconds(now, APP_SESSION_TTL_SECONDS);
      sessions.set(sessionToken, {
        id: randomUUID(),
        subjectType: 'user',
        subjectId: device.userId,
        tokenHash: hashToken(sessionToken),
        client: 'app',
        expiresAt,
        revokedAt: null,
      });

      return {
        userId: device.userId,
        sessionToken,
        expiresAt: expiresAt.toISOString(),
      };
    },

    async registerPublisher(input: RegisterPublisherRequest) {
      const email = normalizeEmail(input.email);
      if ([...accounts.values()].some((a) => a.email === email)) {
        throw new AuthError('email_taken');
      }

      let slug = input.slug ?? slugifyPublisherName(input.name);
      if ([...publishers.values()].some((p) => p.slug === slug)) {
        if (input.slug) throw new AuthError('slug_taken');
        slug = `${slug}-${randomUUID().slice(0, 8)}`;
      }

      const accountId = randomUUID();
      const publisherId = randomUUID();
      const now = env.now();
      accounts.set(accountId, {
        id: accountId,
        email,
        passwordHash: await hashPassword(input.password),
        emailVerifiedAt: null,
      });
      publishers.set(publisherId, {
        id: publisherId,
        type: input.type,
        name: input.name,
        slug,
        verified: false,
        origin: 'native',
        createdAt: now,
      });
      members.push({
        publisherId,
        publisherAccountId: accountId,
        role: 'owner',
      });

      const verificationToken = generateEmailToken();
      tokens.set(verificationToken, {
        id: randomUUID(),
        purpose: 'publisher_email',
        subjectId: accountId,
        tokenHash: hashToken(verificationToken),
        expiresAt: addSeconds(now, EMAIL_VERIFICATION_TTL_SECONDS),
        usedAt: null,
      });

      return {
        publisherAccountId: accountId,
        publisherId,
        email,
        ...(env.includeVerificationToken ? { verificationToken } : {}),
      };
    },

    async verifyPublisherEmail(input: VerifyPublisherEmailRequest) {
      const tokenHash = hashToken(input.token);
      const row = [...tokens.values()].find(
        (t) => t.tokenHash === tokenHash && t.purpose === 'publisher_email',
      );
      if (!row) throw new AuthError('invalid_token');
      if (row.usedAt) throw new AuthError('invalid_token');
      if (row.expiresAt <= env.now()) throw new AuthError('token_expired');

      const account = accounts.get(row.subjectId);
      if (!account) throw new AuthError('invalid_token');
      account.emailVerifiedAt = env.now();
      row.usedAt = env.now();
      return { ok: true as const };
    },

    async loginPublisher(input: LoginPublisherRequest) {
      const email = normalizeEmail(input.email);
      const account = [...accounts.values()].find((a) => a.email === email);
      if (!account || !(await verifyPassword(input.password, account.passwordHash))) {
        throw new AuthError('invalid_credentials');
      }
      const allowed = canPublisherLogin(account);
      if (!allowed.ok) throw new AuthError('email_unverified');

      const now = env.now();
      const sessionToken = generateSessionToken();
      const expiresAt = addSeconds(now, PUBLISHER_SESSION_TTL_SECONDS);
      sessions.set(sessionToken, {
        id: randomUUID(),
        subjectType: 'publisher_account',
        subjectId: account.id,
        tokenHash: hashToken(sessionToken),
        client: 'web',
        expiresAt,
        revokedAt: null,
      });

      return {
        body: {
          publisherAccountId: account.id,
          email: account.email,
          publishers: publishersForAccount(account.id),
        },
        sessionToken,
        expiresAt,
      };
    },

    async logoutPublisher(sessionToken: string | undefined) {
      if (!sessionToken) return;
      const tokenHash = hashToken(sessionToken);
      for (const session of sessions.values()) {
        if (session.tokenHash === tokenHash && !session.revokedAt) {
          session.revokedAt = env.now();
        }
      }
    },

    async getPublisherMe(sessionToken: string | undefined) {
      const account = await resolvePublisherSession(sessionToken);
      return {
        publisherAccountId: account.id,
        email: account.email,
        publishers: publishersForAccount(account.id),
      };
    },

    async createWebLoginCode(input) {
      const credentialHash = hashToken(input.deviceCredential);
      const device = [...devices.values()].find(
        (d) => d.credentialHash === credentialHash && !d.revokedAt,
      );
      if (!device) throw new AuthError('invalid_credentials');

      const code = generatePairingCode();
      const now = env.now();
      tokens.set(code, {
        id: randomUUID(),
        purpose: 'web_login_code',
        subjectId: device.userId,
        tokenHash: hashToken(code),
        expiresAt: addSeconds(now, PAIRING_CODE_TTL_SECONDS),
        usedAt: null,
      });
      return { code, expiresAt: addSeconds(now, PAIRING_CODE_TTL_SECONDS).toISOString() };
    },

    async exchangeWebLoginCode(input) {
      const normalized = normalizePairingCode(input.code);
      const tokenHash = hashToken(normalized);
      const row = [...tokens.values()].find(
        (t) => t.purpose === 'web_login_code' && t.tokenHash === tokenHash,
      );
      if (!row || row.usedAt || row.expiresAt <= env.now()) {
        throw new AuthError('invalid_pairing_code');
      }

      row.usedAt = env.now();
      const sessionToken = generateSessionToken();
      const expiresAt = addSeconds(env.now(), APP_SESSION_TTL_SECONDS);
      sessions.set(sessionToken, {
        id: randomUUID(),
        subjectType: 'user',
        subjectId: row.subjectId,
        tokenHash: hashToken(sessionToken),
        client: 'web',
        expiresAt,
        revokedAt: null,
      });
      return {
        body: { userId: row.subjectId, expiresAt: expiresAt.toISOString() },
        sessionToken,
        expiresAt,
      };
    },

    async getWebUserMe(sessionToken: string | undefined) {
      if (!sessionToken) throw new AuthError('unauthorized');
      const tokenHash = hashToken(sessionToken);
      const session = [...sessions.values()].find(
        (s) =>
          s.tokenHash === tokenHash &&
          s.subjectType === 'user' &&
          s.client === 'web' &&
          !s.revokedAt &&
          s.expiresAt > env.now(),
      );
      if (!session) throw new AuthError('unauthorized');
      return { userId: session.subjectId };
    },

    async requirePublisherMember(sessionToken: string | undefined, publisherId: string) {
      const account = await resolvePublisherSession(sessionToken);
      const membership = members.find(
        (m) => m.publisherAccountId === account.id && m.publisherId === publisherId,
      );
      if (!membership) throw new AuthError('unauthorized');
      const publisher = publishers.get(publisherId);
      if (!publisher) throw new AuthError('unauthorized');
      return {
        accountId: account.id,
        role: membership.role,
        publisherVerified: publisher.verified,
      };
    },
  };
}

function defaultEnv(): AuthEnv {
  return { includeVerificationToken: true, now: () => new Date() };
}
