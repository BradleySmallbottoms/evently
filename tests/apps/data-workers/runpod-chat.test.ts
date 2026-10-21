import { describe, expect, it } from 'vitest';
import {
  createRunpodChat,
  runpodChatConfigFromEnv,
  type RunpodChatConfig,
} from '../../../apps/data-workers/src/runpod-chat';

const config: RunpodChatConfig = {
  apiKey: 'rp-key',
  chatKey: 'chat-key',
  podName: 'evnt-scan',
  volumeName: 'evnt-scan-models',
  gpuId: 'NVIDIA A40',
  gpuCount: 1,
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

  it('serves Qwen3 on four A40s unless the model or the concurrency is set', () => {
    const resolved = runpodChatConfigFromEnv({ RUNPOD_API_KEY: 'rp', RUNPOD_CHAT_KEY: 'ck' });
    expect(resolved).toMatchObject({
      model: 'Qwen/Qwen3-32B-AWQ',
      image: 'vllm/vllm-openai:v0.17.0',
      concurrency: 25,
      gpuId: 'NVIDIA A40',
      gpuCount: 4,
    });
  });

  it('uses one A40 for a small batch and two up to 24', () => {
    expect(
      runpodChatConfigFromEnv({
        RUNPOD_API_KEY: 'rp',
        RUNPOD_CHAT_KEY: 'ck',
        SCAN_CONCURRENCY: '3',
      }),
    ).toMatchObject({ concurrency: 3, gpuCount: 1 });
    expect(
      runpodChatConfigFromEnv({
        RUNPOD_API_KEY: 'rp',
        RUNPOD_CHAT_KEY: 'ck',
        SCAN_CONCURRENCY: '24',
      }),
    ).toMatchObject({ concurrency: 24, gpuCount: 2 });
  });

  it('keeps a custom GPU as one card', () => {
    expect(
      runpodChatConfigFromEnv({
        RUNPOD_API_KEY: 'rp',
        RUNPOD_CHAT_KEY: 'ck',
        RUNPOD_GPU: 'NVIDIA H100 80GB HBM3',
        SCAN_CONCURRENCY: '25',
      }),
    ).toMatchObject({ gpuId: 'NVIDIA H100 80GB HBM3', gpuCount: 1, concurrency: 25 });
  });

  it('rejects concurrency above the cap', () => {
    expect(
      runpodChatConfigFromEnv({
        RUNPOD_API_KEY: 'rp',
        RUNPOD_CHAT_KEY: 'ck',
        SCAN_CONCURRENCY: '26',
      }),
    ).toEqual({ error: 'SCAN_CONCURRENCY must be a whole number from 1 to 25' });
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
        const body = JSON.parse(String(init?.body)) as {
          args?: string;
          env?: { VLLM_API_KEY?: string };
          mounts?: { network?: { volumeId: string }[] };
        };
        expect(body.mounts?.network?.[0]?.volumeId).toBe('vol_1');
        expect(body.env?.VLLM_API_KEY).toBe('chat-key');
        expect(body.args).not.toContain('chat-key');
        expect(body.args).toContain('--max-num-seqs');
        expect(body.args).not.toContain('--disable-custom-all-reduce');
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
    expect(calls.some((call) => call.startsWith('POST') && call.endsWith('/network-volumes'))).toBe(
      true,
    );
    await chat.stop();
    expect(calls.some((call) => call.includes('/pods/pod_1/action'))).toBe(true);
  });

  it('retries a start with no GPU and keeps the stopped pod', async () => {
    const actions: string[] = [];
    let starts = 0;
    let clock = 0;
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
              env: { SCAN_MODEL: config.model, SCAN_CONCURRENCY: '3', SCAN_GPU_COUNT: '1' },
            },
          ],
          pagination: { hasNextPage: false },
        });
      }
      if (target.endsWith('/pods/pod_old/action')) {
        const body = JSON.parse(String(init?.body)) as { action: string };
        actions.push(body.action);
        starts += 1;
        return starts < 3 ? json({ title: 'no GPU' }, 400) : json(runningPod('pod_old'));
      }
      if (target.endsWith('/pods/pod_old')) return json(runningPod('pod_old'));
      if (target.includes('/v1/models')) return json({ data: [] });
      return json({ title: target }, 500);
    };
    const chat = createRunpodChat(config, {
      fetch: fetchImpl,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });

    const ready = await chat.ensureReady();

    expect(actions).toEqual(['start', 'start', 'start']);
    expect(ready.podId).toBe('pod_old');
  });

  it('leaves the pod stopped when no GPU appears before the ready timeout', async () => {
    const actions: string[] = [];
    let clock = 0;
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
              env: { SCAN_MODEL: config.model, SCAN_CONCURRENCY: '3', SCAN_GPU_COUNT: '1' },
            },
          ],
          pagination: { hasNextPage: false },
        });
      }
      if (target.endsWith('/pods/pod_old/action')) {
        const body = JSON.parse(String(init?.body)) as { action: string };
        actions.push(body.action);
        return json({ title: 'no GPU' }, 400);
      }
      if (target.endsWith('/pods/pod_old'))
        return json({ id: 'pod_old', name: 'evnt-scan', status: 'EXITED' });
      return json({ title: target }, 500);
    };
    const chat = createRunpodChat(
      { ...config, readyTimeoutMs: 10_000 },
      {
        fetch: fetchImpl,
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      },
    );

    await expect(chat.ensureReady()).rejects.toThrow('Runpod start pod failed: no GPU');
    expect(actions.every((action) => action === 'start')).toBe(true);
    expect(actions.length).toBeGreaterThan(1);
  });

  it('fails at once when the stopped pod is gone', async () => {
    let starts = 0;
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
              env: { SCAN_MODEL: config.model, SCAN_CONCURRENCY: '3', SCAN_GPU_COUNT: '1' },
            },
          ],
          pagination: { hasNextPage: false },
        });
      }
      if (target.endsWith('/pods/pod_old/action')) {
        starts += 1;
        return json({ title: 'not found' }, 404);
      }
      return json({ title: target }, 500);
    };
    const chat = createRunpodChat(config, { fetch: fetchImpl, sleep: async () => {} });

    await expect(chat.ensureReady()).rejects.toThrow('Runpod start pod failed: not found');
    expect(starts).toBe(1);
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
        const body = JSON.parse(String(init?.body)) as {
          args?: string;
          env?: { SCAN_MODEL?: string };
        };
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

  it('replaces a one-GPU pod when fifty scans need four A40s', async () => {
    let created: {
      gpu?: { count?: number };
      args?: string;
      env?: {
        SCAN_CONCURRENCY?: string;
        SCAN_GPU_COUNT?: string;
        SCAN_ALLREDUCE?: string;
        NCCL_P2P_DISABLE?: string;
        NCCL_IB_DISABLE?: string;
      };
    } = {};
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
              env: { SCAN_MODEL: config.model, SCAN_CONCURRENCY: '3', SCAN_GPU_COUNT: '1' },
            },
          ],
          pagination: { hasNextPage: false },
        });
      }
      if (target.endsWith('/pods/pod_old/action')) return json(null, 204);
      if (method === 'POST' && target.endsWith('/pods')) {
        created = JSON.parse(String(init?.body)) as typeof created;
        return json({ id: 'pod_new', name: 'evnt-scan', status: 'PROVISIONING' });
      }
      if (target.endsWith('/pods/pod_new')) return json(runningPod('pod_new'));
      if (target.includes('/v1/models')) return json({ data: [] });
      return json({ title: target }, 500);
    };
    const chat = createRunpodChat(
      { ...config, concurrency: 50, gpuCount: 4 },
      { fetch: fetchImpl, sleep: async () => {} },
    );

    const ready = await chat.ensureReady();

    expect(ready.concurrency).toBe(50);
    expect(created.gpu?.count).toBe(4);
    expect(created.env?.SCAN_CONCURRENCY).toBe('50');
    expect(created.env?.SCAN_GPU_COUNT).toBe('4');
    expect(created.args).toContain('--max-num-seqs');
    expect(created.args).toContain('--tensor-parallel-size');
    expect(created.args).toContain('--disable-custom-all-reduce');
    expect(created.args).toContain('hermes');
    expect(created.args).not.toContain('qwen3_coder');
    expect(created.args).not.toContain('--language-model-only');
    expect(created.args).toContain('4');
    expect(created.env?.SCAN_ALLREDUCE).toBe('shm');
    expect(created.env?.NCCL_P2P_DISABLE).toBe('1');
    expect(created.env?.NCCL_IB_DISABLE).toBe('1');
  });

  it('replaces a multi-GPU pod that still opens a GPU peer link', async () => {
    const actions: string[] = [];
    let createdEnv: { NCCL_P2P_DISABLE?: string } = {};
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
              status: 'RUNNING',
              env: {
                SCAN_MODEL: config.model,
                SCAN_CONCURRENCY: '50',
                SCAN_GPU_COUNT: '4',
                SCAN_ALLREDUCE: 'nccl',
              },
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
        const body = JSON.parse(String(init?.body)) as { env?: { NCCL_P2P_DISABLE?: string } };
        createdEnv = body.env ?? {};
        return json({ id: 'pod_new', name: 'evnt-scan', status: 'PROVISIONING' });
      }
      if (target.endsWith('/pods/pod_new')) return json(runningPod('pod_new'));
      if (target.includes('/v1/models')) return json({ data: [] });
      return json({ title: target }, 500);
    };
    const chat = createRunpodChat(
      { ...config, concurrency: 50, gpuCount: 4 },
      { fetch: fetchImpl, sleep: async () => {} },
    );

    const ready = await chat.ensureReady();

    expect(actions).toEqual(['terminate']);
    expect(createdEnv.NCCL_P2P_DISABLE).toBe('1');
    expect(ready.podId).toBe('pod_new');
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
