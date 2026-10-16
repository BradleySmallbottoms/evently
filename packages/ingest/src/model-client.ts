export interface ModelRequest {
  prompt: string;
  format: 'json';
  temperature: number;
  timeoutMs: number;
}

export type ModelResponse =
  | { ok: true; content: string }
  | { ok: false; reason: 'disabled' | 'unavailable' };

/** One model call. An Ollama client runs it locally. A later RunPod client can batch it. */
export interface ModelClient {
  readonly id: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}
