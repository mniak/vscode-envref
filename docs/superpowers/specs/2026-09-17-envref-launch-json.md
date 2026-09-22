# External Secrets for VS Code — Implementation Plan

> **Superseded on the name and the block shape** by
> `docs/superpowers/plans/2026-09-22-envref-rename-and-sources.md`, which renamed the extension to
> **EnvRef** and replaced the `externalSecrets` block — one set of defaults, provider config spread
> over the references — with an `envRef` block whose `vars` reference *named sources*. Read that plan
> for the current design. Everything here about the DAP, the abort-on-failure rule, the cache and the
> competing extensions still holds; the names and the block shape no longer do.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VS Code extension that, when you run or debug an application, resolves AWS Secrets
Manager references declared in `launch.json` and injects the values into environment variables —
the local equivalent of ExternalSecrets.

**Architecture:** A pure core (no `import 'vscode'`) parses the `externalSecrets` block, resolves
the secrets through a `SecretProvider` (dedupe + in-memory TTL cache) and merges the values into
the configuration's `env`/`environment`. The VS Code shell registers a `DebugConfigurationProvider`
for type `'*'` implementing `resolveDebugConfigurationWithSubstitutedVariables` (it runs *after*
variable substitution, so no secret value ever passes through the substitution engine) and returns
`undefined` to abort the launch on any failure. References live in a block that is a sibling of
`env`, not inside it, because the DAP allows extra attributes on `launch` — without the extension
installed the block is ignored and the session still starts.

**Tech Stack:** TypeScript 5.6, `@aws-sdk/client-secrets-manager` + `@aws-sdk/credential-providers`
3.700, esbuild (CJS bundle to `dist/extension.js`), vitest (unit), `@vscode/test-cli` +
`@vscode/test-electron` (integration, mocha `suite`/`test`), eslint 9 flat config, `@vscode/vsce`.

**Spec:** the "Spec — research and decisions" section of this document (there was no separate spec).

**Repo:** `~/Projects/mniak/vscode-external-secrets` (new, `master`).

## Global Constraints

- `engines.vscode`: `^1.85.0`; `activationEvents`: `["onDebug", "onCommand:externalSecrets.resolveInput"]`.
- Single provider in v1: `aws-sm`. Any other value is a configuration error — the `SecretProvider`
  interface exists so Vault/GCP/Azure can be added later without touching the resolver.
- **No secret value** in logs, telemetry, error messages or terminal titles. The logger only ever
  receives variable name, key, profile, region and status. `no-console: error` in eslint.
- Cache is **in memory only**, TTL configurable (default 300 s), never on disk nor in `SecretStorage`.
- Any failure aborts the launch (`return undefined`). Never start the app with a missing or empty
  variable.
- A reference's `default` applies only to *not-found* (missing secret or missing field); it never
  masks a credential or permission error.
- The `externalSecrets` block is removed from the configuration **before** returning it to the
  adapter, including when the launch is aborted.
- Modules under `src/refs`, `src/resolve`, `src/providers`, `src/aws` and `src/types.ts` must not
  import `vscode` (so they run under vitest); UI dependencies are injected (`Logger`).
- The exported `.env` is the only path that writes a secret to disk: behind an explicit modal
  confirmation and with `0600` permissions.

---

## Spec — research and decisions

Today, to run or debug locally an app that receives its credentials from ExternalSecrets in the
cluster, you have to copy the values into `launch.json`'s `env` or into a `.env`: plaintext secrets
on disk, accidentally committable, and stale as soon as the secret rotates.

No existing extension does the mapping we want:

