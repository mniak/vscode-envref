import { describe, expect, it } from 'vitest';
import { AwsSecretsManagerProvider } from '../../src/providers/awsSecretsManager';

describe('AwsSecretsManagerProvider', () => {
  it('declares the config keys a source may set', () => {
    expect(new AwsSecretsManagerProvider().configKeys).toEqual(['profile', 'region']);
  });

  it('takes profile and region from the request config', () => {
    const provider = new AwsSecretsManagerProvider();
    expect(provider.scopeOf({ key: 'k', config: { profile: 'dev-ext', region: 'us-east-1' } })).toEqual({
      profile: 'dev-ext',
      region: 'us-east-1',
    });
  });

  it('leaves the scope empty when the source declared neither', () => {
    expect(new AwsSecretsManagerProvider().scopeOf({ key: 'k', config: {} })).toEqual({});
  });
});
