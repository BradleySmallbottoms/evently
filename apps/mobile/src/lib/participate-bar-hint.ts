/** Set once the participate bar has been opened. Kept until the app is removed. */
export const PARTICIPATE_BAR_HINT_SEEN_KEY = 'le.participateBarHintSeen';

export const PARTICIPATE_BAR_HINT_SEEN_VALUE = '1';

export function isParticipateBarHintSeen(raw: string | null | undefined): boolean {
  return raw === PARTICIPATE_BAR_HINT_SEEN_VALUE;
}
