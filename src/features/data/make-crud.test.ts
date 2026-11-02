import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import { makeCrud, type CrudNames } from './make-crud';

/**
 * The hooks only hand their options to React Query, so React Query is replaced by
 * pass-throughs: each hook returns the options it built, and the query/mutation
 * functions inside are then called directly.
 */
const { invalidateQueries } = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries }),
}));

interface QueryOptions {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
}

interface MutationOptions<V> {
  mutationFn: (vars: V) => Promise<unknown>;
  onSuccess: () => unknown;
}

const asQuery = (value: unknown) => value as QueryOptions;
const asMutation = <V>(value: unknown) => value as MutationOptions<V>;

const flat = (query: unknown) => String(query).replaceAll(/\s+/g, ' ').trim();
const sentQuery = (body: unknown) => flat((body as { query: string }).query);

interface Product {
  ItemId: string;
  Title: string;
}

const names: CrudNames = {
  query: 'getProducts',
  insert: 'insertProduct',
  update: 'updateProduct',
  remove: 'deleteProduct',
  filterType: 'ProductFilterInput',
  sortType: 'ProductSortInput',
  insertType: 'ProductInsertInput',
  updateType: 'ProductUpdateInput',
};

const crud = makeCrud<Product, { Title: string }, { Title?: string }>(names, 'ItemId Title');
const GATEWAY = 'https://blocksapi.example.com/data/v4/gateway';

beforeEach(() => {
  invalidateQueries.mockClear();
});

describe('makeCrud', () => {
  it('keys every list under data + the query name', () => {
    expect(crud.listKey).toEqual(['data', 'getProducts']);
  });

  it('keys a list query by its variables', () => {
    const vars = { paging: { pageNo: 1, pageSize: 10 } };
    expect(asQuery(crud.useList(vars)).queryKey).toEqual(['data', 'getProducts', vars]);
    expect(asQuery(crud.useList()).queryKey).toEqual(['data', 'getProducts', {}]);
  });

  it('lists with the shared sort type and returns the query result', async () => {
    const result = { items: [{ ItemId: 'p1', Title: 'Pen' }], totalCount: 1 };
    const http = mockFetch({ body: { data: { getProducts: result } } });
    const vars = { where: { Title: { eq: 'Pen' } }, order: [{ field: 'Title', direction: 'DESC' as const }] };

    await expect(asQuery(crud.useList(vars)).queryFn()).resolves.toEqual(result);
    expect(http.last()).toMatchObject({ method: 'POST', url: GATEWAY, body: { variables: vars } });
    expect(sentQuery(http.last().body)).toBe(
      'query($where:ProductFilterInput,$paging:PaginationInput,$order:[DynamicSortInput!]){ ' +
        'getProducts(where:$where,paging:$paging,order:$order){ ' +
        'totalCount pageNo pageSize totalPages hasNextPage hasPreviousPage items { ItemId Title } } }',
    );
  });

  it('ignores the deprecated per-schema sort type', async () => {
    const http = mockFetch({ body: { data: { getProducts: {} } } });
    await asQuery(crud.useList()).queryFn();
    expect(sentQuery(http.last().body)).not.toContain('ProductSortInput');
  });

  it('creates with a required insert input and invalidates the lists', async () => {
    const ack = { acknowledged: true, itemId: 'p1', totalImpactedData: 1 };
    const http = mockFetch({ body: { data: { insertProduct: ack } } });
    const create = asMutation<{ Title: string }>(crud.useCreate());

    await expect(create.mutationFn({ Title: 'Pen' })).resolves.toEqual(ack);
    expect(sentQuery(http.last().body)).toBe(
      'mutation($input:ProductInsertInput!){ insertProduct(input:$input){ acknowledged itemId totalImpactedData message } }',
    );
    expect(http.last().body).toMatchObject({ variables: { input: { Title: 'Pen' } } });

    create.onSuccess();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['data', 'getProducts'] });
  });

  it('updates by filter and invalidates the lists', async () => {
    const http = mockFetch({ body: { data: { updateProduct: { acknowledged: true, totalImpactedData: 1 } } } });
    const update = asMutation<{ where: unknown; input: { Title?: string } }>(crud.useUpdate());
    const vars = { where: { ItemId: { eq: 'p1' } }, input: { Title: 'Pencil' } };

    await expect(update.mutationFn(vars)).resolves.toEqual({ acknowledged: true, totalImpactedData: 1 });
    expect(sentQuery(http.last().body)).toBe(
      'mutation($where:ProductFilterInput,$input:ProductUpdateInput!){ ' +
        'updateProduct(where:$where,input:$input){ acknowledged totalImpactedData message } }',
    );
    expect(http.last().body).toMatchObject({ variables: vars });

    update.onSuccess();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['data', 'getProducts'] });
  });

  it('deletes by filter and invalidates the lists', async () => {
    const http = mockFetch({ body: { data: { deleteProduct: { acknowledged: true, totalImpactedData: 2 } } } });
    const remove = asMutation<unknown>(crud.useDelete());
    const where = { Title: { eq: 'Pen' } };

    await expect(remove.mutationFn(where)).resolves.toEqual({ acknowledged: true, totalImpactedData: 2 });
    expect(sentQuery(http.last().body)).toBe(
      'mutation($where:ProductFilterInput){ deleteProduct(where:$where){ acknowledged totalImpactedData message } }',
    );
    expect(http.last().body).toMatchObject({ variables: { where } });

    remove.onSuccess();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['data', 'getProducts'] });
  });
});