| Solution | Why it doesn't fit |
|---|---|
| [SecretLoader](https://github.com/Maruf61/SecretLoader) (`KiviAS.secretloader`) | Bulk import from a CLI that prints JSON; no field → variable mapping. GPL-3.0, 19 commits, 0 stars |
| [Secret Resolver](https://marketplace.visualstudio.com/items?itemName=jochenseeber.vscode-secret-resolver) | The per-field reference model is the right one, but it is **1Password only**, requires the `op` CLI, and has no Windows support |
| [Keeper](https://github.com/Keeper-Security/keeper-vscode-extension) | Keeper vault only, via Keeper Commander CLI |
| [Doppler](https://docs.doppler.com/docs/vscode-extension), [Cloud Code](https://docs.cloud.google.com/code/docs/vscode/secret-manager) | In-editor management/autocomplete, not mapped injection at launch time |
| [vscode#200404](https://github.com/microsoft/vscode/issues/200404) | Request for native support, marked **out-of-scope** by Microsoft |

Decisions:

- **v1 backend**: AWS Secrets Manager (`provider: "aws-sm"`), behind an internal provider interface.
- **Syntax**: a dedicated `externalSecrets` block, one object per variable, provider stated explicitly.
- **Backward compatibility**: `launch` request arguments are "implementation specific" in the
  [DAP](https://microsoft.github.io/debug-adapter-protocol/specification) and adapters ignore
  unknown attributes — without the extension the block is dropped and the session starts. An object
  *inside* `env` would **not** degrade gracefully (the adapter would receive an object where it
  expects a string), which is why that shape was rejected.
- **Credentials**: cascade — variable > block > workspace/user settings > default credential chain.
- **Errors**: abort with per-variable detail and a button to run `aws sso login`.
- **Surfaces**: debug configurations, `tasks.json` (`${input:}`), integrated terminal, `.env` export.

### Contract

```jsonc
{
  "type": "go", "request": "launch", "name": "api", "program": "${workspaceFolder}/cmd/api",
  "env": { "LOG_LEVEL": "debug" },
  "externalSecrets": {
    "provider": "aws-sm", "profile": "dev-ext", "region": "us-east-1",
    "env": {
      "DB_PASSWORD": { "key": "dev-ext/cards/db", "property": "password" },
      "DB_HOST": { "key": "dev-ext/cards/db", "property": "host" },
      "PARTNER_TOKEN": { "key": "prod-nonpci/partner/token", "property": "value",
                         "profile": "prod-nonpci", "region": "eu-west-1" },
      "API_TOKEN": { "key": "dev-ext/cards/token" },
      "OPT": { "key": "dev-ext/cards/x", "default": "" }
    },
    "envFrom": [{ "key": "dev-ext/cards/env", "prefix": "APP_" }]
  }
}
```

Reference fields: `key` (required), `provider` (on the reference or on the block), `property`
(accepts a dotted path), `profile`, `region`, `versionStage` (defaults to `AWSCURRENT`),
`versionId`, `default`, `encoding` (`utf8` | `base64`). Block-level defaults: `provider`, `profile`,
`region`, `versionStage`, `versionId`, and `target` (`env` | `environment`).

## File Structure

```
src/
  types.ts                        # pure types + Logger + silentLogger (no vscode)
  refs/parse.ts                   # validates block/refs, applies defaults, ParseError with every issue
  refs/merge.ts                   # writes values into env (map) or environment (array)
  resolve/resolver.ts             # dedupe, TTL cache, property extraction, envFrom expansion
  providers/provider.ts           # SecretProvider, FetchRequest, FetchedSecret, ProviderError
  providers/awsSecretsManager.ts  # GetSecretValue + error classification
  aws/credentials.ts              # one client per profile+region, classifyAwsError
  aws/ssoLogin.ts                 # terminal running aws sso login
  log.ts                          # ChannelLogger (OutputChannel), redaction by construction
  ui/errors.ts                    # modal dialogs + open launch.json at the offending reference
  debug/configurationProvider.ts  # DebugConfigurationProvider for '*'
  commands/sources.ts             # named sets + launch configs, shared parse+resolve
  commands/{openTerminal,exportEnvFile,resolveInput}.ts
  extension.ts                    # activate: settings, provider and command registration, test API
test/
  unit/{parse,merge,resolver,credentials}.test.ts + fakeProvider.ts
  integration/extension.test.ts
  fixtures/workspace/{.vscode/launch.json,app.js}
```

---

### Task 1: Scaffold, tooling and types

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.mjs`, `eslint.config.mjs`, `vitest.config.ts`,
  `.vscode-test.mjs`, `.gitignore`, `.vscodeignore`, `src/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ProviderId = 'aws-sm'`, `SUPPORTED_PROVIDERS`, `Encoding = 'utf8' | 'base64'`,
  `EnvTarget = 'env' | 'environment'`, `FailureKind = 'auth' | 'access-denied' | 'not-found' | 'invalid' | 'other'`,
  `LogLevel`, `Logger { error|warn|info|debug(m: string): void }`, `silentLogger`,
  `SecretRef { varName, provider, key, property?, profile?, region?, versionStage?, versionId?, fallback?, encoding, source }`,
  `SecretBulkRef { provider, key, prefix?, profile?, region?, versionStage?, versionId?, source }`,
  `ParsedBlock { refs, bulk, target? }`, `BlockDefaults { provider?, profile?, region? }`,
  `ResolveFailure { kind, message, source, varName?, key, profile?, region? }`,
  `ResolveOutcome { values: Map<string, string>, failures: ResolveFailure[] }`.

- [ ] **Step 1: `git init` and `package.json`**

`publisher: "mniak"`, `main: "./dist/extension.js"`, `engines.vscode: "^1.85.0"`,
`activationEvents: ["onDebug", "onCommand:externalSecrets.resolveInput"]`, `categories: ["Debuggers","Other"]`,
deps `@aws-sdk/client-secrets-manager@^3.700.0` and `@aws-sdk/credential-providers@^3.700.0`,
devDeps `@types/node@^20.14`, `@types/vscode@^1.85`, `typescript@^5.6`, `eslint@^9`,
`@typescript-eslint/{parser,eslint-plugin}@^8`, `esbuild@^0.24`, `vitest@^2.1`,
`@vscode/test-cli@^0.0.15`, `@vscode/test-electron@^3.1`, `@vscode/vsce@^4`.

```json
"scripts": {
  "build": "node esbuild.mjs",
  "watch": "node esbuild.mjs --watch",
  "typecheck": "tsc --noEmit",
  "lint": "eslint src test",
  "test:unit": "vitest run",
  "test:integration": "tsc -p . && vscode-test",
  "test": "npm run lint && npm run typecheck && npm run test:unit",
  "package": "npm run build && vsce package",
  "vscode:prepublish": "node esbuild.mjs --production"
}
```

**Watch out:** `@vscode/test-electron` < 3 cannot find the VS Code binary on macOS
(`Contents/MacOS/Electron` is now `Code`) — it fails with `spawn ... ENOENT`. Use `^3.1`.

- [ ] **Step 2: `contributes` in `package.json`**

Commands `externalSecrets.clearCache` / `openTerminal` / `exportEnvFile` / `showLog` (titles
prefixed with `External Secrets:`) and the settings `externalSecrets.aws.profile`, `aws.region`,
`cache.ttlSeconds` (default 300), `log.level` (default `info`, enum error/warn/info/debug),
`terminal.namedSets` (object, each value shaped like the block).

- [ ] **Step 3: Tooling**

`tsconfig.json`: `target/lib ES2022`, `module`/`moduleResolution` `Node16`, `outDir "out"`,
`rootDir "."`, `strict`, `noUncheckedIndexedAccess`, `include: ["src","test"]`.
`esbuild.mjs`: entry `src/extension.ts` → `dist/extension.js`, `platform: 'node'`, `target: 'node18'`,
`format: 'cjs'`, `external: ['vscode']`, `--watch` and `--production` (minify) flags.
`vitest.config.ts`: `include: ['test/unit/**/*.test.ts']`, environment `node`.
`.vscode-test.mjs`: `files: 'out/test/integration/**/*.test.js'`,
`workspaceFolder: './test/fixtures/workspace'`, `mocha: { timeout: 30000 }`.
`eslint.config.mjs`: flat config with the TS parser, `no-console: 'error'`, `eqeqeq: 'error'`.
`.gitignore`: `node_modules/ dist/ out/ *.vsix .vscode-test/`.
`.vscodeignore`: `src/** test/** out/** .vscode/** .github/** node_modules/** *.map .gitignore *.vsix`
plus the config files.

- [ ] **Step 4: `src/types.ts`**

Types and `silentLogger` only; no `import 'vscode'` (vitest cannot resolve that module).

```ts
export type ProviderId = 'aws-sm';
export const SUPPORTED_PROVIDERS: ProviderId[] = ['aws-sm'];
export interface SecretRef {
  varName: string; provider: ProviderId; key: string; property?: string;
  profile?: string; region?: string; versionStage?: string; versionId?: string;
  fallback?: string; encoding: Encoding; source: string;
}
export const silentLogger: Logger = {
  error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined,
};
```

- [ ] **Step 5: `npm install` and `npm run typecheck`**

Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold TypeScript extension with esbuild, vitest and vscode-test"
```

---

### Task 2: Parsing the `externalSecrets` block

**Files:**
- Create: `src/refs/parse.ts`
- Test: `test/unit/parse.test.ts`

**Interfaces:**
- Consumes: `BlockDefaults`, `ParsedBlock`, `SecretRef`, `SecretBulkRef`, `SUPPORTED_PROVIDERS` (Task 1).
- Produces: `parseBlock(block: unknown, settings?: BlockDefaults, rootPath?: string): ParsedBlock`,
  `class ParseError extends Error { issues: ParseIssue[] }` (message = one `path: message` line per
  issue), `interface ParseIssue { path: string; message: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { ParseError, parseBlock } from '../../src/refs/parse';

it('applies block defaults and per-variable overrides', () => {
  const parsed = parseBlock({
    provider: 'aws-sm', profile: 'dev-ext', region: 'us-east-1',
    env: {
      DB_PASSWORD: { key: 'dev-ext/cards/db', property: 'password' },
      PARTNER_TOKEN: { key: 'p/t', property: 'value', profile: 'prod-nonpci', region: 'eu-west-1' },
    },
  });
  expect(parsed.refs[0]).toMatchObject({
    varName: 'DB_PASSWORD', provider: 'aws-sm', profile: 'dev-ext',
    region: 'us-east-1', encoding: 'utf8',
  });
  expect(parsed.refs[1]).toMatchObject({ profile: 'prod-nonpci', region: 'eu-west-1' });
});

it('reports the variable name when a reference is invalid', () => {
  let error: unknown;
  try {
    parseBlock({ provider: 'aws-sm', env: { DB_PASSWORD: { property: 'password' } } });
  } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(ParseError);
  expect((error as ParseError).message).toContain('externalSecrets.env.DB_PASSWORD');
  expect((error as ParseError).message).toContain('missing "key"');
});

it('rejects plain strings and points to env', () => {
  expect(() => parseBlock({ provider: 'aws-sm', env: { A: 'dev-ext/cards/db' } }))
    .toThrow(/plain strings belong in "env"/);
});

it('collects every issue at once', () => {
  let error: unknown;
  try {
    parseBlock({ provider: 'aws-sm', env: { A: { key: 'k', encoding: 'hex' }, B: {} } });
  } catch (caught) { error = caught; }
  expect((error as ParseError).issues).toHaveLength(2);
});
```

More cases, in the same file: settings as the fallback for `profile`/`region`; the block wins over
settings; `provider` only on the reference; `provider` missing in both places; `provider: 'vault'`
rejected; unknown field (`propery`) rejected; `envFrom` with and without `prefix`; a block with
neither `env` nor `envFrom`; invalid `target` and `target: 'environment'` accepted.

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run test/unit/parse.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/refs/parse"`.

- [ ] **Step 3: Implement `parse.ts`**

An `IssueCollector` accumulates every issue (`add`, `string`, `unknownKeys`, `provider`) and
`parseBlock` throws `ParseError` at the end, so the user sees all errors at once.

```ts
const BLOCK_KEYS = ['provider','profile','region','versionStage','versionId','env','envFrom','target'];
const REF_KEYS = ['provider','key','property','profile','region','versionStage','versionId','default','encoding'];
const BULK_KEYS = ['provider','key','prefix','profile','region','versionStage','versionId'];

export function parseBlock(block: unknown, settings: BlockDefaults = {}, rootPath = 'externalSecrets'): ParsedBlock
```

Rules: `default` becomes `fallback` on `SecretRef` (`default` is too reserved elsewhere in the
code); a string where an object is expected gets its own message (`plain strings belong in "env"`);
`encoding` defaults to `utf8`; each reference inherits `provider`/`profile`/`region`/`versionStage`/
`versionId` from the block, and the block inherits `profile`/`region` from settings; `source`
carries the reference path for error messages; at least one of `env`/`envFrom` is required.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run test/unit/parse.test.ts` — Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/refs/parse.ts test/unit/parse.test.ts
git commit -m "feat: parse and validate the externalSecrets block"
```

---

### Task 3: Merging into `env` and `environment`

**Files:**
- Create: `src/refs/merge.ts`
- Test: `test/unit/merge.test.ts`

**Interfaces:**
- Consumes: `EnvTarget`, `Logger`, `silentLogger` (Task 1).
- Produces: `detectTarget(config: Record<string, unknown>): EnvTarget`,
  `mergeValues(config: Record<string, unknown>, values: Map<string, string>, options?: { target?: EnvTarget; logger?: Logger }): MergeResult`,
  `interface MergeResult { target: EnvTarget; overridden: string[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('writes into env and reports overridden literals', () => {
  const config: Record<string, unknown> = { env: { LOG_LEVEL: 'debug', DB_PASSWORD: 'placeholder' } };
  const result = mergeValues(config, new Map([['DB_PASSWORD', 's3cr3t'], ['API_TOKEN', 't']]));
  expect(config['env']).toEqual({ LOG_LEVEL: 'debug', DB_PASSWORD: 's3cr3t', API_TOKEN: 't' });
  expect(result).toEqual({ target: 'env', overridden: ['DB_PASSWORD'] });
});

it('writes into the environment array when the adapter uses it', () => {
  const config: Record<string, unknown> = {
    environment: [{ name: 'LOG_LEVEL', value: 'debug' }, { name: 'DB_PASSWORD', value: 'placeholder' }],
  };
  const result = mergeValues(config, new Map([['DB_PASSWORD', 's3cr3t'], ['API_TOKEN', 't']]));
  expect(config['environment']).toEqual([
    { name: 'LOG_LEVEL', value: 'debug' },
    { name: 'DB_PASSWORD', value: 's3cr3t' },
    { name: 'API_TOKEN', value: 't' },
  ]);
  expect(result.target).toBe('environment');
  expect(config['env']).toBeUndefined();
});
```

More cases: creates `env` when it does not exist; an explicit `target` overrides detection;
`detectTarget({ environment: [] }) === 'environment'`, `detectTarget({}) === 'env'`.

- [ ] **Step 2: Run the tests and see them fail** — `npx vitest run test/unit/merge.test.ts`.

- [ ] **Step 3: Implement**

Mutate the configuration object in place; in the array form, replace existing entries preserving
order and append new ones at the end; `overridden` holds **names only** (never values) and is fed
to `logger.warn`.

- [ ] **Step 4: Run the tests and see them pass** — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/refs/merge.ts test/unit/merge.test.ts
git commit -m "feat: merge resolved values into env or environment"
```

---

### Task 4: Provider interface and resolver

**Files:**
- Create: `src/providers/provider.ts`, `src/resolve/resolver.ts`
- Test: `test/unit/resolver.test.ts`, `test/unit/fakeProvider.ts`

**Interfaces:**
- Consumes: `ParsedBlock`, `SecretRef`, `SecretBulkRef`, `ResolveOutcome`, `ResolveFailure`,
  `FailureKind`, `Logger` (Task 1); `parseBlock` (Task 2) in the tests.
- Produces: `interface FetchRequest { key, profile?, region?, versionStage?, versionId? }`,
  `type FetchedSecret = { kind: 'string'; value: string } | { kind: 'binary'; value: Uint8Array }`,
  `interface SecretProvider { readonly id: ProviderId; fetch(request: FetchRequest): Promise<FetchedSecret> }`,
  `class ProviderError extends Error { kind: FailureKind; hint?: string }`,
  `class SecretResolver { constructor(providers: Map<ProviderId, SecretProvider>, options?: { ttlMs?: number; now?: () => number; logger?: Logger }); resolve(block: ParsedBlock): Promise<ResolveOutcome>; setTtlMs(ms: number): void; clearCache(): void }`.

- [ ] **Step 1: Write the fake provider**

```ts
export class FakeProvider implements SecretProvider {
  readonly id: ProviderId = 'aws-sm';
  readonly calls: FetchRequest[] = [];
  constructor(private readonly entries: Record<string, FakeEntry>) {}
  async fetch(request: FetchRequest): Promise<FetchedSecret> {
    this.calls.push(request);
    const entry = this.entries[request.key];
    if (entry === undefined) throw new ProviderError('not-found', `Secret "${request.key}" was not found.`);
    if (entry.error !== undefined) throw new ProviderError(entry.error.kind, entry.error.message);
    if (entry.binary !== undefined) return { kind: 'binary', value: entry.binary };
    return { kind: 'string', value: entry.value ?? '' };
  }
  callsFor(key: string): FetchRequest[] { return this.calls.filter((call) => call.key === key); }
}
```

- [ ] **Step 2: Write the failing tests**

```ts
const DB_JSON = JSON.stringify({ password: 's3cr3t', host: 'db.internal', port: 5432, tls: true });

it('calls the provider once for two properties of the same secret', async () => {
  const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
  await resolverFor(provider).resolve(parseBlock({
    provider: 'aws-sm',
    env: { DB_PASSWORD: { key: 'dev/db', property: 'password' }, DB_HOST: { key: 'dev/db', property: 'host' } },
  }));
  expect(provider.callsFor('dev/db')).toHaveLength(1);
});

it('reuses the cache until the TTL expires', async () => {
  const provider = new FakeProvider({ 'dev/db': { value: DB_JSON } });
  let clock = 0;
  const resolver = new SecretResolver(providers(provider), { ttlMs: 1_000, now: () => clock });
  const block = parseBlock({ provider: 'aws-sm', env: { A: { key: 'dev/db', property: 'host' } } });
  await resolver.resolve(block);
  clock = 900; await resolver.resolve(block);
  expect(provider.callsFor('dev/db')).toHaveLength(1);
  clock = 1_500; await resolver.resolve(block);
  expect(provider.callsFor('dev/db')).toHaveLength(2);
  resolver.clearCache(); await resolver.resolve(block);
  expect(provider.callsFor('dev/db')).toHaveLength(3);
});

it('applies default only when the secret or field is missing', async () => {
  const provider = new FakeProvider({
    'dev/db': { value: DB_JSON },
    'dev/expired': { error: { kind: 'auth', message: 'token expired' } },
  });
  const outcome = await resolverFor(provider).resolve(parseBlock({
    provider: 'aws-sm',
    env: {
      MISSING_SECRET: { key: 'dev/nope', default: 'fallback' },
      MISSING_FIELD: { key: 'dev/db', property: 'nope', default: '' },
      AUTH_FAILED: { key: 'dev/expired', default: 'must-not-be-used' },
    },
  }));
  expect(outcome.values.get('MISSING_SECRET')).toBe('fallback');
  expect(outcome.values.get('MISSING_FIELD')).toBe('');
  expect(outcome.values.has('AUTH_FAILED')).toBe(false);
  expect(outcome.failures[0]).toMatchObject({ kind: 'auth', varName: 'AUTH_FAILED' });
});
```

More cases: `property` extraction and raw value; different profiles/regions do **not** share cache
entries (3 calls for 3 scopes); non-JSON secret → `kind: 'invalid'` with "is not JSON"; a missing
property lists the available fields (`password, host, port, tls`); dotted path (`a.b`);
`SecretBinary` with `encoding` `utf8`/`base64` (`[104,105]` → `hi` / `aGk=`); `envFrom` with a
prefix produces `DB_password`/`DB_host`/`DB_port`/`DB_tls` (numbers and booleans stringified); a
field that is not a valid variable name → `invalid`; unregistered provider → `invalid`.

- [ ] **Step 3: Run the tests and see them fail** — `npx vitest run test/unit/resolver.test.ts`.

- [ ] **Step 4: Implement `provider.ts` and `resolver.ts`**

The cache is a `Map<string, { expiresAt, promise }>` keyed by
`JSON.stringify([providerId, profile, region, key, versionStage, versionId])` — storing the
**promise** also dedupes concurrent calls; `promise.catch(() => cache.delete(key))` keeps failures
out of the cache. `resolve` fires references and `envFrom` through `Promise.all` and never throws:
it returns `{ values, failures }`. Extraction: with no `property`, decode directly; with one,
`JSON.parse` → exact key → dotted path; non-string values become `String(...)`/`JSON.stringify(...)`.
`fallback` only kicks in when the failure kind is `not-found`.

- [ ] **Step 5: Run the tests and see them pass** — 12 tests.

- [ ] **Step 6: Commit**

```bash
git add src/providers/provider.ts src/resolve/resolver.ts test/unit/resolver.test.ts test/unit/fakeProvider.ts
git commit -m "feat: resolve secret references with dedupe and TTL cache"
```

---

### Task 5: AWS Secrets Manager

**Files:**
- Create: `src/aws/credentials.ts`, `src/providers/awsSecretsManager.ts`
- Test: `test/unit/credentials.test.ts`

**Interfaces:**
- Consumes: `SecretProvider`, `FetchRequest`, `FetchedSecret`, `ProviderError` (Task 4).
- Produces: `interface ClientScope { profile?: string; region?: string }`,
  `class SecretsManagerClientFactory { get(scope: ClientScope): SecretsManagerClient; dispose(): void }`,
  `classifyAwsError(error: unknown): { kind: FailureKind; message: string }`,
  `class AwsSecretsManagerProvider implements SecretProvider { constructor(options?: { defaults?: ClientScope; factory?: SecretsManagerClientFactory; logger?: Logger }); setDefaults(d: ClientScope): void; dispose(): void }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('classifies credential and session problems as auth', () => {
  for (const name of ['CredentialsProviderError','ExpiredTokenException','UnrecognizedClientException','SSOTokenProviderFailure']) {
    expect(classifyAwsError(Object.assign(new Error('boom'), { name })).kind).toBe('auth');
  }
  expect(classifyAwsError(new Error('The SSO session associated with this profile has expired')).kind).toBe('auth');
});

it('reuses one client per profile and region', () => {
  const factory = new SecretsManagerClientFactory();
  const a = factory.get({ profile: 'dev', region: 'us-east-1' });
  expect(factory.get({ profile: 'dev', region: 'us-east-1' })).toBe(a);
  expect(factory.get({ profile: 'dev', region: 'eu-west-1' })).not.toBe(a);
  expect(factory.get({ profile: 'prod', region: 'us-east-1' })).not.toBe(a);
  factory.dispose();
});
```

More cases: `AccessDeniedException` → `access-denied`, `ResourceNotFoundException` → `not-found`,
`ValidationException` → `invalid`, `{ __type: 'ResourceNotFoundException' }` (error without
`name`), network error → `other`, a raw string preserves its message.

- [ ] **Step 2: Run the tests and see them fail** — `npx vitest run test/unit/credentials.test.ts`.

- [ ] **Step 3: Implement**

`fromIni({ profile, clientConfig: { region } })` when a profile is set, `fromNodeProviderChain()`
otherwise; clients cached by `profile|region`. In the provider, `GetSecretValueCommand` with
`VersionId` **or** `VersionStage` (never both), `SecretString` → `{ kind: 'string' }`,
`SecretBinary` → `{ kind: 'binary' }`, neither → `ProviderError('not-found', ...)`. Errors go
through `classifyAwsError` and gain a `hint`: `auth` → `Run "aws sso login --profile X"`,
`access-denied` → the profile and region that were used. The log records the call with
key/profile/region.

- [ ] **Step 4: Run the tests and see them pass** — 3 tests; `npm run typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add src/aws/credentials.ts src/providers/awsSecretsManager.ts test/unit/credentials.test.ts
git commit -m "feat: fetch secrets from AWS Secrets Manager with per-scope clients"
```

---

### Task 6: Redacted logging, error dialogs and `aws sso login`

**Files:**
- Create: `src/log.ts`, `src/ui/errors.ts`, `src/aws/ssoLogin.ts`

**Interfaces:**
- Consumes: `Logger`, `LogLevel`, `ResolveFailure` (Task 1).
- Produces: `class ChannelLogger implements Logger { constructor(channel: vscode.OutputChannel); setLevel(level: LogLevel): void; show(): void; failure(f: ResolveFailure): void }`,
  `reportFailures(title: string, failures: ResolveFailure[], logger: ChannelLogger, folder?: vscode.WorkspaceFolder): Promise<void>`,
  `reportError(title: string, detail: string, logger: ChannelLogger, folder?: vscode.WorkspaceFolder): Promise<void>`,
  `openLaunchJson(folder?: vscode.WorkspaceFolder, needle?: string): Promise<void>`,
  `runSsoLogin(profile: string | undefined): void`.

- [ ] **Step 1: `log.ts`**

Level filtering (`error < warn < info < debug`), lines shaped `[ISO] [level] message`. `failure()`
prints `source → varName: [kind] message (key=… profile=… region=…)` — its signature only accepts
`ResolveFailure`, so there is no code path by which a secret value reaches the channel.

- [ ] **Step 2: `ssoLogin.ts`**

Reuses the terminal named `aws sso login` if one exists and sends
`aws sso login --profile <profile>` (no `--profile` when the scope is the default chain).

- [ ] **Step 3: `ui/errors.ts`**

`showErrorMessage(title, { modal: true, detail }, ...actions)` with one `detail` line per variable
(`• DB_PASSWORD (dev-ext/cards/db) [profile dev-ext, region us-east-1]: …`). Buttons:
`Run aws sso login` when there is an `auth` failure; `Open launch.json` when there is a
`not-found`/`invalid` one (opens `.vscode/launch.json` and moves the cursor to the first occurrence
of the offending `key`, falling back to `workbench.action.debug.configure` when the file does not
exist); `Show Log` always.

- [ ] **Step 4: `npm run typecheck && npm run lint`** — Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/log.ts src/ui/errors.ts src/aws/ssoLogin.ts
git commit -m "feat: redacted output channel and actionable error dialogs"
```

---

### Task 7: Debug hook and activation

**Files:**
- Create: `src/debug/configurationProvider.ts`, `src/extension.ts`,
  `test/integration/extension.test.ts`, `test/fixtures/workspace/.vscode/launch.json`,
  `test/fixtures/workspace/app.js`, `.vscode/launch.json`, `.vscode/tasks.json`
- Modify: `package.json` (nothing new, just confirm the `contributes` from Task 1)

**Interfaces:**
- Consumes: `parseBlock`/`ParseError` (2), `mergeValues` (3), `SecretResolver` (4),
  `AwsSecretsManagerProvider`/`SecretsManagerClientFactory` (5), `ChannelLogger`/`reportFailures`/`reportError` (6).
- Produces: `BLOCK_KEY = 'externalSecrets'`,
  `class ExternalSecretsConfigurationProvider implements vscode.DebugConfigurationProvider` with
  `constructor(deps: { resolver: SecretResolver; logger: ChannelLogger; settings(folder: vscode.WorkspaceFolder | undefined): BlockDefaults })`,
  `activate(context): ExternalSecretsApi` with `ExternalSecretsApi { registerProvider(p: SecretProvider): void; clearCache(): void }`.

- [ ] **Step 1: Fixture workspace**

`test/fixtures/workspace/.vscode/launch.json` with two `node` configurations: "fixture with
secrets" (carrying the block, pointing at `fixture/db`) and "fixture without secrets".
`test/fixtures/workspace/app.js` writes to `process.stdout` when `DB_PASSWORD` is set
(`console.log` would violate the eslint `no-console` rule).

- [ ] **Step 2: Write the failing integration tests**

```ts
suite('External Secrets extension', () => {
  test('injects string values into env and hides the block from the adapter', async () => {
    const resolved = await providerFor().resolveDebugConfigurationWithSubstitutedVariables(
      vscode.workspace.workspaceFolders?.[0], fixtureConfig());
    assert.ok(resolved);
    assert.equal(BLOCK_KEY in resolved, false, 'the externalSecrets block reached the adapter');
    assert.deepEqual(resolved['env'], { LOG_LEVEL: 'debug', DB_PASSWORD: 's3cr3t' });
  });

  test('aborts the session when a secret cannot be resolved', async () => {
    const original = vscode.window.showErrorMessage;
    const shown: string[] = [];
    (vscode.window as any).showErrorMessage = async (m: string) => { shown.push(m); return undefined; };
    try {
      const resolved = await providerFor(true).resolveDebugConfigurationWithSubstitutedVariables(
        vscode.workspace.workspaceFolders?.[0], fixtureConfig());
      assert.equal(resolved, undefined, 'the session should have been aborted');
      assert.ok(shown[0]?.includes('was not started'));
    } finally { (vscode.window as any).showErrorMessage = original; }
  });
});

suite('Backward compatibility', () => {
  test('a debug adapter starts a session even with an unknown launch attribute', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const terminated = new Promise<void>((resolve) => {
      const s = vscode.debug.onDidTerminateDebugSession(() => { s.dispose(); resolve(); });
    });
    const started = await vscode.debug.startDebugging(folder!, {
      type: 'node', request: 'launch', name: 'unknown attribute',
      program: `${folder!.uri.fsPath}/app.js`, internalConsoleOptions: 'neverOpen',
      unknownAttributeThatNoAdapterKnows: { env: { A: { key: 'k' } } },
    } as vscode.DebugConfiguration);
    assert.equal(started, true, 'the adapter refused a configuration with an unknown attribute');
    await terminated;
  });
});
```

More cases: the extension activates and all 5 commands are registered; `collectSources` finds the
block in the fixture `launch.json` and skips the configuration without one; a configuration with no
block comes back identical (`===`); an invalid block reports "invalid configuration" without calling
the provider. The test's `StubProvider` is a local `SecretProvider` with `id: 'aws-sm'` — the test
builds `ExternalSecretsConfigurationProvider` directly, with a real `SecretResolver`.

- [ ] **Step 3: Run the tests and see them fail** — `npm run test:integration`.

- [ ] **Step 4: Implement `configurationProvider.ts`**

```ts
async resolveDebugConfigurationWithSubstitutedVariables(folder, config) {
  const record = config as unknown as Record<string, unknown>;
  const block = record[BLOCK_KEY];
  if (block === undefined) return config;      // no block: never touches AWS
  delete record[BLOCK_KEY];                    // never travels to the adapter
  // parse → reportError + undefined; resolve → reportFailures + undefined; mergeValues → config
}
```

Only `...WithSubstitutedVariables` is implemented: running after substitution means a
`${workspaceFolder}` inside a `key` arrives already resolved, and no secret value passes through
the substitution engine.

- [ ] **Step 5: Implement `extension.ts`**

Creates the `OutputChannel` + `ChannelLogger`, the `SecretsManagerClientFactory`, the
`AwsSecretsManagerProvider` and the `SecretResolver`; applies `log.level` and `cache.ttlSeconds` and
re-applies them on `onDidChangeConfiguration`; builds `settingsFor(folder)` with
`getConfiguration('externalSecrets', folder ?? null)` (per-folder settings); registers the provider
via `registerDebugConfigurationProvider('*', …)`, the `clearCache`/`showLog` commands, and returns
the `{ registerProvider, clearCache }` API — used by the tests and by a future Vault/GCP provider.
The factory's `dispose` goes into `context.subscriptions`.

- [ ] **Step 6: Run the tests and see them pass**

Run: `npm run test:integration`
Expected: 7 passing. Also `.vscode/launch.json` with the `Run Extension` (F5, with
`preLaunchTask: "npm: build"`) and `Integration Tests` configurations, and `.vscode/tasks.json`
with `npm: build`/`watch`.

- [ ] **Step 7: Commit**

```bash
git add src/debug src/extension.ts test/integration test/fixtures .vscode
git commit -m "feat: resolve secrets on launch and abort the session on failure"
```

---

### Task 8: `tasks.json`, terminal and `.env` export

**Files:**
- Create: `src/commands/sources.ts`, `src/commands/openTerminal.ts`,
  `src/commands/exportEnvFile.ts`, `src/commands/resolveInput.ts`
- Modify: `src/extension.ts` (register the three commands with the same `CommandDeps`)

**Interfaces:**
- Consumes: `parseBlock`/`ParseError` (2), `SecretResolver` (4), `ChannelLogger`/`reportFailures`/`reportError` (6).
- Produces: `interface CommandDeps { resolver: SecretResolver; logger: ChannelLogger; settings(folder): BlockDefaults }`,
  `interface SecretSource { label: string; description: string; block: unknown; folder?: vscode.WorkspaceFolder }`,
  `pickFolder()`, `collectSources(folder)`, `pickSource(sources)`,
  `resolveSource(source, deps): Promise<Map<string, string> | undefined>`,
  `openTerminal(deps)`, `exportEnvFile(deps)`, `resolveInput(deps, args): Promise<string | undefined>`.

- [ ] **Step 1: `sources.ts`**

`collectSources` combines `externalSecrets.terminal.namedSets` (`description: 'named set'`) with the
configurations from `getConfiguration('launch', folder).get('configurations')` that carry the block
(`description: 'launch configuration'`). `resolveSource` centralizes parse + resolve + error
reporting, so all three commands behave exactly like F5.

- [ ] **Step 2: `openTerminal.ts`**

`createTerminal({ name: 'secrets: <label>', cwd: folder.uri, env: Object.fromEntries(values) })`.
The log records variable **names** only.

- [ ] **Step 3: `exportEnvFile.ts`**

`showSaveDialog` (defaults to `<folder>/.env`) → modal confirmation naming the path and "Never
commit this file" → resolve → write `KEY="value"` escaping `\`, `"`, `\n`, `\r` → `chmod 0o600`
(via `import('node:fs/promises')`, skipped when the scheme is not `file`) → if the file is not in
`.gitignore`, offer to add it.

- [ ] **Step 4: `resolveInput.ts`**

Accepts either a raw reference in `args` (`{ provider, key, property, … }`, wrapped as
`{ env: { value: <args> } }`) or a full block with `env`/`envFrom`; requires exactly one reference;
returns `undefined` (cancelling the `${input:}`) after reporting the error.

- [ ] **Step 5: Register in `extension.ts`**

```ts
const deps: CommandDeps = { resolver, logger, settings: settingsFor };
vscode.commands.registerCommand('externalSecrets.openTerminal', () => openTerminal(deps)),
vscode.commands.registerCommand('externalSecrets.exportEnvFile', () => exportEnvFile(deps)),
vscode.commands.registerCommand('externalSecrets.resolveInput', (args: unknown) => resolveInput(deps, args)),
```

- [ ] **Step 6: Run everything**

Run: `npm test && npm run test:integration`
Expected: 33 unit + 7 integration tests passing (the "activates and exposes its commands" test
covers all five registered commands).

- [ ] **Step 7: Commit**

```bash
git add src/commands src/extension.ts
git commit -m "feat: terminal, .env export and tasks.json input surfaces"
```

---

### Task 9: Documentation, CI and packaging

**Files:**
- Create: `README.md`, `CHANGELOG.md`, `LICENSE`, `.github/workflows/ci.yml`
- Modify: `.vscodeignore` (add `.gitignore` and `*.vsix`)

**Interfaces:** none.

- [ ] **Step 1: README**

Go/Node/Python examples of the block; a table of the reference fields; `envFrom`; a note about
adapters that use an `environment` array; the credential cascade; a table of the settings; the three
extra surfaces (with the full `tasks.json` `inputs` snippet); a security section; and the schema
caveat: some debuggers ship a closed schema, so `launch.json` may show
`Property externalSecrets is not allowed`
([vscode#48844](https://github.com/microsoft/vscode/issues/48844)) — cosmetic only, the DAP accepts
the extra attribute at runtime.

- [ ] **Step 2: CHANGELOG 0.1.0 and LICENSE (MIT)**

- [ ] **Step 3: CI**

`.github/workflows/ci.yml` on `ubuntu-latest`, Node 20, `npm ci`, `lint`, `typecheck`, `test:unit`,
`build` and `xvfb-run -a npm run test:integration` (the test host needs a display).

- [ ] **Step 4: Package**

Run: `npm run package`
Expected: `vscode-external-secrets-0.1.0.vsix` (production bundle ~460 KB). Check the VSIX file
list: only `package.json`, `readme.md`, `changelog.md`, `LICENSE.txt` and `dist/extension.js`.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md LICENSE .github .vscodeignore
git commit -m "docs: README, changelog, license and CI"
```

---

## Verification

Automated (all green on 2026-09-17):

```bash
npm test                  # lint + typecheck + 33 unit tests
npm run test:integration  # 7 tests in a real VS Code host
npm run package           # produces the .vsix
```

Relevant coverage: dedupe (1 call for 2 properties), TTL and `clearCache`, `default` only on
not-found, non-JSON secret, the message listing available fields, `envFrom` with and without a
prefix, the `variable > block > settings` cascade, one client per `profile+region`, `env` reaching
the adapter with strings only, the block absent from the final configuration, a failure aborting the
session, and the `node` adapter starting with an unknown launch attribute (the test that proves
backward compatibility).

Manual (needs real credentials):

1. `F5` → Extension Development Host over a Go project that prints `os.Getenv`, pointing at a
   `dev-ext` secret; compare against
   `aws secretsmanager get-secret-value --secret-id <key> --profile <profile>`.
2. Error scenarios: a profile with no SSO session (the `Run aws sso login` button appears and
   works), a nonexistent `key`, a nonexistent `property`, the wrong region.
3. Repeat the F5 on Node (`node`), Python (`debugpy`) and a `cppdbg` configuration using the
   `environment` array.
4. Two variables in the same configuration with different profiles and regions.
5. **With the extension disabled**, press F5 on the same configuration in Go/Node/Python and
   confirm the session starts (block ignored, no adapter error).
6. Check the output channel to confirm no secret value appears, including on failures.

## Known trade-offs

- **The `launch.json` schema warning** (vscode#48844): cosmetic, documented in the README.
- **Without the extension the variables simply do not exist** — the app starts and fails (or falls
  back to its own default) on its own. The requirement satisfied is "VS Code starts normally,
  ignoring the block".
- `console: "integratedTerminal"` receives `env` through the `runInTerminal` request, so no value
  is exposed on a command line — there is no need to rewrite the command.
- The exported `.env` is the only surface that writes a secret to disk, and it sits behind an
  explicit confirmation.

## Status

Implemented on 2026-09-17 (tasks 1–9), `npm test` and `npm run test:integration` green, `.vsix`
produced. Outside the scope of this plan: manual verification against real AWS, the decision to
publish on the Marketplace or distribute the `.vsix` internally, and the initial commit (nothing has
been committed yet).
