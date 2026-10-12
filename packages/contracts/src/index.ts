import { z } from 'zod';

/** Shared request/response schemas. API routes, generated clients and apps all build on these. */

export const Id = z.uuid();

export const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const EventMode = z.enum(['physical', 'digital']);
export type EventMode = z.infer<typeof EventMode>;

export const EventStatus = z.enum([
  'draft',
  'awaiting_verification',
  'in_review',
  'published',
  'cancelled',
  'ended',
]);
export type EventStatus = z.infer<typeof EventStatus>;

export const EventOrigin = z.enum(['native', 'imported']);
export type EventOrigin = z.infer<typeof EventOrigin>;

export const Locale = z.enum(['sv', 'en']);
export type Locale = z.infer<typeof Locale>;
export const DEFAULT_LOCALE: Locale = 'sv';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.string(),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export * from './admin';
export * from './auth';
export * from './check-ins';
export * from './devices';
export * from './domain-events';
export * from './events';
export * from './event-content';
export * from './notifications';
export * from './preferences';
export * from './profile';
export * from './ratings';
export * from './regions';
export * from './stats';
export * from './subscriptions';
