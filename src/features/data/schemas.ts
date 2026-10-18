import { blocksFetch } from '@/lib/blocks-client';
import { BLOCKS, DATA_BASE } from '@/lib/env';
import { gql, type ActionResponse, type GqlResult } from './gateway';

/**
 * Schema metadata, and GraphQL built from it — so any schema in the project can be
 * listed and edited without writing a typed module for it first.
 *
 * Metadata comes from the REST schema endpoints, not GraphQL introspection: the gateway
 * is built with introspection disabled, and the REST shape carries more anyway (access
 * levels, requiredOn, enum values).
 *
 * These reads are permission-gated (`blocks-data::schema::*`); a project user needs that
 * granted to their role. The gateway itself checks each schema's own access levels.
 */

export interface SchemaField {
  name: string;
  /** String, Int, Float, Boolean, DateTime, ID, GeoJson, Enum — or a Dto schema name. */
  type: string;
  isArray?: boolean;
  enumValues?: string[];
  isPIIData?: boolean;
  isUniqueData?: boolean;
  description?: string;
  requiredOn?: 'None' | 'Insert' | 'Update' | 'Both' | string;
  fields?: SchemaField[];
  validationRule?: unknown;
  totalValidationRules?: number;
}

export interface SchemaDefinition {
  id: string;
  schemaName: string;
  collectionName?: string;
  /** 1 Entity, 2 Dto (embedded object type — has no operations of its own). */
  schemaType?: number;
  querySchema?: string;
  mutationSchemas?: string[];
  readAccessLevel?: number;
  writeAccessLevel?: number;
  editAccessLevel?: number;
  deleteAccessLevel?: number;
  fields?: SchemaField[];
  [k: string]: unknown;
}

interface ServiceResponse<T> {
  isSuccess?: boolean;
  message?: string;
  httpStatusCode?: number;
  data?: T;
  errors?: unknown;
}

/** Schema access levels: who the gateway lets through for each operation. */
export const ACCESS_LEVEL = ['Inherited', 'User', 'Public', 'Custom'];

export const SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'ID', 'GeoJson', 'Enum']);

/** System fields the server fills in; only some are writable on insert/update. */
const BASE_FIELDS = new Set(['ItemId', 'CreatedDate', 'LastUpdatedDate', 'CreatedBy', 'LastUpdatedBy', 'Language', 'OrganizationId', 'Tags']);
const INSERTABLE_BASE = new Set(['ItemId', 'OrganizationId', 'Tags', 'Language']);
const UPDATABLE_BASE = new Set(['OrganizationId', 'Tags', 'Language']);

export const isBaseField = (f: SchemaField) => BASE_FIELDS.has(f.name);
export const writableFields = (s: SchemaDefinition, mode: 'insert' | 'update') =>
  (s.fields ?? []).filter((f) => !isBaseField(f) || (mode === 'insert' ? INSERTABLE_BASE : UPDATABLE_BASE).has(f.name));

/** A selection set covering every field, recursing into embedded Dto fields. */
export function selectionFor(fields: SchemaField[] = [], depth = 0): string {
  return fields
    .map((f) => {
      if (SCALARS.has(f.type)) return f.name;
      // An embedded Dto needs a sub-selection; without its field list there is nothing
      // valid to ask for, so it is left out rather than breaking the whole query.
      if (!f.fields?.length || depth > 3) return '';
      return `${f.name} { ${selectionFor(f.fields, depth + 1)} }`;
    })
    .filter(Boolean)
    .join(' ');
}

const qs = (p: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') q.set(k, String(v));
  return q.toString();
};

export const schemaApi = {
  list: (p: { keyword?: string; schemaType?: number; pageNo?: number; pageSize?: number } = {}) =>
    blocksFetch<ServiceResponse<{ totalCount?: number; items?: SchemaDefinition[] }>>(
      `${DATA_BASE}/schemas?${qs({ Keyword: p.keyword, SchemaType: p.schemaType, PageNo: p.pageNo ?? 1, PageSize: p.pageSize ?? 100 })}`,
    ),
  getById: (id: string) => blocksFetch<ServiceResponse<SchemaDefinition>>(`${DATA_BASE}/schemas/get-by-id?${qs({ id })}`),
  /** `projectKey` is required here — the one Data read that still wants it. */
  info: () => blocksFetch<ServiceResponse<unknown>>(`${DATA_BASE}/schemas/info?${qs({ projectKey: BLOCKS.projectKey })}`),
  infoByName: (schemaName: string) =>
    blocksFetch<ServiceResponse<unknown>>(`${DATA_BASE}/schemas/info-by-name?${qs({ schemaName })}`),
  validationsBySchema: (schemaId: string) =>
    blocksFetch<unknown>(`${DATA_BASE}/data-validations/by-schema-id?${qs({ schemaId })}`),
  validations: (p: { schemaId?: string; fieldName?: string; pageNo?: number; pageSize?: number } = {}) =>
    blocksFetch<unknown>(
      `${DATA_BASE}/data-validations?${qs({ SchemaId: p.schemaId, FieldName: p.fieldName, PageNo: p.pageNo ?? 1, PageSize: p.pageSize ?? 100 })}`,
    ),
  generateRegex: (description: string) =>
    blocksFetch<{ pattern?: string; errorMessage?: string }>(`${DATA_BASE}/regex/generate-regex`, {
      method: 'POST',
      body: { description },
    }),
  mockData: () => blocksFetch<unknown>(`${DATA_BASE}/mock-data`),
};

export interface ListArgs {
  where?: unknown;
  order?: { field: string; direction: 'ASC' | 'DESC' }[];
  paging?: { pageNo: number; pageSize: number };
}

/** Operations for one Entity schema, named exactly as the gateway generates them. */
export function recordsApi(s: SchemaDefinition) {
  const X = s.schemaName;
  const list = `get${s.querySchema || `${X}s`}`;
  const selection = selectionFor(s.fields) || 'ItemId';

  const mutate = (op: string, args: string, vars: Record<string, unknown>, fields = 'acknowledged itemId totalImpactedData message') =>
    gql<Record<string, ActionResponse & { itemIds?: string[] }>>(`mutation(${args}){ ${op}(${args.replace(/\$(\w+):[^,]+/g, '$1:$$$1')}){ ${fields} } }`, vars).then(
      (d) => d[op],
    );

  return {
    listOp: list,
    selection,
    list: (v: ListArgs) =>
      gql<Record<string, GqlResult<Record<string, unknown>>>>(
        `query($where:${X}FilterInput,$paging:PaginationInput,$order:[DynamicSortInput!]){
           ${list}(where:$where,paging:$paging,order:$order){
             totalCount pageNo pageSize totalPages hasNextPage hasPreviousPage
             items { ${selection} }
           }
         }`,
        v as Record<string, unknown>,
      ).then((d) => d[list]),
    insert: (input: Record<string, unknown>) => mutate(`insert${X}`, `$input:${X}InsertInput`, { input }),
    insertMany: (input: Record<string, unknown>[]) =>
      mutate(`insertMany${X}`, `$input:[${X}InsertInput]`, { input }, 'acknowledged totalImpactedData message itemIds'),
    update: (where: unknown, input: Record<string, unknown>, many = false) =>
      mutate(`${many ? 'updateMany' : 'update'}${X}`, `$where:${X}FilterInput,$input:${X}UpdateInput`, { where, input }),
    remove: (where: unknown, isHardDelete: boolean, many = false) =>
      mutate(`${many ? 'deleteMany' : 'delete'}${X}`, `$where:${X}FilterInput,$input:${X}DeleteInput`, {
        where,
        input: { isHardDelete },
      }),
  };
}
