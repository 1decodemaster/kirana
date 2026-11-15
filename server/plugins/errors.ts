import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ERROR_CODES, type ErrorCode } from '@kirana/shared';

const STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT_STALE',
  429: 'RATE_LIMITED',
};

export interface HttpError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
}

export interface ErrorsPluginOptions {
  readonly spaIndex?: boolean;
}

export function httpError(
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): HttpError {
  const error: HttpError = Object.assign(new Error(message), {
    statusCode,
    code,
    ...(details === undefined ? {} : { details }),
  });
  return error;
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

function statusCodeOf(error: FastifyError): number {
  return typeof error.statusCode === 'number' ? error.statusCode : 500;
}

async function errorsPlugin(app: FastifyInstance, opts: ErrorsPluginOptions = {}): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header('X-Request-Id', req.id);
  });

  app.setNotFoundHandler((req, reply) => {
    const wantsHtml = (req.headers.accept ?? '').includes('text/html');
    if (opts.spaIndex === true && req.method === 'GET' && wantsHtml) {
      void reply.sendFile('index.html');
      return;
    }
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.url} not found`,
        requestId: req.id,
      },
    });
  });

  app.setErrorHandler((rawError, req, reply) => {
    const error = rawError as FastifyError;
    const statusCode = statusCodeOf(error);
    const code = isErrorCode(error.code) ? error.code : (STATUS_TO_CODE[statusCode] ?? 'INTERNAL');
    const message = statusCode >= 500 ? 'Internal server error' : error.message;
    const details = (error as { details?: Record<string, unknown> }).details;
    const payload = {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
        requestId: req.id,
      },
    };
    if (statusCode >= 500) {
      req.log.error({ err: error, requestId: req.id }, 'unhandled error');
    } else {
      req.log.info({ err: error, requestId: req.id }, 'request rejected');
    }
    void reply.code(statusCode).send(payload);
  });
}

export default fp(errorsPlugin, { name: 'kirana-errors' });
