import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AuthServices } from '../services/auth/types';
import type { CheckInServices } from '../services/check-ins/types';
import type { EventServices } from '../services/events/types';
import type { NotificationServices } from '../services/notifications/types';
import type { PreferenceServices } from '../services/preferences/types';
import type { RegionServices } from '../services/regions/types';
import type { SubscriptionServices } from '../services/subscriptions/types';
import { registerCategoryRoutes } from './categories';
import { registerCheckInRoutes } from './check-ins';
import { registerEventRoutes } from './events';
import { registerIdentityRoutes } from './identities';
import { registerMeRoutes } from './me';
import { registerPairingRoutes } from './pairing';
import { registerPublisherRoutes } from './publishers';
import { registerRegionRoutes } from './regions';
import { registerSessionRoutes } from './sessions';
import { registerSubscriptionRoutes } from './subscriptions';

export type ApiRouteServices = {
  auth: AuthServices;
  events: EventServices;
  preferences: PreferenceServices;
  regions: RegionServices;
  subscriptions: SubscriptionServices;
  checkIns: CheckInServices;
  notifications: NotificationServices;
};

/**
 * Register versioned route groups (paths without `/vN` — the app mounts this at `API_PREFIX`).
 * Health is registered separately on the root app.
 */
export function registerRoutes(app: OpenAPIHono, services: ApiRouteServices): void {
  registerIdentityRoutes(app, services.auth);
  registerSessionRoutes(app, services.auth);
  registerPairingRoutes(app, services.auth);
  registerPublisherRoutes(app, services.auth);
  registerMeRoutes(app, services.preferences, services.auth, services.notifications);
  registerSubscriptionRoutes(app, services.subscriptions);
  registerRegionRoutes(app, services.regions);
  registerCategoryRoutes(app, services.events);
  registerEventRoutes(app, services.events);
  registerCheckInRoutes(app, services.checkIns);
}
