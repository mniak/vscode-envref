import { describe, expect, it } from 'vitest';
import { sourcesFromSettings } from '../../src/config/defaults';
import { ProviderSchema } from '../../src/refs/parse';
import { ProviderId } from '../../src/types';

const schemas = new Map<ProviderId, ProviderSchema>([['aws-sm', { configKeys: ['profile', 'region'] }]]);

describe('sourcesFromSettings', () => {
  it('keeps well-formed entries', () => {
    expect(
      sourcesFromSettings({ dev: { provider: 'aws-sm', profile: 'sandbox', region: 'us-east-1' } }, schemas),
    ).toEqual({ dev: { provider: 'aws-sm', config: { profile: 'sandbox', region: 'us-east-1' } } });
  });

  it('keeps an entry that sets no provider config at all', () => {
    expect(sourcesFromSettings({ chain: { provider: 'aws-sm' } }, schemas)).toEqual({
      chain: { provider: 'aws-sm', config: {} },
    });
  });

  it('drops entries with an unknown provider instead of throwing', () => {
    expect(sourcesFromSettings({ v: { provider: 'vault', address: 'https://x' } }, schemas)).toEqual({});
  });

  it('drops entries without a usable provider', () => {
    expect(sourcesFromSettings({ a: { profile: 'x' }, b: { provider: '  ' }, c: 'nope' }, schemas)).toEqual({});
  });

  it('ignores fields the provider does not accept', () => {
    expect(sourcesFromSettings({ dev: { provider: 'aws-sm', profile: 'sandbox', nope: 'x' } }, schemas)).toEqual({
      dev: { provider: 'aws-sm', config: { profile: 'sandbox' } },
    });
  });

  it('drops blank and non-string config values', () => {
    expect(sourcesFromSettings({ dev: { provider: 'aws-sm', profile: '   ', region: 42 } }, schemas)).toEqual({
      dev: { provider: 'aws-sm', config: {} },
    });
  });

  it('returns an empty map for anything that is not an object', () => {
    expect(sourcesFromSettings(undefined, schemas)).toEqual({});
    expect(sourcesFromSettings(null, schemas)).toEqual({});
    expect(sourcesFromSettings([], schemas)).toEqual({});
  });
});
