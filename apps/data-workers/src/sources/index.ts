import type { SourceAdapter } from '@local-events/ingest';
import { exampleFixture } from './example-fixture';

/** Every source adapter is registered here by slug (matching data_sources.slug). */
export const sources: Record<string, SourceAdapter<any>> = {
  [exampleFixture.slug]: exampleFixture,
};
