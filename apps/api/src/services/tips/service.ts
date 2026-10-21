import { randomUUID } from 'node:crypto';
import type {
  ConfirmTipRequest,
  CreateTipRequest,
  Tip,
  TipImageRequest,
} from '@local-events/contracts';
import type { DomainEventPublisher } from '../domain-events/types';
import { enqueueDomainEvent } from '../domain-events/types';
import type { AuthServices } from '../auth/types';
import {
  emptyTipExtraction,
  fallbackTipTitle,
  hasUsableTitle,
  mergeTipExtraction,
  needsTipFollowUp,
  tipImageAllowed,
  tipOpenAllowed,
  tipSubmissionAllowed,
  visionIsStale,
  type TipExtraction,
  type TipLocale,
} from '@local-events/domain';
import type { TipModel } from './anthropic';
import { TipError } from './errors';
import { imageStatusOf, presentTip } from './present';
import type { TipImageRecord, TipImageStore, TipRecord, TipRepository } from './repo';

const noopImages: TipImageStore = { async put() {} };

export interface TipServices {
  create(sessionToken: string | undefined, input: CreateTipRequest): Promise<Tip>;
  list(sessionToken: string | undefined): Promise<{ items: Tip[] }>;
  get(sessionToken: string | undefined, tipId: string): Promise<Tip>;
  addText(sessionToken: string | undefined, tipId: string, text: string): Promise<Tip>;
  addImage(sessionToken: string | undefined, tipId: string, input: TipImageRequest): Promise<Tip>;
  confirm(sessionToken: string | undefined, tipId: string, input: ConfirmTipRequest): Promise<Tip>;
}

