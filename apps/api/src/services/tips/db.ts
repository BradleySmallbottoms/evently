import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import {
  emptyTipExtraction,
  bareTipLink,
  fallbackTipTitle,
  TIP_LIST_LIMIT,
  tipEventFields,
  tipInstant,
  tipOrganizerKeys,
  tipScanStatus,
  type TipExtraction,
} from '@local-events/domain';
import { and, asc, count, desc, eq, gte, inArray } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import type { DomainEventPublisher } from '../domain-events/types';
import type { TipModel } from './anthropic';
import { TipError } from './errors';
import type {
  TipImageRecord,
  TipImageStore,
  TipMessageRecord,
  TipRecord,
  TipRepository,
} from './repo';
import { createTipServices, type TipServices } from './service';

const USER_TIPS_SLUG = 'user-tips';

function asExtraction(value: unknown): TipExtraction {
  if (!value || typeof value !== 'object') return emptyTipExtraction();
  return { ...emptyTipExtraction(), ...(value as TipExtraction) };
}

function blankEvent(row: typeof schema.eventTips.$inferSelect): TipRecord {
  return {
    id: row.id,
    userId: row.userId,
    path: row.path,
    status: row.status,
    locale: row.locale,
    extracted: asExtraction(row.extracted),
    sourceText: row.sourceText,
    eventId: row.eventId,
    scanStatus: row.scanStatus,
    submittedAt: row.submittedAt,
    analyzedAt: row.analyzedAt,
    completedAt: row.completedAt,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    eventTitle: null,
    eventStartsAt: null,
    eventPlace: null,
    eventPriceAmount: null,
    eventDescription: null,
  };
}

export function tipImageStoreFromEnv(env: NodeJS.ProcessEnv = process.env): TipImageStore {
  const bucket = env.PUBLIC_ASSETS_BUCKET?.trim();
  if (!bucket) {
    return {
      async put() {
        throw new Error('tip_image_bucket_missing');
      },
    };
  }
  const endpoint = env.S3_ENDPOINT?.trim();
  const client = new S3Client({
    region: env.S3_REGION?.trim() || env.AWS_REGION?.trim() || 'eu-north-1',
    ...(endpoint
      ? {
          endpoint,
          forcePathStyle: true,
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
            secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
          },
        }
      : {}),
  });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=86400',
        }),
      );
    },
  };
}

