import { describe, expect, it } from 'vitest';
import { BlocksError } from '@/lib/blocks-client';
import { mockFetch } from '@/test/mock-fetch';
import { GraphQLError, gql } from './gateway';

const GATEWAY = 'https://blocksapi.example.com/data/v4/gateway';

describe('gql', () => {
  it('posts the query and variables to the one gateway endpoint and returns data', async () => {
    const http = mockFetch({ body: { data: { getProducts: { totalCount: 0 } } } });
    await expect(gql('query { getProducts { totalCount } }', { a: 1 })).resolves.toEqual({ getProducts: { totalCount: 0 } });

    expect(http.last()).toMatchObject({
      method: 'POST',
      url: GATEWAY,
      body: { query: 'query { getProducts { totalCount } }', variables: { a: 1 } },
    });
    expect(http.last().headers).toMatchObject({ 'x-blocks-key': 'test-project-key', 'Content-Type': 'application/json' });
  });

  it('sends empty variables by default', async () => {
    const http = mockFetch({ body: { data: {} } });
    await gql('query { x }');
    expect(http.last().body).toEqual({ query: 'query { x }', variables: {} });
  });

  it('throws every GraphQL error from a 200 reply as one GraphQLError', async () => {
    const errors = [{ message: 'Unknown field Foo' }, { message: 'Bad input' }];
    mockFetch({ body: { errors, data: null } });
    const error: unknown = await gql('query { Foo }').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GraphQLError);
    expect(error).toMatchObject({ name: 'GraphQLError', message: 'Unknown field Foo; Bad input', errors });
  });

  it('ignores an empty errors array', async () => {
    mockFetch({ body: { errors: [], data: { ok: true } } });
    await expect(gql('query { ok }')).resolves.toEqual({ ok: true });
  });

  it('throws when the reply carries no data', async () => {
    mockFetch({ body: {} });
    await expect(gql('query { x }')).rejects.toThrow('Gateway returned an empty response');
  });

  it('lets an HTTP failure through as a BlocksError', async () => {
    mockFetch({ status: 500, body: { message: 'boom' } });
    await expect(gql('query { x }')).rejects.toBeInstanceOf(BlocksError);
  });
});
