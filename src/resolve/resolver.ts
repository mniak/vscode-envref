import { FetchRequest, FetchedSecret, ProviderError, SecretProvider } from '../providers/provider';
import { ProviderSchema } from '../refs/parse';
import {
  Logger,
  ParsedBlock,
  ProviderId,
  ResolveFailure,
  ResolveOutcome,
  SourceConfig,
  VarRef,
  silentLogger,
} from '../types';

interface CacheEntry {
  expiresAt: number;
  promise: Promise<FetchedSecret>;
}

export interface ResolverOptions {
  ttlMs?: number;
  now?: () => number;
  logger?: Logger;
}

export class EnvRefResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly logger: Logger;
  private ttlMs: number;

  constructor(
    private readonly providers: Map<ProviderId, SecretProvider>,
    options: ResolverOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 300_000;
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger ?? silentLogger;
  }

  setTtlMs(ttlMs: number): void {
    this.ttlMs = ttlMs;
  }

  clearCache(): void {
    this.cache.clear();
    this.logger.info('Cache cleared.');
  }

  schemas(): Map<ProviderId, ProviderSchema> {
    const map = new Map<ProviderId, ProviderSchema>();
    for (const [id, provider] of this.providers) {
      map.set(id, { configKeys: provider.configKeys });
    }
    return map;
  }

  async resolve(block: ParsedBlock): Promise<ResolveOutcome> {
    const values = new Map<string, string>();
    const failures: ResolveFailure[] = [];

    const single = block.refs.map(async (ref) => {
      try {
        const secret = await this.fetch(ref.source, requestOf(ref));
        values.set(ref.varName, extract(ref, secret));
        this.logger.debug(`Resolved ${ref.varName} from ${ref.key}${ref.property ? `#${ref.property}` : ''}.`);
      } catch (error) {
        const failure = toFailure(error, ref, ref.varName);
        if (failure.kind === 'not-found' && ref.fallback !== undefined) {
          values.set(ref.varName, ref.fallback);
          this.logger.warn(`${ref.varName}: ${failure.message} — using the configured default.`);
          return;
        }
        failures.push(failure);
      }
    });

    await Promise.all(single);
    return { values, failures };
  }

  private fetch(source: SourceConfig, request: FetchRequest): Promise<FetchedSecret> {
    const provider = this.providers.get(source.provider);
    if (provider === undefined) {
      return Promise.reject(new ProviderError('invalid', `No provider registered for "${source.provider}".`));
    }

    const cacheKey = JSON.stringify([
      source.provider,
      Object.entries(source.config).sort(([a], [b]) => a.localeCompare(b)),
      request.key,
      request.versionStage ?? '',
      request.versionId ?? '',
    ]);

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > this.now()) {
      return cached.promise;
    }

    const promise = provider.fetch(request);
    if (this.ttlMs > 0) {
      this.cache.set(cacheKey, { expiresAt: this.now() + this.ttlMs, promise });
      promise.catch(() => this.cache.delete(cacheKey));
    }
    return promise;
  }
}

function requestOf(ref: VarRef): FetchRequest {
  return {
    key: ref.key,
    config: ref.source.config,
    ...(ref.versionStage === undefined ? {} : { versionStage: ref.versionStage }),
    ...(ref.versionId === undefined ? {} : { versionId: ref.versionId }),
  };
}

function decode(secret: FetchedSecret, encoding: 'utf8' | 'base64'): string {
  if (secret.kind === 'string') {
    return encoding === 'base64' ? Buffer.from(secret.value, 'utf8').toString('base64') : secret.value;
  }
  return Buffer.from(secret.value).toString(encoding);
}

function extract(ref: VarRef, secret: FetchedSecret): string {
  if (ref.property === undefined) {
    return decode(secret, ref.encoding);
  }

  const text = decode(secret, 'utf8');
  const document = parseJson(text, ref.key);
  const found = lookup(document, ref.property);
  if (found === undefined || found === null) {
    throw new ProviderError(
      'not-found',
      `Secret "${ref.key}" has no field "${ref.property}".`,
      `Available fields: ${Object.keys(document).join(', ') || '(none)'}`,
    );
  }
  return stringify(found);
}

function parseJson(text: string, key: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderError(
      'invalid',
      `Secret "${key}" is not JSON, so its fields cannot be read.`,
      'Drop "property" to use the whole secret value.',
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProviderError('invalid', `Secret "${key}" is not a JSON object, so its fields cannot be read.`);
  }
  return parsed as Record<string, unknown>;
}

function lookup(document: Record<string, unknown>, property: string): unknown {
  if (property in document) {
    return document[property];
  }
  if (!property.includes('.')) {
    return undefined;
  }
  let current: unknown = document;
  for (const segment of property.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function toFailure(error: unknown, ref: VarRef, varName?: string): ResolveFailure {
  const base = {
    path: ref.path,
    key: ref.key,
    sourceName: ref.sourceName,
    config: ref.source.config,
    ...(varName === undefined ? {} : { varName }),
  };
  if (error instanceof ProviderError) {
    return {
      ...base,
      kind: error.kind,
      message: error.hint === undefined ? error.message : `${error.message} ${error.hint}`,
    };
  }
  return { ...base, kind: 'other', message: error instanceof Error ? error.message : String(error) };
}
