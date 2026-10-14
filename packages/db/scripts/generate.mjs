import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampNewEntries } from './migration-plan.mjs';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const journalPath = path.join(packageDir, 'migrations/meta/_journal.json');
const before = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
const previousTags = before.entries.map((entry) => entry.tag);

const generated = spawnSync('drizzle-kit', ['generate', ...process.argv.slice(2)], {
  cwd: packageDir,
  stdio: 'inherit',
});
if (generated.status !== 0) process.exit(generated.status ?? 1);

const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
const stamped = stampNewEntries(journal.entries, previousTags);
if (stamped.length === 0) process.exit(0);

fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
for (const tag of stamped) {
  const entry = journal.entries.find((item) => item.tag === tag);
  console.log(`stamped ${tag} at ${entry.when} so it applies after earlier migrations`);
}
