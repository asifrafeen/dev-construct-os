import { describe, expect, it } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import { GraphQLError } from './gateway';
import { isBaseField, recordsApi, schemaApi, selectionFor, writableFields, type SchemaDefinition, type SchemaField } from './schemas';

const DATA = 'https://blocksapi.example.com/data/v4';
const GATEWAY = `${DATA}/gateway`;

/** The gateway queries are indented template literals; compare them on one line. */
const flat = (query: unknown) => String(query).replaceAll(/\s+/g, ' ').trim();
const sentQuery = (body: unknown) => flat((body as { query: string }).query);

const field = (name: string, type = 'String', fields?: SchemaField[]): SchemaField => ({ name, type, fields });

describe('isBaseField', () => {
  it.each(['ItemId', 'CreatedDate', 'LastUpdatedDate', 'CreatedBy', 'LastUpdatedBy', 'Language', 'OrganizationId', 'Tags'])(
    '%s is a system field',
    (name) => {
      expect(isBaseField(field(name))).toBe(true);
    },
  );

  it('does not treat a schema field as a system field', () => {
    expect(isBaseField(field('Title'))).toBe(false);
  });
});

describe('writableFields', () => {
  const schema: SchemaDefinition = {
    id: 's1',
    schemaName: 'Product',
    fields: ['ItemId', 'CreatedDate', 'LastUpdatedDate', 'CreatedBy', 'LastUpdatedBy', 'Language', 'OrganizationId', 'Tags', 'Title'].map(
      (name) => field(name),
    ),
  };

  it('allows ItemId, OrganizationId, Tags and Language on insert', () => {
    expect(writableFields(schema, 'insert').map((f) => f.name)).toEqual(['ItemId', 'Language', 'OrganizationId', 'Tags', 'Title']);
  });

  it('does not allow ItemId on update', () => {
    expect(writableFields(schema, 'update').map((f) => f.name)).toEqual(['Language', 'OrganizationId', 'Tags', 'Title']);
  });

  it('copes with a schema without fields', () => {
    expect(writableFields({ id: 's2', schemaName: 'Empty' }, 'insert')).toEqual([]);
  });
});

describe('selectionFor', () => {
  it('selects every scalar by name', () => {
    const scalars = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'ID', 'GeoJson', 'Enum'].map((type, i) => field(`F${i}`, type));
    expect(selectionFor(scalars)).toBe('F0 F1 F2 F3 F4 F5 F6 F7');
  });

  it('recurses into an embedded Dto', () => {
    expect(selectionFor([field('Title'), field('Address', 'AddressDto', [field('Street'), field('Zip', 'Int')])])).toBe(
      'Title Address { Street Zip }',
    );
  });

  it('leaves out a Dto whose fields are unknown', () => {
    expect(selectionFor([field('Title'), field('Owner', 'UserDto'), field('Meta', 'MetaDto', [])])).toBe('Title');
  });

  it('stops recursing four levels down', () => {
    const nest = (level: number): SchemaField =>
      field(`D${level}`, 'Dto', level < 6 ? [field(`S${level}`), nest(level + 1)] : [field(`S${level}`)]);
    expect(selectionFor([nest(0)])).toBe('D0 { S0 D1 { S1 D2 { S2 D3 { S3 } } } }');
  });

  it('selects nothing for no fields', () => {
    expect(selectionFor()).toBe('');
    expect(selectionFor([])).toBe('');
  });
});

describe('schemaApi', () => {
  it('lists the first 100 schemas, dropping unset filters', async () => {
    const http = mockFetch({ body: { isSuccess: true, data: { totalCount: 1, items: [{ id: 's1', schemaName: 'Product' }] } } });
    await expect(schemaApi.list()).resolves.toEqual({ isSuccess: true, data: { totalCount: 1, items: [{ id: 's1', schemaName: 'Product' }] } });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${DATA}/schemas?PageNo=1&PageSize=100`, body: undefined });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');

    await schemaApi.list({ keyword: '' });
    expect(http.last().url).toBe(`${DATA}/schemas?PageNo=1&PageSize=100`);
  });

  it('sends every list filter', async () => {
    const http = mockFetch();
    await schemaApi.list({ keyword: 'prod', schemaType: 1, pageNo: 2, pageSize: 10 });
    expect(http.last().url).toBe(`${DATA}/schemas?Keyword=prod&SchemaType=1&PageNo=2&PageSize=10`);
  });

  it.each([
    ['getById', () => schemaApi.getById('s 1'), `${DATA}/schemas/get-by-id?id=s+1`],
    ['info', () => schemaApi.info(), `${DATA}/schemas/info?projectKey=test-project-key`],
    ['infoByName', () => schemaApi.infoByName('Product'), `${DATA}/schemas/info-by-name?schemaName=Product`],
    ['validationsBySchema', () => schemaApi.validationsBySchema('s1'), `${DATA}/data-validations/by-schema-id?schemaId=s1`],
    ['validations', () => schemaApi.validations(), `${DATA}/data-validations?PageNo=1&PageSize=100`],
    ['mockData', () => schemaApi.mockData(), `${DATA}/mock-data`],
  ])('%s is a GET on its route', async (_name, call, url) => {
    const http = mockFetch({ body: { isSuccess: true } });
    await expect(call()).resolves.toEqual({ isSuccess: true });
    expect(http.last()).toMatchObject({ method: 'GET', url });
  });

  it('filters validations by schema and field', async () => {
    const http = mockFetch();
    await schemaApi.validations({ schemaId: 's1', fieldName: 'Email', pageNo: 3, pageSize: 5 });
    expect(http.last().url).toBe(`${DATA}/data-validations?SchemaId=s1&FieldName=Email&PageNo=3&PageSize=5`);
  });

  it('asks for a regex from a description', async () => {
    const http = mockFetch({ body: { pattern: '^\\d+$' } });
    await expect(schemaApi.generateRegex('digits only')).resolves.toEqual({ pattern: '^\\d+$' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${DATA}/regex/generate-regex`, body: { description: 'digits only' } });
  });
});

