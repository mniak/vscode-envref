import { describe, expect, it } from 'vitest';
import { ParseError, parseBlock } from '../../src/refs/parse';

describe('parseBlock', () => {
  it('applies block defaults and per-variable overrides', () => {
    const parsed = parseBlock({
      provider: 'aws-sm',
      profile: 'dev-ext',
      region: 'us-east-1',
      env: {
        DB_PASSWORD: { key: 'dev-ext/cards/db', property: 'password' },
        PARTNER_TOKEN: {
          key: 'prod-nonpci/partner/token',
          property: 'value',
          profile: 'prod-nonpci',
          region: 'eu-west-1',
        },
      },
    });

    expect(parsed.refs).toHaveLength(2);
    const [db, partner] = parsed.refs;
    expect(db).toMatchObject({
      varName: 'DB_PASSWORD',
      provider: 'aws-sm',
      key: 'dev-ext/cards/db',
      property: 'password',
      profile: 'dev-ext',
      region: 'us-east-1',
      encoding: 'utf8',
    });
    expect(partner).toMatchObject({ profile: 'prod-nonpci', region: 'eu-west-1' });
  });

  it('falls back to settings when the block has no profile or region', () => {
    const parsed = parseBlock(
      { provider: 'aws-sm', env: { A: { key: 'k' } } },
      { profile: 'from-settings', region: 'sa-east-1' },
    );
    expect(parsed.refs[0]).toMatchObject({ profile: 'from-settings', region: 'sa-east-1' });
  });

  it('keeps the block profile over settings', () => {
    const parsed = parseBlock(
      { provider: 'aws-sm', profile: 'from-block', env: { A: { key: 'k' } } },
      { profile: 'from-settings' },
    );
    expect(parsed.refs[0]?.profile).toBe('from-block');
  });

  it('accepts a provider declared only on the reference', () => {
    const parsed = parseBlock({ env: { A: { provider: 'aws-sm', key: 'k' } } });
    expect(parsed.refs[0]?.provider).toBe('aws-sm');
  });

  it('reports the variable name when a reference is invalid', () => {
    let error: unknown;
    try {
      parseBlock({ provider: 'aws-sm', env: { DB_PASSWORD: { property: 'password' } } });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ParseError);
    expect((error as ParseError).message).toContain('externalSecrets.env.DB_PASSWORD');
    expect((error as ParseError).message).toContain('missing "key"');
  });

  it('rejects plain strings and points to env', () => {
    const run = () => parseBlock({ provider: 'aws-sm', env: { A: 'dev-ext/cards/db' } });
    expect(run).toThrow(/plain strings belong in "env"/);
  });

  it('rejects an unsupported provider', () => {
    const run = () => parseBlock({ provider: 'vault', env: { A: { key: 'k' } } });
    expect(run).toThrow(/unsupported provider "vault"/);
  });

  it('requires a provider somewhere', () => {
    const run = () => parseBlock({ env: { A: { key: 'k' } } });
    expect(run).toThrow(/missing "provider"/);
  });

  it('rejects unknown fields', () => {
    const run = () => parseBlock({ provider: 'aws-sm', env: { A: { key: 'k', propery: 'x' } } });
    expect(run).toThrow(/unknown field/);
  });

  it('collects every issue at once', () => {
    let error: unknown;
    try {
      parseBlock({ provider: 'aws-sm', env: { A: { key: 'k', encoding: 'hex' }, B: {} } });
    } catch (caught) {
      error = caught;
    }
    expect((error as ParseError).issues).toHaveLength(2);
  });

  it('parses envFrom with and without prefix', () => {
    const parsed = parseBlock({
      provider: 'aws-sm',
      profile: 'dev-ext',
      envFrom: [{ key: 'dev-ext/cards/all' }, { key: 'dev-ext/cards/db', prefix: 'DB_' }],
    });
    expect(parsed.bulk).toHaveLength(2);
    expect(parsed.bulk[0]).toMatchObject({ key: 'dev-ext/cards/all', profile: 'dev-ext' });
    expect(parsed.bulk[1]?.prefix).toBe('DB_');
  });

  it('requires env or envFrom', () => {
    expect(() => parseBlock({ provider: 'aws-sm' })).toThrow(/at least one of "env" or "envFrom"/);
  });

  it('validates target', () => {
    expect(() => parseBlock({ provider: 'aws-sm', target: 'vars', env: { A: { key: 'k' } } })).toThrow(
      /must be "env" or "environment"/,
    );
    expect(parseBlock({ provider: 'aws-sm', target: 'environment', env: { A: { key: 'k' } } }).target).toBe(
      'environment',
    );
  });
});
