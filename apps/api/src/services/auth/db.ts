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
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import {
  canConfirmDeviceLink,
  canInviteAnotherMember,
  canManagePublisherOrg,
  canPublisherLogin,
  entitlementsFor,
  slugifyPublisherName,
} from '@local-events/domain';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AuthError, type AuthEnv, type AuthServices } from './types';

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

/** Postgres unique_violation (23505), including drizzle/postgres.js wrappers. */
function uniqueViolationConstraint(err: unknown): string | undefined {
  let current: unknown = err;
  for (let i = 0; i < 4 && current && typeof current === 'object'; i++) {
    const obj = current as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (obj.code === '23505') {
      return obj.constraint_name ?? obj.constraint;
    }
    current = obj.cause;
  }
  return undefined;
}

export function createDbAuthServices(db: Db, env: AuthEnv): AuthServices {
  const {
    users,
    devices,
    sessions,
    webLoginCodes,
    publisherAccounts,
    publishers,
    publisherMembers,
    publisherInvites,
    emailVerificationTokens,
  } = schema;

  function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async function publishersForAccount(accountId: string): Promise<PublisherSummary[]> {
    const rows = await db
      .select({
        id: publishers.id,
        name: publishers.name,
        slug: publishers.slug,
        type: publishers.type,
        verified: publishers.verified,
        role: publisherMembers.role,
      })
      .from(publisherMembers)
      .innerJoin(publishers, eq(publishers.id, publisherMembers.publisherId))
      .where(eq(publisherMembers.publisherAccountId, accountId));
    return rows;
  }

  async function resolvePublisherSession(sessionToken: string | undefined) {
    if (!sessionToken) throw new AuthError('unauthorized');
    const tokenHash = hashToken(sessionToken);
    const now = env.now();
    const [row] = await db
      .select({
        accountId: publisherAccounts.id,
        email: publisherAccounts.email,
        sessionId: sessions.id,
      })
      .from(sessions)
      .innerJoin(
        publisherAccounts,
        and(
          eq(publisherAccounts.id, sessions.subjectId),
          eq(sessions.subjectType, 'publisher_account'),
        ),
      )
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .limit(1);
    if (!row) throw new AuthError('unauthorized');
    return row;
  }

  /** Current members plus unexpired pending invites (seats reserved until accept/expiry). */
  async function reservedMemberSeats(publisherId: string, now: Date): Promise<number> {
    const [memberRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(publisherMembers)
      .where(eq(publisherMembers.publisherId, publisherId));
    const [inviteRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(publisherInvites)
      .where(
        and(
          eq(publisherInvites.publisherId, publisherId),
          isNull(publisherInvites.acceptedAt),
          gt(publisherInvites.expiresAt, now),
        ),
      );
    return (memberRow?.count ?? 0) + (inviteRow?.count ?? 0);
  }

  return {
    async createIdentity(input: CreateIdentityRequest) {
      const now = env.now();
      const deviceCredential = generateDeviceCredential();
      const sessionToken = generateSessionToken();
      const expiresAt = addSeconds(now, APP_SESSION_TTL_SECONDS);

      const result = await db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({}).returning({ id: users.id });
        if (!user) throw new Error('failed to create user');
        const [device] = await tx
          .insert(devices)
          .values({
            userId: user.id,
            credentialHash: hashToken(deviceCredential),
            platform: input.platform,
            locale: input.locale,
            lastSeenAt: now,
          })
          .returning({ id: devices.id });
        if (!device) throw new Error('failed to create device');
        await tx.insert(sessions).values({
          subjectType: 'user',
          subjectId: user.id,
          tokenHash: hashToken(sessionToken),
          client: 'app',
          expiresAt,
        });
        await tx.update(users).set({ lastSeenAt: now }).where(eq(users.id, user.id));
        return { userId: user.id, deviceId: device.id };
      });

      return {
        userId: result.userId,
        deviceId: result.deviceId,
        deviceCredential,
        sessionToken,
        expiresAt: expiresAt.toISOString(),
      };
    },

    async createSession(input: CreateSessionRequest) {
      const credentialHash = hashToken(input.deviceCredential);
      const [device] = await db
        .select({ id: devices.id, userId: devices.userId })
        .from(devices)
        .where(and(eq(devices.credentialHash, credentialHash), isNull(devices.revokedAt)))
        .limit(1);
      if (!device) throw new AuthError('invalid_credentials');

      const now = env.now();
      const sessionToken = generateSessionToken();
      const expiresAt = addSeconds(now, APP_SESSION_TTL_SECONDS);
      await db.insert(sessions).values({
        subjectType: 'user',
        subjectId: device.userId,
        tokenHash: hashToken(sessionToken),
        client: 'app',
        expiresAt,
      });
      await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id));
      await db.update(users).set({ lastSeenAt: now }).where(eq(users.id, device.userId));

      return {
        userId: device.userId,
        sessionToken,
        expiresAt: expiresAt.toISOString(),
      };
    },

    async registerPublisher(input: RegisterPublisherRequest) {
      const email = normalizeEmail(input.email);
      let slug = input.slug ?? slugifyPublisherName(input.name);
      const passwordHash = await hashPassword(input.password);
      const verificationToken = generateEmailToken();
      const expiresAt = addSeconds(env.now(), EMAIL_VERIFICATION_TTL_SECONDS);

      try {
        const created = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select({ id: publisherAccounts.id })
            .from(publisherAccounts)
            .where(sql`lower(${publisherAccounts.email}) = ${email}`)
            .limit(1);
          if (existing) throw new AuthError('email_taken');

          const [slugTaken] = await tx
            .select({ id: publishers.id })
            .from(publishers)
            .where(eq(publishers.slug, slug))
            .limit(1);
          if (slugTaken) {
            if (input.slug) throw new AuthError('slug_taken');
            slug = `${slug}-${randomUUID().slice(0, 8)}`;
          }

          const [account] = await tx
            .insert(publisherAccounts)
            .values({ email, passwordHash })
            .returning({ id: publisherAccounts.id });
          if (!account) throw new Error('failed to create publisher account');
          const [publisher] = await tx
            .insert(publishers)
            .values({
              type: input.type,
              name: input.name,
              slug,
              verified: false,
              origin: 'native',
              isTemporary: false,
            })
            .returning({ id: publishers.id });
          if (!publisher) throw new Error('failed to create publisher');
          await tx.insert(publisherMembers).values({
            publisherId: publisher.id,
            publisherAccountId: account.id,
            role: 'owner',
          });
          await tx.insert(emailVerificationTokens).values({
            purpose: 'publisher_email',
            subjectId: account.id,
            tokenHash: hashToken(verificationToken),
            expiresAt,
          });
          return { accountId: account.id, publisherId: publisher.id };
        });

        return {
          publisherAccountId: created.accountId,
          publisherId: created.publisherId,
          email,
          ...(env.includeVerificationToken ? { verificationToken } : {}),
        };
      } catch (err) {
        if (err instanceof AuthError) throw err;
        const constraint = uniqueViolationConstraint(err);
        if (constraint?.includes('email')) throw new AuthError('email_taken');
        if (constraint?.includes('slug')) throw new AuthError('slug_taken');
        if (constraint) throw new AuthError('email_taken');
        throw err;
      }
    },

    async verifyPublisherEmail(input: VerifyPublisherEmailRequest) {
      const tokenHash = hashToken(input.token);
      const now = env.now();
      const [row] = await db
        .select()
        .from(emailVerificationTokens)
        .where(
          and(
            eq(emailVerificationTokens.tokenHash, tokenHash),
            eq(emailVerificationTokens.purpose, 'publisher_email'),
          ),
        )
        .limit(1);
      if (!row || row.usedAt) throw new AuthError('invalid_token');
      if (row.expiresAt <= now) throw new AuthError('token_expired');

      await db.transaction(async (tx) => {
        await tx
          .update(publisherAccounts)
          .set({ emailVerifiedAt: now })
          .where(eq(publisherAccounts.id, row.subjectId));
        await tx
          .update(emailVerificationTokens)
          .set({ usedAt: now })
          .where(eq(emailVerificationTokens.id, row.id));
      });
      return { ok: true as const };
    },

    async loginPublisher(input: LoginPublisherRequest) {
      const email = normalizeEmail(input.email);
      const [account] = await db
        .select()
        .from(publisherAccounts)
        .where(sql`lower(${publisherAccounts.email}) = ${email}`)
        .limit(1);
      if (!account || !(await verifyPassword(input.password, account.passwordHash))) {
        throw new AuthError('invalid_credentials');
      }
      const allowed = canPublisherLogin(account);
      if (!allowed.ok) throw new AuthError('email_unverified');

      const now = env.now();
      const sessionToken = generateSessionToken();
      const expiresAt = addSeconds(now, PUBLISHER_SESSION_TTL_SECONDS);
      await db.insert(sessions).values({
        subjectType: 'publisher_account',
        subjectId: account.id,
        tokenHash: hashToken(sessionToken),
        client: 'web',
        expiresAt,
      });

      return {
        body: {
          publisherAccountId: account.id,
          email: account.email,
          publishers: await publishersForAccount(account.id),
        },
        sessionToken,
        expiresAt,
      };
    },

    async logoutPublisher(sessionToken: string | undefined) {
      if (!sessionToken) return;
      await db
        .update(sessions)
        .set({ revokedAt: env.now() })
        .where(and(eq(sessions.tokenHash, hashToken(sessionToken)), isNull(sessions.revokedAt)));
    },

    async getPublisherMe(sessionToken: string | undefined) {
      const account = await resolvePublisherSession(sessionToken);
      return {
        publisherAccountId: account.accountId,
        email: account.email,
        publishers: await publishersForAccount(account.accountId),
      };
    },

    async createWebLoginCode(input) {
      const credentialHash = hashToken(input.deviceCredential);
      const [device] = await db
        .select({ userId: devices.userId })
        .from(devices)
        .where(and(eq(devices.credentialHash, credentialHash), isNull(devices.revokedAt)))
        .limit(1);
      if (!device) throw new AuthError('invalid_credentials');

      const now = env.now();
      const code = generatePairingCode();
      const expiresAt = addSeconds(now, PAIRING_CODE_TTL_SECONDS);
      await db.insert(webLoginCodes).values({
        codeHash: hashToken(code),
        purpose: 'web_login',
        status: 'pending',
        userId: device.userId,
        expiresAt,
      });
      return { code, expiresAt: expiresAt.toISOString() };
    },

    async exchangeWebLoginCode(input) {
      const codeHash = hashToken(normalizePairingCode(input.code));
      const now = env.now();
      const [row] = await db
        .select()
        .from(webLoginCodes)
        .where(
          and(
            eq(webLoginCodes.codeHash, codeHash),
            eq(webLoginCodes.purpose, 'web_login'),
            eq(webLoginCodes.status, 'pending'),
            gt(webLoginCodes.expiresAt, now),
          ),
        )
        .limit(1);
      if (!row || !row.userId) throw new AuthError('invalid_pairing_code');

      const sessionToken = generateSessionToken();
      const expiresAt = addSeconds(now, APP_SESSION_TTL_SECONDS);
      await db.transaction(async (tx) => {
        await tx
          .update(webLoginCodes)
          .set({ status: 'used' })
          .where(eq(webLoginCodes.id, row.id));
        await tx.insert(sessions).values({
          subjectType: 'user',
          subjectId: row.userId!,
          tokenHash: hashToken(sessionToken),
          client: 'web',
          expiresAt,
        });
      });
      return { body: { userId: row.userId, expiresAt: expiresAt.toISOString() }, sessionToken, expiresAt };
    },

    async getWebUserMe(sessionToken: string | undefined) {
      if (!sessionToken) throw new AuthError('unauthorized');
      const now = env.now();
      const [row] = await db
        .select({ userId: sessions.subjectId })
        .from(sessions)
        .where(
          and(
            eq(sessions.subjectType, 'user'),
            eq(sessions.client, 'web'),
            eq(sessions.tokenHash, hashToken(sessionToken)),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
          ),
        )
        .limit(1);
      if (!row) throw new AuthError('unauthorized');
      return { userId: row.userId };
    },

    async createDeviceLinkCode(input) {
      const credentialHash = hashToken(input.deviceCredential);
      const [device] = await db
        .select({ id: devices.id, userId: devices.userId })
        .from(devices)
        .where(and(eq(devices.credentialHash, credentialHash), isNull(devices.revokedAt)))
        .limit(1);
      if (!device) throw new AuthError('invalid_credentials');

      const now = env.now();
      const code = generatePairingCode();
      const expiresAt = addSeconds(now, PAIRING_CODE_TTL_SECONDS);
      await db.insert(webLoginCodes).values({
        codeHash: hashToken(code),
        purpose: 'device_link',
        status: 'pending',
        userId: device.userId,
        deviceId: device.id,
        expiresAt,
      });
      return { code, expiresAt: expiresAt.toISOString() };
    },

    async confirmDeviceLink(input) {
      const confirmingHash = hashToken(input.deviceCredential);
      const [confirming] = await db
        .select({ userId: devices.userId })
        .from(devices)
        .where(and(eq(devices.credentialHash, confirmingHash), isNull(devices.revokedAt)))
        .limit(1);
      if (!confirming) throw new AuthError('invalid_credentials');

      const now = env.now();
      const codeHash = hashToken(normalizePairingCode(input.code));
      const [row] = await db
        .select()
        .from(webLoginCodes)
        .where(
          and(
            eq(webLoginCodes.codeHash, codeHash),
            eq(webLoginCodes.purpose, 'device_link'),
            eq(webLoginCodes.status, 'pending'),
            gt(webLoginCodes.expiresAt, now),
          ),
        )
        .limit(1);
      if (!row?.userId || !row.deviceId) throw new AuthError('invalid_pairing_code');

      const decision = canConfirmDeviceLink({
        pendingUserId: row.userId,
        confirmingUserId: confirming.userId,
      });
      if (!decision.ok) throw new AuthError('device_link_same_user');

      await db.transaction(async (tx) => {
        const consumed = await tx
          .update(webLoginCodes)
          .set({ status: 'used' })
          .where(and(eq(webLoginCodes.id, row.id), eq(webLoginCodes.status, 'pending')))
          .returning({ id: webLoginCodes.id });
        if (consumed.length === 0) throw new AuthError('invalid_pairing_code');

        await tx
          .update(devices)
          .set({ userId: confirming.userId })
          .where(and(eq(devices.id, row.deviceId!), isNull(devices.revokedAt)));
        await tx
          .update(sessions)
          .set({ revokedAt: now })
          .where(
            and(
              eq(sessions.subjectType, 'user'),
              eq(sessions.subjectId, row.userId!),
              isNull(sessions.revokedAt),
            ),
          );
      });

      return { userId: confirming.userId };
    },

    async requirePublisherMember(sessionToken: string | undefined, publisherId: string) {
      const account = await resolvePublisherSession(sessionToken);
      const [membership] = await db
        .select({
          role: publisherMembers.role,
          verified: publishers.verified,
        })
        .from(publisherMembers)
        .innerJoin(publishers, eq(publishers.id, publisherMembers.publisherId))
        .where(
          and(
            eq(publisherMembers.publisherAccountId, account.accountId),
            eq(publisherMembers.publisherId, publisherId),
          ),
        )
        .limit(1);
      if (!membership) throw new AuthError('unauthorized');
      return {
        accountId: account.accountId,
        role: membership.role,
        publisherVerified: membership.verified,
      };
    },

    async requireUserSession(sessionToken) {
      if (!sessionToken) throw new AuthError('unauthorized');
      const tokenHash = hashToken(sessionToken);
      const now = env.now();
      const [row] = await db
        .select({ userId: sessions.subjectId })
        .from(sessions)
        .where(
          and(
            eq(sessions.tokenHash, tokenHash),
            eq(sessions.subjectType, 'user'),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
          ),
        )
        .limit(1);
      if (!row) throw new AuthError('unauthorized');
      return { userId: row.userId };
    },

    async getPublisherProfile(sessionToken, publisherId) {
      const access = await this.requirePublisherMember(sessionToken, publisherId);
      const [row] = await db
        .select({
          id: publishers.id,
          name: publishers.name,
          slug: publishers.slug,
          type: publishers.type,
          verified: publishers.verified,
          origin: publishers.origin,
        })
        .from(publishers)
        .where(eq(publishers.id, publisherId))
        .limit(1);
      if (!row) throw new AuthError('unauthorized');
      return { ...row, role: access.role };
    },

    async updatePublisherProfile(sessionToken, publisherId, input) {
      const access = await this.requirePublisherMember(sessionToken, publisherId);
      if (!canManagePublisherOrg(access.role)) throw new AuthError('forbidden');
      if (!input.name && !input.slug && !input.type) {
        return this.getPublisherProfile(sessionToken, publisherId);
      }
      try {
        await db
          .update(publishers)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(input.type !== undefined ? { type: input.type } : {}),
          })
          .where(eq(publishers.id, publisherId));
      } catch (err) {
        const constraint = uniqueViolationConstraint(err);
        if (constraint?.includes('slug')) throw new AuthError('slug_taken');
        throw err;
      }
      return this.getPublisherProfile(sessionToken, publisherId);
    },

    async listPublisherMembers(sessionToken, publisherId) {
      await this.requirePublisherMember(sessionToken, publisherId);
      const rows = await db
        .select({
          publisherAccountId: publisherAccounts.id,
          email: publisherAccounts.email,
          role: publisherMembers.role,
          createdAt: publisherMembers.createdAt,
        })
        .from(publisherMembers)
        .innerJoin(
          publisherAccounts,
          eq(publisherAccounts.id, publisherMembers.publisherAccountId),
        )
        .where(eq(publisherMembers.publisherId, publisherId));
      return {
        items: rows.map((r) => ({
          publisherAccountId: r.publisherAccountId,
          email: r.email,
          role: r.role,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },

    async listPublisherInvites(sessionToken, publisherId) {
      const access = await this.requirePublisherMember(sessionToken, publisherId);
      if (!canManagePublisherOrg(access.role)) throw new AuthError('forbidden');
      const now = env.now();
      const rows = await db
        .select({
          id: publisherInvites.id,
          email: publisherInvites.email,
          role: publisherInvites.role,
          expiresAt: publisherInvites.expiresAt,
          createdAt: publisherInvites.createdAt,
        })
        .from(publisherInvites)
        .where(
          and(
            eq(publisherInvites.publisherId, publisherId),
            isNull(publisherInvites.acceptedAt),
            gt(publisherInvites.expiresAt, now),
          ),
        );
      return {
        items: rows.map((r) => ({
          id: r.id,
          email: r.email,
          role: r.role,
          expiresAt: r.expiresAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },

    async createPublisherInvite(sessionToken, publisherId, input) {
      const access = await this.requirePublisherMember(sessionToken, publisherId);
      if (!canManagePublisherOrg(access.role)) throw new AuthError('forbidden');

      const email = normalizeEmail(input.email);
      const now = env.now();
      const seats = await reservedMemberSeats(publisherId, now);
      if (!canInviteAnotherMember(entitlementsFor(publisherId), seats)) {
        throw new AuthError('member_limit');
      }

      const [existingAccount] = await db
        .select({ id: publisherAccounts.id })
        .from(publisherAccounts)
        .where(sql`lower(${publisherAccounts.email}) = ${email}`)
        .limit(1);
      if (existingAccount) {
        const [existingMember] = await db
          .select({ role: publisherMembers.role })
          .from(publisherMembers)
          .where(
            and(
              eq(publisherMembers.publisherId, publisherId),
              eq(publisherMembers.publisherAccountId, existingAccount.id),
            ),
          )
          .limit(1);
        if (existingMember) throw new AuthError('already_member');
      }

      const token = generateEmailToken();
      const expiresAt = addSeconds(now, PUBLISHER_INVITE_TTL_SECONDS);
      const id = randomUUID();

      await db.transaction(async (tx) => {
        const [pending] = await tx
          .select({ id: publisherInvites.id })
          .from(publisherInvites)
          .where(
            and(
              eq(publisherInvites.publisherId, publisherId),
              sql`lower(${publisherInvites.email}) = ${email}`,
              isNull(publisherInvites.acceptedAt),
              gt(publisherInvites.expiresAt, now),
            ),
          )
          .limit(1);
        if (pending) throw new AuthError('invite_pending');

        const [memberRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(publisherMembers)
          .where(eq(publisherMembers.publisherId, publisherId));
        const [inviteRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(publisherInvites)
          .where(
            and(
              eq(publisherInvites.publisherId, publisherId),
              isNull(publisherInvites.acceptedAt),
              gt(publisherInvites.expiresAt, now),
            ),
          );
        const seatsInTx = (memberRow?.count ?? 0) + (inviteRow?.count ?? 0);
        if (!canInviteAnotherMember(entitlementsFor(publisherId), seatsInTx)) {
          throw new AuthError('member_limit');
        }

        await tx.insert(publisherInvites).values({
          id,
          publisherId,
          email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedByAccountId: access.accountId,
          expiresAt,
        });
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
      const [invite] = await db
        .select()
        .from(publisherInvites)
        .where(
          and(
            eq(publisherInvites.tokenHash, hashToken(input.token)),
            isNull(publisherInvites.acceptedAt),
            gt(publisherInvites.expiresAt, now),
          ),
        )
        .limit(1);
      if (!invite) throw new AuthError('invalid_token');
      if (normalizeEmail(account.email) !== normalizeEmail(invite.email)) {
        throw new AuthError('invite_email_mismatch');
      }

      const [existing] = await db
        .select({ role: publisherMembers.role })
        .from(publisherMembers)
        .where(
          and(
            eq(publisherMembers.publisherId, invite.publisherId),
            eq(publisherMembers.publisherAccountId, account.accountId),
          ),
        )
        .limit(1);
      if (existing) throw new AuthError('already_member');

      await db.transaction(async (tx) => {
        const [memberRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(publisherMembers)
          .where(eq(publisherMembers.publisherId, invite.publisherId));
        if (!canInviteAnotherMember(entitlementsFor(invite.publisherId), memberRow?.count ?? 0)) {
          throw new AuthError('member_limit');
        }

        const consumed = await tx
          .update(publisherInvites)
          .set({ acceptedAt: now })
          .where(
            and(eq(publisherInvites.id, invite.id), isNull(publisherInvites.acceptedAt)),
          )
          .returning({ id: publisherInvites.id });
        if (consumed.length === 0) throw new AuthError('invalid_token');
        await tx.insert(publisherMembers).values({
          publisherId: invite.publisherId,
          publisherAccountId: account.accountId,
          role: invite.role,
        });
      });

      return { publisherId: invite.publisherId, role: invite.role };
    },
  };
}
