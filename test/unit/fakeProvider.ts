import { FetchRequest, FetchedSecret, ProviderError, SecretProvider } from '../../src/providers/provider';
import { ProviderSchema } from '../../src/refs/parse';
import { FailureKind, ProviderId } from '../../src/types';

export interface FakeEntry {
  value?: string;
  binary?: Uint8Array;
  error?: { kind: FailureKind; message: string };
}

export class FakeProvider implements SecretProvider {
  readonly id: ProviderId = 'aws-sm';
  readonly configKeys = ['profile', 'region'] as const;
  readonly calls: FetchRequest[] = [];

  constructor(private readonly entries: Record<string, FakeEntry>) {}

  async fetch(request: FetchRequest): Promise<FetchedSecret> {
    this.calls.push(request);
    const entry = this.entries[request.key];
    if (entry === undefined) {
      throw new ProviderError('not-found', `Secret "${request.key}" was not found.`);
    }
    if (entry.error !== undefined) {
      throw new ProviderError(entry.error.kind, entry.error.message);
    }
    if (entry.binary !== undefined) {
      return { kind: 'binary', value: entry.binary };
    }
    return { kind: 'string', value: entry.value ?? '' };
  }

  callsFor(key: string): FetchRequest[] {
    return this.calls.filter((call) => call.key === key);
  }
}

export function providers(provider: SecretProvider): Map<ProviderId, SecretProvider> {
  return new Map<ProviderId, SecretProvider>([[provider.id, provider]]);
}

export const schemas = new Map<ProviderId, ProviderSchema>([['aws-sm', { configKeys: ['profile', 'region'] }]]);
