import { hashPassword } from '@local-events/auth';
import type {
  AdminCreatePublisherAccountRequest,
  AdminPatchPublisherAccountRequest,
  AdminPublisherAccount,
  AdminPublisherAccountDirectoryItem,
  AdminPublisherAccountDirectoryResponse,
  AdminPublisherAccountListResponse,
  AdminPublisherAccountPasswordRequest,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export type PublisherAccountMemory = {
  publishers: Map<string, { id: string }>;
  accounts?: Map<string, MemoryAccount>;
  members?: {
    publisherId: string;
    publisherAccountId: string;
    role: 'owner' | 'editor';
    createdAt: Date;
  }[];
};

export type PublisherAccountFailure =
  'not_found' | 'already_member' | 'email_taken' | 'password_required';

export type PublisherAccountLookupStatus = 'new' | 'existing' | 'already_member';

type AccountResult =
  | { ok: true; account: AdminPublisherAccount }
  | { ok: false; reason: Exclude<PublisherAccountFailure, 'password_required'> };

type CreateAccountResult =
  { ok: true; account: AdminPublisherAccount } | { ok: false; reason: PublisherAccountFailure };

type RemoveResult = { ok: true } | { ok: false; reason: 'not_found' };

type MemoryAccount = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  totpSecret: string | null;
  createdAt: Date;
};

function ensureAccounts(store: PublisherAccountMemory) {
  if (!store.accounts) store.accounts = new Map();
  if (!store.members) store.members = [];
  return {
    accounts: store.accounts,
    members: store.members,
  };
}

function toAccount(account: MemoryAccount, role: 'owner' | 'editor'): AdminPublisherAccount {
  return {
    id: account.id,
    email: account.email,
    role,
    emailVerifiedAt: account.emailVerifiedAt?.toISOString() ?? null,
    totpEnabled: account.totpSecret != null && account.totpSecret.length > 0,
    createdAt: account.createdAt.toISOString(),
  };
}

export function listMemoryPublisherAccounts(
  store: PublisherAccountMemory,
  publisherId: string,
): AdminPublisherAccountListResponse | null {
  if (!store.publishers.has(publisherId)) return null;
  const { accounts, members } = ensureAccounts(store);
  const items = members
    .filter((member) => member.publisherId === publisherId)
    .flatMap((member) => {
      const account = accounts.get(member.publisherAccountId);
      return account ? [toAccount(account, member.role)] : [];
    })
    .sort((a, b) => a.email.localeCompare(b.email));
  return { items };
}

export function lookupMemoryPublisherAccount(
  store: PublisherAccountMemory,
  publisherId: string,
  email: string,
): { ok: true; status: PublisherAccountLookupStatus } | { ok: false; reason: 'not_found' } {
  if (!store.publishers.has(publisherId)) return { ok: false, reason: 'not_found' };
  const { accounts, members } = ensureAccounts(store);
  const account = [...accounts.values()].find((row) => row.email === email.trim().toLowerCase());
  if (!account) return { ok: true, status: 'new' };
  const member = members.some(
    (row) => row.publisherId === publisherId && row.publisherAccountId === account.id,
  );
  return { ok: true, status: member ? 'already_member' : 'existing' };
}

export async function createMemoryPublisherAccount(
  store: PublisherAccountMemory,
  publisherId: string,
  body: AdminCreatePublisherAccountRequest,
  at: Date,
): Promise<CreateAccountResult> {
  if (!store.publishers.has(publisherId)) return { ok: false, reason: 'not_found' };
  const { accounts, members } = ensureAccounts(store);
  const email = body.email.trim().toLowerCase();
  let account = [...accounts.values()].find((row) => row.email === email);
  if (
    account &&
    members.some(
      (member) => member.publisherId === publisherId && member.publisherAccountId === account!.id,
    )
  ) {
    return { ok: false, reason: 'already_member' };
  }
  if (!account) {
    if (!body.password) return { ok: false, reason: 'password_required' };
    account = {
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(body.password),
      emailVerifiedAt: at,
      totpSecret: null,
      createdAt: at,
    };
    accounts.set(account.id, account);
  }
  members.push({
    publisherId,
    publisherAccountId: account.id,
    role: body.role,
    createdAt: at,
  });
  return { ok: true, account: toAccount(account, body.role) };
}

export async function patchMemoryPublisherAccount(
  store: PublisherAccountMemory,
  publisherId: string,
  accountId: string,
  body: AdminPatchPublisherAccountRequest,
): Promise<AccountResult> {
  if (!store.publishers.has(publisherId)) return { ok: false, reason: 'not_found' };
  const { accounts, members } = ensureAccounts(store);
  const member = members.find(
    (row) => row.publisherId === publisherId && row.publisherAccountId === accountId,
  );
  const account = accounts.get(accountId);
  if (!member || !account) return { ok: false, reason: 'not_found' };
  member.role = body.role;
  return { ok: true, account: toAccount(account, member.role) };
}

