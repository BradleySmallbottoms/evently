import type { SourceAdapter } from '@local-events/ingest';
import { exampleFixture } from './example-fixture';
import { icsFeed } from './ics-feed';
import { visitSoderhamn } from './visit-soderhamn';

/** Every source adapter is registered here by slug (matching data_sources.slug). */
export const sources: Record<string, SourceAdapter<any>> = {
  [exampleFixture.slug]: exampleFixture,
  [visitSoderhamn.slug]: visitSoderhamn,
  [icsFeed.slug]: icsFeed,
};
