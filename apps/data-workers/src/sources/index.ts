import type { SourceAdapter } from '@local-events/ingest';
import { billetto } from './billetto';
import { bollnasKommun } from './bollnas-kommun';
import { destinationHalsingland } from './destination-halsingland';
import { exampleFixture } from './example-fixture';
import { gladaHudik } from './glada-hudik';
import { HTML_CALENDAR_SLUGS, htmlCalendarSource } from './html-calendar';
import { icsFeed } from './ics-feed';
import { kulturbiljetter } from './kulturbiljetter';
import { nortic } from './nortic';
import { soderhamnBiblioteket } from './soderhamn-biblioteket';
import { tickster } from './tickster';
import { visitSoderhamn } from './visit-soderhamn';

/** Every source adapter is registered here by slug (matching data_sources.slug). */
export const sources: Record<string, SourceAdapter<any>> = {
  [exampleFixture.slug]: exampleFixture,
  [visitSoderhamn.slug]: visitSoderhamn,
  [gladaHudik.slug]: gladaHudik,
  [destinationHalsingland.slug]: destinationHalsingland,
  [icsFeed.slug]: icsFeed,
  [soderhamnBiblioteket.slug]: soderhamnBiblioteket,
  [bollnasKommun.slug]: bollnasKommun,
  [tickster.slug]: tickster,
  [kulturbiljetter.slug]: kulturbiljetter,
  [billetto.slug]: billetto,
  [nortic.slug]: nortic,
};

for (const slug of HTML_CALENDAR_SLUGS) {
  sources[slug] = htmlCalendarSource(slug);
}

/** Slugs that identify a data source, not an organizer. They never match across workers. */
export const LOCAL_ORGANIZER_SLUGS = Object.keys(sources);