export function createDbTipServices(
  db: Db,
  auth: AuthServices,
  model: TipModel,
  options: {
    now?: () => Date;
    domainEvents?: DomainEventPublisher;
    assetsPublicBaseUrl?: string;
    images?: TipImageStore;
  } = {},
): TipServices {
  async function imagesFor(tipIds: string[]): Promise<Map<string, TipImageRecord[]>> {
    const grouped = new Map<string, TipImageRecord[]>();
    if (tipIds.length === 0) return grouped;
    const rows = await db
      .select()
      .from(schema.tipImages)
      .where(inArray(schema.tipImages.tipId, tipIds))
      .orderBy(asc(schema.tipImages.createdAt));
    for (const row of rows) {
      const image: TipImageRecord = {
        id: row.id,
        tipId: row.tipId,
        s3Key: row.s3Key,
        contentType: row.contentType,
        status: row.status,
        extracted: asExtraction(row.extracted),
        updatedAt: row.updatedAt,
      };
      grouped.set(row.tipId, [...(grouped.get(row.tipId) ?? []), image]);
    }
    return grouped;
  }

  async function attachEvents(
    rows: (typeof schema.eventTips.$inferSelect)[],
  ): Promise<TipRecord[]> {
    const ids = rows.flatMap((row) => (row.eventId ? [row.eventId] : []));
    const events =
      ids.length === 0
        ? []
        : await db
            .select({
              id: schema.events.id,
              title: schema.events.title,
              startsAt: schema.events.startsAt,
              venueName: schema.events.venueName,
              priceAmount: schema.events.priceAmount,
              description: schema.events.description,
              summary: schema.events.summary,
              status: schema.events.status,
            })
            .from(schema.events)
            .where(inArray(schema.events.id, ids));
    const byId = new Map(events.map((event) => [event.id, event]));
    return rows.map((row) => {
      const tip = blankEvent(row);
      const event = row.eventId ? byId.get(row.eventId) : undefined;
      if (!event) return tip;
      tip.eventTitle = event.title;
      tip.eventStartsAt = event.startsAt;
      tip.eventPlace = event.venueName;
      tip.eventPriceAmount = event.priceAmount;
      tip.eventDescription = event.summary ?? event.description;
      tip.scanStatus = tipScanStatus(tip.scanStatus, event.status);
      return tip;
    });
  }

  const repo: TipRepository = {
    async insert(input) {
      console.log('insert', input);
      const [row] = await db
        .insert(schema.eventTips)
        .values({
          userId: input.userId,
          path: input.path,
          locale: input.locale,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      if (!row) throw new TipError('source_missing');
      return blankEvent(row);
    },
    async find(userId, tipId) {
      const [row] = await db
        .select()
        .from(schema.eventTips)
        .where(and(eq(schema.eventTips.id, tipId), eq(schema.eventTips.userId, userId)))
        .limit(1);
      if (!row) return null;
      const grouped = await imagesFor([row.id]);
      const [tip] = await attachEvents([row]);
      const messages = await db
        .select({
          role: schema.tipMessages.role,
          body: schema.tipMessages.body,
          createdAt: schema.tipMessages.createdAt,
        })
        .from(schema.tipMessages)
        .where(eq(schema.tipMessages.tipId, row.id))
        .orderBy(asc(schema.tipMessages.createdAt));
      return {
        tip: tip!,
        images: grouped.get(row.id) ?? [],
        messages: messages.flatMap((message): TipMessageRecord[] =>
          message.role === 'user' || message.role === 'assistant'
            ? [{ role: message.role, body: message.body, createdAt: message.createdAt }]
            : [],
        ),
      };
    },
    async list(userId) {
      const rows = await db
        .select()
        .from(schema.eventTips)
        .where(eq(schema.eventTips.userId, userId))
        .orderBy(desc(schema.eventTips.createdAt))
        .limit(TIP_LIST_LIMIT);
      const grouped = await imagesFor(rows.map((row) => row.id));
      const tips = await attachEvents(rows);
      return tips.map((tip) => ({ tip, images: grouped.get(tip.id) ?? [] }));
    },
    async countOpen(userId) {
      const [row] = await db
        .select({ n: count() })
        .from(schema.eventTips)
        .where(
          and(
            eq(schema.eventTips.userId, userId),
            inArray(schema.eventTips.status, ['collecting', 'needs_input']),
          ),
        );
      return Number(row?.n ?? 0);
    },
    async countSubmittedSince(userId, since) {
      const [row] = await db
        .select({ n: count() })
        .from(schema.eventTips)
        .where(
          and(
            eq(schema.eventTips.userId, userId),
            gte(schema.eventTips.submittedAt, since),
            inArray(schema.eventTips.status, ['submitted', 'scanned']),
          ),
        );
      return Number(row?.n ?? 0);
    },
    async saveExtraction(input) {
      await db
        .update(schema.eventTips)
        .set({
          extracted: input.extracted,
          ...(input.sourceText !== undefined ? { sourceText: input.sourceText } : {}),
          analyzedAt: input.analyzedAt,
          ...(input.status ? { status: input.status } : {}),
          updatedAt: input.analyzedAt,
        })
        .where(eq(schema.eventTips.id, input.tipId));
    },
    async insertImage(input) {
      const [row] = await db
        .insert(schema.tipImages)
        .values({
          id: input.id,
          tipId: input.tipId,
          s3Key: input.s3Key,
          contentType: input.contentType,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      if (!row) throw new TipError('source_missing');
      return {
        id: row.id,
        tipId: row.tipId,
        s3Key: row.s3Key,
        contentType: row.contentType,
        status: row.status,
        extracted: {},
        updatedAt: row.updatedAt,
      };
    },
    async markImage(imageId, status, extracted, at) {
      await db
        .update(schema.tipImages)
        .set({ status, extracted, updatedAt: at })
        .where(eq(schema.tipImages.id, imageId));
    },
    async markSubmitted(tipId, eventId, at) {
      await db
        .update(schema.eventTips)
        .set({
          status: 'submitted',
          eventId,
          submittedAt: at,
          completedAt: at,
          updatedAt: at,
        })
        .where(eq(schema.eventTips.id, tipId));
    },
    async addMessage(tipId, role, body, at) {
      await db.insert(schema.tipMessages).values({ tipId, role, body, createdAt: at });
    },
    async remove(userId, tipId) {
      const removed = await db
        .delete(schema.eventTips)
        .where(and(eq(schema.eventTips.id, tipId), eq(schema.eventTips.userId, userId)))
        .returning({ id: schema.eventTips.id });
      return removed.length > 0;
    },
    async createPendingEvent(tip, images) {
      const [source] = await db
        .select({ id: schema.dataSources.id })
        .from(schema.dataSources)
        .where(eq(schema.dataSources.slug, USER_TIPS_SLUG))
        .limit(1);
      if (!source) throw new TipError('source_missing');
      const extraction = tip.extracted;
      const title = fallbackTipTitle({
        title: extraction.title,
        text: tip.sourceText,
        locale: tip.locale,
      });
      const startsAt = tipInstant(extraction.startsAt);
      const endsAt = tipInstant(extraction.endsAt);
      const bare = bareTipLink(extraction.link);
      const link = bare ? `https://${bare}` : null;
      const place = extraction.place?.trim().slice(0, 200) || null;
      const city = place?.includes(',') ? place.split(',').pop()?.trim() || null : null;
      const fields = tipEventFields({
        description: extraction.description,
        sourceText: tip.sourceText,
        categoryHint: extraction.categoryHint,
      });
      const eventId = randomUUID();
      const ready = [...images].reverse().find((image) => image.status === 'ready');
      await db.transaction(async (tx) => {
        await tx.insert(schema.events).values({
          id: eventId,
          title,
          summary: extraction.summary?.trim().slice(0, 500) || null,
          description: fields.description,
          language: tip.locale,
          mode: 'physical',
          status: 'pending_scan',
          origin: 'imported',
          sourceUrl: link,
          refId: tip.id,
          workerId: USER_TIPS_SLUG,
          startsAt,
          endsAt,
          priceAmount: extraction.priceAmount ?? null,
          currency: 'SEK',
          meta: {
            fromUserTip: true,
            ...(fields.tip ? { tip: fields.tip } : {}),
            ...(extraction.priceAmount === 0 ? { freeEntry: true } : {}),
            ...(city ? { address: { city, country: 'Sweden' as const } } : {}),
            import: {
              organizerKeys: tipOrganizerKeys({
                tipId: tip.id,
                organizerName: extraction.organizerName,
                link,
              }),
              ...(extraction.organizerName ? { organizerName: extraction.organizerName } : {}),
              ...(place ? { venueName: place } : {}),
            },
          },
        });
        await tx.insert(schema.externalRefs).values({
          sourceId: source.id,
          externalId: tip.id,
          eventId,
          contentHash: createHash('sha256')
            .update(`${title}\n${fields.description ?? ''}\n${fields.tip?.text ?? ''}`)
            .digest('hex'),
        });
        if (link) {
          const tickets = /ticket|biljett|tickster|nortic|ticketco/i.test(link);
          await tx.insert(schema.eventLinks).values({
            eventId,
            type: tickets ? 'tickets' : 'info',
            url: link,
            position: 0,
          });
        }
        if (ready) {
          await tx.insert(schema.eventImages).values({
            eventId,
            role: 'main',
            s3Key: ready.s3Key,
            contentType: ready.contentType,
          });
        }
      });
      return eventId;
    },
  };
  return createTipServices(auth, repo, model, {
    ...options,
    images: options.images ?? tipImageStoreFromEnv(),
    tags: async () =>
      db
        .select({ id: schema.tags.id, name: schema.tags.name })
        .from(schema.tags)
        .orderBy(asc(schema.tags.name)),
  });
}
