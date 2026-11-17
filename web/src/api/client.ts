import type { ApiError as ApiErrorDto } from '@kirana/shared';
import {
  drainQueue,
  enqueueMutation,
  idbQueueStore,
  isQueueable,
  QUEUE_DROPPED_EVENT,
  refreshQueueCount,
  type QueueStore,
} from '../lib/offline.js';

const BASE = '/api/v1';

/** Error carrying the §7.1 envelope from the server. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, body: ApiErrorDto) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Network request failed');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/** A queued mutation resolved as success: the optimistic UI stands and the
 * queue replays it on reconnect (§4.7 QUEUED). Callers that need a response
 * body must tolerate undefined when this is possible. */
export class QueuedError extends Error {
  constructor() {
    super('Queued for replay when back online');
    this.name = 'QueuedError';
  }
}

interface RequestOptions {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  /** Resolve path from the origin root instead of /api/v1 (healthz, §7.2 #32). */
  readonly absolute?: boolean;
  /** Overridden in tests; the runtime store is IndexedDB. */
  readonly queueStore?: QueueStore;
}

let defaultQueueStore: QueueStore = idbQueueStore;

export function setDefaultQueueStore(store: QueueStore): void {
  defaultQueueStore = store;
}

function newClientId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `q-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function api<T>(path: string, options: RequestOptions): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${options.absolute === true ? '' : BASE}${path}`, {
      method: options.method,
      headers: {
        // §7.1: every mutation carries the CSRF header. Content-Type only
        // goes out with an actual body — Fastify rejects bodiless JSON POSTs.
        ...(options.method === 'GET' ? {} : { 'x-requested-with': 'kirana' }),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal,
    });
  } catch (cause: unknown) {
    if (options.signal?.aborted === true) throw new NetworkError(cause);
    return queueOrThrow<T>(path, options, cause);
  }
  if (response.status >= 500 && isQueueable(options.method, `${BASE}${path}`)) {
    return queueOrThrow<T>(path, options, new Error(`server error ${response.status}`));
  }
  return parseResponse<T>(response);
}

/** §4.7: 5xx / offline → QUEUED. The optimistic UI stands; drainQueue
 * replays oldest-first on reconnect. */
async function queueOrThrow<T>(
  path: string,
  options: RequestOptions,
  cause: unknown,
): Promise<T> {
  if (isQueueable(options.method, `${BASE}${path}`)) {
    // isQueueable guarantees a mutating verb; QueueEntry narrows the union.
    const method: 'POST' | 'PATCH' | 'DELETE' | 'PUT' =
      options.method === 'GET' ? 'PATCH' : options.method;
    await enqueueMutation(options.queueStore ?? defaultQueueStore, {
      clientId: newClientId(),
      method,
      path: `${BASE}${path}`,
      ...(options.body === undefined ? {} : { body: options.body }),
      createdAt: Date.now(),
    });
    return undefined as T;
  }
  throw new NetworkError(cause);
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/** Replay queued mutations oldest-first (G4.2/G4.3). Called on boot and on
 * the browser 'online' event. A 401 stops the drain — the entries survive
 * for the next session; the resumed board query redirects to login. */
export async function drainMutationQueue(): Promise<void> {
  const store = defaultQueueStore;
  await refreshQueueCount(store);
  if (!isOnline()) return;
  const result = await drainQueue(store, async (entry) => {
    try {
      const response = await fetch(entry.path, {
        method: entry.method,
        headers: {
          'x-requested-with': 'kirana',
          ...(entry.body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
        },
        ...(entry.body === undefined ? {} : { body: JSON.stringify(entry.body) }),
      });
      return { ok: response.ok, status: response.status, networkFailure: false };
    } catch {
      return { ok: false, status: 0, networkFailure: true };
    }
  });
  await refreshQueueCount(store);
  if (result.dropped > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(QUEUE_DROPPED_EVENT));
  }
}

/** Wire boot + reconnect draining (main.tsx calls this once). */
export function startOfflineQueue(): void {
  if (typeof window === 'undefined') return;
  void drainMutationQueue();
  window.addEventListener('online', () => void drainMutationQueue());
}

/** multipart upload (§7.2 #28): the browser sets the boundary header. */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'x-requested-with': 'kirana' },
      body: form,
    });
  } catch (cause: unknown) {
    throw new NetworkError(cause);
  }
  return parseResponse<T>(response);
}

/** Trigger a browser download for a GET endpoint (§9.4 export). The server's
 *  content-disposition filename wins when present. */
export async function download(path: string, fallbackName: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { headers: { 'x-requested-with': 'kirana' } });
  } catch (cause: unknown) {
    throw new NetworkError(cause);
  }
  if (!response.ok) return parseResponse(response) as never;
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = match?.[1] ?? fallbackName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => undefined);
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'error' in raw &&
      typeof (raw as { error: unknown }).error === 'object'
    ) {
      throw new ApiError(response.status, (raw as { error: ApiErrorDto }).error);
    }
    throw new ApiError(response.status, {
      code: 'INTERNAL',
      message: `Request failed with status ${response.status}`,
      requestId: '',
    });
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const get = <T>(path: string, signal?: AbortSignal): Promise<T> =>
  api<T>(path, { method: 'GET', signal });
export const getRoot = <T>(path: string, signal?: AbortSignal): Promise<T> =>
  api<T>(path, { method: 'GET', signal, absolute: true });
export const post = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string): Promise<T> => api<T>(path, { method: 'DELETE' });
