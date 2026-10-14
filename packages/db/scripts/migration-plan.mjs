import crypto from 'node:crypto';

/** Same hash drizzle-kit stores in drizzle.__drizzle_migrations. */
export function migrationHash(sqlText) {
  return crypto.createHash('sha256').update(sqlText).digest('hex');
}

/**
 * Journal order. A file counts as applied when its hash is recorded, or when its
 * journal timestamp is already stored. The timestamp check matters when a file was
 * edited after it ran: the hash no longer matches, and running it again would replay
 * SQL that a later migration already undid.
 */
export function pendingMigrations(migrations, appliedHashes, appliedWhens = []) {
  const hashes = appliedHashes instanceof Set ? appliedHashes : new Set(appliedHashes);
  const whens = appliedWhens instanceof Set ? appliedWhens : new Set([...appliedWhens].map(Number));
  return migrations.filter(
    (migration) => !hashes.has(migration.hash) && !whens.has(Number(migration.when)),
  );
}

/** Refuse to run when the database has rows but none of them match these files. */
export function assertKnownMigrations(migrations, appliedHashes) {
  const applied = appliedHashes instanceof Set ? appliedHashes : new Set(appliedHashes);
  if (applied.size === 0) return;
  if (migrations.some((migration) => applied.has(migration.hash))) return;
  throw new Error(
    'Migration file hashes do not match drizzle.__drizzle_migrations. Refusing to apply.',
  );
}

/**
 * A new journal entry must sort after every entry that already existed.
 * drizzle-kit stamps Date.now(), which is behind the bumped timestamps in this repo.
 */
export function stampNewEntries(entries, previousTags) {
  const known = new Set(previousTags);
  let cursor = 0;
  for (const entry of entries) {
    if (known.has(entry.tag)) cursor = Math.max(cursor, entry.when);
  }
  const stamped = [];
  for (const entry of entries) {
    if (known.has(entry.tag)) continue;
    if (entry.when <= cursor) {
      cursor += 1;
      entry.when = cursor;
      stamped.push(entry.tag);
    } else {
      cursor = entry.when;
    }
  }
  return stamped;
}
