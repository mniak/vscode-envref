import {
  BulkRef,
  Encoding,
  EnvTarget,
  ParsedBlock,
  ProviderId,
  SourceConfig,
  SourceMap,
  VarRef,
} from '../types';

export interface ParseIssue {
  path: string;
  message: string;
}

export class ParseError extends Error {
  constructor(readonly issues: ParseIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'ParseError';
  }
}

export interface ProviderSchema {
  configKeys: readonly string[];
}

export interface ParseOptions {
  schemas: Map<ProviderId, ProviderSchema>;
  settingsSources?: SourceMap;
  rootPath?: string;
}

const BLOCK_KEYS = ['sources', 'vars', 'varsFrom', 'target'];
const REF_KEYS = ['source', 'key', 'property', 'versionStage', 'versionId', 'default', 'encoding'];
const BULK_KEYS = ['source', 'key', 'prefix', 'versionStage', 'versionId'];

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class IssueCollector {
  readonly issues: ParseIssue[] = [];

  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  string(path: string, value: unknown, field: string): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      this.add(`${path}.${field}`, 'must be a non-empty string');
      return undefined;
    }
    return value;
  }

  unknownKeys(path: string, value: Rec, allowed: string[]): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        this.add(`${path}.${key}`, `unknown field, expected one of: ${allowed.join(', ')}`);
      }
    }
  }
}

function parseSources(
  collector: IssueCollector,
  path: string,
  raw: unknown,
  schemas: Map<ProviderId, ProviderSchema>,
): SourceMap {
  if (!isRecord(raw)) {
    collector.add(path, 'must be an object mapping source names to provider configuration');
    return {};
  }

  const map: SourceMap = {};
  for (const [name, entry] of Object.entries(raw)) {
    const entryPath = `${path}.${name}`;
    if (!isRecord(entry)) {
      collector.add(entryPath, 'must be an object such as { "provider": "aws-sm", "profile": "dev-ext" }');
      continue;
    }

    const provider = collector.string(entryPath, entry.provider, 'provider');
    if (provider === undefined) {
      if (entry.provider === undefined) {
        collector.add(entryPath, 'missing "provider"');
      }
      continue;
    }

    const schema = schemas.get(provider);
    if (schema === undefined) {
      const known = [...schemas.keys()].join(', ');
      collector.add(
        `${entryPath}.provider`,
        `unknown provider "${provider}", registered providers are: ${known === '' ? '(none)' : known}`,
      );
      continue;
    }

    collector.unknownKeys(entryPath, entry, ['provider', ...schema.configKeys]);

    const config: Record<string, string> = {};
    for (const key of schema.configKeys) {
      const value = collector.string(entryPath, entry[key], key);
      if (value !== undefined) {
        config[key] = value;
      }
    }
    map[name] = { provider, config };
  }
  return map;
}

function bindSource(
  collector: IssueCollector,
  path: string,
  raw: Rec,
  sources: SourceMap,
): { sourceName: string; source: SourceConfig } | undefined {
  const name = collector.string(path, raw.source, 'source');
  if (name === undefined) {
    if (raw.source === undefined) {
      collector.add(path, 'missing "source" (the name of an entry in "sources")');
    }
    return undefined;
  }

  const source = sources[name];
  if (source === undefined) {
    const declared = Object.keys(sources).join(', ');
    collector.add(
      `${path}.source`,
      `unknown source "${name}", declared sources are: ${declared === '' ? '(none)' : declared}`,
    );
    return undefined;
  }
  return { sourceName: name, source };
}

