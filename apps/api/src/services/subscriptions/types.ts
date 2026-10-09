import type {
  CreateSubscriptionRequest,
  Subscription,
  SubscriptionListResponse,
  SubscriptionTargetType,
} from '@local-events/contracts';

export type SubscriptionErrorCode = 'unauthorized' | 'not_found' | 'invalid_target';

export class SubscriptionError extends Error {
  constructor(readonly code: SubscriptionErrorCode) {
    super(code);
    this.name = 'SubscriptionError';
  }
}

export type SubscriptionServices = {
  list: (sessionToken: string | undefined) => Promise<SubscriptionListResponse>;
  create: (
    sessionToken: string | undefined,
    input: CreateSubscriptionRequest,
  ) => Promise<Subscription>;
  remove: (
    sessionToken: string | undefined,
    targetType: SubscriptionTargetType,
    targetId: string,
  ) => Promise<void>;
};
