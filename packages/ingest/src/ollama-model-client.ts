import type { ModelClient, ModelRequest, ModelResponse } from './model-client';
import { ollamaBaseUrl, ollamaDisabled, ollamaModel } from './tag-match';

function messageContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || !('message' in payload)) return '';
  const message = payload.message;
  if (!message || typeof message !== 'object' || !('content' in message)) return '';
  return typeof message.content === 'string' ? message.content : '';
}

/** Local Ollama chat call. The base URL stays on loopback. */
export function createOllamaModelClient(
  config: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): ModelClient {
  return {
    id: 'ollama',
    async complete(request: ModelRequest): Promise<ModelResponse> {
      if (ollamaDisabled()) return { ok: false, reason: 'disabled' };
      let base: URL;
      let model: string;
      try {
        base = ollamaBaseUrl(config);
        model = ollamaModel(config);
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
      try {
        const response = await fetchImpl(new URL('/api/chat', base), {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            format: request.format,
            options: { temperature: request.temperature },
            messages: [{ role: 'user', content: request.prompt }],
          }),
          signal: AbortSignal.timeout(request.timeoutMs),
        });
        if (!response.ok) return { ok: false, reason: 'unavailable' };
        return { ok: true, content: messageContent(await response.json()) };
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    },
  };
}
