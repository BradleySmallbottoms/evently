import { tagSlug } from '@local-events/domain';

export type EventPlaceholderKind = 'music' | 'workout' | 'lecture' | 'culture' | 'generic';

const MUSIC = new Set([
  'dans',
  'fest',
  'festival',
  'julkonsert',
  'konsert',
  'musik-underhallning',
  'show',
  'spelmansstamma',
  'soderhamns-kulturfestival',
]);

const WORKOUT = new Set([
  'alpint-langdskidor',
  'bandy-innebandy',
  'bowling',
  'fotboll',
  'golf',
  'hastsport',
  'hockey',
  'idrott',
  'idrott-tavlingar',
  'skateboard',
  'tavlingar',
  'tennis',
  'vandringar',
  'yoga',
]);

const LECTURE = new Set(['forelasningar-seminarier', 'naringsliv']);

const CULTURE = new Set([
  'film-teater',
  'guidning',
  'halsingegard',
  'massa',
  'massor-utstallningar',
  'skapande-hantverk',
  'utstallning',
]);

function isMusic(slug: string): boolean {
  if (MUSIC.has(slug)) return true;
  return /musik|konsert|festival|spelman|underhallning/.test(slug);
}

function isWorkout(slug: string): boolean {
  if (slug.endsWith('lov')) return false;
  if (WORKOUT.has(slug)) return true;
  return /idrott|fotboll|hockey|bandy|skid|golf|tennis|bowling|skate|vandring|hast|traning|lopning|yoga/.test(
    slug,
  );
}

function isLecture(slug: string): boolean {
  if (LECTURE.has(slug)) return true;
  return /forelasning|seminari|naringsliv/.test(slug);
}

function isCulture(slug: string): boolean {
  if (CULTURE.has(slug)) return true;
  return /utstallning|teater|museum|galleri|hantverk|guidning|halsingegard|^kultur/.test(slug);
}

/**
 * A talk, concert, or sport tag wins over a broader culture tag, so a lecture
 * filed under exhibitions still gets the auditorium. Within those scenes, the
 * first tag wins. Anything else is the generic scene.
 */
export function eventPlaceholderKind(tags: readonly string[] | undefined): EventPlaceholderKind {
  let culture = false;
  for (const tag of tags ?? []) {
    const slug = tagSlug(tag);
    if (isMusic(slug)) return 'music';
    if (isWorkout(slug)) return 'workout';
    if (isLecture(slug)) return 'lecture';
    if (isCulture(slug)) culture = true;
  }
  return culture ? 'culture' : 'generic';
}
