export const RATING_WINDOW_DAYS = 14;

export interface RatingContext {
  hasCheckIn: boolean;
  alreadyRated: boolean;
  isOwnEvent: boolean;
  eventEndsAt: Date;
  now: Date;
}

/** Only checked-in attendees may rate, once, from the event's end until 14 days after. */
export function canRate(ctx: RatingContext): boolean {
  if (!ctx.hasCheckIn || ctx.alreadyRated || ctx.isOwnEvent) return false;
  const closesAt = ctx.eventEndsAt.getTime() + RATING_WINDOW_DAYS * 86_400_000;
  return ctx.now >= ctx.eventEndsAt && ctx.now.getTime() <= closesAt;
}

/** Anonymous users can give a score but not write a comment. */
export function canComment(user: { displayName: string | null; isPublic: boolean }): boolean {
  return user.displayName !== null && user.isPublic;
}
