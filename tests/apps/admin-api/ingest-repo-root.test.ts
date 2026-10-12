import { ingestRepoRoot } from '../../../apps/admin-api/src/services/data-sources';
import { describe, expect, it } from 'vitest';

describe('ingestRepoRoot', () => {
  it('resolves the monorepo root from the data-sources module', () => {
    const root = ingestRepoRoot('file:///repo/apps/admin-api/src/services/data-sources.ts');
    expect(root).toBe('/repo');
  });
});
