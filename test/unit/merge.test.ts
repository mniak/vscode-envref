import { describe, expect, it } from 'vitest';
import { detectTarget, mergeValues } from '../../src/refs/merge';

describe('mergeValues', () => {
  it('writes into env and reports overridden literals', () => {
    const config: Record<string, unknown> = { env: { LOG_LEVEL: 'debug', DB_PASSWORD: 'placeholder' } };
    const result = mergeValues(config, new Map([['DB_PASSWORD', 's3cr3t'], ['API_TOKEN', 't']]));

    expect(config['env']).toEqual({ LOG_LEVEL: 'debug', DB_PASSWORD: 's3cr3t', API_TOKEN: 't' });
    expect(result).toEqual({ target: 'env', overridden: ['DB_PASSWORD'] });
  });

  it('creates env when the config has none', () => {
    const config: Record<string, unknown> = {};
    mergeValues(config, new Map([['A', '1']]));
    expect(config['env']).toEqual({ A: '1' });
  });

  it('writes into the environment array when the adapter uses it', () => {
    const config: Record<string, unknown> = {
      environment: [
        { name: 'LOG_LEVEL', value: 'debug' },
        { name: 'DB_PASSWORD', value: 'placeholder' },
      ],
    };
    const result = mergeValues(config, new Map([['DB_PASSWORD', 's3cr3t'], ['API_TOKEN', 't']]));

    expect(config['environment']).toEqual([
      { name: 'LOG_LEVEL', value: 'debug' },
      { name: 'DB_PASSWORD', value: 's3cr3t' },
      { name: 'API_TOKEN', value: 't' },
    ]);
    expect(result.target).toBe('environment');
    expect(result.overridden).toEqual(['DB_PASSWORD']);
    expect(config['env']).toBeUndefined();
  });

  it('honours an explicit target', () => {
    const config: Record<string, unknown> = { env: { A: '1' } };
    mergeValues(config, new Map([['B', '2']]), { target: 'environment' });
    expect(config['environment']).toEqual([{ name: 'B', value: '2' }]);
    expect(config['env']).toEqual({ A: '1' });
  });

  it('detects the target from the config shape', () => {
    expect(detectTarget({ environment: [] })).toBe('environment');
    expect(detectTarget({ env: {} })).toBe('env');
    expect(detectTarget({})).toBe('env');
  });
});
