import type { EventReport } from '@local-events/contracts';

export type ReportErrorCode = 'unauthorized' | 'forbidden' | 'not_found';

export class ReportError extends Error {
  constructor(readonly code: ReportErrorCode) {
    super(code);
    this.name = 'ReportError';
  }
}

export type ReportCreateResult = {
  report: EventReport;
  created: boolean;
};

export type ReportServices = {
  create: (sessionToken: string | undefined, eventId: string) => Promise<ReportCreateResult>;
};