export function createTipServices(
  auth: AuthServices,
  repo: TipRepository,
  model: TipModel,
  options: {
    now?: () => Date;
    images?: TipImageStore;
    assetsPublicBaseUrl?: string;
    domainEvents?: DomainEventPublisher;
  } = {},
): TipServices {
  const now = options.now ?? (() => new Date());
  const images = options.images ?? noopImages;
  const baseUrl = options.assetsPublicBaseUrl;
  const held = new Map<string, { bytes: Uint8Array; contentType: string; locale: TipLocale }>();
  const inflight = new Set<string>();

  async function userId(sessionToken: string | undefined): Promise<string> {
    const session = await auth.requireUserSession(sessionToken);
    return session.userId;
  }

  async function load(ownerId: string, tipId: string) {
    const found = await repo.find(ownerId, tipId);
    if (!found) throw new TipError('not_found');
    return found;
  }

  async function show(ownerId: string, tipId: string): Promise<Tip> {
    const found = await load(ownerId, tipId);
    await resumeStale(found.tip, found.images);
    const again = await load(ownerId, tipId);
    return presentTip(again.tip, again.images, baseUrl);
  }

  function scheduleVision(tip: TipRecord, image: TipImageRecord, bytes: Uint8Array) {
    if (inflight.has(image.id)) return;
    inflight.add(image.id);
    held.set(image.id, { bytes, contentType: image.contentType, locale: tip.locale });
    void readImage(tip, image, bytes).finally(() => inflight.delete(image.id));
  }

  async function readImage(tip: TipRecord, image: TipImageRecord, bytes: Uint8Array) {
    const at = now();
    let merged: TipExtraction;
    try {
      merged = mergeTipExtraction(
        tip.extracted,
        await model.extract({
          locale: tip.locale,
          text: tip.sourceText ?? undefined,
          image: { bytes, contentType: image.contentType },
        }),
      );
    } catch (err) {
      console.error('tip vision failed', tip.id, err instanceof Error ? err.message : err);
      await repo.markImage(image.id, 'failed', {}, at);
      if (tip.path === 'photo') {
        await repo.saveExtraction({
          tipId: tip.id,
          extracted: tip.extracted,
          analyzedAt: at,
          status: 'needs_input',
        });
      }
      return;
    }
    await repo.markImage(image.id, 'ready', merged, at);
    await repo.saveExtraction({ tipId: tip.id, extracted: merged, analyzedAt: at });
    await repo.addMessage(tip.id, 'assistant', JSON.stringify(merged), at);
    const current = await repo.find(tip.userId, tip.id);
    if (!current || current.tip.status !== 'collecting' || tip.path !== 'photo') return;
    if (hasUsableTitle(merged)) {
      await submit(current.tip, current.images, merged);
      return;
    }
    await repo.saveExtraction({
      tipId: tip.id,
      extracted: merged,
      analyzedAt: at,
      status: 'needs_input',
    });
    if (options.domainEvents) {
      await enqueueDomainEvent(options.domainEvents, {
        type: 'tip.needs_input',
        tipId: tip.id,
        userId: tip.userId,
      });
    }
  }

  async function resumeStale(tip: TipRecord, rows: TipImageRecord[]) {
    for (const image of rows) {
      if (image.status !== 'scanning' || !visionIsStale(image.updatedAt, now())) continue;
      const cached = held.get(image.id);
      if (!cached) {
        await repo.markImage(image.id, 'failed', {}, now());
        if (tip.path === 'photo' && tip.status === 'collecting') {
          await repo.saveExtraction({
            tipId: tip.id,
            extracted: tip.extracted,
            analyzedAt: now(),
            status: 'needs_input',
          });
        }
        continue;
      }
      scheduleVision(tip, image, cached.bytes);
    }
  }

  async function submit(tip: TipRecord, rows: TipImageRecord[], extracted: TipExtraction) {
    const since = new Date(now().getTime() - 24 * 60 * 60 * 1000);
    const count = await repo.countSubmittedSince(tip.userId, since);
    const allowed = tipSubmissionAllowed(count);
    if (!allowed.ok) throw new TipError('daily_limit');
    const titled = {
      ...extracted,
      title: fallbackTipTitle({
        title: extracted.title,
        text: tip.sourceText,
        locale: tip.locale,
      }),
    };
    const eventId = await repo.createPendingEvent({ ...tip, extracted: titled }, rows);
    await repo.markSubmitted(tip.id, eventId, now());
  }

  return {
    async create(sessionToken, input) {
      const ownerId = await userId(sessionToken);
      const open = tipOpenAllowed(await repo.countOpen(ownerId));
      if (!open.ok) throw new TipError(open.reason);
      const tip = await repo.insert({
        userId: ownerId,
        path: input.path,
        locale: input.locale ?? 'sv',
        now: now(),
      });
      return presentTip(tip, [], baseUrl);
    },
    async list(sessionToken) {
      const ownerId = await userId(sessionToken);
      const items = await repo.list(ownerId);
      return { items: items.map((item) => presentTip(item.tip, item.images, baseUrl)) };
    },
    async get(sessionToken, tipId) {
      return show(await userId(sessionToken), tipId);
    },
    async addText(sessionToken, tipId, text) {
      const ownerId = await userId(sessionToken);
      const { tip } = await load(ownerId, tipId);
      if (tip.status !== 'collecting' && tip.status !== 'needs_input') {
        throw new TipError('invalid_state');
      }
      const at = now();
      await repo.addMessage(tip.id, 'user', text, at);
      const extracted = mergeTipExtraction(
        tip.extracted,
        await model.extract({ locale: tip.locale, text }),
      );
      console.log('extracted', extracted);
      if (!extracted.description) extracted.description = text;
      await repo.saveExtraction({
        tipId: tip.id,
        extracted,
        sourceText: text,
        analyzedAt: at,
      });
      return show(ownerId, tipId);
    },
    async addImage(sessionToken, tipId, input) {
      const ownerId = await userId(sessionToken);
      const found = await load(ownerId, tipId);
      if (found.tip.status !== 'collecting' && found.tip.status !== 'needs_input') {
        throw new TipError('invalid_state');
      }
      const bytes = Buffer.from(input.dataBase64, 'base64');
      const check = tipImageAllowed({
        contentType: input.contentType,
        byteLength: bytes.byteLength,
        existingCount: found.images.length,
      });
      if (!check.ok) throw new TipError(check.reason);
      const imageId = randomUUID();
      const key = `tips/${tipId}/${imageId}`;
      await images.put(key, bytes, input.contentType);
      const image = await repo.insertImage({
        id: imageId,
        tipId,
        s3Key: key,
        contentType: input.contentType,
        now: now(),
      });
      scheduleVision(found.tip, image, bytes);
      const again = await load(ownerId, tipId);
      return presentTip(again.tip, again.images, baseUrl);
    },
    async confirm(sessionToken, tipId, input) {
      const ownerId = await userId(sessionToken);
      const found = await load(ownerId, tipId);
      const { tip } = found;
      if (tip.status !== 'collecting' && tip.status !== 'needs_input') {
        throw new TipError('invalid_state');
      }
      if (tip.path === 'text' && imageStatusOf(found.images) !== 'scanning' && !tip.analyzedAt) {
        throw new TipError('invalid_state');
      }
      let extracted = { ...emptyTipExtraction(), ...tip.extracted };
      if (input.card) {
        extracted = {
          ...extracted,
          ...(input.card.title !== undefined ? { title: input.card.title } : {}),
          ...(input.card.startsAt !== undefined ? { startsAt: input.card.startsAt } : {}),
          ...(input.card.place !== undefined ? { place: input.card.place } : {}),
          ...(input.card.priceLabel !== undefined ? { priceLabel: input.card.priceLabel } : {}),
          ...(input.card.link !== undefined ? { link: input.card.link } : {}),
        };
      }
      if (input.categoryHint) extracted.categoryHint = input.categoryHint;
      if (input.description) extracted.description = input.description;
      extracted = mergeTipExtraction({}, extracted);
      const hasImage = found.images.some((image) => image.status === 'ready');
      const followUp = needsTipFollowUp({ path: tip.path, extraction: extracted, hasImage });
      if (followUp && !input.submitFollowUp) {
        await repo.saveExtraction({
          tipId: tip.id,
          extracted,
          analyzedAt: tip.analyzedAt ?? now(),
          status: 'needs_input',
        });
        return show(ownerId, tipId);
      }
      await repo.saveExtraction({
        tipId: tip.id,
        extracted,
        analyzedAt: tip.analyzedAt ?? now(),
      });
      const fresh = await load(ownerId, tipId);
      await submit(fresh.tip, fresh.images, extracted);
      return show(ownerId, tipId);
    },
  };
}
