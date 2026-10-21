/**
 * One reused GPU pod for the import scan. The job starts it, waits until vLLM
 * answers, then stops it. A start with no free GPU keeps that pod and retries
 * until one is free. The model weights live on a network volume in the
 * same data center, so a later start does not download them again.
 */

const RUNPOD_API = 'https://api.runpod.io/v2';
const CHAT_PORT = 8000;
const READY_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_MS = 5_000;
const A40_GPU_ID = 'NVIDIA A40';

/**
 * Upper bound on scans in flight. The default is this same number.
 * One A40 holds about 10 sequences at the 16384 cap. Two hold up to 24,
 * because the weights are split. Four hold this cap. An H100 or H200
 * finishes a batch sooner and costs more per finished scan.
 */
export const MAX_SCAN_CONCURRENCY = 25;

/** A40s required so `concurrency` sequences fit at the 16384 cap. */
export function a40CountForConcurrency(concurrency: number): 1 | 2 | 4 {
  if (concurrency <= 10) return 1;
  if (concurrency <= 24) return 2;
  return 4;
}

export interface RunpodChatConfig {
  apiKey: string;
  chatKey: string;
  podName: string;
  volumeName: string;
  gpuId: string;
  /** A40s on one pod. 1, 2, or 4, so vLLM can split the model. */
  gpuCount: number;
  dataCenterId: string;
  model: string;
  image: string;
  volumeGb: number;
  concurrency: number;
  readyTimeoutMs: number;
}

export interface ReadyChat {
  chatUrl: string;
  model: string;
  auth: string;
  concurrency: number;
  podId: string;
}

export interface RunpodChat {
  ensureReady(): Promise<ReadyChat>;
  /** Stops the named pod when a previous run left it billing and this queue is empty. */
  stopIfRunning(): Promise<void>;
  stop(): Promise<void>;
}

interface RunpodDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type PodStatus = 'PROVISIONING' | 'STARTING' | 'RUNNING' | 'EXITED' | 'ERROR' | 'TERMINATED';

interface PodRecord {
  id: string;
  name: string;
  status: PodStatus;
  createdAt?: string;
  cost?: number;
  runtime?: { ports?: { private?: number }[] } | null;
  /** Shape this pod was started with. Missing on pods created before that label existed. */
  env?: {
    SCAN_MODEL?: string;
    SCAN_CONCURRENCY?: string;
    SCAN_GPU_COUNT?: string;
    /** Set when more than one GPU serves over shared memory, with GPU peer access off. */
    SCAN_ALLREDUCE?: 'shm';
  };
}

interface VolumeRecord {
  id: string;
  name: string;
  dataCenter: string;
}

/** Reads `CHAT_PROVIDER=runpod` settings. A missing key is an error, not a guess. */
export function runpodChatConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RunpodChatConfig | { error: string } {
  const apiKey = env.RUNPOD_API_KEY?.trim() ?? '';
  const chatKey = env.RUNPOD_CHAT_KEY?.trim() ?? '';
  if (!apiKey) return { error: 'RUNPOD_API_KEY is required when CHAT_PROVIDER=runpod' };
  if (!chatKey) return { error: 'RUNPOD_CHAT_KEY is required when CHAT_PROVIDER=runpod' };
  const volumeGb = Number(env.RUNPOD_VOLUME_GB?.trim() || '40');
  if (!Number.isInteger(volumeGb) || volumeGb < 10) {
    return { error: 'RUNPOD_VOLUME_GB must be a whole number of at least 10' };
  }
  const concurrency = Number(env.SCAN_CONCURRENCY?.trim() || String(MAX_SCAN_CONCURRENCY));
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_SCAN_CONCURRENCY) {
    return { error: `SCAN_CONCURRENCY must be a whole number from 1 to ${MAX_SCAN_CONCURRENCY}` };
  }
  const gpuId = env.RUNPOD_GPU?.trim() || A40_GPU_ID;
  return {
    apiKey,
    chatKey,
    podName: env.RUNPOD_POD_NAME?.trim() || 'evnt-scan',
    volumeName: env.RUNPOD_VOLUME_NAME?.trim() || 'evnt-scan-models',
    gpuId,
    gpuCount: gpuId === A40_GPU_ID ? a40CountForConcurrency(concurrency) : 1,
    dataCenterId: env.RUNPOD_DATA_CENTER?.trim() || 'CA-MTL-1',
    model: env.RUNPOD_MODEL?.trim() || 'Qwen/Qwen3.5-27B-GPTQ-Int4',
    image: env.RUNPOD_IMAGE?.trim() || 'vllm/vllm-openai:v0.17.0',
    volumeGb,
    concurrency,
    readyTimeoutMs: READY_TIMEOUT_MS,
  };
}

