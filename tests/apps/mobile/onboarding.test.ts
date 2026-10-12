import { describe, expect, it } from 'vitest';

import {
  REMINDER_EVERY_ACTIVATIONS,
  applyAppActivation,
  pendingReminderKinds,
  type OnboardingState,
} from '../../../apps/mobile/src/lib/onboarding-state';

function base(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    completed: true,
    notifications: 'skipped',
    location: 'skipped',
    activationCount: 0,
    nextReminderAtActivation: REMINDER_EVERY_ACTIVATIONS,
    lastReminderKind: null,
    ...overrides,
  };
}

describe('onboarding reminders', () => {
  it('lists only explicitly skipped permissions', () => {
    expect(pendingReminderKinds(base({ notifications: 'granted', location: 'skipped' }))).toEqual([
      'location',
    ]);
    expect(pendingReminderKinds(base({ notifications: null, location: null }))).toEqual([]);
  });

  it('does not remind before the activation threshold', () => {
    const { reminder, state } = applyAppActivation(base());
    expect(reminder).toBeNull();
    expect(state.activationCount).toBe(1);
  });

  it('opens one reminder at the threshold and schedules the next interval', () => {
    let state = base({ activationCount: REMINDER_EVERY_ACTIVATIONS - 1 });
    const first = applyAppActivation(state);
    expect(first.reminder).toBe('notifications');
    expect(first.state.nextReminderAtActivation).toBe(
      REMINDER_EVERY_ACTIVATIONS + REMINDER_EVERY_ACTIVATIONS,
    );

    state = { ...first.state, notifications: 'skipped' };
    // Activations until next threshold should not remind.
    for (let i = 0; i < REMINDER_EVERY_ACTIVATIONS - 1; i++) {
      const mid = applyAppActivation(state);
      expect(mid.reminder).toBeNull();
      state = mid.state;
    }
    const second = applyAppActivation(state);
    // Rotates to location after notifications was last shown.
    expect(second.reminder).toBe('location');
  });

  it('skips reminders when onboarding is incomplete', () => {
    const { reminder, state } = applyAppActivation(base({ completed: false }));
    expect(reminder).toBeNull();
    expect(state.activationCount).toBe(0);
  });
});
