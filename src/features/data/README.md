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
    sortType: 'ProductSortInput',
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

## Filters

`where` is the generated `<Schema>FilterInput`. Per-field operators: `eq`, `neq`, `gt`,
`gte`, `lt`, `lte`, `contains`, `in`, plus `and` / `or`. Omit it to fetch everything.

## Attaching files

Upload with `useUploadFile()` (`src/features/files`), keep the returned `fileId`, and set
it on a schema field — e.g. `create.mutate({ ..., ImageFileId: fileId })`.
