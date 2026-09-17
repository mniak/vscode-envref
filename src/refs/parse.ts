import {
  BlockDefaults,
  Encoding,
  EnvTarget,
  ParsedBlock,
  ProviderId,
  SUPPORTED_PROVIDERS,
  SecretBulkRef,
  SecretRef,
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

const BLOCK_KEYS = ['provider', 'profile', 'region', 'versionStage', 'versionId', 'env', 'envFrom', 'target'];
const REF_KEYS = ['provider', 'key', 'property', 'profile', 'region', 'versionStage', 'versionId', 'default', 'encoding'];
const BULK_KEYS = ['provider', 'key', 'prefix', 'profile', 'region', 'versionStage', 'versionId'];

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

  provider(path: string, value: unknown, fallback: ProviderId | undefined): ProviderId | undefined {
    const raw = this.string(path, value, 'provider');
    if (raw === undefined) {
      if (value !== undefined && value !== null) {
        return undefined;
      }
      if (fallback === undefined) {
        this.add(path, 'missing "provider" (set it on the reference or on the externalSecrets block)');
        return undefined;
      }
      return fallback;
    }
    if (!SUPPORTED_PROVIDERS.includes(raw as ProviderId)) {
      this.add(`${path}.provider`, `unsupported provider "${raw}", expected one of: ${SUPPORTED_PROVIDERS.join(', ')}`);
      return undefined;
    }
    return raw as ProviderId;
  }
}

function parseRef(
  collector: IssueCollector,
  path: string,
  varName: string,
  raw: unknown,
  defaults: BlockDefaults,
): SecretRef | undefined {
  if (typeof raw === 'string') {
    collector.add(
      path,
      'must be an object such as { "provider": "aws-sm", "key": "my/secret", "property": "password" }; plain strings belong in "env"',
    );
    return undefined;
  }
  if (!isRecord(raw)) {
    collector.add(path, 'must be an object');
    return undefined;
  }

  collector.unknownKeys(path, raw, REF_KEYS);

  const provider = collector.provider(path, raw.provider, defaults.provider);
  const key = collector.string(path, raw.key, 'key');
  if (key === undefined && raw.key === undefined) {
    collector.add(path, 'missing "key" (the secret name or ARN)');
  }

  const property = collector.string(path, raw.property, 'property');
  const profile = collector.string(path, raw.profile, 'profile') ?? defaults.profile;
  const region = collector.string(path, raw.region, 'region') ?? defaults.region;
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

  if (provider === undefined || key === undefined) {
    return undefined;
  }

  return {
    varName,
    provider,
    key,
    property,
    profile,
    region,
    versionStage,
    versionId,
    fallback,
    encoding,
    source: path,
  };
}

function parseBulkRef(
  collector: IssueCollector,
  path: string,
  raw: unknown,
  defaults: BlockDefaults,
): SecretBulkRef | undefined {
  if (!isRecord(raw)) {
    collector.add(path, 'must be an object such as { "key": "my/secret", "prefix": "DB_" }');
    return undefined;
  }

  collector.unknownKeys(path, raw, BULK_KEYS);

  const provider = collector.provider(path, raw.provider, defaults.provider);
  const key = collector.string(path, raw.key, 'key');
  if (key === undefined && raw.key === undefined) {
    collector.add(path, 'missing "key" (the secret name or ARN)');
  }
  const prefix = collector.string(path, raw.prefix, 'prefix');

  if (provider === undefined || key === undefined) {
    return undefined;
  }

  return {
    provider,
    key,
    prefix,
    profile: collector.string(path, raw.profile, 'profile') ?? defaults.profile,
    region: collector.string(path, raw.region, 'region') ?? defaults.region,
    versionStage: collector.string(path, raw.versionStage, 'versionStage'),
    versionId: collector.string(path, raw.versionId, 'versionId'),
    source: path,
  };
}

export function parseBlock(block: unknown, settings: BlockDefaults = {}, rootPath = 'externalSecrets'): ParsedBlock {
  const collector = new IssueCollector();

  if (!isRecord(block)) {
    throw new ParseError([{ path: rootPath, message: 'must be an object' }]);
  }

  collector.unknownKeys(rootPath, block, BLOCK_KEYS);

  const defaults: BlockDefaults = {
    provider:
      block.provider === undefined
        ? settings.provider
        : collector.provider(rootPath, block.provider, undefined),
    profile: collector.string(rootPath, block.profile, 'profile') ?? settings.profile,
    region: collector.string(rootPath, block.region, 'region') ?? settings.region,
  };

  let target: EnvTarget | undefined;
  if (block.target !== undefined) {
    if (block.target !== 'env' && block.target !== 'environment') {
      collector.add(`${rootPath}.target`, 'must be "env" or "environment"');
    } else {
      target = block.target;
    }
  }

  const refs: SecretRef[] = [];
  if (block.env !== undefined) {
    if (!isRecord(block.env)) {
      collector.add(`${rootPath}.env`, 'must be an object mapping variable names to secret references');
    } else {
      for (const [varName, raw] of Object.entries(block.env)) {
        const ref = parseRef(collector, `${rootPath}.env.${varName}`, varName, raw, defaults);
        if (ref !== undefined) {
          refs.push(ref);
        }
      }
    }
  }

  const bulk: SecretBulkRef[] = [];
  if (block.envFrom !== undefined) {
    if (!Array.isArray(block.envFrom)) {
      collector.add(`${rootPath}.envFrom`, 'must be an array of { key, prefix? } entries');
    } else {
      block.envFrom.forEach((raw, index) => {
        const entry = parseBulkRef(collector, `${rootPath}.envFrom[${index}]`, raw, defaults);
        if (entry !== undefined) {
          bulk.push(entry);
        }
      });
    }
  }

  if (block.env === undefined && block.envFrom === undefined) {
    collector.add(rootPath, 'needs at least one of "env" or "envFrom"');
  }

  if (collector.issues.length > 0) {
    throw new ParseError(collector.issues);
  }

  return { refs, bulk, target };
}
