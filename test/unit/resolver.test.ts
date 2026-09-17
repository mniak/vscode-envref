import { describe, expect, it } from 'vitest';
import { parseBlock } from '../../src/refs/parse';
import { EnvRefResolver } from '../../src/resolve/resolver';
import { FakeProvider, providers, schemas } from './fakeProvider';

const DB_JSON = JSON.stringify({ password: 's3cr3t', host: 'db.internal', port: 5432, tls: true });
const ONE = { dev: { provider: 'aws-sm', profile: 'sandbox', region: 'us-east-1' } };

function resolverFor(provider: FakeProvider, ttlMs = 300_000, now?: () => number): EnvRefResolver {
  return new EnvRefResolver(providers(provider), { ttlMs, ...(now === undefined ? {} : { now }) });
}

function block(body: Record<string, unknown>, sources: Record<string, unknown> = ONE) {
  return parseBlock({ sources, ...body }, { schemas });
}

describe('EnvRefResolver', () => {
  it('extracts JSON properties and raw values', async () => {
    const provider = new FakeProvider({
      'dev/db': { value: DB_JSON },
      'dev/token': { value: 'raw-token' },
    });
    const outcome = await resolverFor(provider).resolve(
      block({
        vars: {
          DB_PASSWORD: { source: 'dev', key: 'dev/db', property: 'password' },
          DB_PORT: { source: 'dev', key: 'dev/db', property: 'port' },
          API_TOKEN: { source: 'dev', key: 'dev/token' },
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
      block({
        vars: {
          DB_PASSWORD: { source: 'dev', key: 'dev/db', property: 'password' },
          DB_HOST: { source: 'dev', key: 'dev/db', property: 'host' },
        },
      }),
    );
    expect(provider.callsFor('dev/db')).toHaveLength(1);
  });

  it('does not share cache entries across sources', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
    await resolverFor(provider).resolve(
      block(
        {
          vars: {
            A: { source: 'one', key: 'dev/db', property: 'host' },
            B: { source: 'two', key: 'dev/db', property: 'host' },
            C: { source: 'three', key: 'dev/db', property: 'host' },
          },
        },
        {
          one: { provider: 'aws-sm', profile: 'one', region: 'us-east-1' },
          two: { provider: 'aws-sm', profile: 'two', region: 'us-east-1' },
          three: { provider: 'aws-sm', profile: 'two', region: 'eu-west-1' },
        },
      ),
    );
    expect(provider.callsFor('dev/db')).toHaveLength(3);
  });

  it('shares one cache entry between two sources with identical config', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
    await resolverFor(provider).resolve(
      block(
        {
          vars: {
            A: { source: 'alias-one', key: 'dev/db', property: 'host' },
            B: { source: 'alias-two', key: 'dev/db', property: 'host' },
          },
        },
        {
          'alias-one': { provider: 'aws-sm', profile: 'same', region: 'us-east-1' },
          'alias-two': { provider: 'aws-sm', region: 'us-east-1', profile: 'same' },
        },
      ),
    );
    expect(provider.callsFor('dev/db')).toHaveLength(1);
  });

  it('reuses the cache until the TTL expires', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
    let clock = 0;
    const resolver = resolverFor(provider, 1_000, () => clock);
    const parsed = block({ vars: { A: { source: 'dev', key: 'dev/db', property: 'host' } } });

    await resolver.resolve(parsed);
    clock = 900;
    await resolver.resolve(parsed);
    expect(provider.callsFor('dev/db')).toHaveLength(1);

    clock = 1_500;
    await resolver.resolve(parsed);
    expect(provider.callsFor('dev/db')).toHaveLength(2);

    resolver.clearCache();
    await resolver.resolve(parsed);
    expect(provider.callsFor('dev/db')).toHaveLength(3);
  });

  it('applies default only when the secret or field is missing', async () => {
    const provider = new FakeProvider({
      'dev/db': { value: DB_JSON },
      'dev/expired': { error: { kind: 'auth', message: 'token expired' } },
    });
    const outcome = await resolverFor(provider).resolve(
      block({
        vars: {
          MISSING_SECRET: { source: 'dev', key: 'dev/nope', default: 'fallback' },
          MISSING_FIELD: { source: 'dev', key: 'dev/db', property: 'nope', default: '' },
          AUTH_FAILED: { source: 'dev', key: 'dev/expired', default: 'must-not-be-used' },
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
      block({ vars: { A: { source: 'dev', key: 'dev/plain', property: 'password' } } }),
    );
    expect(outcome.failures[0]).toMatchObject({ kind: 'invalid', varName: 'A' });
    expect(outcome.failures[0]?.message).toContain('is not JSON');
  });

  it('lists the available fields when a property is missing', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
    const outcome = await resolverFor(provider).resolve(
      block({ vars: { A: { source: 'dev', key: 'dev/db', property: 'secret' } } }),
    );
    expect(outcome.failures[0]?.message).toContain('password, host, port, tls');
  });

  it('reads nested properties with a dotted path', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: JSON.stringify({ a: { b: 'deep' } }) } });
    const outcome = await resolverFor(provider).resolve(
      block({ vars: { A: { source: 'dev', key: 'dev/db', property: 'a.b' } } }),
    );
    expect(outcome.values.get('A')).toBe('deep');
  });

  it('decodes SecretBinary according to encoding', async () => {
    const provider = new FakeProvider({ 'dev/bin': { binary: new Uint8Array([104, 105]) } });
    const outcome = await resolverFor(provider).resolve(
      block({
        vars: {
          TEXT: { source: 'dev', key: 'dev/bin' },
          B64: { source: 'dev', key: 'dev/bin', encoding: 'base64' },
        },
      }),
    );
    expect(outcome.values.get('TEXT')).toBe('hi');
    expect(outcome.values.get('B64')).toBe('aGk=');
  });

  it('expands varsFrom with and without prefix', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
    const outcome = await resolverFor(provider).resolve(
      block({ varsFrom: [{ source: 'dev', key: 'dev/db', prefix: 'DB_' }] }),
    );
    expect(Object.fromEntries(outcome.values)).toEqual({
      DB_password: 's3cr3t',
      DB_host: 'db.internal',
      DB_port: '5432',
      DB_tls: 'true',
    });
  });

  it('rejects varsFrom fields that are not valid variable names', async () => {
    const provider = new FakeProvider({ 'dev/db': { value: JSON.stringify({ 'not-a-var': 'x' }) } });
    const outcome = await resolverFor(provider).resolve(
      block({ varsFrom: [{ source: 'dev', key: 'dev/db' }] }),
    );
    expect(outcome.failures[0]).toMatchObject({ kind: 'invalid' });
    expect(outcome.values.size).toBe(0);
  });

  it('fails when no provider is registered for the source', async () => {
    const resolver = new EnvRefResolver(new Map());
    const outcome = await resolver.resolve(block({ vars: { A: { source: 'dev', key: 'k' } } }));
    expect(outcome.failures[0]).toMatchObject({ kind: 'invalid', sourceName: 'dev' });
  });
});
