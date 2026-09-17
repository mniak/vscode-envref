import { ProviderSchema } from '../refs/parse';
import { ProviderId, SourceMap } from '../types';

export function sourcesFromSettings(raw: unknown, schemas: Map<ProviderId, ProviderSchema>): SourceMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }

  const map: SourceMap = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const provider = nonEmptyString(record['provider']);
    if (provider === undefined) {
      continue;
    }
    const schema = schemas.get(provider);
    if (schema === undefined) {
      continue;
    }

    const config: Record<string, string> = {};
    for (const key of schema.configKeys) {
      const value = nonEmptyString(record[key]);
      if (value !== undefined) {
        config[key] = value;
      }
    }
    map[name] = { provider, config };
  }
  return map;
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
