import type { CreateEventListRequest, Event, UpdateEventListRequest, UserEventList } from '@local-events/contracts';

export type LibraryErrorCode = 'unauthorized' | 'not_found' | 'limit_reached' | 'invalid_event';

export class LibraryError extends Error {
  constructor(readonly code: LibraryErrorCode) {
    super(code);
    this.name = 'LibraryError';
  }
}

export type LibraryServices = {
  listSaved: (sessionToken: string | undefined) => Promise<{ items: Event[] }>;
  saveEvent: (sessionToken: string | undefined, eventId: string) => Promise<void>;
  unsaveEvent: (sessionToken: string | undefined, eventId: string) => Promise<void>;
  listLists: (sessionToken: string | undefined) => Promise<{ items: UserEventList[] }>;
  createList: (
    sessionToken: string | undefined,
    body: CreateEventListRequest,
  ) => Promise<UserEventList>;
  updateList: (
    sessionToken: string | undefined,
    listId: string,
    body: UpdateEventListRequest,
  ) => Promise<UserEventList>;
  deleteList: (sessionToken: string | undefined, listId: string) => Promise<void>;
  addListEvent: (sessionToken: string | undefined, listId: string, eventId: string) => Promise<void>;
  removeListEvent: (
    sessionToken: string | undefined,
    listId: string,
    eventId: string,
  ) => Promise<void>;
};
