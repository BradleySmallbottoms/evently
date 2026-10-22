import { randomUUID } from 'node:crypto';
import { emptyTipExtraction, TIP_LIST_LIMIT } from '@local-events/domain';
import type { AuthServices } from '../auth/types';
import type { DomainEventPublisher } from '../domain-events/types';
import type { TipModel } from './anthropic';
import type { TipImageRecord, TipMessageRecord, TipRecord, TipRepository } from './repo';
import { createTipServices, type TipServices } from './service';

export function createMemoryTipServices(
  auth: AuthServices,
  model: TipModel,
  options: {
    now?: () => Date;
    domainEvents?: DomainEventPublisher;
    assetsPublicBaseUrl?: string;
    tags?: () => Promise<{ id: string; name: string }[]>;
  } = {},
): TipServices {
  const tips = new Map<string, TipRecord>();
  const images = new Map<string, TipImageRecord[]>();
  const messages = new Map<string, TipMessageRecord[]>();
  const repo: TipRepository = {
    async insert(input) {
      const tip: TipRecord = {
        id: randomUUID(),
        userId: input.userId,
        path: input.path,
        status: 'collecting',
        locale: input.locale,
        extracted: emptyTipExtraction(),
        sourceText: null,
        eventId: null,
        scanStatus: null,
        submittedAt: null,
        analyzedAt: null,
        completedAt: null,
        reviewedAt: null,
        createdAt: input.now,
        eventTitle: null,
        eventStartsAt: null,
        eventPlace: null,
        eventPriceAmount: null,
        eventDescription: null,
      };
      tips.set(tip.id, tip);
      images.set(tip.id, []);
      return tip;
    },
    async find(userId, tipId) {
      const tip = tips.get(tipId);
      if (!tip || tip.userId !== userId) return null;
      return { tip, images: images.get(tipId) ?? [], messages: messages.get(tipId) ?? [] };
    },
    async list(userId) {
      return [...tips.values()]
        .filter((tip) => tip.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, TIP_LIST_LIMIT)
        .map((tip) => ({ tip, images: images.get(tip.id) ?? [] }));
    },
    async countOpen(userId) {
      return [...tips.values()].filter(
        (tip) =>
          tip.userId === userId && (tip.status === 'collecting' || tip.status === 'needs_input'),
      ).length;
    },
    async countSubmittedSince(userId, since) {
      return [...tips.values()].filter(
        (tip) =>
          tip.userId === userId &&
          tip.submittedAt != null &&
          tip.submittedAt >= since &&
          (tip.status === 'submitted' || tip.status === 'scanned'),
      ).length;
    },
    async saveExtraction(input) {
      const tip = tips.get(input.tipId);
      if (!tip) return;
      tip.extracted = input.extracted;
      if (input.sourceText !== undefined) tip.sourceText = input.sourceText;
      tip.analyzedAt = input.analyzedAt;
      if (input.status) tip.status = input.status;
    },
    async insertImage(input) {
      const image: TipImageRecord = {
        id: input.id,
        tipId: input.tipId,
        s3Key: input.s3Key,
        contentType: input.contentType,
        status: 'scanning',
        extracted: {},
        updatedAt: input.now,
      };
      images.set(input.tipId, [...(images.get(input.tipId) ?? []), image]);
      return image;
    },
    async markImage(imageId, status, extracted, at) {
      for (const rows of images.values()) {
        const image = rows.find((row) => row.id === imageId);
        if (!image) continue;
        image.status = status;
        image.extracted = extracted;
        image.updatedAt = at;
      }
    },
    async markSubmitted(tipId, eventId, at) {
      const tip = tips.get(tipId);
      if (!tip) return;
      tip.status = 'submitted';
      tip.eventId = eventId;
      tip.submittedAt = at;
      tip.completedAt = at;
      if (!tip.analyzedAt) tip.analyzedAt = at;
    },
    async addMessage(tipId, role, body, at) {
      const rows = messages.get(tipId) ?? [];
      rows.push({ role, body, createdAt: at });
      messages.set(tipId, rows);
    },
    async remove(userId, tipId) {
      const tip = tips.get(tipId);
      if (!tip || tip.userId !== userId) return false;
      tips.delete(tipId);
      images.delete(tipId);
      messages.delete(tipId);
      return true;
    },
    async createPendingEvent() {
      return randomUUID();
    },
  };
  return createTipServices(auth, repo, model, options);
}
