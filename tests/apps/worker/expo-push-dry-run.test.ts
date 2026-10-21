import { afterEach, describe, expect, it } from 'vitest';
import { createExpoPushClient, isPushDryRun } from '../../../apps/worker/src/notify/expo-push';

const original = process.env.PUSH_DRY_RUN;

afterEach(() => {
  if (original === undefined) delete process.env.PUSH_DRY_RUN;
  else process.env.PUSH_DRY_RUN = original;
});

describe('isPushDryRun', () => {
  it('is on only for 1, true, and yes', () => {
    expect(isPushDryRun({ PUSH_DRY_RUN: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isPushDryRun({ PUSH_DRY_RUN: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isPushDryRun({ PUSH_DRY_RUN: ' YES ' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isPushDryRun({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isPushDryRun({ PUSH_DRY_RUN: '0' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('createExpoPushClient dry run', () => {
  it('does not call Expo when PUSH_DRY_RUN is set', async () => {
    process.env.PUSH_DRY_RUN = '1';
    let called = false;
    const client = createExpoPushClient(async () => {
      called = true;
      throw new Error('expo should not be called');
    });
    const tickets = await client.send([{ to: 'ExponentPushToken[abc]', data: { kind: 'inbox' } }]);
    expect(called).toBe(false);
    expect(tickets).toEqual([
      { status: 'error', message: 'dry_run', details: { error: 'DryRun' } },
    ]);
  });
});
