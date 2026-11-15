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
}

export async function api<T>(path: string, options: RequestOptions): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
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
export const post = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string): Promise<T> => api<T>(path, { method: 'DELETE' });
