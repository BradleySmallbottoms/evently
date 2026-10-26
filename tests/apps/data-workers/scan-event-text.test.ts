import { publicEventMeta } from '../../../packages/contracts/src/events';
import { describe, expect, it } from 'vitest';
import { scanEventLines } from '../../../apps/data-workers/src/scan-event-text';

describe('scanEventLines', () => {
  it('sends the chat lines as a tip and keeps the written description separate', () => {
    const lines = scanEventLines({
      description: 'En kväll på Krusmynta.',
      tip: {
        text: 'title: Krusmyntanätterna\nprice: free',
        categoryHint: 'Musik',
      },
    });
    expect(lines).toEqual([
      'Tip chat (facts from the submitter, not visitor steps):',
      'title: Krusmyntanätterna\nprice: free',
      'Description: En kväll på Krusmynta.',
      'Category: Musik',
    ]);
  });

  it('keeps the description for an imported event', () => {
    expect(scanEventLines({ description: 'Elitseriebandy i arenan.' })).toEqual([
      'Description: Elitseriebandy i arenan.',
    ]);
  });
});

describe('publicEventMeta', () => {
  it('omits the tip chat', () => {
    expect(publicEventMeta({ fromUserTip: true, tip: { text: 'price: free' } })).toEqual({
      fromUserTip: true,
    });
    expect(
      publicEventMeta({
        fromUserTip: true,
        mergedDuplicates: [{ eventId: '44444444-4444-4444-8444-444444444401', title: 'Other' }],
        duplicateOf: { eventId: '44444444-4444-4444-8444-444444444402', title: 'Host' },
      }),
    ).toEqual({ fromUserTip: true });
  });
});
