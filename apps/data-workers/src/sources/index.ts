import type { SourceAdapter } from '@local-events/ingest';
import { destinationHalsingland } from './destination-halsingland';
import { exampleFixture } from './example-fixture';
import { gladaHudik } from './glada-hudik';
import { icsFeed } from './ics-feed';
import { visitSoderhamn } from './visit-soderhamn';

/** Every source adapter is registered here by slug (matching data_sources.slug). */
export const sources: Record<string, SourceAdapter<any>> = {
  [exampleFixture.slug]: exampleFixture,
  [visitSoderhamn.slug]: visitSoderhamn,
  [gladaHudik.slug]: gladaHudik,
  [destinationHalsingland.slug]: destinationHalsingland,
  [icsFeed.slug]: icsFeed,
};

/** Slugs that identify a data source, not an organizer. They never match across workers. */
export const LOCAL_ORGANIZER_SLUGS = Object.keys(sources);
