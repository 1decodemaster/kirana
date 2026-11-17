import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import * as c from '@kirana/shared';

interface ParamSpec {
  readonly name: string;
  readonly location: 'path' | 'query';
  readonly schema: z.ZodType;
  readonly description?: string;
}

interface EndpointSpec {
  readonly method: 'get' | 'post' | 'patch' | 'delete' | 'put';
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly tag: string;
  readonly body?: z.ZodType;
  readonly response?: z.ZodType;
  readonly params?: readonly ParamSpec[];
  readonly sse?: boolean;
  readonly multipart?: boolean;
  readonly documentedErrors?: readonly string[];
}

const V7 = 'UUIDv7 string';

const idParam = (name = 'id'): ParamSpec => ({
  name,
  location: 'path',
  schema: c.uuidSchema,
  description: V7,
});

const sinceParam: ParamSpec = {
  name: 'since',
  location: 'query',
  schema: z.number().int().nonnegative(),
  description: 'Global revision (change_log.id) cursor',
};

const ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'post',
    path: '/api/v1/auth/login',
    operationId: 'authLogin',
    summary: 'Exchange the household passcode for a session cookie',
    tag: 'auth',
    body: c.loginRequestSchema,
    response: c.loginResponseSchema,
    documentedErrors: ['UNAUTHORIZED', 'RATE_LIMITED'],
  },
  {
    method: 'post',
    path: '/api/v1/auth/logout',
    operationId: 'authLogout',
    summary: 'Clear the current session',
    tag: 'auth',
    response: c.logoutResponseSchema,
  },
  {
    method: 'get',
    path: '/api/v1/auth/me',
    operationId: 'authMe',
    summary: 'Current member and household',
    tag: 'auth',
    response: c.meResponseSchema,
    documentedErrors: ['UNAUTHORIZED'],
  },
  {
    method: 'post',
    path: '/api/v1/auth/members',
    operationId: 'authMembers',
    summary: 'Member roster for the login screen (passcode-gated, ADR-0005)',
    tag: 'auth',
    body: c.authMembersRequestSchema,
    response: c.authMembersResponseSchema,
    documentedErrors: ['UNAUTHORIZED', 'RATE_LIMITED'],
  },
  {
    method: 'post',
    path: '/api/v1/household',
    operationId: 'createHousehold',
    summary: 'First-run wizard commit: household + first member, sets sid (§8.9, ADR-0005)',
    tag: 'household',
    body: c.createHouseholdRequestSchema,
    response: c.createHouseholdResponseSchema,
    documentedErrors: ['FORBIDDEN', 'RATE_LIMITED'],
  },
  {
    method: 'patch',
    path: '/api/v1/household',
    operationId: 'updateHousehold',
    summary: 'Rename the household or change the passcode (§8.1 settings)',
    tag: 'household',
    body: c.updateHouseholdRequestSchema,
    response: c.householdMutationResponseSchema,
    documentedErrors: ['UNAUTHORIZED'],
  },
  {
    method: 'post',
    path: '/api/v1/members',
    operationId: 'createMember',
    summary: 'Add a household member (§8.1 settings)',
    tag: 'members',
    body: c.createMemberRequestSchema,
    response: c.memberMutationResponseSchema,
    documentedErrors: ['UNAUTHORIZED'],
  },
  {
    method: 'patch',
    path: '/api/v1/members/{id}',
    operationId: 'updateMember',
    summary: 'Rename a member or change their avatar color',
    tag: 'members',
    body: c.updateMemberRequestSchema,
    response: c.memberMutationResponseSchema,
    params: [idParam()],
    documentedErrors: ['UNAUTHORIZED', 'NOT_FOUND'],
  },
  {
    method: 'delete',
    path: '/api/v1/members/{id}',
    operationId: 'deleteMember',
    summary: 'Soft delete a member; 403 when it is the last active one',
    tag: 'members',
    response: c.deletedResponseSchema,
    params: [idParam()],
    documentedErrors: ['UNAUTHORIZED', 'NOT_FOUND', 'FORBIDDEN'],
  },
  {
    method: 'get',
    path: '/api/v1/board',
    operationId: 'getBoard',
    summary: 'Full Home payload; pass since for a delta',
    tag: 'board',
    response: c.boardResponseSchema,
    params: [sinceParam],
    documentedErrors: ['UNAUTHORIZED'],
  },
  {
    method: 'post',
    path: '/api/v1/stores',
    operationId: 'createStore',
    summary: 'Create a store',
    tag: 'stores',
    body: c.createStoreRequestSchema,
    response: c.storeMutationResponseSchema,
  },
  {
    method: 'patch',
    path: '/api/v1/stores/{id}',
    operationId: 'updateStore',
    summary: 'Update name, icon, status, ordering or notes',
    tag: 'stores',
    body: c.updateStoreRequestSchema,
    response: c.storeMutationResponseSchema,
    params: [idParam()],
    documentedErrors: ['NOT_FOUND', 'CONFLICT_STALE'],
  },
  {
    method: 'delete',
    path: '/api/v1/stores/{id}',
    operationId: 'deleteStore',
    summary: 'Soft delete a store (409 if it has active items)',
    tag: 'stores',
    response: c.deletedResponseSchema,
    params: [idParam()],
    documentedErrors: ['NOT_FOUND', 'STORE_NOT_EMPTY'],
  },
  {
    method: 'post',
    path: '/api/v1/stores/{id}/items',
    operationId: 'addListItem',
    summary: 'Add a list item by catalog id or free text (§7.4)',
    tag: 'list',
    body: c.addListItemRequestSchema,
    response: c.addListItemResponseSchema,
    params: [idParam('id')],
    documentedErrors: ['NOT_FOUND', 'ITEM_NEAR_DUPLICATE'],
  },
  {
    method: 'post',
    path: '/api/v1/stores/{id}/clear-bought',
    operationId: 'clearBought',
    summary: 'Soft-clear all bought rows (§6.7)',
    tag: 'list',
    response: c.clearBoughtResponseSchema,
    params: [idParam('id')],
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/api/v1/stores/{id}/done',
    operationId: 'markStoreDone',
    summary: 'Mark done; 409 unless zero active items (§4.6)',
    tag: 'stores',
    response: c.storeMutationResponseSchema,
    params: [idParam('id')],
    documentedErrors: ['NOT_FOUND', 'STORE_NOT_EMPTY'],
  },
  {
    method: 'post',
    path: '/api/v1/stores/{id}/reopen',
    operationId: 'reopenStore',
    summary: 'done/archived → active',
    tag: 'stores',
    response: c.storeMutationResponseSchema,
    params: [idParam('id')],
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'patch',
    path: '/api/v1/list-items/{id}',
    operationId: 'patchListItem',
    summary: 'Update qty, unit, category, note, status or sortOrder',
    tag: 'list',
    body: c.patchListItemRequestSchema,
    response: c.listItemMutationResponseSchema,
    params: [idParam()],
    documentedErrors: ['NOT_FOUND', 'CONFLICT_STALE'],
  },
  {
    method: 'delete',
    path: '/api/v1/list-items/{id}',
    operationId: 'deleteListItem',
    summary: 'Hard delete a list row, returns an undo token',
    tag: 'list',
    response: c.deleteListItemResponseSchema,
    params: [idParam()],
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/api/v1/list-items/bulk-check',
    operationId: 'bulkCheck',
    summary: 'Check or uncheck many rows at once',
    tag: 'list',
    body: c.bulkCheckRequestSchema,
    response: c.bulkCheckResponseSchema,
  },
  {
    method: 'get',
    path: '/api/v1/items',
    operationId: 'searchItems',
    summary: 'Catalog search/browse ranked per §8.6',
    tag: 'catalog',
    response: c.getItemsResponseSchema,
    params: [
      { name: 'q', location: 'query', schema: z.string().max(80) },
      { name: 'categoryId', location: 'query', schema: c.uuidSchema },
      { name: 'storeId', location: 'query', schema: c.uuidSchema },
      { name: 'limit', location: 'query', schema: z.number().int().min(1).max(200) },
      { name: 'cursor', location: 'query', schema: z.string() },
    ],
  },
  {
    method: 'post',
    path: '/api/v1/items',
    operationId: 'createItem',
    summary: 'Create a catalog item with optional aliases',
    tag: 'catalog',
    body: c.createItemRequestSchema,
    response: c.itemMutationResponseSchema,
  },
  {
    method: 'get',
    path: '/api/v1/items/{id}',
    operationId: 'getItem',
    summary: 'Full item detail: aliases, defaults, attrs, usage stats (ADR-0003)',
    tag: 'catalog',
    response: c.getItemResponseSchema,
    params: [idParam()],
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'patch',
    path: '/api/v1/items/{id}',
    operationId: 'updateItem',
    summary: 'Update name, defaults, icon or attrs',
    tag: 'catalog',
    body: c.updateItemRequestSchema,
    response: c.itemMutationResponseSchema,
    params: [idParam()],
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'delete',
    path: '/api/v1/items/{id}',
    operationId: 'deleteItem',
    summary: 'Soft delete an item; list rows render as Archived item (INV-6)',
    tag: 'catalog',
    response: c.deletedResponseSchema,
    params: [idParam()],
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/api/v1/items/{id}/aliases',
    operationId: 'createAlias',
    summary: 'Add an alias in a known language',
    tag: 'catalog',
    body: c.createAliasRequestSchema,
    response: c.aliasMutationResponseSchema,
    params: [idParam()],
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'delete',
    path: '/api/v1/items/{id}/aliases/{aliasId}',
    operationId: 'deleteAlias',
    summary: 'Remove an alias',
    tag: 'catalog',
    response: c.deletedResponseSchema,
    params: [idParam(), idParam('aliasId')],
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/api/v1/items/merge',
    operationId: 'mergeItems',
    summary: 'Merge duplicate catalog items (§6.4 hygiene)',
    tag: 'catalog',
    body: c.mergeItemsRequestSchema,
    response: c.mergeItemsResponseSchema,
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'get',
    path: '/api/v1/categories',
    operationId: 'listCategories',
    summary: 'Categories with usage counts',
    tag: 'categories',
    response: c.categoriesResponseSchema,
  },
  {
    method: 'post',
    path: '/api/v1/categories',
    operationId: 'createCategory',
    summary: 'Create a category',
    tag: 'categories',
    body: c.createCategoryRequestSchema,
    response: c.categoryMutationResponseSchema,
  },
  {
    method: 'patch',
    path: '/api/v1/categories/{id}',
    operationId: 'updateCategory',
    summary: 'Update name, icon, color, scope or sortOrder',
    tag: 'categories',
    body: c.updateCategoryRequestSchema,
    response: c.categoryMutationResponseSchema,
    params: [idParam()],
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'delete',
    path: '/api/v1/categories/{id}',
    operationId: 'deleteCategory',
    summary: 'Soft delete; entries are reassigned to Other (§7.2 #26)',
    tag: 'categories',
    response: c.deletedResponseSchema,
    params: [idParam()],
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'put',
    path: '/api/v1/stores/{id}/category-order',
    operationId: 'setCategoryOrder',
    summary: 'Set per-store aisle order (§6.8)',
    tag: 'stores',
    body: c.categoryOrderRequestSchema,
    response: c.categoryOrderResponseSchema,
    params: [idParam('id')],
    documentedErrors: ['NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/api/v1/import/preview',
    operationId: 'importPreview',
    summary: 'Parse CSV/JSON upload into a diff + signed token (§9.3)',
    tag: 'import-export',
    multipart: true,
    response: c.importPreviewResponseSchema,
    documentedErrors: ['IMPORT_PARSE_FAILED', 'VALIDATION_FAILED'],
  },
  {
    method: 'post',
    path: '/api/v1/import/commit',
    operationId: 'importCommit',
    summary: 'Apply preview decisions atomically (§9.3)',
    tag: 'import-export',
    body: c.importCommitRequestSchema,
    response: c.importCommitResponseSchema,
    documentedErrors: ['IMPORT_TOKEN_EXPIRED', 'IMPORT_PARSE_FAILED'],
  },
  {
    method: 'get',
    path: '/api/v1/export',
    operationId: 'exportData',
    summary: 'Full household dump (json) or per-store list (csv) (§9.4)',
    tag: 'import-export',
    response: c.exportPayloadSchema,
    params: [
      { name: 'format', location: 'query', schema: z.enum(['json', 'csv']) },
      { name: 'storeId', location: 'query', schema: c.uuidSchema },
    ],
  },
  {
    method: 'get',
    path: '/api/v1/events',
    operationId: 'streamEvents',
    summary: 'SSE stream of change_log rows (§7.5)',
    tag: 'sync',
    sse: true,
    params: [sinceParam],
  },
  {
    method: 'get',
    path: '/healthz',
    operationId: 'healthz',
    summary: 'Liveness with version + revision (G0.1)',
    tag: 'meta',
    response: c.healthResponseSchema,
  },
  {
    method: 'post',
    path: '/api/v1/admin/backup',
    operationId: 'triggerBackup',
    summary: 'On-demand .backup, returns the filename (§12.4)',
    tag: 'meta',
    response: c.adminBackupResponseSchema,
  },
];