export function removeMemoryPublisherAccount(
  store: PublisherAccountMemory,
  publisherId: string,
  accountId: string,
): RemoveResult {
  if (!store.publishers.has(publisherId)) return { ok: false, reason: 'not_found' };
  const { members } = ensureAccounts(store);
  const index = members.findIndex(
    (row) => row.publisherId === publisherId && row.publisherAccountId === accountId,
  );
  if (index < 0) return { ok: false, reason: 'not_found' };
  members.splice(index, 1);
  return { ok: true };
}

function rowToAccount(row: {
  id: string;
  email: string;
  role: 'owner' | 'editor';
  emailVerifiedAt: Date | null;
  totpSecret: string | null;
  createdAt: Date;
}): AdminPublisherAccount {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
    totpEnabled: row.totpSecret != null && row.totpSecret.length > 0,
    createdAt: row.createdAt.toISOString(),
  };
}

async function publisherExists(db: Db, publisherId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.publishers.id })
    .from(schema.publishers)
    .where(eq(schema.publishers.id, publisherId))
    .limit(1);
  return Boolean(row);
}

export async function listDbPublisherAccounts(
  db: Db,
  publisherId: string,
): Promise<AdminPublisherAccountListResponse | null> {
  if (!(await publisherExists(db, publisherId))) return null;
  const rows = await db
    .select({
      id: schema.publisherAccounts.id,
      email: schema.publisherAccounts.email,
      role: schema.publisherMembers.role,
      emailVerifiedAt: schema.publisherAccounts.emailVerifiedAt,
      totpSecret: schema.publisherAccounts.totpSecret,
      createdAt: schema.publisherAccounts.createdAt,
    })
    .from(schema.publisherMembers)
    .innerJoin(
      schema.publisherAccounts,
      eq(schema.publisherAccounts.id, schema.publisherMembers.publisherAccountId),
    )
    .where(eq(schema.publisherMembers.publisherId, publisherId))
    .orderBy(asc(schema.publisherAccounts.email));
  return { items: rows.map(rowToAccount) };
}

async function findAccountByEmail(db: Db, email: string) {
  const [row] = await db
    .select()
    .from(schema.publisherAccounts)
    .where(sql`lower(${schema.publisherAccounts.email}) = ${email}`)
    .limit(1);
  return row ?? null;
}

export async function lookupDbPublisherAccount(
  db: Db,
  publisherId: string,
  email: string,
): Promise<
  { ok: true; status: PublisherAccountLookupStatus } | { ok: false; reason: 'not_found' }
> {
  if (!(await publisherExists(db, publisherId))) return { ok: false, reason: 'not_found' };
  const existing = await findAccountByEmail(db, email.trim().toLowerCase());
  if (!existing) return { ok: true, status: 'new' };
  const [member] = await db
    .select({ publisherId: schema.publisherMembers.publisherId })
    .from(schema.publisherMembers)
    .where(
      and(
        eq(schema.publisherMembers.publisherId, publisherId),
        eq(schema.publisherMembers.publisherAccountId, existing.id),
      ),
    )
    .limit(1);
  return { ok: true, status: member ? 'already_member' : 'existing' };
}

export async function createDbPublisherAccount(
  db: Db,
  publisherId: string,
  body: AdminCreatePublisherAccountRequest,
  at: Date,
): Promise<CreateAccountResult> {
  if (!(await publisherExists(db, publisherId))) return { ok: false, reason: 'not_found' };
  const email = body.email.trim().toLowerCase();
  const existing = await findAccountByEmail(db, email);
  if (existing) {
    const [member] = await db
      .select({ publisherId: schema.publisherMembers.publisherId })
      .from(schema.publisherMembers)
      .where(
        and(
          eq(schema.publisherMembers.publisherId, publisherId),
          eq(schema.publisherMembers.publisherAccountId, existing.id),
        ),
      )
      .limit(1);
    if (member) return { ok: false, reason: 'already_member' };
    await db.insert(schema.publisherMembers).values({
      publisherId,
      publisherAccountId: existing.id,
      role: body.role,
    });
    return {
      ok: true,
      account: rowToAccount({
        id: existing.id,
        email: existing.email,
        role: body.role,
        emailVerifiedAt: existing.emailVerifiedAt,
        totpSecret: existing.totpSecret,
        createdAt: existing.createdAt,
      }),
    };
  }
  if (!body.password) return { ok: false, reason: 'password_required' };
  const id = randomUUID();
  const passwordHash = await hashPassword(body.password);
  await db.transaction(async (tx) => {
    await tx.insert(schema.publisherAccounts).values({
      id,
      email,
      passwordHash,
      emailVerifiedAt: at,
    });
    await tx.insert(schema.publisherMembers).values({
      publisherId,
      publisherAccountId: id,
      role: body.role,
    });
  });
  return {
    ok: true,
    account: {
      id,
      email,
      role: body.role,
      emailVerifiedAt: at.toISOString(),
      totpEnabled: false,
      createdAt: at.toISOString(),
    },
  };
}

