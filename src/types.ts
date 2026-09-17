export type ProviderId = 'aws-sm';

export const SUPPORTED_PROVIDERS: ProviderId[] = ['aws-sm'];

export type Encoding = 'utf8' | 'base64';

export type EnvTarget = 'env' | 'environment';

export interface SecretRef {
  varName: string;
  provider: ProviderId;
  key: string;
  property?: string;
  profile?: string;
  region?: string;
  versionStage?: string;
  versionId?: string;
  fallback?: string;
  encoding: Encoding;
  source: string;
}

export interface SecretBulkRef {
  provider: ProviderId;
  key: string;
  prefix?: string;
  profile?: string;
  region?: string;
  versionStage?: string;
  versionId?: string;
  source: string;
}

export interface ParsedBlock {
  refs: SecretRef[];
  bulk: SecretBulkRef[];
  target?: EnvTarget;
}

export interface BlockDefaults {
  provider?: ProviderId;
  profile?: string;
  region?: string;
}

export type FailureKind = 'auth' | 'access-denied' | 'not-found' | 'invalid' | 'other';

export interface ResolveFailure {
  kind: FailureKind;
  message: string;
  source: string;
  varName?: string;
  key: string;
  profile?: string;
  region?: string;
}

export interface ResolveOutcome {
  values: Map<string, string>;
  failures: ResolveFailure[];
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

export const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};
