import { FailureKind, ProviderId } from '../types';

export interface FetchRequest {
  key: string;
  config: Record<string, string>;
  versionStage?: string;
  versionId?: string;
}

export type FetchedSecret =
  | { kind: 'string'; value: string }
  | { kind: 'binary'; value: Uint8Array };

export interface SecretProvider {
  readonly id: ProviderId;
  readonly configKeys: readonly string[];
  fetch(request: FetchRequest): Promise<FetchedSecret>;
}

export class ProviderError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
