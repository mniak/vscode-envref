import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { fromIni, fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { FailureKind } from '../types';

export interface ClientScope {
  profile?: string;
  region?: string;
}

export class SecretsManagerClientFactory {
  private readonly clients = new Map<string, SecretsManagerClient>();

  get(scope: ClientScope): SecretsManagerClient {
    const cacheKey = `${scope.profile ?? ''}|${scope.region ?? ''}`;
    const cached = this.clients.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const client = new SecretsManagerClient({
      ...(scope.region === undefined ? {} : { region: scope.region }),
      credentials:
        scope.profile === undefined
          ? fromNodeProviderChain()
          : fromIni({ profile: scope.profile }),
    });
    this.clients.set(cacheKey, client);
    return client;
  }

  dispose(): void {
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
  }
}

const AUTH_NAMES = new Set([
  'CredentialsProviderError',
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidClientTokenId',
  'SSOTokenProviderFailure',
  'TokenRefreshRequired',
  'UnrecognizedClientException',
]);

export function classifyAwsError(error: unknown): { kind: FailureKind; message: string } {
  const name = errorName(error);
  const message = error instanceof Error ? error.message : String(error);

  if (AUTH_NAMES.has(name) || /expired|sso session|not authorized to perform: sts/i.test(message)) {
    return { kind: 'auth', message };
  }
  if (name === 'AccessDeniedException' || name === 'AccessDenied') {
    return { kind: 'access-denied', message };
  }
  if (name === 'ResourceNotFoundException') {
    return { kind: 'not-found', message };
  }
  if (name === 'ValidationException' || name === 'InvalidParameterException' || name === 'InvalidRequestException') {
    return { kind: 'invalid', message };
  }
  return { kind: 'other', message };
}

function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return '';
  }
  const candidate = error as { name?: unknown; __type?: unknown };
  if (typeof candidate.name === 'string' && candidate.name !== 'Error') {
    return candidate.name;
  }
  return typeof candidate.__type === 'string' ? candidate.__type : '';
}
