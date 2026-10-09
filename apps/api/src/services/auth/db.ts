import {
  APP_SESSION_TTL_SECONDS,
  EMAIL_VERIFICATION_TTL_SECONDS,
  generateDeviceCredential,
  generateEmailToken,
  generateSessionToken,
  hashPassword,
  hashToken,
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
import { canPublisherLogin, slugifyPublisherName } from '@local-events/domain';
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
    publisherAccounts,
    publishers,
    publisherMembers,
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
  };
}
