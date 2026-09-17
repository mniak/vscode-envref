import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ClientScope, SecretsManagerClientFactory, classifyAwsError } from '../aws/credentials';
import { Logger, ProviderId, silentLogger } from '../types';
import { FetchRequest, FetchedSecret, ProviderError, SecretProvider } from './provider';

export interface AwsSecretsManagerOptions {
  defaults?: ClientScope;
  factory?: SecretsManagerClientFactory;
  logger?: Logger;
}

export class AwsSecretsManagerProvider implements SecretProvider {
  readonly id: ProviderId = 'aws-sm';
  readonly configKeys = ['profile', 'region'] as const;

  private readonly factory: SecretsManagerClientFactory;
  private readonly logger: Logger;
  private defaults: ClientScope;

  constructor(options: AwsSecretsManagerOptions = {}) {
    this.factory = options.factory ?? new SecretsManagerClientFactory();
    this.logger = options.logger ?? silentLogger;
    this.defaults = options.defaults ?? {};
  }

  setDefaults(defaults: ClientScope): void {
    this.defaults = defaults;
  }

  scopeOf(request: FetchRequest): ClientScope {
    const profile = request.config['profile'] ?? this.defaults.profile;
    const region = request.config['region'] ?? this.defaults.region;
    return {
      ...(profile === undefined ? {} : { profile }),
      ...(region === undefined ? {} : { region }),
    };
  }

  async fetch(request: FetchRequest): Promise<FetchedSecret> {
    const scope = this.scopeOf(request);
    const client = this.factory.get(scope);

    this.logger.debug(
      `GetSecretValue key=${request.key} profile=${scope.profile ?? '(default chain)'} region=${scope.region ?? '(sdk default)'}`,
    );

    try {
      const response = await client.send(
        new GetSecretValueCommand({
          SecretId: request.key,
          ...(request.versionId === undefined ? {} : { VersionId: request.versionId }),
          ...(request.versionId === undefined && request.versionStage !== undefined
            ? { VersionStage: request.versionStage }
            : {}),
        }),
      );

      if (typeof response.SecretString === 'string') {
        return { kind: 'string', value: response.SecretString };
      }
      if (response.SecretBinary !== undefined) {
        return { kind: 'binary', value: response.SecretBinary };
      }
      throw new ProviderError('not-found', `Secret "${request.key}" has neither SecretString nor SecretBinary.`);
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      const { kind, message } = classifyAwsError(error);
      throw new ProviderError(kind, message, hintFor(kind, scope));
    }
  }

  dispose(): void {
    this.factory.dispose();
  }
}

function hintFor(kind: string, scope: ClientScope): string | undefined {
  if (kind === 'auth') {
    return scope.profile === undefined
      ? 'No usable AWS credentials in the default chain.'
      : `Run "aws sso login --profile ${scope.profile}".`;
  }
  if (kind === 'access-denied') {
    return `Checked with profile=${scope.profile ?? '(default chain)'} region=${scope.region ?? '(sdk default)'}.`;
  }
  return undefined;
}
