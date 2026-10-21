export type PermissionKind = 'notifications' | 'location';
export type PermissionChoice = 'granted' | 'skipped' | 'denied';

export type OnboardingState = {
  /** Finished the first-run carousel (continue / last skip). */
  completed: boolean;
  notifications: PermissionChoice | null;
  location: PermissionChoice | null;
  /** How many times the app has come to the foreground since install. */
  activationCount: number;
  /** Show the next deferred reminder when activationCount reaches this. */
  nextReminderAtActivation: number;
  /** Last deferred reminder shown — used to rotate when both are still skipped. */
  lastReminderKind: PermissionKind | null;
};

/** Show one deferred permission reminder after this many app activations. */
export const REMINDER_EVERY_ACTIVATIONS = 5;

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  completed: false,
  notifications: null,
  location: null,
  activationCount: 0,
  nextReminderAtActivation: REMINDER_EVERY_ACTIVATIONS,
  lastReminderKind: null,
};

/** Permissions explicitly skipped during onboarding — candidates for deferred reminders. */
export function pendingReminderKinds(state: OnboardingState): PermissionKind[] {
  const kinds: PermissionKind[] = [];
  if (state.notifications === 'skipped') kinds.push('notifications');
  if (state.location === 'skipped') kinds.push('location');
  return kinds;
}

/**
 * Pure activation step.
 * At most one reminder per threshold; schedules the next after REMINDER_EVERY_ACTIVATIONS.
 */
export function applyAppActivation(state: OnboardingState): {
  state: OnboardingState;
  reminder: PermissionKind | null;
} {
  if (!state.completed) {
    return { state, reminder: null };
  }

  const activationCount = state.activationCount + 1;
  const pending = pendingReminderKinds(state);
  if (pending.length === 0) {
    return { state: { ...state, activationCount }, reminder: null };
  }

  let nextReminderAtActivation = state.nextReminderAtActivation;
  let reminder: PermissionKind | null = null;
  let lastReminderKind = state.lastReminderKind;

  if (activationCount >= state.nextReminderAtActivation) {
    const ordered =
      state.lastReminderKind && pending.length > 1
        ? [...pending.filter((k) => k !== state.lastReminderKind), state.lastReminderKind]
        : pending;
    reminder = ordered[0] ?? null;
    if (reminder) lastReminderKind = reminder;
    nextReminderAtActivation = activationCount + REMINDER_EVERY_ACTIVATIONS;
  }

  return {
    state: { ...state, activationCount, nextReminderAtActivation, lastReminderKind },
    reminder,
  };
}
