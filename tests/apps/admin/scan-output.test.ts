import { describe, expect, it } from 'vitest';
import { readScanView } from '../../../apps/admin/src/app/[locale]/events/[id]/components/scan-output';

const scan = {
  reasoning_content: 'The trail run matches sport.',
  contentVerdict: 'safe',
  possibleTags: [{ id: 'sport', score: 95 }],
};

describe('readScanView', () => {
  it('lifts the final object and its reasoning out of the model response', () => {
    const view = readScanView({
      choices: [{ message: { content: JSON.stringify(scan), reasoning_content: '' } }],
      usage: { total_tokens: 10 },
    });
    expect(view?.reasoning).toBe('The trail run matches sport.');
    expect(view?.finalObject).toEqual({
      contentVerdict: 'safe',
      possibleTags: [{ id: 'sport', score: 95 }],
    });
    expect(view?.full).toContain('"usage"');
  });

  it('uses the message reasoning when the scan object has none', () => {
    const view = readScanView({
      choices: [
        {
          message: {
            content: JSON.stringify({ contentVerdict: 'spam' }),
            reasoning_content: 'This is an advert.',
          },
        },
      ],
    });
    expect(view?.reasoning).toBe('This is an advert.');
    expect(view?.finalObject).toEqual({ contentVerdict: 'spam' });
  });

  it('returns nothing when there is no output', () => {
    expect(readScanView(null)).toBeNull();
  });
});