export function createRunpodChat(config: RunpodChatConfig, deps: RunpodDeps = {}): RunpodChat {
  const fetchImpl = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  let podId: string | null = null;
  let touched = false;

  async function api(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetchImpl(`${RUNPOD_API}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = { title: text.slice(0, 200) };
      }
    }
    return { status: response.status, body };
  }

  return {
    async ensureReady() {
      touched = true;
      const volumeId = await ensureVolume(api, config);
      const existing = await findPod(api, config.podName);
      let pod = existing;
      if (pod && !sameShape(pod, config)) {
        await api(`/pods/${pod.id}/action`, { method: 'POST', body: { action: 'terminate' } });
        pod = null;
      }
      if (!pod) pod = await createPod(api, config, volumeId);
      podId = pod.id;
      if (pod.status === 'EXITED' || pod.status === 'ERROR') {
        await startWhenFree(api, pod.id, config, now, sleep);
      }
      const ready = await waitUntilReady(api, fetchImpl, pod.id, config, now, sleep);
      console.log(
        JSON.stringify({
          podId: ready.id,
          status: ready.status,
          costPerHour: ready.cost ?? null,
          concurrency: config.concurrency,
          gpuCount: config.gpuCount,
        }),
      );
      return {
        chatUrl: `https://${ready.id}-${CHAT_PORT}.proxy.runpod.net/v1/chat/completions`,
        model: config.model,
        auth: config.chatKey,
        concurrency: config.concurrency,
        podId: ready.id,
      };
    },
    async stopIfRunning() {
      const pod = await findPod(api, config.podName);
      if (!pod || !busyStatus(pod.status)) return;
      podId = pod.id;
      touched = true;
      await stopPod(api, pod.id);
    },
    async stop() {
      if (!touched || !podId) return;
      const current = await api(`/pods/${podId}`);
      const pod = asPod(current.body);
      if (!pod || !busyStatus(pod.status)) return;
      await stopPod(api, pod.id);
    },
  };
}

function busyStatus(status: PodStatus): boolean {
  return status === 'RUNNING' || status === 'STARTING' || status === 'PROVISIONING';
}

async function ensureVolume(
  api: (
    path: string,
    init?: { method?: string; body?: unknown },
  ) => Promise<{ status: number; body: unknown }>,
  config: RunpodChatConfig,
): Promise<string> {
  const volumes = (await listAll(api, '/network-volumes', 'networkVolumes'))
    .map(asVolume)
    .filter((volume): volume is VolumeRecord => volume !== null);
  const found = volumes.find(
    (volume) => volume.name === config.volumeName && volume.dataCenter === config.dataCenterId,
  );
  if (found) return found.id;
  const center = await api(`/catalog/datacenters/${encodeURIComponent(config.dataCenterId)}`);
  if (center.status >= 400) throw apiError('read data center', center.status, center.body);
  const types = volumeTypes(center.body);
  if (types.length === 0) {
    throw new Error(
      `Runpod data center ${config.dataCenterId} does not offer network volumes, so ${config.gpuId} cannot store model weights there`,
    );
  }
  const created = await api('/network-volumes', {
    method: 'POST',
    body: {
      name: config.volumeName,
      size: config.volumeGb,
      dataCenter: config.dataCenterId,
      type: types[0],
    },
  });
  if (created.status >= 400) throw apiError('create network volume', created.status, created.body);
  const volume = asVolume(created.body);
  if (!volume) throw new Error('Runpod create network volume returned no id');
  return volume.id;
}

async function findPod(
  api: (path: string) => Promise<{ status: number; body: unknown }>,
  name: string,
): Promise<PodRecord | null> {
  const pods = (await listAll(api, '/pods', 'pods'))
    .map(asPod)
    .filter(
      (pod): pod is PodRecord => pod !== null && pod.name === name && pod.status !== 'TERMINATED',
    );
  pods.sort(
    (a, b) =>
      rank(b.status) - rank(a.status) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  );
  return pods[0] ?? null;
}

function rank(status: PodStatus): number {
  if (status === 'RUNNING') return 3;
  if (status === 'STARTING' || status === 'PROVISIONING') return 2;
  if (status === 'EXITED') return 1;
  return 0;
}

