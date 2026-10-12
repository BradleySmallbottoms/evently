import { z } from 'zod';
import { Event } from './events';

const Id = z.uuid();

export const IdParam = z.object({
  id: Id,
});

export const EventIdParam = z.object({
  eventId: Id,
});

export const ListEventParams = z.object({
  id: Id,
  eventId: Id,
});

export const CreateEventListRequest = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateEventListRequest = z.infer<typeof CreateEventListRequest>;

export const UpdateEventListRequest = z.object({
  name: z.string().trim().min(1).max(80),
});
export type UpdateEventListRequest = z.infer<typeof UpdateEventListRequest>;

export const UserEventList = z.object({
  id: Id,
  name: z.string(),
  createdAt: z.iso.datetime(),
  events: z.array(Event),
});
export type UserEventList = z.infer<typeof UserEventList>;

export const UserEventListResponse = z.object({
  items: z.array(UserEventList),
});
export type UserEventListResponse = z.infer<typeof UserEventListResponse>;
