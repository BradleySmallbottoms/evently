import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const prettierBin = require.resolve('prettier/bin/prettier.cjs');

const files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .map((file) => file.trim())
  .filter(Boolean);

if (files.length === 0) process.exit(0);

execFileSync(process.execPath, [prettierBin, '--write', '--ignore-unknown', ...files], {
  cwd: root,
  stdio: 'inherit',
});
execFileSync('git', ['add', '--', ...files], { cwd: root, stdio: 'inherit' });
