import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminBackupResponseSchema, importCommitRequestSchema, importPreviewResponseSchema, uuidSchema } from '@kirana/shared';
import { httpError } from '../plugins/errors.js';
import { createBackup } from '../services/backup.js';
import { exportJson, exportStoreCsv } from '../services/export.js';
import { commitImport } from '../services/importCommit.js';
import { previewImport } from '../services/importPreview.js';
import { issuePreviewToken } from '../services/importToken.js';
import { isJsonUpload, MAX_IMPORT_ROWS, parseCsvImport, parseJsonImport } from '../services/importParse.js';
import { parseRequest } from '../validate.js';
import { requireActor } from '../services/actor.js';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const exportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).optional(),
  storeId: uuidSchema.optional(),
});

export interface ImportExportOptions {
  readonly dataDir: string;
  readonly backupKeepDaily: number;
  readonly sessionSecret: string;
}

export async function importExportRoutes(app: FastifyInstance, opts: ImportExportOptions): Promise<void> {
  // §7.2 #28: multipart upload. Official plugin; hand-rolled multipart
  // parsing would be risk without benefit (justification in the phase log).
  await app.register(multipart, {
    limits: { files: 1, fileSize: MAX_IMPORT_BYTES },
  });

  app.post('/import/preview', async (req) => {
    const actor = requireActor(req);
    const text = await readUpload(req);
    const parsed = isJsonUpload(req.headers['content-type'] ?? '', text)
      ? parseJsonImport(text)
      : parseCsvImport(text);
    if (parsed.length > MAX_IMPORT_ROWS) {
      throw httpError(400, 'IMPORT_PARSE_FAILED', `Import files are limited to ${MAX_IMPORT_ROWS} rows`);
    }
    const { counts, rows, invalidLines } = previewImport(app.db, actor.householdId, parsed);
    const token = issuePreviewToken(opts.sessionSecret, actor.householdId, { rows, invalidLines }, Date.now());
    return importPreviewResponseSchema.parse({ ...counts, rows, token });
  });

  app.post('/import/commit', async (req) => {
    const actor = requireActor(req);
    const body = parseRequest(importCommitRequestSchema, req.body);
    return commitImport(app.db, actor, opts.sessionSecret, body.token, body.decisions, Date.now());
  });

  app.get('/export', async (req, reply) => {
    const actor = requireActor(req);
    const query = parseRequest(exportQuerySchema, req.query);
    if (query.format === 'csv') {
      if (query.storeId === undefined) {
        throw httpError(400, 'VALIDATION_FAILED', 'storeId is required when format=csv');
      }
      const { csv, filename } = exportStoreCsv(app.db, actor.householdId, query.storeId);
      reply.type('text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="${filename}"`);
      return csv;
    }
    return exportJson(app.db, actor.householdId, Date.now());
  });

  app.post('/admin/backup', async () => {
    const { file } = await createBackup(app.db, opts.dataDir, opts.backupKeepDaily, Date.now());
    return adminBackupResponseSchema.parse({ file });
  });
}

async function readUpload(req: FastifyRequest): Promise<string> {
  let part: Awaited<ReturnType<typeof req.file>>;
  try {
    part = await req.file();
  } catch {
    throw httpError(400, 'IMPORT_PARSE_FAILED', 'Send the import file as multipart/form-data with a "file" field');
  }
  if (part === undefined || part.fieldname !== 'file') {
    throw httpError(400, 'IMPORT_PARSE_FAILED', 'Send the import file as multipart/form-data with a "file" field');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of part.file) {
    size += chunk.length;
    if (size > MAX_IMPORT_BYTES) {
      part.file.destroy();
      throw httpError(400, 'IMPORT_PARSE_FAILED', `Import file exceeds ${MAX_IMPORT_BYTES} bytes`);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
