import type { TipExtraction, TipLocale, TipPath, TipStatus } from '@local-events/domain';

export interface TipImageRecord {
  id: string;
  tipId: string;
  s3Key: string;
  contentType: string;
  status: 'scanning' | 'ready' | 'failed';
  extracted: TipExtraction;
  updatedAt: Date;
}

export interface TipRecord {
  id: string;
  userId: string;
  path: TipPath;
  status: TipStatus;
  locale: TipLocale;
  extracted: TipExtraction;
  sourceText: string | null;
  eventId: string | null;
  scanStatus: string | null;
  submittedAt: Date | null;
  analyzedAt: Date | null;
  completedAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
  /** Event columns after the scan, when the row is joined. */
  eventTitle: string | null;
  eventStartsAt: Date | null;
  eventPlace: string | null;
  eventPriceAmount: number | null;
  eventDescription: string | null;
}

export interface TipMessageRecord {
  role: 'user' | 'assistant';
  body: string;
  createdAt: Date;
}

export interface TipRepository {
  insert(input: {
    userId: string;
    path: TipPath;
    locale: TipLocale;
    now: Date;
  }): Promise<TipRecord>;
  find(
    userId: string,
    tipId: string,
  ): Promise<{ tip: TipRecord; images: TipImageRecord[]; messages: TipMessageRecord[] } | null>;
  list(userId: string): Promise<{ tip: TipRecord; images: TipImageRecord[] }[]>;
  countOpen(userId: string): Promise<number>;
  countSubmittedSince(userId: string, since: Date): Promise<number>;
  saveExtraction(input: {
    tipId: string;
    extracted: TipExtraction;
    sourceText?: string | null;
    analyzedAt: Date;
    status?: TipStatus;
  }): Promise<void>;
  insertImage(input: {
    id: string;
    tipId: string;
    s3Key: string;
    contentType: string;
    now: Date;
  }): Promise<TipImageRecord>;
  markImage(
    imageId: string,
    status: 'ready' | 'failed',
    extracted: TipExtraction,
    now: Date,
  ): Promise<void>;
  markSubmitted(tipId: string, eventId: string, now: Date): Promise<void>;
  addMessage(tipId: string, role: 'user' | 'assistant', body: string, now: Date): Promise<void>;
  createPendingEvent(tip: TipRecord, images: TipImageRecord[]): Promise<string>;
}

export interface TipImageStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}
