import {
  defaultPushMessageCopy,
  initialPushMessageStatus,
  shouldAutoApprovePushMessage,
  statusAfterDraftEdit,
  type PublisherStatus,
  type PushMessageStatus,
} from '@local-events/domain';
import {
  findOpenPushMessage,
  insertPushMessage,
  updatePushMessage,
  type Db,
  type PushMessageRow,
} from '@local-events/db';

export type DraftPushInput = {
  eventId: string;
  eventTitle: string;
  publisherStatus: PublisherStatus;
  origin: 'native' | 'imported';
  sourceTrust?: 'auto_publish' | 'review';
  publisherIsTemporary?: boolean;
  copyOverride?: {
    titleSv?: string;
    bodySv?: string;
    titleEn?: string;
    bodyEn?: string;
  };
  sendAt?: Date | null;
  now?: Date;
};

/** Create or refresh the open push draft for an event submit/edit. */
export async function upsertEventPushDraft(
  db: Db,
  input: DraftPushInput,
): Promise<PushMessageRow | null> {
  const now = input.now ?? new Date();
  const autoApprove = shouldAutoApprovePushMessage({
    publisherStatus: input.publisherStatus,
    origin: input.origin,
    sourceTrust: input.sourceTrust,
    publisherIsTemporary: input.publisherIsTemporary,
  });
  const defaults = defaultPushMessageCopy(input.eventTitle);
  const open = await findOpenPushMessage(db, input.eventId);

  if (open) {
    if (open.status === 'sending') return open;
    const copyEdited = Boolean(input.copyOverride) || open.copyEdited;
    const nextStatus = statusAfterDraftEdit({
      current: open.status as PushMessageStatus,
      autoApprove,
    });
    return updatePushMessage(db, open.id, {
      status: nextStatus,
      titleSv: input.copyOverride?.titleSv ?? (open.copyEdited ? open.titleSv : defaults.titleSv),
      bodySv: input.copyOverride?.bodySv ?? (open.copyEdited ? open.bodySv : defaults.bodySv),
      titleEn: input.copyOverride?.titleEn ?? (open.copyEdited ? open.titleEn : defaults.titleEn),
      bodyEn: input.copyOverride?.bodyEn ?? (open.copyEdited ? open.bodyEn : defaults.bodyEn),
      copyEdited,
      ...(input.sendAt !== undefined ? { sendAt: input.sendAt } : {}),
      ...(nextStatus === 'approved' && open.status !== 'approved'
        ? { approvedAt: now, approvedByAdminId: null }
        : {}),
      ...(nextStatus === 'pending' ? { approvedAt: null, approvedByAdminId: null } : {}),
      updatedAt: now,
    });
  }

  const status = initialPushMessageStatus(autoApprove);
  return insertPushMessage(db, {
    eventId: input.eventId,
    status,
    titleSv: input.copyOverride?.titleSv ?? defaults.titleSv,
    bodySv: input.copyOverride?.bodySv ?? defaults.bodySv,
    titleEn: input.copyOverride?.titleEn ?? defaults.titleEn,
    bodyEn: input.copyOverride?.bodyEn ?? defaults.bodyEn,
    copyEdited: Boolean(input.copyOverride),
    sendAt: input.sendAt === undefined ? null : input.sendAt,
    approvedAt: status === 'approved' ? now : null,
    approvedByAdminId: null,
    updatedAt: now,
  });
}

/** New draft after a previous send (fails if an open draft already exists). */
export async function createEventPushDraft(db: Db, input: DraftPushInput): Promise<PushMessageRow> {
  const open = await findOpenPushMessage(db, input.eventId);
  if (open) throw new Error('push_draft_exists');
  const created = await upsertEventPushDraft(db, input);
  if (!created) throw new Error('push_draft_failed');
  return created;
}
