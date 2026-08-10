import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gql, type ActionResponse, type GqlResult } from './gateway';

/**
 * CRUD-hook factory for one Data Gateway schema.
 *
 * Instantiate it per schema with the operation names read from the schema's
 * `querySchema` / `mutationSchemas` — see src/features/data/README.md for a worked example.
 */

export interface CrudNames {
  /** e.g. "getProducts" — `get` + querySchema */
  query: string;
  insert: string;
  update: string;
  remove: string;
  filterType: string;
  sortType: string;
  insertType: string;
  updateType: string;
}

export type SortInput = { direction: 'ASC' | 'DESC'; field: string };
export type Paging = { pageNo: number; pageSize: number };

export interface ListVars {
  where?: unknown;
  paging?: Paging;
  order?: SortInput[];
}

export function makeCrud<TRecord, TInsert, TUpdate>(n: CrudNames, fieldSelection: string) {
  const listKey = ['data', n.query] as const;

  function useList(vars: ListVars = {}) {
    return useQuery({
      queryKey: [...listKey, vars],
      queryFn: () =>
        gql<Record<string, GqlResult<TRecord>>>(
          `query($where:${n.filterType},$paging:PaginationInput,$order:[${n.sortType}!]){
             ${n.query}(where:$where,paging:$paging,order:$order){
               totalCount pageNo pageSize totalPages hasNextPage hasPreviousPage
               items { ${fieldSelection} }
             }
           }`,
          vars as Record<string, unknown>,
        ).then((d) => d[n.query]),
    });
  }

  function useCreate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (input: TInsert) =>
        gql<Record<string, ActionResponse>>(
          `mutation($input:${n.insertType}!){ ${n.insert}(input:$input){ acknowledged itemId totalImpactedData message } }`,
          { input },
        ).then((d) => d[n.insert]),
      onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
    });
  }

  function useUpdate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (v: { where: unknown; input: TUpdate }) =>
        gql<Record<string, ActionResponse>>(
          `mutation($where:${n.filterType},$input:${n.updateType}!){ ${n.update}(where:$where,input:$input){ acknowledged totalImpactedData message } }`,
          v as Record<string, unknown>,
        ).then((d) => d[n.update]),
      onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
    });
  }

  function useDelete() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (where: unknown) =>
        gql<Record<string, ActionResponse>>(
          `mutation($where:${n.filterType}){ ${n.remove}(where:$where){ acknowledged totalImpactedData message } }`,
          { where },
        ).then((d) => d[n.remove]),
      onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
    });
  }

  return { useList, useCreate, useUpdate, useDelete, listKey };
}
