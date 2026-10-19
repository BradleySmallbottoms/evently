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
  PUBLISHER_INVITE_TTL_SECONDS,
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
import {
  canConfirmDeviceLink,
  canInviteAnotherMember,
  canManagePublisherOrg,
  canPublisherLogin,
  entitlementsFor,
  slugifyPublisherName,
} from '@local-events/domain';
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
  const { users, devices, sessions, accounts, publishers, members, invites, tokens } = store;

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
          status: p.status,
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

      users.set(userId, {
        id: userId,
        createdAt: now,
        displayName: null,
        isPublic: false,
        recoveryEmail: null,
        recoveryEmailVerifiedAt: null,
        profileChosenAt: null,
        timezone: 'Europe/Stockholm',
        quietHoursStartMin: 22 * 60,
        quietHoursEndMin: 8 * 60,
        quietHoursEnabled: true,
        travelDistanceM: 25_000,
        discoveryRadiusM: null,
        bannedAt: null,
        banReason: null,
      });
      devices.set(deviceId, {
        id: deviceId,
        userId,
        credentialHash: hashToken(deviceCredential),
        platform: input.platform,
        locale: input.locale,
        expoPushToken: null,
        lastSeenAt: now,
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
      const user = users.get(device.userId);
      if (user?.bannedAt) throw new AuthError('user_banned');

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
        status: 'in_review',
        origin: 'native',
        createdAt: now,
      });
      members.push({
        publisherId,
        publisherAccountId: accountId,
        role: 'owner',
        createdAt: now,
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

    async createDeviceLinkCode(input) {
      const credentialHash = hashToken(input.deviceCredential);
      const device = [...devices.values()].find(
        (d) => d.credentialHash === credentialHash && !d.revokedAt,
      );
      if (!device) throw new AuthError('invalid_credentials');

      const code = generatePairingCode();
      const now = env.now();
      tokens.set(code, {
        id: randomUUID(),
        purpose: 'device_link_code',
        subjectId: device.userId,
        deviceId: device.id,
        tokenHash: hashToken(code),
        expiresAt: addSeconds(now, PAIRING_CODE_TTL_SECONDS),
        usedAt: null,
      });
      return { code, expiresAt: addSeconds(now, PAIRING_CODE_TTL_SECONDS).toISOString() };
    },

    async confirmDeviceLink(input) {
      const confirmingHash = hashToken(input.deviceCredential);
      const confirming = [...devices.values()].find(
        (d) => d.credentialHash === confirmingHash && !d.revokedAt,
      );
      if (!confirming) throw new AuthError('invalid_credentials');

      const normalized = normalizePairingCode(input.code);
      const tokenHash = hashToken(normalized);
      const row = [...tokens.values()].find(
        (t) => t.purpose === 'device_link_code' && t.tokenHash === tokenHash,
      );
      if (!row || !row.deviceId || row.usedAt || row.expiresAt <= env.now()) {
        throw new AuthError('invalid_pairing_code');
      }

      const decision = canConfirmDeviceLink({
        pendingUserId: row.subjectId,
        confirmingUserId: confirming.userId,
      });
      if (!decision.ok) throw new AuthError('device_link_same_user');

      // Atomic consume: first writer wins.
      if (row.usedAt) throw new AuthError('invalid_pairing_code');
      row.usedAt = env.now();

      const pendingDevice = devices.get(row.deviceId);
      if (pendingDevice && !pendingDevice.revokedAt) {
        pendingDevice.userId = confirming.userId;
      }
      for (const session of sessions.values()) {
        if (
          session.subjectType === 'user' &&
          session.subjectId === row.subjectId &&
          !session.revokedAt
        ) {
          session.revokedAt = env.now();
        }
      }

      return { userId: confirming.userId };
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
        publisherStatus: publisher.status,
      };
    },

    async requireUserSession(sessionToken) {
      if (!sessionToken) throw new AuthError('unauthorized');
      const tokenHash = hashToken(sessionToken);
      const session = [...sessions.values()].find(
        (s) =>
          s.tokenHash === tokenHash &&
          s.subjectType === 'user' &&
          !s.revokedAt &&
          s.expiresAt > env.now(),
      );
      if (!session) throw new AuthError('unauthorized');
      const user = users.get(session.subjectId);
      if (user?.bannedAt) throw new AuthError('user_banned');
      return { userId: session.subjectId };
    },

    async registerPushToken(sessionToken, input) {
      const { userId } = await this.requireUserSession(sessionToken);
      const device = [...devices.values()].find(
        (d) =>
          d.credentialHash === hashToken(input.deviceCredential) &&
          !d.revokedAt,
      );
      if (!device || device.userId !== userId) throw new AuthError('invalid_credentials');
      device.expoPushToken = input.expoPushToken;
      device.lastSeenAt = env.now();
      return { ok: true as const };
    },

    async getPublisherProfile(sessionToken, publisherId) {
      const access = await this.requirePublisherMember(sessionToken, publisherId);
      const publisher = publishers.get(publisherId);
      if (!publisher) throw new AuthError('unauthorized');
      return {
        id: publisher.id,
        name: publisher.name,
        slug: publisher.slug,
        type: publisher.type,
        status: publisher.status,
        origin: publisher.origin,
        role: access.role,
      };
    },

    async updatePublisherProfile(sessionToken, publisherId, input) {
      const access = await this.requirePublisherMember(sessionToken, publisherId);
      if (!canManagePublisherOrg(access.role)) throw new AuthError('forbidden');
      const publisher = publishers.get(publisherId);
      if (!publisher) throw new AuthError('unauthorized');
      if (input.slug !== undefined) {
        for (const p of publishers.values()) {
          if (p.id !== publisherId && p.slug === input.slug) throw new AuthError('slug_taken');
        }
        publisher.slug = input.slug;
      }
      if (input.name !== undefined) publisher.name = input.name;
      if (input.type !== undefined) publisher.type = input.type;
      return this.getPublisherProfile(sessionToken, publisherId);
    },

    async listPublisherMembers(sessionToken, publisherId) {
      await this.requirePublisherMember(sessionToken, publisherId);
      return {
        items: members
          .filter((m) => m.publisherId === publisherId)
          .map((m) => {
            const account = accounts.get(m.publisherAccountId);
            return {
              publisherAccountId: m.publisherAccountId,
              email: account?.email ?? '',
              role: m.role,
              createdAt: m.createdAt.toISOString(),
            };
          }),
      };
    },

    async listPublisherInvites(sessionToken, publisherId) {
      const access = await this.requirePublisherMember(sessionToken, publisherId);
      if (!canManagePublisherOrg(access.role)) throw new AuthError('forbidden');
      const now = env.now();
      return {
        items: invites
          .filter(
            (i) =>
              i.publisherId === publisherId &&
              i.acceptedAt === null &&
              i.expiresAt > now,
          )
          .map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            expiresAt: i.expiresAt.toISOString(),
            createdAt: i.createdAt.toISOString(),
          })),
      };
    },

    async createPublisherInvite(sessionToken, publisherId, input) {
      const access = await this.requirePublisherMember(sessionToken, publisherId);
      if (!canManagePublisherOrg(access.role)) throw new AuthError('forbidden');

      const email = normalizeEmail(input.email);
      const now = env.now();
      const memberCount = members.filter((m) => m.publisherId === publisherId).length;
      const pendingCount = invites.filter(
        (i) =>
          i.publisherId === publisherId &&
          i.acceptedAt === null &&
          i.expiresAt > now,
      ).length;
      if (!canInviteAnotherMember(entitlementsFor(publisherId), memberCount + pendingCount)) {
        throw new AuthError('member_limit');
      }

      const existingAccount = [...accounts.values()].find(
        (a) => normalizeEmail(a.email) === email,
      );
      if (existingAccount) {
        const existingMember = members.find(
          (m) =>
            m.publisherId === publisherId && m.publisherAccountId === existingAccount.id,
        );
        if (existingMember) throw new AuthError('already_member');
      }

      const pending = invites.find(
        (i) =>
          i.publisherId === publisherId &&
          normalizeEmail(i.email) === email &&
          i.acceptedAt === null &&
          i.expiresAt > now,
      );
      if (pending) throw new AuthError('invite_pending');

      const token = generateEmailToken();
      const expiresAt = addSeconds(now, PUBLISHER_INVITE_TTL_SECONDS);
      const id = randomUUID();
      invites.push({
        id,
        publisherId,
        email,
        role: input.role,
        tokenHash: hashToken(token),
        invitedByAccountId: access.accountId,
        expiresAt,
        acceptedAt: null,
        createdAt: now,
      });

      return {
        id,
        email,
        role: input.role,
        expiresAt: expiresAt.toISOString(),
        ...(env.includeVerificationToken ? { inviteToken: token } : {}),
      };
    },

    async acceptPublisherInvite(sessionToken, input) {
      const account = await resolvePublisherSession(sessionToken);
      const now = env.now();
      const invite = invites.find(
        (i) =>
          i.tokenHash === hashToken(input.token) &&
          i.acceptedAt === null &&
          i.expiresAt > now,
      );
      if (!invite) throw new AuthError('invalid_token');
      if (normalizeEmail(account.email) !== normalizeEmail(invite.email)) {
        throw new AuthError('invite_email_mismatch');
      }

      const existing = members.find(
        (m) =>
          m.publisherId === invite.publisherId && m.publisherAccountId === account.id,
      );
      if (existing) throw new AuthError('already_member');

      const memberCount = members.filter((m) => m.publisherId === invite.publisherId).length;
      if (!canInviteAnotherMember(entitlementsFor(invite.publisherId), memberCount)) {
        throw new AuthError('member_limit');
      }

      invite.acceptedAt = now;
      members.push({
        publisherId: invite.publisherId,
        publisherAccountId: account.id,
        role: invite.role,
        createdAt: now,
      });

      return { publisherId: invite.publisherId, role: invite.role };
    },
  };
}

function defaultEnv(): AuthEnv {
  return { includeVerificationToken: true, now: () => new Date() };
}
