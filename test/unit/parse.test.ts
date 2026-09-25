import { describe, expect, it } from 'vitest';
import { ParseError, ProviderSchema, parseBlock } from '../../src/refs/parse';
import { ProviderId, SourceMap } from '../../src/types';

const schemas = new Map<ProviderId, ProviderSchema>([['aws-sm', { configKeys: ['profile', 'region'] }]]);

function parse(block: unknown, settingsSources: SourceMap = {}) {
  return parseBlock(block, { schemas, settingsSources });
}

const TWO_SOURCES = {
  dev: { provider: 'aws-sm', profile: 'sandbox', region: 'us-east-1' },
  partner: { provider: 'aws-sm', profile: 'prod-nonpci', region: 'eu-west-1' },
};

describe('parseBlock', () => {
  it('binds each variable to the config of its named source', () => {
    const parsed = parse({
      sources: TWO_SOURCES,
      vars: {
        DB_PASSWORD: { source: 'dev', key: 'sandbox/cards/db', property: 'password' },
        PARTNER_TOKEN: { source: 'partner', key: 'partner/token' },
      },
    });

    expect(parsed.refs).toHaveLength(2);
    expect(parsed.refs[0]).toMatchObject({
      varName: 'DB_PASSWORD',
      sourceName: 'dev',
      source: { provider: 'aws-sm', config: { profile: 'sandbox', region: 'us-east-1' } },
      key: 'sandbox/cards/db',
      property: 'password',
      encoding: 'utf8',
      path: 'envRef.vars.DB_PASSWORD',
    });
    expect(parsed.refs[1]?.source.config).toEqual({ profile: 'prod-nonpci', region: 'eu-west-1' });
  });

  it('reads sources from settings when the block declares none', () => {
    const parsed = parse({ vars: { A: { source: 'shared', key: 'k' } } }, {
      shared: { provider: 'aws-sm', config: { profile: 'from-settings' } },
    });
    expect(parsed.refs[0]?.source.config).toEqual({ profile: 'from-settings' });
  });

  it('lets a block source shadow a settings source of the same name', () => {
    const parsed = parse(
      { sources: { dev: { provider: 'aws-sm', profile: 'from-block' } }, vars: { A: { source: 'dev', key: 'k' } } },
      { dev: { provider: 'aws-sm', config: { profile: 'from-settings' } } },
    );
    expect(parsed.refs[0]?.source.config).toEqual({ profile: 'from-block' });
  });

  it('requires a source on every reference', () => {
    const run = () => parse({ sources: TWO_SOURCES, vars: { A: { key: 'k' } } });
    expect(run).toThrow(/missing "source"/);
  });

  it('never defaults to the only source', () => {
    const run = () =>
      parse({ sources: { dev: { provider: 'aws-sm', profile: 'sandbox' } }, vars: { A: { key: 'k' } } });
    expect(run).toThrow(/missing "source"/);
  });

  it('lists the declared sources when one is unknown', () => {
    const run = () => parse({ sources: TWO_SOURCES, vars: { A: { source: 'staging', key: 'k' } } });
    expect(run).toThrow(/unknown source "staging", declared sources are: dev, partner/);
  });

  it('rejects provider config on the reference', () => {
    const run = () =>
      parse({ sources: TWO_SOURCES, vars: { A: { source: 'dev', key: 'k', profile: 'other' } } });
    expect(run).toThrow(/unknown field/);
  });

  it('requires at least one source', () => {
    const run = () => parse({ vars: { A: { source: 'dev', key: 'k' } } });
    expect(run).toThrow(/needs at least one entry in "sources"/);
  });

  it('rejects a source whose provider is not registered', () => {
    const run = () =>
      parse({ sources: { v: { provider: 'vault', address: 'https://x' } }, vars: { A: { source: 'v', key: 'k' } } });
    expect(run).toThrow(/unknown provider "vault", registered providers are: aws-sm/);
  });

  it('rejects a source field the provider does not accept', () => {
    const run = () =>
      parse({ sources: { dev: { provider: 'aws-sm', prfile: 'typo' } }, vars: { A: { source: 'dev', key: 'k' } } });
    expect(run).toThrow(/unknown field/);
  });

  it('requires a provider on every source', () => {
    const run = () => parse({ sources: { dev: { profile: 'sandbox' } }, vars: { A: { source: 'dev', key: 'k' } } });
    expect(run).toThrow(/missing "provider"/);
  });

  it('reports the variable name and the missing key', () => {
    let error: unknown;
    try {
      parse({ sources: TWO_SOURCES, vars: { DB_PASSWORD: { source: 'dev', property: 'password' } } });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ParseError);
    expect((error as ParseError).message).toContain('envRef.vars.DB_PASSWORD');
    expect((error as ParseError).message).toContain('missing "key"');
  });

  it('rejects plain strings and points at env', () => {
    const run = () => parse({ sources: TWO_SOURCES, vars: { A: 'sandbox/cards/db' } });
    expect(run).toThrow(/plain strings belong in "env"/);
  });

  it('collects every issue at once', () => {
    let error: unknown;
    try {
      parse({ sources: TWO_SOURCES, vars: { A: { source: 'dev', key: 'k', encoding: 'hex' }, B: { source: 'dev' } } });
    } catch (caught) {
      error = caught;
    }
    expect((error as ParseError).issues).toHaveLength(2);
  });

  it('requires "vars"', () => {
    expect(() => parse({ sources: TWO_SOURCES })).toThrow(/needs "vars"/);
  });

  it('rejects versionStage at block level', () => {
    const run = () =>
      parse({ sources: TWO_SOURCES, versionStage: 'AWSPREVIOUS', vars: { A: { source: 'dev', key: 'k' } } });
    expect(run).toThrow(/unknown field/);
  });

  it('keeps versionStage and versionId on the reference', () => {
    const parsed = parse({
      sources: TWO_SOURCES,
      vars: { A: { source: 'dev', key: 'k', versionStage: 'AWSPREVIOUS', versionId: 'v1' } },
    });
    expect(parsed.refs[0]).toMatchObject({ versionStage: 'AWSPREVIOUS', versionId: 'v1' });
  });

  it('validates target', () => {
    const block = { sources: TWO_SOURCES, vars: { A: { source: 'dev', key: 'k' } } };
    expect(() => parse({ ...block, target: 'vars' })).toThrow(/must be "env" or "environment"/);
    expect(parse({ ...block, target: 'environment' }).target).toBe('environment');
  });
});
