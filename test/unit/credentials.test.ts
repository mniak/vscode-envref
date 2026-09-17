import { describe, expect, it } from 'vitest';
import { SecretsManagerClientFactory, classifyAwsError } from '../../src/aws/credentials';

describe('classifyAwsError', () => {
  it('classifies credential and session problems as auth', () => {
    for (const name of [
      'CredentialsProviderError',
      'ExpiredTokenException',
      'UnrecognizedClientException',
      'SSOTokenProviderFailure',
    ]) {
      const error = Object.assign(new Error('boom'), { name });
      expect(classifyAwsError(error).kind).toBe('auth');
    }
    expect(classifyAwsError(new Error('The SSO session associated with this profile has expired')).kind).toBe('auth');
  });

  it('classifies the remaining service errors', () => {
    expect(classifyAwsError(Object.assign(new Error('x'), { name: 'AccessDeniedException' })).kind).toBe(
      'access-denied',
    );
    expect(classifyAwsError(Object.assign(new Error('x'), { name: 'ResourceNotFoundException' })).kind).toBe(
      'not-found',
    );
    expect(classifyAwsError(Object.assign(new Error('x'), { name: 'ValidationException' })).kind).toBe('invalid');
    expect(classifyAwsError({ __type: 'ResourceNotFoundException' }).kind).toBe('not-found');
    expect(classifyAwsError(new Error('socket hang up')).kind).toBe('other');
    expect(classifyAwsError('plain string').message).toBe('plain string');
  });
});

describe('SecretsManagerClientFactory', () => {
  it('reuses one client per profile and region', () => {
    const factory = new SecretsManagerClientFactory();
    const a = factory.get({ profile: 'dev', region: 'us-east-1' });
    const b = factory.get({ profile: 'dev', region: 'us-east-1' });
    const c = factory.get({ profile: 'dev', region: 'eu-west-1' });
    const d = factory.get({ profile: 'prod', region: 'us-east-1' });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    factory.dispose();
  });
});
