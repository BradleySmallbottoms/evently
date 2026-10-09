import { z } from 'zod';

export const RegisterPushTokenRequest = z.object({
  deviceCredential: z.string().min(1),
  /** Expo push token, e.g. ExponentPushToken[…]. */
  expoPushToken: z.string().min(1).max(512),
});
export type RegisterPushTokenRequest = z.infer<typeof RegisterPushTokenRequest>;

export const RegisterPushTokenResponse = z.object({
  ok: z.literal(true),
});
export type RegisterPushTokenResponse = z.infer<typeof RegisterPushTokenResponse>;
