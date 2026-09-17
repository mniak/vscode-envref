import { FailureKind, ProviderId } from '../types';

export interface FetchRequest {
  key: string;
  profile?: string;
  region?: string;
  versionStage?: string;
  versionId?: string;
}

export type FetchedSecret =
  | { kind: 'string'; value: string }
  | { kind: 'binary'; value: Uint8Array };

export interface SecretProvider {
  readonly id: ProviderId;
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
