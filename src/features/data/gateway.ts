import { DATA_BASE } from '@/lib/env';
import { blocksFetch } from '@/lib/blocks-client';

/**
 * Data Gateway — one POST endpoint, all CRUD. No Apollo/urql needed; add one only if
 * you want normalized caching or codegen.
 *
 * Operation names come from the schema's `querySchema` / `mutationSchemas`, so never
 * hand-pluralize them — read them off the schema (blocks-data-gateway-configuration).
 */

const GATEWAY = `${DATA_BASE}/gateway`;

export interface ActionResponse {
  acknowledged: boolean;
  itemId?: string | null;
  totalImpactedData: number;
  message?: string | null;
}

export interface GqlResult<T> {
  items: T[];
  totalCount: number;
  pageNo: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export class GraphQLError extends Error {
  constructor(public errors: Array<{ message: string }>) {
    super(errors.map((e) => e.message).join('; '));
    this.name = 'GraphQLError';
  }
}

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const body = await blocksFetch<{ data?: T; errors?: Array<{ message: string }> }>(GATEWAY, {
    method: 'POST',
    body: { query, variables },
  });

  // The gateway returns 200 with an `errors` array for schema/validation problems.
  if (body.errors?.length) throw new GraphQLError(body.errors);
  if (!body.data) throw new Error('Gateway returned an empty response');
  return body.data;
}
