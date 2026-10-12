import {
  ADMIN_CHALLENGE_TTL_SECONDS,
  ADMIN_SESSION_TTL_SECONDS,
  generateSessionToken,
  generateTotpSecret,
  hashPassword,
  hashToken,
  totpOtpauthUrl,
  verifyPassword,
  verifyTotpCode,
} from '@local-events/auth';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import { AdminAuthError, type AdminAuthServices } from './types';

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
  env: { now?: () => Date; challenges?: Map<string, ChallengeRow> } = {},
): AdminAuthServices {
  const now = env.now ?? (() => new Date());
  const challenges = env.challenges ?? new Map<string, ChallengeRow>();

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
