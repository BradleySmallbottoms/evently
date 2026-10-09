import { describe, expect, it } from 'vitest';
import { processMessage } from '../../../apps/worker/src/handlers';

const EVENT_ID = '11111111-1111-4111-8111-111111111101';

describe('processMessage', () => {
  it('fails closed when notify deps are missing', async () => {
    await expect(
      processMessage(JSON.stringify({ type: 'event.published', eventId: EVENT_ID })),
    ).rejects.toThrow('notify_unavailable');
  });
  it('rejects unknown types', async () => {
    await expect(processMessage(JSON.stringify({ type: 'nope' }))).rejects.toThrow();
  });
  it('rejects invalid event ids', async () => {
    await expect(
      processMessage(JSON.stringify({ type: 'event.published', eventId: 'not-a-uuid' })),
    ).rejects.toThrow();
  });
});
