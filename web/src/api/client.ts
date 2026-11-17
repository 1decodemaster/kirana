import type { ApiError as ApiErrorDto } from '@kirana/shared';

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

interface RequestOptions {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  /** Resolve path from the origin root instead of /api/v1 (healthz, §7.2 #32). */
  readonly absolute?: boolean;
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
    throw new NetworkError(cause);
  }
  return parseResponse<T>(response);
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
