import { z } from 'zod';

const Id = z.uuid();

export const StatsSourceType = z.enum(['user', 'event', 'publisher']);
export type StatsSourceType = z.infer<typeof StatsSourceType>;

export const StatMutation = z
  .object({
    key: z.string().trim().min(1).max(120),
    add: z.number().finite().optional(),
    remove: z.number().finite().optional(),
    value: z.number().finite().optional(),
  })
  .superRefine((val, ctx) => {
    const modes = [val.add !== undefined, val.remove !== undefined, val.value !== undefined].filter(
      Boolean,
    ).length;
    if (modes !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Exactly one of add, remove, or value is required',
      });
    }
  });
export type StatMutation = z.infer<typeof StatMutation>;

export const UpdateStatsRequest = z.array(StatMutation).min(1).max(200);
export type UpdateStatsRequest = z.infer<typeof UpdateStatsRequest>;

export const StatEntry = z.object({
  sourceType: StatsSourceType,
  sourceId: Id,
  key: z.string(),
  value: z.number(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StatEntry = z.infer<typeof StatEntry>;

export const StatsListResponse = z.object({
  items: z.array(StatEntry),
});
export type StatsListResponse = z.infer<typeof StatsListResponse>;
