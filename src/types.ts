export type ProviderId = string;

export type Encoding = 'utf8' | 'base64';

export type EnvTarget = 'env' | 'environment';

export interface SourceConfig {
  provider: ProviderId;
  config: Record<string, string>;
}

export type SourceMap = Record<string, SourceConfig>;

export interface VarRef {
  varName: string;
  sourceName: string;
  source: SourceConfig;
  key: string;
  property?: string;
  versionStage?: string;
  versionId?: string;
  fallback?: string;
  encoding: Encoding;
  path: string;
}

export interface BulkRef {
  sourceName: string;
  source: SourceConfig;
  key: string;
  prefix?: string;
  versionStage?: string;
  versionId?: string;
  path: string;
}

export interface ParsedBlock {
  refs: VarRef[];
  bulk: BulkRef[];
  target?: EnvTarget;
}

export type FailureKind = 'auth' | 'access-denied' | 'not-found' | 'invalid' | 'other';

export interface ResolveFailure {
  kind: FailureKind;
  message: string;
  path: string;
  varName?: string;
  key: string;
  sourceName: string;
  config: Record<string, string>;
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
