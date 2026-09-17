import { EnvTarget, Logger, silentLogger } from '../types';

interface EnvArrayEntry {
  name: string;
  value: string;
}

export interface MergeResult {
  target: EnvTarget;
  overridden: string[];
}

export function detectTarget(config: Record<string, unknown>): EnvTarget {
  if (Array.isArray(config['environment'])) {
    return 'environment';
  }
  if (isRecord(config['env'])) {
    return 'env';
  }
  return 'env';
}

export function mergeValues(
  config: Record<string, unknown>,
  values: Map<string, string>,
  options: { target?: EnvTarget; logger?: Logger } = {},
): MergeResult {
  const logger = options.logger ?? silentLogger;
  const target = options.target ?? detectTarget(config);
  const overridden: string[] = [];

  if (target === 'environment') {
    const existing = Array.isArray(config['environment'])
      ? (config['environment'] as unknown[]).filter(isEnvArrayEntry)
      : [];
    const merged: EnvArrayEntry[] = [];
    const seen = new Set<string>();

    for (const entry of existing) {
      const replacement = values.get(entry.name);
      if (replacement === undefined) {
        merged.push(entry);
      } else {
        overridden.push(entry.name);
        merged.push({ name: entry.name, value: replacement });
      }
      seen.add(entry.name);
    }
    for (const [name, value] of values) {
      if (!seen.has(name)) {
        merged.push({ name, value });
      }
    }
    config['environment'] = merged;
  } else {
    const existing = isRecord(config['env']) ? config['env'] : {};
    for (const [name, value] of values) {
      if (name in existing) {
        overridden.push(name);
      }
      existing[name] = value;
    }
    config['env'] = existing;
  }

  if (overridden.length > 0) {
    logger.warn(`Resolved secrets replaced literal values for: ${overridden.join(', ')}.`);
  }
  logger.info(`Injected ${values.size} environment variable(s) into "${target}".`);

  return { target, overridden };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnvArrayEntry(value: unknown): value is EnvArrayEntry {
  return isRecord(value) && typeof value['name'] === 'string' && typeof value['value'] === 'string';
}