describe('recordsApi', () => {
  const product: SchemaDefinition = {
    id: 's1',
    schemaName: 'Product',
    querySchema: 'Products',
    fields: [field('Title'), field('Price', 'Float'), field('Owner', 'UserDto')],
  };

  it('names the list operation from querySchema and selects the selectable fields', () => {
    const api = recordsApi(product);
    expect(api.listOp).toBe('getProducts');
    expect(api.selection).toBe('Title Price');
  });

  it('falls back to schemaName + s, and to ItemId when nothing is selectable', () => {
    const api = recordsApi({ id: 's2', schemaName: 'Category', fields: [field('Owner', 'UserDto')] });
    expect(api.listOp).toBe('getCategorys');
    expect(api.selection).toBe('ItemId');
  });

  it('lists through the gateway and returns the operation result', async () => {
    const result = { items: [{ Title: 'Pen' }], totalCount: 1, pageNo: 1, pageSize: 10, totalPages: 1, hasNextPage: false, hasPreviousPage: false };
    const http = mockFetch({ body: { data: { getProducts: result } } });
    const vars = { where: { Title: { eq: 'Pen' } }, paging: { pageNo: 1, pageSize: 10 }, order: [{ field: 'Title', direction: 'ASC' as const }] };

    await expect(recordsApi(product).list(vars)).resolves.toEqual(result);
    expect(http.last()).toMatchObject({ method: 'POST', url: GATEWAY });
    expect(sentQuery(http.last().body)).toBe(
      'query($where:ProductFilterInput,$paging:PaginationInput,$order:[DynamicSortInput!]){ ' +
        'getProducts(where:$where,paging:$paging,order:$order){ ' +
        'totalCount pageNo pageSize totalPages hasNextPage hasPreviousPage items { Title Price } } }',
    );
    expect(http.last().body).toMatchObject({ variables: vars });
  });

  it('inserts one record', async () => {
    const ack = { acknowledged: true, itemId: 'p1', totalImpactedData: 1, message: null };
    const http = mockFetch({ body: { data: { insertProduct: ack } } });
    await expect(recordsApi(product).insert({ Title: 'Pen' })).resolves.toEqual(ack);
    expect(sentQuery(http.last().body)).toBe(
      'mutation($input:ProductInsertInput){ insertProduct(input:$input){ acknowledged itemId totalImpactedData message } }',
    );
    expect(http.last().body).toMatchObject({ variables: { input: { Title: 'Pen' } } });
  });

  it('inserts many records and asks for their ids', async () => {
    const ack = { acknowledged: true, totalImpactedData: 2, itemIds: ['p1', 'p2'] };
    const http = mockFetch({ body: { data: { insertManyProduct: ack } } });
    await expect(recordsApi(product).insertMany([{ Title: 'A' }, { Title: 'B' }])).resolves.toEqual(ack);
    expect(sentQuery(http.last().body)).toBe(
      'mutation($input:[ProductInsertInput]){ insertManyProduct(input:$input){ acknowledged totalImpactedData message itemIds } }',
    );
    expect(http.last().body).toMatchObject({ variables: { input: [{ Title: 'A' }, { Title: 'B' }] } });
  });

  it('updates one record, or many', async () => {
    const http = mockFetch({ body: { data: { updateProduct: { acknowledged: true }, updateManyProduct: { acknowledged: true } } } });
    const where = { ItemId: { eq: 'p1' } };

    await expect(recordsApi(product).update(where, { Title: 'Pencil' })).resolves.toEqual({ acknowledged: true });
    expect(sentQuery(http.last().body)).toBe(
      'mutation($where:ProductFilterInput,$input:ProductUpdateInput){ ' +
        'updateProduct(where:$where,input:$input){ acknowledged itemId totalImpactedData message } }',
    );
    expect(http.last().body).toMatchObject({ variables: { where, input: { Title: 'Pencil' } } });

    await recordsApi(product).update(where, { Title: 'Pencil' }, true);
    expect(sentQuery(http.last().body)).toContain('updateManyProduct(where:$where,input:$input)');
  });

  it('deletes softly or hard, one or many', async () => {
    const http = mockFetch({ body: { data: { deleteProduct: { acknowledged: true }, deleteManyProduct: { acknowledged: false } } } });
    const where = { ItemId: { eq: 'p1' } };

    await expect(recordsApi(product).remove(where, false)).resolves.toEqual({ acknowledged: true });
    expect(sentQuery(http.last().body)).toBe(
      'mutation($where:ProductFilterInput,$input:ProductDeleteInput){ ' +
        'deleteProduct(where:$where,input:$input){ acknowledged itemId totalImpactedData message } }',
    );
    expect(http.last().body).toMatchObject({ variables: { where, input: { isHardDelete: false } } });

    await expect(recordsApi(product).remove(where, true, true)).resolves.toEqual({ acknowledged: false });
    expect(sentQuery(http.last().body)).toContain('deleteManyProduct(where:$where,input:$input)');
    expect(http.last().body).toMatchObject({ variables: { input: { isHardDelete: true } } });
  });

  it('throws the gateway errors', async () => {
    mockFetch({ body: { errors: [{ message: 'Unknown field Title' }] } });
    await expect(recordsApi(product).insert({ Title: 'Pen' })).rejects.toBeInstanceOf(GraphQLError);
  });
});