function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): unknown {
  return z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' });
}

function paramToOpenApi(p: ParamSpec): unknown {
  return {
    name: p.name,
    in: p.location,
    required: p.location === 'path',
    description: p.description,
    schema: toJsonSchema(p.schema, 'input'),
  };
}

function errorResponse(code: string): unknown {
  return {
    description: code,
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
    },
  };
}

export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const openApiPath = e.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const item: Record<string, unknown> = {
      operationId: e.operationId,
      summary: e.summary,
      tags: [e.tag],
      responses: {
        ...(e.response === undefined
          ? {}
          : {
              '200': {
                description: 'Success',
                content: {
                  ...(e.sse
                    ? {
                        'text/event-stream': {
                          schema: {
                            type: 'object',
                            properties: {
                              revision: { type: 'integer' },
                              entity: { type: 'string' },
                              entityId: { type: 'string' },
                              op: { type: 'string' },
                              storeId: { type: ['string', 'null'] },
                            },
                          },
                        },
                      }
                    : {
                        'application/json': { schema: toJsonSchema(e.response, 'output') },
                      }),
                },
              },
            }),
        '4XX': errorResponse('client error'),
        '5XX': errorResponse('server error'),
        ...(e.sse ? {} : { default: errorResponse('error') }),
      },
    };
    if (e.params !== undefined && e.params.length > 0) {
      item.parameters = e.params.map(paramToOpenApi);
    }
    if (e.body !== undefined) {
      item.requestBody = {
        required: true,
        content: {
          'application/json': { schema: toJsonSchema(e.body, 'input') },
        },
      };
    }
    if (e.multipart) {
      item.requestBody = {
        required: true,
        content: {
          'multipart/form-data': {
            schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
          },
        },
      };
    }
    for (const code of e.documentedErrors ?? []) {
      item.responses[code] = errorResponse(code);
    }
    (paths[openApiPath] ??= {})[e.method] = item;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Kirana API',
      version: '1.0.0',
      description:
        'Self-hosted household shopping board. Base path /api/v1, JSON only, HttpOnly sid cookie auth (P4), X-Request-Id on every response, errors in the §7.1 envelope. Refs: PRD §7.',
    },
    servers: [{ url: '/' }],
    tags: [
      'auth',
      'household',
      'members',
      'board',
      'stores',
      'list',
      'catalog',
      'categories',
      'import-export',
      'sync',
      'meta',
    ].map((name) => ({ name })),
    paths,
    components: {
      schemas: {
        ErrorResponse: toJsonSchema(c.errorResponseSchema, 'output'),
      },
    },
  };
}

function serialize(doc: Record<string, unknown>): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const outFile = new URL('../openapi.json', import.meta.url).pathname;
const generated = serialize(buildOpenApiDocument());

if (check) {
  if (!existsSync(outFile)) {
    console.error('openapi.json missing — run pnpm gen:openapi');
    process.exit(1);
  }
  const committed = readFileSync(outFile, 'utf8');
  if (committed !== generated) {
    console.error('openapi.json is out of date — run pnpm gen:openapi and commit');
    process.exit(1);
  }
  console.log('openapi.json is up to date');
} else {
  writeFileSync(outFile, generated);
  console.log(`wrote ${outFile}`);
}