async function createPod(
  api: (
    path: string,
    init?: { method?: string; body?: unknown },
  ) => Promise<{ status: number; body: unknown }>,
  config: RunpodChatConfig,
  volumeId: string,
): Promise<PodRecord> {
  const created = await api('/pods', {
    method: 'POST',
    body: {
      name: config.podName,
      cloud: 'SECURE',
      dataCenterIds: [config.dataCenterId],
      gpu: { id: config.gpuId, count: config.gpuCount, minCudaVersion: '12.8' },
      image: config.image,
      ports: [`${CHAT_PORT}/http`],
      disk: 40,
      env: {
        HF_HOME: '/models',
        HUGGING_FACE_HUB_CACHE: '/models',
        SCAN_MODEL: config.model,
        SCAN_CONCURRENCY: String(config.concurrency),
        SCAN_GPU_COUNT: String(config.gpuCount),
        ...(config.gpuCount > 1
          ? { SCAN_ALLREDUCE: 'shm', NCCL_P2P_DISABLE: '1', NCCL_IB_DISABLE: '1' }
          : {}),
        VLLM_API_KEY: config.chatKey,
      },
      args: JSON.stringify({
        entrypoint: ['vllm', 'serve'],
        cmd: vllmCommand(config),
      }),
      mounts: { network: [{ volumeId, path: '/models' }] },
    },
  });
  if (created.status >= 400) throw apiError('create pod', created.status, created.body);
  const pod = asPod(created.body);
  if (!pod) throw new Error('Runpod create pod returned no id');
  return pod;
}

/**
 * Retries start until a GPU is free. This wait and the later model-ready wait
 * each get `readyTimeoutMs`. A missing pod or a rejected key fails at once.
 * The pod stays either way.
 */
async function startWhenFree(
  api: (
    path: string,
    init?: { method?: string; body?: unknown },
  ) => Promise<{ status: number; body: unknown }>,
  id: string,
  config: RunpodChatConfig,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const deadline = now() + config.readyTimeoutMs;
  for (;;) {
    const started = await api(`/pods/${id}/action`, { method: 'POST', body: { action: 'start' } });
    if (started.status < 400) return;
    const failure = apiError('start pod', started.status, started.body);
    if (!startCanWait(started.status) || now() > deadline) throw failure;
    console.log(JSON.stringify({ podId: id, waiting: 'gpu', status: started.status }));
    await sleep(POLL_MS);
  }
}

/** Capacity and transient start errors are worth another try. Auth and a missing pod are not. */
function startCanWait(status: number): boolean {
  return status !== 401 && status !== 403 && status !== 404 && status !== 422;
}

async function waitUntilReady(
  api: (path: string) => Promise<{ status: number; body: unknown }>,
  fetchImpl: typeof fetch,
  id: string,
  config: RunpodChatConfig,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<PodRecord> {
  const deadline = now() + config.readyTimeoutMs;
  for (;;) {
    const read = await api(`/pods/${id}`);
    const pod = asPod(read.body);
    if (pod?.status === 'ERROR')
      throw new Error(`Runpod pod ${id} entered ERROR before the model was ready`);
    if (
      pod?.status === 'RUNNING' &&
      pod.runtime?.ports?.some((port) => port.private === CHAT_PORT)
    ) {
      const models = await fetchImpl(`https://${id}-${CHAT_PORT}.proxy.runpod.net/v1/models`, {
        headers: { authorization: `Bearer ${config.chatKey}` },
      });
      if (models.ok) return pod;
    }
    if (now() > deadline) throw new Error(`Runpod pod ${id} did not become ready`);
    await sleep(POLL_MS);
  }
}

async function stopPod(
  api: (
    path: string,
    init?: { method?: string; body?: unknown },
  ) => Promise<{ status: number; body: unknown }>,
  id: string,
): Promise<void> {
  const stopped = await api(`/pods/${id}/action`, { method: 'POST', body: { action: 'stop' } });
  if (stopped.status === 409 || stopped.status === 204) return;
  if (stopped.status >= 400) throw apiError('stop pod', stopped.status, stopped.body);
}

async function listAll(
  api: (path: string) => Promise<{ status: number; body: unknown }>,
  path: '/pods' | '/network-volumes',
  key: 'pods' | 'networkVolumes',
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const page = await api(`${path}${query}`);
    if (page.status >= 400) throw apiError(`list ${path}`, page.status, page.body);
    const body = record(page.body);
    const items = body?.[key];
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item && typeof item === 'object') rows.push(item as Record<string, unknown>);
      }
    }
    const pagination = record(body?.pagination);
    const next = typeof pagination?.nextCursor === 'string' ? pagination.nextCursor : null;
    if (!next || pagination?.hasNextPage !== true) return rows;
    cursor = next;
  }
}

