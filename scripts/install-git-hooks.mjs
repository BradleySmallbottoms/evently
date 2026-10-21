import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Docker images run `pnpm install` without git. Leave those builds alone.
const git = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'ignore' });
if (git.error || git.status !== 0) process.exit(0);

const set = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'ignore',
});
if (set.error || set.status !== 0) process.exit(0);
