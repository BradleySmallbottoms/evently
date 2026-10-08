import { describe, expect, it } from 'vitest';
import { runSource } from './run';

describe('runSource', () => {
  it('maps and validates the example fixture', async () => {
    const summary = await runSource('example-fixture');
    expect(summary.fetched).toBe(2);
    expect(summary.valid).toBe(2);
    expect(summary.invalid).toEqual([]);
  });
  it('fails on unknown sources', async () => {
    await expect(runSource('nope')).rejects.toThrow(/Unknown source/);
  });
});
