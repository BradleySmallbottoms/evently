import { z } from 'zod';

export const SubscriptionTargetType = z.enum(['publisher', 'event']);
export type SubscriptionTargetType = z.infer<typeof SubscriptionTargetType>;

export const Subscription = z.object({
  targetType: SubscriptionTargetType,
  targetId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type Subscription = z.infer<typeof Subscription>;

export const SubscriptionListResponse = z.object({
  items: z.array(Subscription),
});
export type SubscriptionListResponse = z.infer<typeof SubscriptionListResponse>;

export const CreateSubscriptionRequest = z.object({
  targetType: SubscriptionTargetType,
  targetId: z.uuid(),
});
export type CreateSubscriptionRequest = z.infer<typeof CreateSubscriptionRequest>;

export const DeleteSubscriptionParams = z.object({
  targetType: SubscriptionTargetType,
  targetId: z.uuid(),
});
export type DeleteSubscriptionParams = z.infer<typeof DeleteSubscriptionParams>;
