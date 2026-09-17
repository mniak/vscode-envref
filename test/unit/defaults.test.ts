import { describe, expect, it } from 'vitest';
import { blockDefaultsFrom } from '../../src/config/defaults';

describe('blockDefaultsFrom', () => {
  it('keeps non-empty strings', () => {
    expect(blockDefaultsFrom('dev-ext', 'us-east-1')).toEqual({ profile: 'dev-ext', region: 'us-east-1' });
  });

  it('drops null, which is what the settings default resolves to', () => {
    expect(blockDefaultsFrom(null, null)).toEqual({});
    expect(blockDefaultsFrom(null, 'us-east-1')).toEqual({ region: 'us-east-1' });
    expect(blockDefaultsFrom('dev-ext', null)).toEqual({ profile: 'dev-ext' });
  });

  it('drops undefined, empty and blank values', () => {
    expect(blockDefaultsFrom(undefined, undefined)).toEqual({});
    expect(blockDefaultsFrom('', '')).toEqual({});
    expect(blockDefaultsFrom('   ', '\t')).toEqual({});
  });

  it('drops values that are not strings', () => {
    expect(blockDefaultsFrom(42, true)).toEqual({});
  });

  it('never sets the keys it drops', () => {
    expect(Object.keys(blockDefaultsFrom(null, null))).toEqual([]);
  });
});
