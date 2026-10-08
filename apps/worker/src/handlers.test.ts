import { describe, expect, it } from 'vitest';
import { processMessage } from './handlers';

describe('processMessage', () => {
  it('dispatches by type', async () => {
    await expect(
      processMessage(JSON.stringify({ type: 'event.published', eventId: 'e1' })),
    ).resolves.toBe('event.published');
  });
  it('rejects unknown types', async () => {
    await expect(processMessage(JSON.stringify({ type: 'nope' }))).rejects.toThrow();
  });
});