function parseRef(
  collector: IssueCollector,
  path: string,
  varName: string,
  raw: unknown,
  sources: SourceMap,
): VarRef | undefined {
  if (typeof raw === 'string') {
    collector.add(
      path,
      'must be an object such as { "source": "dev", "key": "my/secret", "property": "password" }; plain strings belong in "env"',
    );
    return undefined;
  }
  if (!isRecord(raw)) {
    collector.add(path, 'must be an object');
    return undefined;
  }

  collector.unknownKeys(path, raw, REF_KEYS);

  const bound = bindSource(collector, path, raw, sources);
  const key = collector.string(path, raw.key, 'key');
  if (key === undefined && raw.key === undefined) {
    collector.add(path, 'missing "key" (the secret name or ARN)');
  }

  const property = collector.string(path, raw.property, 'property');
  const versionStage = collector.string(path, raw.versionStage, 'versionStage');
  const versionId = collector.string(path, raw.versionId, 'versionId');

  let encoding: Encoding = 'utf8';
  if (raw.encoding !== undefined) {
    if (raw.encoding !== 'utf8' && raw.encoding !== 'base64') {
      collector.add(`${path}.encoding`, 'must be "utf8" or "base64"');
    } else {
      encoding = raw.encoding;
    }
  }

  let fallback: string | undefined;
  if (raw.default !== undefined) {
    if (typeof raw.default !== 'string') {
      collector.add(`${path}.default`, 'must be a string');
    } else {
      fallback = raw.default;
    }
  }

  if (bound === undefined || key === undefined) {
    return undefined;
  }

  return {
    varName,
    sourceName: bound.sourceName,
    source: bound.source,
    key,
    ...(property === undefined ? {} : { property }),
    ...(versionStage === undefined ? {} : { versionStage }),
    ...(versionId === undefined ? {} : { versionId }),
    ...(fallback === undefined ? {} : { fallback }),
    encoding,
    path,
  };
}

function parseBulkRef(
  collector: IssueCollector,
  path: string,
  raw: unknown,
  sources: SourceMap,
): BulkRef | undefined {
  if (!isRecord(raw)) {
    collector.add(path, 'must be an object such as { "source": "dev", "key": "my/secret", "prefix": "DB_" }');
    return undefined;
  }

  collector.unknownKeys(path, raw, BULK_KEYS);

  const bound = bindSource(collector, path, raw, sources);
  const key = collector.string(path, raw.key, 'key');
  if (key === undefined && raw.key === undefined) {
    collector.add(path, 'missing "key" (the secret name or ARN)');
  }
  const prefix = collector.string(path, raw.prefix, 'prefix');
  const versionStage = collector.string(path, raw.versionStage, 'versionStage');
  const versionId = collector.string(path, raw.versionId, 'versionId');

  if (bound === undefined || key === undefined) {
    return undefined;
  }

  return {
    sourceName: bound.sourceName,
    source: bound.source,
    key,
    ...(prefix === undefined ? {} : { prefix }),
    ...(versionStage === undefined ? {} : { versionStage }),
    ...(versionId === undefined ? {} : { versionId }),
    path,
  };
}

export function parseBlock(block: unknown, options: ParseOptions): ParsedBlock {
  const rootPath = options.rootPath ?? 'envRef';
  const collector = new IssueCollector();

  if (!isRecord(block)) {
    throw new ParseError([{ path: rootPath, message: 'must be an object' }]);
  }

  collector.unknownKeys(rootPath, block, BLOCK_KEYS);

  const local =
    block.sources === undefined
      ? {}
      : parseSources(collector, `${rootPath}.sources`, block.sources, options.schemas);
  const sources: SourceMap = { ...(options.settingsSources ?? {}), ...local };

  if (Object.keys(sources).length === 0) {
    collector.add(rootPath, 'needs at least one entry in "sources" (here or in the "envref.sources" setting)');
  }

  let target: EnvTarget | undefined;
  if (block.target !== undefined) {
    if (block.target !== 'env' && block.target !== 'environment') {
      collector.add(`${rootPath}.target`, 'must be "env" or "environment"');
    } else {
      target = block.target;
    }
  }

  const refs: VarRef[] = [];
  if (block.vars !== undefined) {
    if (!isRecord(block.vars)) {
      collector.add(`${rootPath}.vars`, 'must be an object mapping variable names to references');
    } else {
      for (const [varName, raw] of Object.entries(block.vars)) {
        const ref = parseRef(collector, `${rootPath}.vars.${varName}`, varName, raw, sources);
        if (ref !== undefined) {
          refs.push(ref);
        }
      }
    }
  }

  const bulk: BulkRef[] = [];
  if (block.varsFrom !== undefined) {
    if (!Array.isArray(block.varsFrom)) {
      collector.add(`${rootPath}.varsFrom`, 'must be an array of { source, key, prefix? } entries');
    } else {
      block.varsFrom.forEach((raw, index) => {
        const entry = parseBulkRef(collector, `${rootPath}.varsFrom[${index}]`, raw, sources);
        if (entry !== undefined) {
          bulk.push(entry);
        }
      });
    }
  }

  if (block.vars === undefined && block.varsFrom === undefined) {
    collector.add(rootPath, 'needs at least one of "vars" or "varsFrom"');
  }

  if (collector.issues.length > 0) {
    throw new ParseError(collector.issues);
  }

  return { refs, bulk, ...(target === undefined ? {} : { target }) };
}