function asPod(value: unknown): PodRecord | null {
  const body = record(value);
  if (
    !body ||
    typeof body.id !== 'string' ||
    typeof body.name !== 'string' ||
    typeof body.status !== 'string'
  ) {
    return null;
  }
  const runtime = record(body.runtime);
  const ports = Array.isArray(runtime?.ports) ? runtime.ports : undefined;
  return {
    id: body.id,
    name: body.name,
    status: body.status as PodStatus,
    ...(typeof body.createdAt === 'string' ? { createdAt: body.createdAt } : {}),
    ...(typeof body.cost === 'number' ? { cost: body.cost } : {}),
    ...(scanEnv(body.env) ? { env: scanEnv(body.env) } : {}),
    runtime: ports
      ? {
          ports: ports.flatMap((port) => {
            const item = record(port);
            return typeof item?.private === 'number' ? [{ private: item.private }] : [];
          }),
        }
      : null,
  };
}

function asVolume(value: unknown): VolumeRecord | null {
  const body = record(value);
  if (
    !body ||
    typeof body.id !== 'string' ||
    typeof body.name !== 'string' ||
    typeof body.dataCenter !== 'string'
  ) {
    return null;
  }
  return { id: body.id, name: body.name, dataCenter: body.dataCenter };
}

function vllmCommand(config: RunpodChatConfig): string[] {
  return [
    config.model,
    '--host',
    '0.0.0.0',
    '--port',
    String(CHAT_PORT),
    '--trust-remote-code',
    '--enable-auto-tool-choice',
    '--tool-call-parser',
    'qwen3_coder',
    '--reasoning-parser',
    'qwen3',
    '--language-model-only',
    '--download-dir',
    '/models',
    '--max-model-len',
    '16384',
    '--max-num-seqs',
    String(config.concurrency),
    ...(config.gpuCount > 1
      ? ['--tensor-parallel-size', String(config.gpuCount), '--disable-custom-all-reduce']
      : []),
  ];
}

function sameShape(pod: PodRecord, config: RunpodChatConfig): boolean {
  const allReduce = config.gpuCount > 1 ? pod.env?.SCAN_ALLREDUCE === 'shm' : true;
  return (
    allReduce &&
    pod.env?.SCAN_MODEL === config.model &&
    pod.env?.SCAN_CONCURRENCY === String(config.concurrency) &&
    pod.env?.SCAN_GPU_COUNT === String(config.gpuCount)
  );
}

function scanEnv(value: unknown): PodRecord['env'] | undefined {
  const env = record(value);
  const model = env?.SCAN_MODEL;
  const concurrency = env?.SCAN_CONCURRENCY;
  const gpuCount = env?.SCAN_GPU_COUNT;
  if (typeof model !== 'string' || !model.trim()) return undefined;
  return {
    SCAN_MODEL: model,
    ...(typeof concurrency === 'string' && concurrency.trim()
      ? { SCAN_CONCURRENCY: concurrency }
      : {}),
    ...(typeof gpuCount === 'string' && gpuCount.trim() ? { SCAN_GPU_COUNT: gpuCount } : {}),
    ...(env?.SCAN_ALLREDUCE === 'shm' ? { SCAN_ALLREDUCE: 'shm' as const } : {}),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function volumeTypes(value: unknown): Array<'STANDARD' | 'HIGH_PERFORMANCE'> {
  const types = record(value)?.networkVolumeTypes;
  if (!Array.isArray(types)) return [];
  return types.filter(
    (type): type is 'STANDARD' | 'HIGH_PERFORMANCE' =>
      type === 'STANDARD' || type === 'HIGH_PERFORMANCE',
  );
}

function apiError(action: string, status: number, body: unknown): Error {
  const item = record(body);
  const title = typeof item?.title === 'string' ? item.title : '';
  const detail = typeof item?.detail === 'string' ? item.detail : '';
  const message = [title, detail].filter(Boolean).join(': ') || `HTTP ${status}`;
  return new Error(`Runpod ${action} failed: ${message}`);
}
