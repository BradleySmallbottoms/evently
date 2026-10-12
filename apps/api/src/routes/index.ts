import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AuthServices } from '../services/auth/types';
import type { CheckInServices } from '../services/check-ins/types';
import type { EventContentServices } from '../services/event-content/types';
import type { EventServices } from '../services/events/types';
import type { NotificationServices } from '../services/notifications/types';
import type { PreferenceServices } from '../services/preferences/types';
import type { RatingServices } from '../services/ratings/types';
import type { RegionServices } from '../services/regions/types';
import type { StatsServices } from '../services/stats/types';
import type { LibraryServices } from '../services/library/types';
import type { SubscriptionServices } from '../services/subscriptions/types';
import { registerAssetRoutes } from './assets';
import { registerTagRoutes } from './tags';
import { registerCheckInRoutes } from './check-ins';
import { registerEventContentRoutes } from './event-content';
import { registerEventRoutes } from './events';
import { registerIdentityRoutes } from './identities';
import { registerLibraryRoutes } from './library';
import { registerMeRoutes } from './me';
import { registerPairingRoutes } from './pairing';
import { registerPublisherRoutes } from './publishers';
import { registerRatingRoutes } from './ratings';
import { registerRegionRoutes } from './regions';
import { registerSessionRoutes } from './sessions';
import { registerStatsRoutes } from './stats';
import { registerSubscriptionRoutes } from './subscriptions';

export type ApiRouteServices = {
  auth: AuthServices;
  events: EventServices;
  preferences: PreferenceServices;
  regions: RegionServices;
  subscriptions: SubscriptionServices;
  library: LibraryServices;
  checkIns: CheckInServices;
  notifications: NotificationServices;
  eventContent: EventContentServices;
  ratings: RatingServices;
  stats: StatsServices;
};

/**
 * Register versioned route groups (paths without `/vN` — the app mounts this at `API_PREFIX`).
 * Health is registered separately on the root app.
 */
export function registerRoutes(
  app: OpenAPIHono,
  services: ApiRouteServices,
  options: { assetsPublicBaseUrl?: string } = {},
): void {
  registerIdentityRoutes(app, services.auth);
  registerSessionRoutes(app, services.auth);
  registerPairingRoutes(app, services.auth);
  registerPublisherRoutes(app, services.auth);
  registerMeRoutes(app, services.preferences, services.auth, services.notifications);
  registerSubscriptionRoutes(app, services.subscriptions);
  registerLibraryRoutes(app, services.library);
  registerRegionRoutes(app, services.regions);
  registerAssetRoutes(app, options.assetsPublicBaseUrl);
  registerTagRoutes(app, services.events);
  registerEventRoutes(app, services.events);
  registerCheckInRoutes(app, services.checkIns);
  registerEventContentRoutes(app, services.eventContent);
  registerRatingRoutes(app, services.ratings);
  registerStatsRoutes(app, services.stats);
}
