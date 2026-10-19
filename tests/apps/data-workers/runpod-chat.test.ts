import { describe, expect, it } from 'vitest';
import { createRunpodChat, runpodChatConfigFromEnv, type RunpodChatConfig } from '../../../apps/data-workers/src/runpod-chat';

const config: RunpodChatConfig = {
  apiKey: 'rp-key',
  chatKey: 'chat-key',
  podName: 'evnt-scan',
  volumeName: 'evnt-scan-models',
  gpuId: 'NVIDIA A40',
  dataCenterId: 'EU-SE-1',
  model: 'Qwen/Qwen2.5-32B-Instruct-AWQ',
  image: 'vllm/vllm-openai:v0.10.2',
  volumeGb: 80,
  concurrency: 3,
  readyTimeoutMs: 60_000,
};

function json(body: unknown, status = 200): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function runningPod(id = 'pod_1') {
  return {
    id,
    name: 'evnt-scan',
    status: 'RUNNING',
    cost: 0.59,
    createdAt: '2026-10-18T00:00:00.000Z',
    runtime: { ports: [{ private: 8000, type: 'http' }] },
  };
}

describe('runpodChatConfigFromEnv', () => {
  it('requires both keys', () => {
    expect(runpodChatConfigFromEnv({})).toEqual({
      error: 'RUNPOD_API_KEY is required when CHAT_PROVIDER=runpod',
    });
    expect(runpodChatConfigFromEnv({ RUNPOD_API_KEY: 'rp' })).toEqual({
      error: 'RUNPOD_CHAT_KEY is required when CHAT_PROVIDER=runpod',
    });
  });

  it('serves Qwen3 unless RUNPOD_MODEL is set', () => {
    const resolved = runpodChatConfigFromEnv({ RUNPOD_API_KEY: 'rp', RUNPOD_CHAT_KEY: 'ck' });
    expect(resolved).toMatchObject({ model: 'Qwen/Qwen3-32B-AWQ' });
  });
});

