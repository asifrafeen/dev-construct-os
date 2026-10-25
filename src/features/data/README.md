# Data gateway

All CRUD goes through one endpoint: `POST /data/v4/gateway`.

## Before writing a screen

The generated GraphQL operation names come from the schema itself — read them off
`querySchema` / `mutationSchemas` in the Blocks console rather than pluralizing by hand.
A `Field 'getX' does not exist` error almost always means one of two things:

- the schema was never **reloaded** after a field/validation/access edit, or
- the operation name was guessed instead of read from the schema.

## Wiring a schema

```ts
// src/features/products/api.ts
import { makeCrud } from '@/features/data/make-crud';

export interface Product {
  ItemId: string;
  Title: string;
  Price: number;
  Sku: string;
}
export type ProductInsert = { Title: string; Price: number; Sku: string };
export type ProductUpdate = Partial<ProductInsert>;

export const productsCrud = makeCrud<Product, ProductInsert, ProductUpdate>(
  {
    query: 'getProducts',
    insert: 'insertProduct',
    update: 'updateProduct',
    remove: 'deleteProduct',
    filterType: 'ProductFilterInput',
    insertType: 'ProductInsertInput',
    updateType: 'ProductUpdateInput',
  },
  'ItemId Title Price Sku', // field selection
);
```

```tsx
const { data, isPending } = productsCrud.useList({
  paging: { pageNo: 1, pageSize: 20 },
  order: [{ direction: 'DESC', field: 'Price' }],
});
const create = productsCrud.useCreate();
const remove = productsCrud.useDelete();

remove.mutate({ ItemId: { eq: someId } });
```

## Generated operations

For an Entity schema `X` (case-sensitive, exactly as named):

```graphql
getXs(where: XFilterInput, order: [DynamicSortInput!], paging: PaginationInput): XResult
insertX(input: XInsertInput): ActionResponse
insertManyX(input: [XInsertInput]): BulkActionResponse      # { acknowledged totalImpactedData message itemIds }
updateX(where: XFilterInput, input: XUpdateInput)            # FIRST match only
updateManyX(where: XFilterInput, input: XUpdateInput)        # every match
deleteX(where: XFilterInput, input: { isHardDelete: Boolean! })      # FIRST match only
deleteManyX(where: XFilterInput, input: { isHardDelete: Boolean! })
```

- The list query is **`get` + name + `s`** — naive, so `Company` → `getCompanys`. Read it
  off the schema's `querySchema` rather than pluralizing.
- Sorting uses the shared `DynamicSortInput` (`{ field: "Price", direction: DESC }`), not a
  per-schema sort type.
- `paging` is 1-based; omit either half and you get the first 10.
- The legacy `input: DynamicQueryInput` (`filter`/`sort` as JSON strings) still works, but
  `where`/`order`/`paging` win when both are sent.
- There are no aggregate, group-by, join or subscription operations — `totalCount` is the
  only count.
- Soft and hard delete both remove the row from `getXs`; soft keeps a copy in a
  deleted-records store.

## Filters

`where` is the generated `<Schema>FilterInput`. Per-field operators: strings `eq`, `neq`,
`contains`, `startsWith`, `endsWith`, `in`; numbers and dates `eq`, `neq`, `gt`, `gte`, `lt`,
`lte`, `in`; booleans `eq`, `neq`; enums `eq`, `neq`, `in`, `nin`; plus `and` / `or`. Omit it to
fetch everything.

## Access levels

Each schema sets read/write/edit/delete access: `Public` needs only `x-blocks-key`, `User`
needs a signed-in user, `Custom` applies row/column policies (and denies when the schema has
none). The generic screen on the Data page shows these per schema.

## Attaching files

Upload with `useUploadFile()` (`src/features/files`), keep the returned `fileId`, and set
it on a schema field — e.g. `create.mutate({ ..., ImageFileId: fileId })`.
