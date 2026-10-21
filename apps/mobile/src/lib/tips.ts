import type {
  ConfirmTipRequest,
  CreateTipRequest,
  Tip,
  TipImageRequest,
  TipListResponse,
} from '@local-events/contracts';

import { TIP_IMAGE_BASE64_MAX } from '@local-events/domain';

import { API_URL } from './api';
import type { StoredIdentity } from './identity';

async function tipFetch<T>(
  identity: StoredIdentity,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${identity.sessionToken}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(payload?.error?.code ?? `tip_${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;

export function tipImageContentType(mime: string | null | undefined): (typeof IMAGE_TYPES)[number] {
  return (IMAGE_TYPES as readonly string[]).includes(mime ?? '')
    ? (mime as (typeof IMAGE_TYPES)[number])
    : 'image/jpeg';
}

export function createTip(identity: StoredIdentity, body: CreateTipRequest): Promise<Tip> {
  return tipFetch(identity, '/me/tips', { method: 'POST', body });
}

export function listTips(identity: StoredIdentity): Promise<TipListResponse> {
  return tipFetch(identity, '/me/tips');
}

export function getTip(identity: StoredIdentity, tipId: string): Promise<Tip> {
  return tipFetch(identity, `/me/tips/${tipId}`);
}

export function sendTipText(identity: StoredIdentity, tipId: string, text: string): Promise<Tip> {
  return tipFetch(identity, `/me/tips/${tipId}/text`, { method: 'POST', body: { text } });
}

export function sendTipImage(
  identity: StoredIdentity,
  tipId: string,
  body: TipImageRequest,
): Promise<Tip> {
  if (body.dataBase64.length > TIP_IMAGE_BASE64_MAX) throw new Error('too_large');
  return tipFetch(identity, `/me/tips/${tipId}/images`, { method: 'POST', body });
}

export function confirmTip(
  identity: StoredIdentity,
  tipId: string,
  body: ConfirmTipRequest,
): Promise<Tip> {
  return tipFetch(identity, `/me/tips/${tipId}/confirm`, { method: 'POST', body });
}
