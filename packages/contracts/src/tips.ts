import { z } from 'zod';

const Id = z.uuid();
const Locale = z.enum(['sv', 'en']);

export const TipPath = z.enum(['photo', 'text']);
export type TipPath = z.infer<typeof TipPath>;

export const TipStatus = z.enum(['collecting', 'needs_input', 'submitted', 'scanned', 'failed']);
export type TipStatus = z.infer<typeof TipStatus>;

export const TipPhase = z.enum([
  'collecting',
  'scanning',
  'confirm',
  'follow_up',
  'receipt',
  'published',
  'review',
  'failed',
]);
export type TipPhase = z.infer<typeof TipPhase>;

export const TipImageContentType = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const TipAskOption = z.object({
  label: z.string(),
  reply: z.string().nullable(),
});
export type TipAskOption = z.infer<typeof TipAskOption>;

export const TipCard = z.object({
  title: z.string().max(200).nullable(),
  startsAt: z.string().max(40).nullable(),
  place: z.string().max(200).nullable(),
  priceLabel: z.string().max(40).nullable(),
  link: z
    .string()
    .max(500)
    .refine((value) => value.length === 0 || !/^https?:\/\//i.test(value))
    .nullable(),
  endsAt: z.string().max(40).nullable(),
  summary: z.string().max(500).nullable(),
  tags: z.array(z.string().max(80)).max(8),
});
export type TipCard = z.infer<typeof TipCard>;

export const TipFound = z.object({
  title: z.string().nullable(),
  startsAt: z.string().nullable(),
  place: z.string().nullable(),
  priceLabel: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
});
export type TipFound = z.infer<typeof TipFound>;

export const TipTimeline = z.object({
  submittedAt: z.iso.datetime().nullable(),
  analyzedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
});
export type TipTimeline = z.infer<typeof TipTimeline>;

export const Tip = z.object({
  id: Id,
  path: TipPath,
  status: TipStatus,
  phase: TipPhase,
  locale: Locale,
  card: TipCard.nullable(),
  /** Which follow-up questions are still empty. Null when that screen is not showing. */
  followUp: z
    .object({
      category: z.boolean(),
      image: z.boolean(),
      description: z.boolean(),
    })
    .nullable(),
  eventId: Id.nullable(),
  scanStatus: z.string().nullable(),
  imageStatus: z.enum(['none', 'scanning', 'ready', 'failed']),
  timeline: TipTimeline,
  found: TipFound.nullable(),
  previewImageUrl: z.url().nullable(),
  /** Filled facts, and how many of those the person has accepted. */
  progress: z.object({
    done: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    verified: z.number().int().nonnegative(),
  }),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      body: z.string(),
      /** Which fact this bot line is asking for. Null on a person's message. */
      key: z
        .enum([
          'title',
          'startDate',
          'startTime',
          'endDate',
          'endTime',
          'date',
          'end',
          'place',
          'price',
          'link',
          'description',
          'image',
        ])
        .nullable(),
      options: z.array(TipAskOption),
      createdAt: z.iso.datetime(),
    }),
  ),
  /** The question the bot is asking now. Null when the chat is not waiting. */
  question: z
    .object({
      key: z.enum([
        'title',
        'startDate',
        'startTime',
        'endDate',
        'endTime',
        'date',
        'end',
        'place',
        'price',
        'link',
        'description',
        'image',
      ]),
      question: z.string(),
      options: z.array(TipAskOption),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
  /** Set on the reply that refused a typed text. A later read is null. */
  warning: z.string().max(240).nullable(),
});
export type Tip = z.infer<typeof Tip>;

export const TipListResponse = z.object({
  items: z.array(Tip),
});
export type TipListResponse = z.infer<typeof TipListResponse>;

export const CreateTipRequest = z.object({
  path: TipPath,
  locale: Locale.optional(),
});
export type CreateTipRequest = z.infer<typeof CreateTipRequest>;

export const TipTextRequest = z.object({
  text: z.string().trim().min(1).max(500),
});
export type TipTextRequest = z.infer<typeof TipTextRequest>;

export const TipImageRequest = z.object({
  contentType: TipImageContentType,
  dataBase64: z.string().trim().min(1).max(11_184_812),
});
export type TipImageRequest = z.infer<typeof TipImageRequest>;

export const ConfirmTipRequest = z.object({
  card: TipCard.partial().optional(),
  categoryHint: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  /** True on the follow-up screen, including when every field is left empty. */
  submitFollowUp: z.boolean().optional(),
});
export type ConfirmTipRequest = z.infer<typeof ConfirmTipRequest>;

export const TipIdParam = z.object({
  tipId: Id,
});