export async function patchDbPublisherAccount(
  db: Db,
  publisherId: string,
  accountId: string,
  body: AdminPatchPublisherAccountRequest,
): Promise<AccountResult> {
  if (!(await publisherExists(db, publisherId))) return { ok: false, reason: 'not_found' };
  const [member] = await db
    .select({ role: schema.publisherMembers.role })
    .from(schema.publisherMembers)
    .where(
      and(
        eq(schema.publisherMembers.publisherId, publisherId),
        eq(schema.publisherMembers.publisherAccountId, accountId),
      ),
    )
    .limit(1);
  const [account] = await db
    .select()
    .from(schema.publisherAccounts)
    .where(eq(schema.publisherAccounts.id, accountId))
    .limit(1);
  if (!member || !account) return { ok: false, reason: 'not_found' };
  await db
    .update(schema.publisherMembers)
    .set({ role: body.role })
    .where(
      and(
        eq(schema.publisherMembers.publisherId, publisherId),
        eq(schema.publisherMembers.publisherAccountId, accountId),
      ),
    );
  const [updated] = await db
    .select()
    .from(schema.publisherAccounts)
    .where(eq(schema.publisherAccounts.id, accountId))
    .limit(1);
  return {
    ok: true,
    account: rowToAccount({
      id: accountId,
      email: updated?.email ?? account.email,
      role: body.role,
      emailVerifiedAt: updated?.emailVerifiedAt ?? account.emailVerifiedAt,
      totpSecret: updated?.totpSecret ?? null,
      createdAt: updated?.createdAt ?? account.createdAt,
    }),
  };
}

export async function removeDbPublisherAccount(
  db: Db,
  publisherId: string,
  accountId: string,
): Promise<RemoveResult> {
  if (!(await publisherExists(db, publisherId))) return { ok: false, reason: 'not_found' };
  const [member] = await db
    .select({ publisherId: schema.publisherMembers.publisherId })
    .from(schema.publisherMembers)
    .where(
      and(
        eq(schema.publisherMembers.publisherId, publisherId),
        eq(schema.publisherMembers.publisherAccountId, accountId),
      ),
    )
    .limit(1);
  if (!member) return { ok: false, reason: 'not_found' };
  await db
    .delete(schema.publisherMembers)
    .where(
      and(
        eq(schema.publisherMembers.publisherId, publisherId),
        eq(schema.publisherMembers.publisherAccountId, accountId),
      ),
    );
  return { ok: true };
}

function directoryItem(account: {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  totpSecret: string | null;
  createdAt: Date;
}): AdminPublisherAccountDirectoryItem {
  return {
    id: account.id,
    email: account.email,
    emailVerifiedAt: account.emailVerifiedAt?.toISOString() ?? null,
    totpEnabled: account.totpSecret != null && account.totpSecret.length > 0,
    createdAt: account.createdAt.toISOString(),
  };
}

export function listMemoryPublisherAccountDirectory(
  store: PublisherAccountMemory,
): AdminPublisherAccountDirectoryResponse {
  const { accounts } = ensureAccounts(store);
  const items = [...accounts.values()]
    .map((account) => directoryItem(account))
    .sort((a, b) => a.email.localeCompare(b.email));
  return { items };
}

export async function setMemoryPublisherAccountPassword(
  store: PublisherAccountMemory,
  accountId: string,
  body: AdminPublisherAccountPasswordRequest,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' }> {
  const account = ensureAccounts(store).accounts.get(accountId);
  if (!account) return { ok: false, reason: 'not_found' };
  account.passwordHash = await hashPassword(body.password);
  return { ok: true };
}

export async function listDbPublisherAccountDirectory(
  db: Db,
): Promise<AdminPublisherAccountDirectoryResponse> {
  const rows = await db
    .select({
      id: schema.publisherAccounts.id,
      email: schema.publisherAccounts.email,
      emailVerifiedAt: schema.publisherAccounts.emailVerifiedAt,
      totpSecret: schema.publisherAccounts.totpSecret,
      createdAt: schema.publisherAccounts.createdAt,
    })
    .from(schema.publisherAccounts)
    .orderBy(asc(schema.publisherAccounts.email));
  return { items: rows.map(directoryItem) };
}

export async function setDbPublisherAccountPassword(
  db: Db,
  accountId: string,
  body: AdminPublisherAccountPasswordRequest,
  at: Date,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' }> {
  const [account] = await db
    .select({ id: schema.publisherAccounts.id })
    .from(schema.publisherAccounts)
    .where(eq(schema.publisherAccounts.id, accountId))
    .limit(1);
  if (!account) return { ok: false, reason: 'not_found' };
  const passwordHash = await hashPassword(body.password);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.publisherAccounts)
      .set({ passwordHash })
      .where(eq(schema.publisherAccounts.id, accountId));
    await tx
      .update(schema.sessions)
      .set({ revokedAt: at })
      .where(
        and(
          eq(schema.sessions.subjectType, 'publisher_account'),
          eq(schema.sessions.subjectId, accountId),
        ),
      );
  });
  return { ok: true };
}