describe('createRunpodChat', () => {
  it('creates a volume and pod, then waits until the model answers', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const target = String(url);
      calls.push(`${init?.method ?? 'GET'} ${target}`);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && target.endsWith('/network-volumes')) {
        return json({ networkVolumes: [], pagination: { hasNextPage: false, nextCursor: null } });
      }
      if (target.includes('/catalog/datacenters/EU-SE-1')) {
        return json({ id: 'EU-SE-1', networkVolumeTypes: ['STANDARD'] });
      }
      if (method === 'POST' && target.endsWith('/network-volumes')) {
        const body = JSON.parse(String(init?.body)) as { type?: string };
        expect(body.type).toBe('STANDARD');
        return json({ id: 'vol_1', name: 'evnt-scan-models', dataCenter: 'EU-SE-1', size: 80 });
      }
      if (method === 'GET' && target.endsWith('/pods')) {
        return json({ pods: [], pagination: { hasNextPage: false, nextCursor: null } });
      }
      if (method === 'POST' && target.endsWith('/pods')) {
        const body = JSON.parse(String(init?.body)) as { args?: string; mounts?: { network?: { volumeId: string }[] } };
        expect(body.mounts?.network?.[0]?.volumeId).toBe('vol_1');
        expect(body.args).toContain('chat-key');
        expect(body.args).toContain('--max-num-seqs');
        return json({ id: 'pod_1', name: 'evnt-scan', status: 'PROVISIONING' });
      }
      if (target.endsWith('/pods/pod_1/action')) return json({ ...runningPod(), status: 'EXITED' });
      if (target.endsWith('/pods/pod_1')) return json(runningPod());
      if (target.includes('pod_1-8000.proxy.runpod.net/v1/models')) {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer chat-key');
        return json({ data: [{ id: config.model }] });
      }
      return json({ title: 'unexpected' }, 500);
    };
    const chat = createRunpodChat(config, { fetch: fetchImpl, sleep: async () => {} });

    const ready = await chat.ensureReady();

    expect(ready.chatUrl).toBe('https://pod_1-8000.proxy.runpod.net/v1/chat/completions');
    expect(ready.concurrency).toBe(3);
    expect(calls.some((call) => call.startsWith('POST') && call.endsWith('/network-volumes'))).toBe(true);
    await chat.stop();
    expect(calls.some((call) => call.includes('/pods/pod_1/action'))).toBe(true);
  });

  it('replaces a pod that cannot start', async () => {
    const actions: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const target = String(url);
      const method = init?.method ?? 'GET';
      if (target.endsWith('/network-volumes')) {
        return json({
          networkVolumes: [{ id: 'vol_1', name: 'evnt-scan-models', dataCenter: 'EU-SE-1' }],
          pagination: { hasNextPage: false },
        });
      }
      if (method === 'GET' && target.endsWith('/pods')) {
        return json({
          pods: [
            {
              id: 'pod_old',
              name: 'evnt-scan',
              status: 'EXITED',
              createdAt: '2026-10-01T00:00:00.000Z',
              env: { SCAN_MODEL: config.model },
            },
          ],
          pagination: { hasNextPage: false },
        });
      }
      if (target.endsWith('/pods/pod_old/action')) {
        const body = JSON.parse(String(init?.body)) as { action: string };
        actions.push(body.action);
        return body.action === 'start' ? json({ title: 'no GPU' }, 400) : json(null, 204);
      }
      if (method === 'POST' && target.endsWith('/pods')) {
        return json({ id: 'pod_new', name: 'evnt-scan', status: 'PROVISIONING' });
      }
      if (target.endsWith('/pods/pod_new')) return json(runningPod('pod_new'));
      if (target.includes('/v1/models')) return json({ data: [] });
      return json({ title: target }, 500);
    };
    const chat = createRunpodChat(config, { fetch: fetchImpl, sleep: async () => {} });

    const ready = await chat.ensureReady();

    expect(actions).toEqual(['start', 'terminate']);
    expect(ready.podId).toBe('pod_new');
  });

  it('replaces a pod that was started with another model', async () => {
    const actions: string[] = [];
    let createdArgs = '';
    let createdModel = '';
    const fetchImpl: typeof fetch = async (url, init) => {
      const target = String(url);
      const method = init?.method ?? 'GET';
      if (target.endsWith('/network-volumes')) {
        return json({
          networkVolumes: [{ id: 'vol_1', name: 'evnt-scan-models', dataCenter: 'EU-SE-1' }],
          pagination: { hasNextPage: false },
        });
      }
      if (method === 'GET' && target.endsWith('/pods')) {
        return json({
          pods: [
            {
              id: 'pod_old',
              name: 'evnt-scan',
              status: 'EXITED',
              env: { SCAN_MODEL: 'Qwen/Qwen2.5-32B-Instruct-AWQ' },
            },
          ],
          pagination: { hasNextPage: false },
        });
      }
      if (target.endsWith('/pods/pod_old/action')) {
        const body = JSON.parse(String(init?.body)) as { action: string };
        actions.push(body.action);
        return json(null, 204);
      }
      if (method === 'POST' && target.endsWith('/pods')) {
        const body = JSON.parse(String(init?.body)) as { args?: string; env?: { SCAN_MODEL?: string } };
        createdArgs = body.args ?? '';
        createdModel = body.env?.SCAN_MODEL ?? '';
        return json({ id: 'pod_new', name: 'evnt-scan', status: 'PROVISIONING' });
      }
      if (target.endsWith('/pods/pod_new')) return json(runningPod('pod_new'));
      if (target.includes('/v1/models')) return json({ data: [] });
      return json({ title: target }, 500);
    };
    const chat = createRunpodChat(
      { ...config, model: 'Qwen/Qwen3-32B-AWQ' },
      { fetch: fetchImpl, sleep: async () => {} },
    );

    const ready = await chat.ensureReady();

    expect(actions).toEqual(['terminate']);
    expect(createdArgs).toContain('Qwen/Qwen3-32B-AWQ');
    expect(createdModel).toBe('Qwen/Qwen3-32B-AWQ');
    expect(ready.model).toBe('Qwen/Qwen3-32B-AWQ');
  });

  it('refuses a data center that has no network volumes', async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      const target = String(url);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && target.endsWith('/network-volumes')) {
        return json({ networkVolumes: [], pagination: { hasNextPage: false } });
      }
      if (target.endsWith('/catalog/datacenters/EU-SE-1')) {
        return json({ id: 'EU-SE-1', networkVolumeTypes: [] });
      }
      return json({ title: 'should not be called' }, 500);
    };
    const chat = createRunpodChat(config, { fetch: fetchImpl, sleep: async () => {} });

    await expect(chat.ensureReady()).rejects.toThrow('does not offer network volumes');
  });
});
