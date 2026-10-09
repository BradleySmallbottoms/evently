import { z } from 'zod';

export const UserProfile = z.object({
  displayName: z.string().nullable(),
  isPublic: z.boolean(),
  /** False until the first-check-in prompt is answered (named or anonymous). */
  profileChosen: z.boolean(),
  /** Present when set; never shown on public surfaces. */
  recoveryEmail: z.string().email().nullable(),
  recoveryEmailVerified: z.boolean(),
});
export type UserProfile = z.infer<typeof UserProfile>;

export const UpdateUserProfileRequest = z
  .object({
    choice: z.enum(['named', 'anonymous']),
    displayName: z.string().optional(),
    /** Defaults to true for named profiles (needed for rating comments). */
    isPublic: z.boolean().optional(),
    /** Optional; verification of recovery email is a later slice. */
    recoveryEmail: z.string().email().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.choice === 'named' && (val.displayName == null || val.displayName.trim() === '')) {
      ctx.addIssue({
        code: 'custom',
        path: ['displayName'],
        message: 'displayName is required when choice is named',
      });
    }
  });
export type UpdateUserProfileRequest = z.infer<typeof UpdateUserProfileRequest>;
