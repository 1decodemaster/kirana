import { z } from 'zod';
export const ERROR_CODES = [
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'VALIDATION_FAILED',
    'ITEM_NEAR_DUPLICATE',
    'STORE_NOT_EMPTY',
    'IMPORT_TOKEN_EXPIRED',
    'IMPORT_PARSE_FAILED',
    'RATE_LIMITED',
    'CONFLICT_STALE',
    'INTERNAL',
];
export const errorCodeSchema = z.enum(ERROR_CODES);
export const errorDetailsSchema = z.record(z.string(), z.unknown());
export const apiErrorSchema = z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: errorDetailsSchema.optional(),
    requestId: z.string(),
});
export const errorResponseSchema = z.object({ error: apiErrorSchema });
export const uuidSchema = z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
export const epochMsSchema = z.number().int().nonnegative();
export const unitCodeSchema = z.enum(['ea', 'pack', 'dozen', 'g', 'kg', 'ml', 'l']);
export const langSchema = z.enum(['en', 'hi-Latn', 'hi']);
export const scopeSchema = z.enum(['grocery', 'household', 'general']);
export const listStatusSchema = z.enum(['active', 'bought', 'cleared']);
export const storeStatusSchema = z.enum(['active', 'done', 'archived']);
export const iconKindSchema = z.enum(['emoji', 'sprite', 'url', 'none']);
export const entitySchema = z.enum(['store', 'list_item', 'item', 'alias', 'category', 'member']);
export const opSchema = z.enum(['create', 'update', 'delete']);
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const nameSchema = z.string().trim().min(1).max(60);
export const itemNameSchema = z.string().trim().min(1).max(80);
export const noteSchema = z.string().max(500);
export const healthResponseSchema = z.object({
    status: z.literal('ok'),
    version: z.string(),
    revision: z.string(),
    uptime: z.number(),
});
export const passcodeSchema = z.string().min(4).max(128);
export const displayNameSchema = z.string().trim().min(1).max(40);
export const memberDtoSchema = z.object({
    id: uuidSchema,
    displayName: displayNameSchema,
    color: colorSchema,
});
export const householdDtoSchema = z.object({ id: uuidSchema, name: nameSchema });
export const loginRequestSchema = z.object({
    passcode: passcodeSchema,
    displayName: displayNameSchema,
});
export const loginResponseSchema = z.object({ member: memberDtoSchema });
export const meResponseSchema = z.object({
    member: memberDtoSchema,
    household: householdDtoSchema,
});
export const storeCountsSchema = z.object({
    total: z.number().int().nonnegative(),
    bought: z.number().int().nonnegative(),
});
export const listItemDtoSchema = z.object({
    id: uuidSchema,
    itemId: uuidSchema,
    name: itemNameSchema,
    qtyValue: z.number().positive().nullable(),
    unitCode: unitCodeSchema.nullable(),
    categoryId: uuidSchema.nullable(),
    status: listStatusSchema,
    note: noteSchema.nullable(),
    addedBy: uuidSchema.nullable(),
    updatedAt: epochMsSchema,
});
export const categoryDtoSchema = z.object({
    id: uuidSchema,
    name: nameSchema,
    scope: scopeSchema,
    icon: z.string().max(16).nullable(),
    color: colorSchema.nullable(),
    sortOrder: z.number().int(),
});
export const catalogItemDtoSchema = z.object({
    id: uuidSchema,
    name: itemNameSchema,
    norm: z.string().min(1).max(120),
    aliases: z.array(z.string().min(1).max(80)),
    defaultUnit: unitCodeSchema.nullable(),
    defaultCategoryId: uuidSchema.nullable(),
    iconRef: z.string().max(16).nullable(),
});
export const storeDtoSchema = z.object({
    id: uuidSchema,
    name: nameSchema,
    iconKind: iconKindSchema,
    iconRef: z.string().max(64).nullable(),
    status: storeStatusSchema,
    categoryOrder: z.array(uuidSchema),
    sortOrder: z.number().int(),
    counts: storeCountsSchema,
    items: z.array(listItemDtoSchema),
});
export const boardResponseSchema = z.object({
    revision: z.number().int().nonnegative(),
    household: householdDtoSchema,
    me: memberDtoSchema,
    members: z.array(memberDtoSchema),
    categories: z.array(categoryDtoSchema),
    stores: z.array(storeDtoSchema),
    catalog: z.array(catalogItemDtoSchema),
    catalogTruncated: z.boolean().optional(),
});
export const boardQuerySchema = z.object({ since: z.number().int().nonnegative().optional() });
export const createStoreRequestSchema = z.object({
    name: nameSchema,
    iconKind: iconKindSchema.optional(),
    iconRef: z.string().max(64).nullable().optional(),
});
export const updateStoreRequestSchema = z.object({
    name: nameSchema.optional(),
    iconKind: iconKindSchema.optional(),
    iconRef: z.string().max(64).nullable().optional(),
    status: storeStatusSchema.optional(),
    categoryOrder: z.array(uuidSchema).optional(),
    sortOrder: z.number().int().optional(),
    notes: noteSchema.nullable().optional(),
});
export const storeDtoWithNotesSchema = storeDtoSchema.extend({
    notes: noteSchema.nullable(),
});
export const storeMutationResponseSchema = z.object({ store: storeDtoWithNotesSchema });
export const categoryOrderRequestSchema = z.object({ categoryIds: z.array(uuidSchema).max(64) });
export const clearBoughtResponseSchema = z.object({
    cleared: z.number().int().nonnegative(),
});
export const addListItemRequestSchema = z
    .object({
    clientId: uuidSchema,
    itemId: uuidSchema.optional(),
    name: itemNameSchema.optional(),
    qtyValue: z.number().positive().max(1_000_000).optional(),
    unitCode: unitCodeSchema.optional(),
    categoryId: uuidSchema.optional(),
    note: noteSchema.nullable().optional(),
})
    .superRefine((v, ctx) => {
    if ((v.itemId === undefined) === (v.name === undefined)) {
        ctx.addIssue({
            code: 'custom',
            message: 'exactly one of itemId or name is required',
            path: ['itemId'],
        });
    }
});
export const addListItemResponseSchema = z.object({
    listItem: listItemDtoSchema,
    item: catalogItemDtoSchema,
    createdItem: z.boolean(),
    createdAlias: z.boolean(),
});
export const patchListItemRequestSchema = z.object({
    qtyValue: z.number().positive().max(1_000_000).nullable().optional(),
    unitCode: unitCodeSchema.nullable().optional(),
    categoryId: uuidSchema.nullable().optional(),
    note: noteSchema.nullable().optional(),
    status: listStatusSchema.optional(),
    sortOrder: z.number().optional(),
});
export const deleteListItemResponseSchema = z.object({ undoToken: z.string() });
export const bulkCheckRequestSchema = z.object({
    ids: z.array(uuidSchema).min(1).max(500),
    checked: z.boolean(),
});
export const listItemMutationResponseSchema = z.object({ listItem: listItemDtoSchema });
export const aliasDtoSchema = z.object({
    id: uuidSchema,
    alias: z.string().min(1).max(80),
    lang: langSchema,
});
export const itemDtoSchema = z.object({
    id: uuidSchema,
    name: itemNameSchema,
    norm: z.string().min(1).max(120),
    defaultCategoryId: uuidSchema.nullable(),
    defaultUnitCode: unitCodeSchema.nullable(),
    defaultQty: z.number().positive().nullable(),
    iconKind: iconKindSchema,
    iconRef: z.string().max(64).nullable(),
    attrs: z.record(z.string(), z.unknown()),
    aliases: z.array(aliasDtoSchema),
    createdAt: epochMsSchema,
    updatedAt: epochMsSchema,
});
export const getItemsQuerySchema = z.object({
    q: z.string().max(80).optional(),
    categoryId: uuidSchema.optional(),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
});
export const searchResultDtoSchema = z.object({
    id: uuidSchema,
    name: itemNameSchema,
    norm: z.string().min(1).max(120),
    defaultUnit: unitCodeSchema.nullable(),
    defaultCategoryId: uuidSchema.nullable(),
    iconRef: z.string().max(16).nullable(),
    matchedVia: z.enum(['name', 'alias', 'fuzzy']),
    inStore: z.boolean(),
    score: z.number().min(0).max(1),
});
export const getItemsResponseSchema = z.object({
    items: z.array(searchResultDtoSchema),
    nextCursor: z.string().optional(),
});
export const aliasInputSchema = z.object({ alias: z.string().trim().min(1).max(80), lang: langSchema });
export const createItemRequestSchema = z.object({
    name: itemNameSchema,
    defaultCategoryId: uuidSchema.optional(),
    defaultUnitCode: unitCodeSchema.optional(),
    defaultQty: z.number().positive().max(1_000_000).optional(),
    iconRef: z.string().max(16).optional(),
    aliases: z.array(aliasInputSchema).max(20).optional(),
});
export const updateItemRequestSchema = z.object({
    name: itemNameSchema.optional(),
    defaultCategoryId: uuidSchema.nullable().optional(),
    defaultUnitCode: unitCodeSchema.nullable().optional(),
    defaultQty: z.number().positive().max(1_000_000).nullable().optional(),
    iconKind: iconKindSchema.optional(),
    iconRef: z.string().max(64).nullable().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
});
export const itemMutationResponseSchema = z.object({ item: itemDtoSchema });
export const createAliasRequestSchema = aliasInputSchema;
export const aliasMutationResponseSchema = z.object({ alias: aliasDtoSchema });
export const mergeItemsRequestSchema = z.object({ sourceId: uuidSchema, targetId: uuidSchema });
export const mergeItemsResponseSchema = z.object({ item: itemDtoSchema });
export const categoriesResponseSchema = z.object({
    categories: z.array(categoryDtoSchema.extend({ itemCount: z.number().int().nonnegative() })),
});
export const createCategoryRequestSchema = z.object({
    name: nameSchema,
    scope: scopeSchema,
    icon: z.string().max(16).optional(),
    color: colorSchema.optional(),
});
export const updateCategoryRequestSchema = z.object({
    name: nameSchema.optional(),
    icon: z.string().max(16).nullable().optional(),
    color: colorSchema.nullable().optional(),
    sortOrder: z.number().int().optional(),
    scope: scopeSchema.optional(),
});
export const categoryMutationResponseSchema = z.object({ category: categoryDtoSchema });
export const categoryOrderResponseSchema = z.object({ store: storeDtoWithNotesSchema });
export const importRowDtoSchema = z.object({
    line: z.number().int().nonnegative(),
    store: z.string(),
    category: z.string().nullable(),
    name: z.string(),
    aliases: z.array(z.string()),
    qty: z.number().nullable(),
    unit: unitCodeSchema.nullable(),
    note: z.string().nullable(),
    action: z.enum(['create', 'merge', 'skip', 'error']),
    targetItemId: uuidSchema.nullable(),
    targetName: z.string().nullable(),
    message: z.string().nullable(),
});
export const importPreviewResponseSchema = z.object({
    new: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
    conflict: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
    rows: z.array(importRowDtoSchema),
});
export const importDecisionSchema = z.object({
    line: z.number().int().nonnegative(),
    action: z.enum(['create', 'merge', 'skip']),
    targetItemId: uuidSchema.optional(),
});
export const importCommitRequestSchema = z.object({
    token: z.string().min(10).max(512),
    decisions: z.array(importDecisionSchema),
});
export const importCommitResponseSchema = z.object({
    created: z.number().int().nonnegative(),
    merged: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
});
export const exportListItemSchema = listItemDtoSchema.extend({ storeId: uuidSchema });
export const exportPayloadSchema = z.object({
    schemaVersion: z.number().int(),
    exportedAt: epochMsSchema,
    household: householdDtoSchema,
    categories: z.array(categoryDtoSchema),
    stores: z.array(storeDtoWithNotesSchema),
    items: z.array(itemDtoSchema),
    listItems: z.array(exportListItemSchema),
});
export const changeEventSchema = z.object({
    revision: z.number().int().positive(),
    entity: entitySchema,
    entityId: uuidSchema,
    op: opSchema,
    storeId: uuidSchema.nullable(),
});
//# sourceMappingURL=contracts.js.map