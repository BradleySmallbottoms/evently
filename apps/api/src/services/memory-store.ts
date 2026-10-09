import type { Category, Event } from '@local-events/contracts';
import { SEED_CATEGORIES } from './events/seed-categories';

export type MemoryUser = { id: string; createdAt: Date };
export type MemoryDevice = {
  id: string;
  userId: string;
  credentialHash: string;
  platform: string;
  locale: string;
  revokedAt: Date | null;
};
export type MemorySession = {
  id: string;
  subjectType: 'user' | 'publisher_account' | 'admin';
  subjectId: string;
  tokenHash: string;
  client: string;
  expiresAt: Date;
  revokedAt: Date | null;
};
export type MemoryPublisherAccount = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
};
export type MemoryPublisher = {
  id: string;
  type: 'org' | 'person';
  name: string;
  slug: string;
  verified: boolean;
  origin: 'native' | 'imported';
  createdAt: Date;
};
export type MemoryMember = {
  publisherId: string;
  publisherAccountId: string;
  role: 'owner' | 'editor';
};
export type MemoryToken = {
  id: string;
  purpose: string;
  subjectId: string;
  /** For device_link_code: device waiting to be reassigned. */
  deviceId?: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export type MemoryEventRow = Event & {
  startsAtDate: Date;
  endsAtDate: Date;
};

/** Shared in-memory tables for auth + events + admin tests. */
export type MemoryStore = {
  users: Map<string, MemoryUser>;
  devices: Map<string, MemoryDevice>;
  sessions: Map<string, MemorySession>;
  accounts: Map<string, MemoryPublisherAccount>;
  publishers: Map<string, MemoryPublisher>;
  members: MemoryMember[];
  tokens: Map<string, MemoryToken>;
  categories: Map<string, Category>;
  events: Map<string, MemoryEventRow>;
};

export function createMemoryStore(): MemoryStore {
  const categories = new Map<string, Category>();
  for (const c of SEED_CATEGORIES) categories.set(c.id, c);
  return {
    users: new Map(),
    devices: new Map(),
    sessions: new Map(),
    accounts: new Map(),
    publishers: new Map(),
    members: [],
    tokens: new Map(),
    categories,
    events: new Map(),
  };
}
