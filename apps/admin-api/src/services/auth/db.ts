import {
  ADMIN_CHALLENGE_TTL_SECONDS,
  ADMIN_LOGIN_OTP_MAX_ATTEMPTS,
  ADMIN_LOGIN_OTP_MAX_REQUESTS,
  ADMIN_LOGIN_OTP_PURPOSE,
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
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import type { AdminSessionResponse } from '@local-events/contracts';
import { and, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { createEmailWindowLimit } from './rate-limit';
import { AdminAuthError, type AdminAuthServices } from './types';

const DUMMY_LOGIN_OTP_HASH = hashToken('dummy-login-otp');

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ('code' in err && (err as { code?: string }).code === '23505') return true;
  if ('cause' in err) return isUniqueViolation((err as { cause?: unknown }).cause);
  return false;
}

type ChallengeRow = {
  tokenHash: string;
  adminId: string;
  kind: 'totp' | 'setup';
  pendingSecret: string | null;
  expiresAt: Date;
};

function addSeconds(d: Date, seconds: number): Date {
  return new Date(d.getTime() + seconds * 1000);
}

/**
 * DB-backed admin auth. Challenges live in-process (short TTL); sessions in `sessions`
 * with subject_type=admin.
 */
export function createDbAdminAuthServices(
  db: Db,
  env: {
    now?: () => Date;
    challenges?: Map<string, ChallengeRow>;
    includeLoginOtp?: boolean;
    otpPepper?: string;
  } = {},
): AdminAuthServices {
  const now = env.now ?? (() => new Date());
  const challenges = env.challenges ?? new Map<string, ChallengeRow>();
  const includeLoginOtp = env.includeLoginOtp ?? false;
  const otpPepper = env.otpPepper ?? randomBytes(32).toString('hex');
  const otpAttempts = new Map<string, number>();
  const allowOtpRequest = createEmailWindowLimit({
    now,
    windowSeconds: ADMIN_LOGIN_OTP_WINDOW_SECONDS,
    max: ADMIN_LOGIN_OTP_MAX_REQUESTS,
  });

  async function issueSession(
    admin: { id: string; email: string; role: string },
    at: Date,
  ): Promise<AdminSessionResponse & { sessionToken: string }> {
    const sessionToken = generateSessionToken();
    const expiresAt = addSeconds(at, ADMIN_SESSION_TTL_SECONDS);
    await db.insert(schema.sessions).values({
      subjectType: 'admin',
      subjectId: admin.id,
      tokenHash: hashToken(sessionToken),
      client: 'admin',
      expiresAt,
    });
    return {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      expiresAt: expiresAt.toISOString(),
      sessionToken,
    };
  }

  function purgeChallenges(at: Date) {
    for (const [k, v] of challenges) {
      if (v.expiresAt <= at) challenges.delete(k);
    }
  }

  async function requireSession(sessionToken: string | undefined) {
    if (!sessionToken) throw new AdminAuthError('unauthorized');
    const at = now();
    const [session] = await db
      .select({
        subjectId: schema.sessions.subjectId,
        expiresAt: schema.sessions.expiresAt,
      })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.tokenHash, hashToken(sessionToken)),
          eq(schema.sessions.subjectType, 'admin'),
          eq(schema.sessions.client, 'admin'),
          isNull(schema.sessions.revokedAt),
          gt(schema.sessions.expiresAt, at),
        ),
      )
      .limit(1);
    if (!session) throw new AdminAuthError('unauthorized');
    const [admin] = await db
      .select({
        id: schema.adminUsers.id,
        email: schema.adminUsers.email,
        role: schema.adminUsers.role,
      })
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.id, session.subjectId))
      .limit(1);
    if (!admin) throw new AdminAuthError('unauthorized');
    return { adminId: admin.id, email: admin.email, role: admin.role };
  }

  return {
    async ensureBootstrapAdmin({ email, password }) {
      const [row] = await db.select({ n: count() }).from(schema.adminUsers);
      if (Number(row?.n ?? 0) > 0) return { created: false };
      await db.insert(schema.adminUsers).values({
        email: email.toLowerCase(),
        passwordHash: await hashPassword(password),
        totpSecret: null,
        role: 'admin',
      });
      return { created: true };
    },

    async login(input) {
      const email = input.email.toLowerCase();
      const [admin] = await db
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.email, email))
        .limit(1);
      if (!admin || !(await verifyPassword(input.password, admin.passwordHash))) {
        throw new AdminAuthError('invalid_credentials');
      }
      const at = now();
      purgeChallenges(at);
      const challengeToken = generateSessionToken();
      const expiresAt = addSeconds(at, ADMIN_CHALLENGE_TTL_SECONDS);
      if (!admin.totpSecret) {
        const secret = generateTotpSecret();
        challenges.set(hashToken(challengeToken), {
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
      challenges.set(hashToken(challengeToken), {
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
      purgeChallenges(at);
      const challenge = challenges.get(hashToken(input.token));
      if (!challenge || challenge.expiresAt <= at) {
        throw new AdminAuthError('challenge_expired');
      }
      challenges.delete(hashToken(input.token));

      const [admin] = await db
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.id, challenge.adminId))
        .limit(1);
      if (!admin) throw new AdminAuthError('invalid_credentials');

      if (challenge.kind === 'setup') {
        if (
          !challenge.pendingSecret ||
          !verifyTotpCode(challenge.pendingSecret, input.code, at.getTime())
        ) {
          throw new AdminAuthError('invalid_totp');
        }
        await db
          .update(schema.adminUsers)
          .set({ totpSecret: challenge.pendingSecret })
          .where(eq(schema.adminUsers.id, admin.id));
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
      const [admin] = await db
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.email, email))
        .limit(1);
      if (!admin) return { status: 'code_sent' as const };
      const at = now();
      let code = '';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        code = generateLoginOtp();
        try {
          await db.transaction(async (tx) => {
            await tx.execute(sql`select id from admin_users where id = ${admin.id} for update`);
            const retired = await tx
              .update(schema.emailVerificationTokens)
              .set({ usedAt: at })
              .where(
                and(
                  eq(schema.emailVerificationTokens.purpose, ADMIN_LOGIN_OTP_PURPOSE),
                  eq(schema.emailVerificationTokens.subjectId, admin.id),
                  isNull(schema.emailVerificationTokens.usedAt),
                ),
              )
              .returning({ id: schema.emailVerificationTokens.id });
            for (const row of retired) otpAttempts.delete(row.id);
            const [inserted] = await tx
              .insert(schema.emailVerificationTokens)
              .values({
                purpose: ADMIN_LOGIN_OTP_PURPOSE,
                subjectId: admin.id,
                tokenHash: loginOtpHash(code, otpPepper),
                expiresAt: addSeconds(at, ADMIN_LOGIN_OTP_TTL_SECONDS),
              })
              .returning({ id: schema.emailVerificationTokens.id });
            if (inserted) otpAttempts.set(inserted.id, 0);
          });
          return includeLoginOtp
            ? { status: 'code_sent' as const, code }
            : { status: 'code_sent' as const };
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      }
      throw new Error('admin_otp_code_collision');
    },

    async confirmOtp(input) {
      const email = input.email.toLowerCase();
      const at = now();
      const [admin] = await db
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.email, email))
        .limit(1);
      if (!admin) {
        loginOtpMatches(input.code, otpPepper, DUMMY_LOGIN_OTP_HASH);
        throw new AdminAuthError('invalid_otp');
      }
      const open = await db
        .select({
          id: schema.emailVerificationTokens.id,
          tokenHash: schema.emailVerificationTokens.tokenHash,
          expiresAt: schema.emailVerificationTokens.expiresAt,
        })
        .from(schema.emailVerificationTokens)
        .where(
          and(
            eq(schema.emailVerificationTokens.purpose, ADMIN_LOGIN_OTP_PURPOSE),
            eq(schema.emailVerificationTokens.subjectId, admin.id),
            isNull(schema.emailVerificationTokens.usedAt),
          ),
        );
      const decision = decideLoginOtpConfirm({
        code: input.code,
        pepper: otpPepper,
        records: open.map((row) => ({
          id: row.id,
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
          attempts: otpAttempts.get(row.id) ?? 0,
        })),
        now: at,
        maxAttempts: ADMIN_LOGIN_OTP_MAX_ATTEMPTS,
      });
      if (!decision.ok) {
        for (const next of decision.attempts) otpAttempts.set(next.id, next.attempts);
        if (decision.burnIds.length > 0) {
          await db
            .update(schema.emailVerificationTokens)
            .set({ usedAt: at })
            .where(
              and(
                inArray(schema.emailVerificationTokens.id, decision.burnIds),
                isNull(schema.emailVerificationTokens.usedAt),
              ),
            );
          for (const id of decision.burnIds) otpAttempts.delete(id);
        }
        throw new AdminAuthError(decision.code);
      }
      const consumed = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.emailVerificationTokens)
          .set({ usedAt: at })
          .where(
            and(
              eq(schema.emailVerificationTokens.id, decision.id),
              isNull(schema.emailVerificationTokens.usedAt),
              gt(schema.emailVerificationTokens.expiresAt, at),
            ),
          )
          .returning({ id: schema.emailVerificationTokens.id });
        if (!row) return false;
        const sessionToken = generateSessionToken();
        const expiresAt = addSeconds(at, ADMIN_SESSION_TTL_SECONDS);
        await tx.insert(schema.sessions).values({
          subjectType: 'admin',
          subjectId: admin.id,
          tokenHash: hashToken(sessionToken),
          client: 'admin',
          expiresAt,
        });
        return { sessionToken, expiresAt };
      });
      if (!consumed) throw new AdminAuthError('invalid_otp');
      otpAttempts.delete(decision.id);
      return {
        adminId: admin.id,
        email: admin.email,
        role: admin.role,
        expiresAt: consumed.expiresAt.toISOString(),
        sessionToken: consumed.sessionToken,
      };
    },

    async me(sessionToken) {
      const { adminId, email, role } = await requireSession(sessionToken);
      const [session] = await db
        .select({ expiresAt: schema.sessions.expiresAt })
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.tokenHash, hashToken(sessionToken!)),
            eq(schema.sessions.subjectType, 'admin'),
            isNull(schema.sessions.revokedAt),
          ),
        )
        .limit(1);
      return {
        adminId,
        email,
        role,
        expiresAt: (session?.expiresAt ?? now()).toISOString(),
      };
    },

    async logout(sessionToken) {
      if (!sessionToken) return;
      await db
        .update(schema.sessions)
        .set({ revokedAt: now() })
        .where(
          and(
            eq(schema.sessions.tokenHash, hashToken(sessionToken)),
            eq(schema.sessions.subjectType, 'admin'),
            isNull(schema.sessions.revokedAt),
          ),
        );
    },

    requireSession,
  };
}
