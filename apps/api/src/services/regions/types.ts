import type { RegionLookupQuery, RegionLookupResponse } from '@local-events/contracts';

export type RegionServices = {
  lookup: (query: RegionLookupQuery) => Promise<RegionLookupResponse>;
};
