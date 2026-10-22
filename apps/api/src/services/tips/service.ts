import { randomUUID } from 'node:crypto';
import type {
  ConfirmTipRequest,
  CreateTipRequest,
  Tip,
  TipImageRequest,
} from '@local-events/contracts';
import type { DomainEventPublisher } from '../domain-events/types';
import type { AuthServices } from '../auth/types';
import {
  emptyTipExtraction,
  fallbackTipTitle,
  mergeTipExtraction,
  needsTipFollowUp,
  applyTipAnswers,
  tipAcceptance,
  tipAskBody,
  tipDetailProgress,
  tipLocalReply,
  tipPendingConfirm,
  tipTags,
  tipFollowUpQuestion,
  tipImageAllowed,
  tipImageReading,
  tipOpenAllowed,
  tipSubmissionAllowed,
  tipTranscript,
  tipTypedFact,
  visionIsStale,
  type TipExtraction,
  type TipFollowUp,
  type TipImageState,
  type TipLocale,
} from '@local-events/domain';
import type { TipModel } from './anthropic';
import { TipError } from './errors';
import { imageStatusOf, presentTip } from './present';
import type { TipImageRecord, TipImageStore, TipRecord, TipRepository } from './repo';

const noopImages: TipImageStore = { async put() {} };

function tipImageKey(tipId: string, imageId: string, contentType: string): string {
  const ext =
    contentType === 'image/png'
      ? 'png'
      : contentType === 'image/webp'
        ? 'webp'
        : contentType === 'image/heic'
          ? 'heic'
          : contentType === 'image/heif'
            ? 'heif'
            : 'jpg';
  return `tips/${tipId}/${imageId}.${ext}`;
}

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
    tags?: () => Promise<{ id: string; name: string }[]>;
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
    return presentTip(again.tip, again.images, baseUrl, again.messages);
  }

  function scheduleVision(tip: TipRecord, image: TipImageRecord, bytes: Uint8Array) {
    if (inflight.has(image.id)) return;
    inflight.add(image.id);
    held.set(image.id, { bytes, contentType: image.contentType, locale: tip.locale });
    void readImage(tip, image, bytes).finally(() => inflight.delete(image.id));
  }

  function imageState(extracted: TipExtraction, rows: TipImageRecord[]): TipImageState {
    if (extracted.imageDeclined) return 'declined';
    if (rows.some((image) => image.status === 'scanning')) return 'scanning';
    if (rows.length > 0) return 'ready';
    return 'missing';
  }

  async function askNext(
    tip: TipRecord,
    extracted: TipExtraction,
    rows: TipImageRecord[],
    questions: TipFollowUp[],
    at: Date,
  ) {
    const question = tipFollowUpQuestion({
      questions,
      missing: tipDetailProgress(extracted).missing,
      locale: tip.locale,
      image: imageState(extracted, rows),
      extraction: extracted,
    });
    if (question) await repo.addMessage(tip.id, 'assistant', tipAskBody(question), at);
  }

  async function knownTags() {
    return options.tags?.() ?? [];
  }

  function keepKnownTags(extraction: TipExtraction, catalog: { id: string; name: string }[]) {
    if (!Array.isArray(extraction.tags)) return extraction;
    return { ...extraction, tags: tipTags(extraction.tags, catalog) };
  }

  async function readImage(tip: TipRecord, image: TipImageRecord, bytes: Uint8Array) {
    const at = now();
    let merged = tip.extracted;
    let questions: TipFollowUp[] = [];
    let status: 'ready' | 'failed' = 'ready';
    try {
      const catalog = await knownTags();
      const read = await model.extract({
        locale: tip.locale,
        text: tip.sourceText ?? undefined,
        image: { bytes, contentType: image.contentType },
        tags: catalog,
      });
      merged = applyTipAnswers(
        mergeTipExtraction(tip.extracted, keepKnownTags(read.extraction, catalog)),
        tip.sourceText,
      );
      if (tipDetailProgress(merged).missing.length === 0) {
        merged = { ...merged, summaryRead: true };
      }
      questions = read.followUpQuestions;
    } catch (err) {
      console.error('tip vision failed', tip.id, err instanceof Error ? err.message : err);
      status = 'failed';
    }
    await repo.markImage(image.id, status, merged, at);
    await repo.saveExtraction({ tipId: tip.id, extracted: merged, analyzedAt: at });
    const current = await repo.find(tip.userId, tip.id);
    if (!current || current.tip.status !== 'collecting') return;
    await askNext(current.tip, merged, current.images, questions, new Date(at.getTime() + 1));
  }

  async function resumeStale(tip: TipRecord, rows: TipImageRecord[]) {
    for (const image of rows) {
      if (image.status !== 'scanning' || !visionIsStale(image.updatedAt, now())) continue;
      const cached = held.get(image.id);
      if (!cached) {
        const at = now();
        await repo.markImage(image.id, 'failed', tip.extracted, at);
        const current = await repo.find(tip.userId, tip.id);
        if (current?.tip.status === 'collecting') {
          await askNext(
            current.tip,
            current.tip.extracted,
            current.images,
            [],
            new Date(at.getTime() + 1),
          );
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
      const typed = tipTypedFact(text);
      if (typed) {
        const current = await show(ownerId, tipId);
        let verdict: { ok: boolean; warning: string | null } = { ok: true, warning: null };
        try {
          verdict = await model.review({
            locale: tip.locale,
            key: typed.key,
            question: current.question?.question ?? '',
            text: typed.value,
          });
        } catch (err) {
          console.error('tip review failed', err instanceof Error ? err.message : 'error');
        }
        if (!verdict.ok && verdict.warning) {
          const fresh = await show(ownerId, tipId);
          return { ...fresh, warning: verdict.warning };
        }
      }
      const transcript = tipTranscript(tip.sourceText, text);
      const local = tipLocalReply(text);
      let questions: TipFollowUp[] = [];
      let extracted = applyTipAnswers(tip.extracted, transcript);
      if (!local) {
        const tags = await knownTags();
        const read = await model.extract({ locale: tip.locale, text: transcript, tags });
        if (!tip.sourceText && read.warning) {
          const fresh = await show(ownerId, tipId);
          return { ...fresh, warning: read.warning };
        }
        questions = read.followUpQuestions;
        extracted = applyTipAnswers(
          mergeTipExtraction(extracted, keepKnownTags(read.extraction, tags)),
          transcript,
        );
      } else if (tipAcceptance(text) == null && !/^image:\s*none$/i.test(text.trim())) {
        extracted = { ...extracted, summary: null, summaryRead: false };
      }
      const factsReady = tipDetailProgress(extracted).missing.length === 0;
      const settled = factsReady && !tipPendingConfirm(extracted);
      if (local && settled && !extracted.summaryRead) {
        const tags = await knownTags();
        const read = await model.extract({ locale: tip.locale, text: transcript, tags });
        questions = read.followUpQuestions;
        extracted = {
          ...applyTipAnswers(
            mergeTipExtraction(extracted, keepKnownTags(read.extraction, tags)),
            transcript,
          ),
          summaryRead: true,
        };
      } else if (!local && factsReady) {
        extracted = { ...extracted, summaryRead: true };
      }
      const at = now();
      await repo.addMessage(tip.id, 'user', text, at);
      await repo.saveExtraction({
        tipId: tip.id,
        extracted,
        sourceText: transcript,
        analyzedAt: at,
      });
      const found = await load(ownerId, tipId);
      await askNext(tip, extracted, found.images, questions, new Date(at.getTime() + 1));
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
      const key = tipImageKey(tipId, imageId, input.contentType);
      await images.put(key, bytes, input.contentType);
      const image = await repo.insertImage({
        id: imageId,
        tipId,
        s3Key: key,
        contentType: input.contentType,
        now: now(),
      });
      await repo.addMessage(
        tipId,
        'assistant',
        tipAskBody(tipImageReading(found.tip.locale)),
        now(),
      );
      scheduleVision(found.tip, image, bytes);
      const again = await load(ownerId, tipId);
      return presentTip(again.tip, again.images, baseUrl, again.messages);
    },
    async confirm(sessionToken, tipId, input) {
      const ownerId = await userId(sessionToken);
      const found = await load(ownerId, tipId);
      const { tip } = found;
      if (tip.status !== 'collecting' && tip.status !== 'needs_input') {
        throw new TipError('invalid_state');
      }
      if (imageStatusOf(found.images) === 'scanning') throw new TipError('invalid_state');
      if (tip.path === 'text' && imageStatusOf(found.images) !== 'scanning' && !tip.analyzedAt) {
        throw new TipError('invalid_state');
      }
      let extracted = { ...emptyTipExtraction(), ...tip.extracted };
      if (input.card) {
        extracted = {
          ...extracted,
          ...(input.card.title !== undefined ? { title: input.card.title } : {}),
          ...(input.card.startsAt !== undefined ? { startsAt: input.card.startsAt } : {}),
          ...(input.card.endsAt !== undefined ? { endsAt: input.card.endsAt } : {}),
          ...(input.card.place !== undefined ? { place: input.card.place } : {}),
          ...(input.card.priceLabel !== undefined ? { priceLabel: input.card.priceLabel } : {}),
          ...(input.card.link !== undefined ? { link: input.card.link } : {}),
          ...(input.card.summary !== undefined ? { summary: input.card.summary } : {}),
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
