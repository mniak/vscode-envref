import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fromIni: vi.fn(),
  fromNodeProviderChain: vi.fn(),
}));

vi.mock('@aws-sdk/credential-providers', () => mocks);

import { SecretsManagerClientFactory } from '../../src/aws/credentials';

const stub = async () => ({ accessKeyId: 'AKID', secretAccessKey: 'SECRET' });

beforeEach(() => {
  mocks.fromIni.mockReset().mockReturnValue(stub);
  mocks.fromNodeProviderChain.mockReset().mockReturnValue(stub);
});

describe('SecretsManagerClientFactory credential scope', () => {
  it('never passes the data-plane region to fromIni, so SSO uses sso_region', () => {
    new SecretsManagerClientFactory().get({ profile: 'pismo-ext', region: 'sa-east-1' });

    expect(mocks.fromIni).toHaveBeenCalledTimes(1);
    expect(mocks.fromIni).toHaveBeenCalledWith({ profile: 'pismo-ext' });
    expect(mocks.fromIni.mock.calls[0]?.[0]).not.toHaveProperty('clientConfig');
  });

  it('passes only the profile when no region is given', () => {
    new SecretsManagerClientFactory().get({ profile: 'pismo-ext' });

    expect(mocks.fromIni).toHaveBeenCalledWith({ profile: 'pismo-ext' });
  });

  it('still applies the region to the Secrets Manager client itself', async () => {
    const client = new SecretsManagerClientFactory().get({ profile: 'pismo-ext', region: 'sa-east-1' });

    expect(await client.config.region()).toBe('sa-east-1');
  });

  it('uses the default chain when there is no profile', () => {
    new SecretsManagerClientFactory().get({ region: 'sa-east-1' });

    expect(mocks.fromNodeProviderChain).toHaveBeenCalledTimes(1);
    expect(mocks.fromIni).not.toHaveBeenCalled();
  });
});
