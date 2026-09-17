import { describe, expect, it } from 'vitest';
import { parseBlock } from '../../src/refs/parse';
import { SecretResolver } from '../../src/resolve/resolver';
import { FakeProvider, providers } from './fakeProvider';

const DB_JSON = JSON.stringify({ password: 's3cr3t', host: 'db.internal', port: 5432, tls: true });

function resolverFor(provider: FakeProvider, ttlMs = 300_000, now?: () => number): SecretResolver {
  return new SecretResolver(providers(provider), { ttlMs, ...(now === undefined ? {} : { now }) });
}

describe('SecretResolver', () => {
  it('extracts JSON properties and raw values', async () => {
    const provider = new FakeProvider({
      'dev/db': { value: DB_JSON },
      'dev/token': { value: 'raw-token' },
    });
    const outcome = await resolverFor(provider).resolve(
      parseBlock({
        provider: 'aws-sm',
        env: {
          DB_PASSWORD: { key: 'dev/db', property: 'password' },
          DB_PORT: { key: 'dev/db', property: 'port' },
          API_TOKEN: { key: 'dev/token' },
        },
      }),
    );

    expect(outcome.failures).toEqual([]);
    expect(Object.fromEntries(outcome.values)).toEqual({
      DB_PASSWORD: 's3cr3t',
      DB_PORT: '5432',
      API_TOKEN: 'raw-token',
    });
  });

  it('calls the provider once for two properties of the same secret', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
    await resolverFor(provider).resolve(
      parseBlock({
        provider: 'aws-sm',
        env: {
          DB_PASSWORD: { key: 'dev/db', property: 'password' },
          DB_HOST: { key: 'dev/db', property: 'host' },
        },
      }),
    );
    expect(provider.callsFor('dev/db')).toHaveLength(1);
  });

  it('does not share cache entries across profiles or regions', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
    await resolverFor(provider).resolve(
      parseBlock({
        provider: 'aws-sm',
        env: {
          A: { key: 'dev/db', property: 'host', profile: 'one', region: 'us-east-1' },
          B: { key: 'dev/db', property: 'host', profile: 'two', region: 'us-east-1' },
          C: { key: 'dev/db', property: 'host', profile: 'two', region: 'eu-west-1' },
        },
      }),
    );
    expect(provider.callsFor('dev/db')).toHaveLength(3);
  });

  it('reuses the cache until the TTL expires', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
    let clock = 0;
    const resolver = resolverFor(provider, 1_000, () => clock);
    const block = parseBlock({ provider: 'aws-sm', env: { A: { key: 'dev/db', property: 'host' } } });

    await resolver.resolve(block);
    clock = 900;
    await resolver.resolve(block);
    expect(provider.callsFor('dev/db')).toHaveLength(1);

    clock = 1_500;
    await resolver.resolve(block);
    expect(provider.callsFor('dev/db')).toHaveLength(2);

    resolver.clearCache();
    await resolver.resolve(block);
    expect(provider.callsFor('dev/db')).toHaveLength(3);
  });

  it('applies default only when the secret or field is missing', async () => {
    const provider = new FakeProvider({
      'dev/db': { value: DB_JSON },
      'dev/expired': { error: { kind: 'auth', message: 'token expired' } },
    });
    const outcome = await resolverFor(provider).resolve(
      parseBlock({
        provider: 'aws-sm',
        env: {
          MISSING_SECRET: { key: 'dev/nope', default: 'fallback' },
          MISSING_FIELD: { key: 'dev/db', property: 'nope', default: '' },
          AUTH_FAILED: { key: 'dev/expired', default: 'must-not-be-used' },
        },
      }),
    );

    expect(outcome.values.get('MISSING_SECRET')).toBe('fallback');
    expect(outcome.values.get('MISSING_FIELD')).toBe('');
    expect(outcome.values.has('AUTH_FAILED')).toBe(false);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]).toMatchObject({ kind: 'auth', varName: 'AUTH_FAILED' });
  });

  it('reports a helpful failure for a non-JSON secret', async () => {
    const provider = new FakeProvider({ 'dev/plain': { value: 'not json' } });
    const outcome = await resolverFor(provider).resolve(
      parseBlock({ provider: 'aws-sm', env: { A: { key: 'dev/plain', property: 'password' } } }),
    );
    expect(outcome.failures[0]).toMatchObject({ kind: 'invalid', varName: 'A' });
    expect(outcome.failures[0]?.message).toContain('is not JSON');
  });

  it('lists the available fields when a property is missing', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
    const outcome = await resolverFor(provider).resolve(
      parseBlock({ provider: 'aws-sm', env: { A: { key: 'dev/db', property: 'secret' } } }),
    );
    expect(outcome.failures[0]?.message).toContain('password, host, port, tls');
  });

  it('reads nested properties with a dotted path', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: JSON.stringify({ a: { b: 'deep' } }) } });
    const outcome = await resolverFor(provider).resolve(
      parseBlock({ provider: 'aws-sm', env: { A: { key: 'dev/db', property: 'a.b' } } }),
    );
    expect(outcome.values.get('A')).toBe('deep');
  });

  it('decodes SecretBinary according to encoding', async () => {
    const provider = new FakeProvider({ 'dev/bin': { binary: new Uint8Array([104, 105]) } });
    const outcome = await resolverFor(provider).resolve(
      parseBlock({
        provider: 'aws-sm',
        env: { TEXT: { key: 'dev/bin' }, B64: { key: 'dev/bin', encoding: 'base64' } },
      }),
    );
    expect(outcome.values.get('TEXT')).toBe('hi');
    expect(outcome.values.get('B64')).toBe('aGk=');
  });

  it('expands envFrom with and without prefix', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
    const outcome = await resolverFor(provider).resolve(
      parseBlock({ provider: 'aws-sm', envFrom: [{ key: 'dev/db', prefix: 'DB_' }] }),
    );
    expect(Object.fromEntries(outcome.values)).toEqual({
      DB_password: 's3cr3t',
      DB_host: 'db.internal',
      DB_port: '5432',
      DB_tls: 'true',
    });
  });

  it('rejects envFrom fields that are not valid variable names', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: JSON.stringify({ 'not-a-var': 'x' }) } });
    const outcome = await resolverFor(provider).resolve(
      parseBlock({ provider: 'aws-sm', envFrom: [{ key: 'dev/db' }] }),
    );
    expect(outcome.failures[0]).toMatchObject({ kind: 'invalid' });
    expect(outcome.values.size).toBe(0);
  });

  it('fails when no provider is registered for the reference', async () => {
    const resolver = new SecretResolver(new Map());
    const outcome = await resolver.resolve(parseBlock({ provider: 'aws-sm', env: { A: { key: 'k' } } }));
    expect(outcome.failures[0]).toMatchObject({ kind: 'invalid' });
  });
});
