# EnvRef — Rename and Named Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the extension from "External Secrets" to **EnvRef** and replace the single-defaults `externalSecrets` block with an `envRef` block whose references point at *named sources*, so one launch configuration can pull variables from several accounts, regions or providers at once.

**Architecture:** The block gains a `sources` map — each entry is a name bound to a provider plus that provider's own configuration. Every reference in `vars`/`varsFrom` carries a mandatory `source` naming one of those entries; there is no inline provider config and no default source. `ProviderId` opens from the `'aws-sm'` literal to `string`, and each `SecretProvider` declares `configKeys` so the parser can validate a source's fields against the provider that will consume them. The resolver keeps its dedupe + TTL cache unchanged in shape, keying on the resolved source config instead of loose `profile`/`region`.

**Tech Stack:** TypeScript 5.6, `@aws-sdk/client-secrets-manager` + `@aws-sdk/credential-providers` 3.700, esbuild (CJS bundle to `dist/extension.js`), vitest (unit), `@vscode/test-cli` + `@vscode/test-electron` (integration, mocha `suite`/`test`), eslint 9 flat config, `@vscode/vsce`.

**Spec:** `docs/superpowers/specs/2026-09-17-envref-launch-json.md` — the original spec, which this plan supersedes on naming and on the block shape. The superseding decisions are reproduced verbatim in "Spec delta" below, so this plan is self-contained.

## Spec delta

These six decisions override the original spec. Every task's requirements implicitly include them.

1. **Name is EnvRef.** Verified free on the VS Code Marketplace, npm, and GitHub (2026-09-22). Rejected `external-secrets` because it is the name of the CNCF project `external-secrets/external-secrets` (6.9k stars, Apache-2.0, `external-secrets.io`) and because the extension is not secrets-specific: planned sources include KeePass, chezmoi and `.env` files, which do not use "secret" vocabulary.
2. **Block key is `envRef`, singular.** The block is a configuration object (`sources` + `vars` + `varsFrom` + `target`), not a collection; the plural lives on the collections inside it.
3. **Named sources (option A).** `sources` maps a name to `{ provider, ...provider-specific config }`. Rejected the alternative of an array of grouped blocks, because a source name is declarable once and reusable from settings, and because provider-specific fields belong on the source rather than beside `vars`.
4. **`source` is the reference field, and it is always required.** No inline `provider`/`profile`/`region` on a reference, and no default source — not even when exactly one source is declared.
5. **`versionStage` and `versionId` are per-reference only.** They are removed from the block level, where the old `parseBlock` accepted them but never applied them — a latent bug that disappears with this change.
6. **`provider`, `profile` and `region` exist only inside a `sources` entry.** They are no longer valid at block level or on a reference.

## Global Constraints

- `engines.vscode`: `^1.85.0`. `activationEvents`: `["onDebug", "onCommand:envref.resolveInput"]`.
- Extension id `mniak.vscode-envref`; `displayName` `EnvRef`; all user-visible strings use the prefix `EnvRef:`.
- Settings namespace is `envref`. Commands are `envref.clearCache`, `envref.showLog`, `envref.openTerminal`, `envref.exportEnvFile`, `envref.resolveInput`.
- **No secret value** in logs, telemetry, error messages or terminal titles. The logger only ever receives variable name, key, source name, source config and status. `no-console: error` stays in eslint.
- Cache is **in memory only**, TTL configurable (default 300 s), never on disk nor in `SecretStorage`.
- Any failure aborts the launch (`return undefined`). Never start the app with a missing or empty variable.
- A reference's `default` applies only to *not-found* (missing secret or missing field); it never masks a credential or permission error.
- The `envRef` block is removed from the configuration **before** returning it to the adapter, including when the launch is aborted.
- Modules under `src/refs`, `src/resolve`, `src/providers`, `src/aws` and `src/types.ts` must not import `vscode`.
- The exported `.env` remains the only path that writes a value to disk: explicit modal confirmation, `0600`.
- **Optional properties use the repo's conditional-spread idiom** (`...(x === undefined ? {} : { x })`). Do not assign `undefined` to an optional property.
- **`npm run typecheck` is expected to fail from Task 1 through Task 4** and must pass from Task 5 onward. Unit tests run under vitest/esbuild, which does not typecheck, so each of Tasks 1-4 still ends with its own test file green.
- Version stays `0.1.0` and the CHANGELOG keeps a single `0.1.0` entry: nothing was ever published, so there is no breaking change to announce.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `src/types.ts` | Vocabulary: `SourceConfig`, `SourceMap`, `VarRef`, `BulkRef`, `ParsedBlock`, `ResolveFailure`. `ProviderId` is `string`. |
| `src/providers/provider.ts` | `SecretProvider` (now with `configKeys`), `FetchRequest` (now carries `config`), `ProviderError`. |
| `src/providers/awsSecretsManager.ts` | Reads `profile`/`region` out of `request.config`. |
| `src/refs/parse.ts` | Parses `sources` first, then resolves each reference's `source` against the merged map. |
| `src/config/defaults.ts` | `sourcesFromSettings` — parses the `envref.sources` setting into a `SourceMap`. |
| `src/resolve/resolver.ts` | `EnvRefResolver`: dedupe + TTL cache keyed on provider + source config + key + version. |
| `src/debug/configurationProvider.ts` | `EnvRefConfigurationProvider`, `BLOCK_KEY = 'envRef'`. |
| `src/commands/sets.ts` *(was `sources.ts`)* | Collecting/picking/resolving a **set** of variables (launch config or named set). Renamed to free the word "source". |
| `src/log.ts`, `src/ui/errors.ts` | Report `failure.path`, `failure.sourceName`, and read `config['profile']` for the SSO action. |
| `src/extension.ts` | Wiring, `envref` settings, 5 command registrations, `EnvRefApi`. |

Three distinct meanings of "source" collide today; this plan assigns each its own word:

| Meaning | Before | After |
|---|---|---|
| JSON path of a reference, for error messages | `SecretRef.source`, `ResolveFailure.source` | **`path`** |
| Origin of a *configuration* (launch config or named set) | `SecretSource`, `collectSources`, `pickSource`, `resolveSource` | **`VarSet`**, `collectSets`, `pickSet`, `resolveSet` in `src/commands/sets.ts` |
| Origin of *values* (an account, a vault, a file) | — | **`source`** / `sources` |

## Target block shape

```jsonc
"envRef": {
  "sources": {
    "dev":     { "provider": "aws-sm", "profile": "sandbox-proj1", "region": "us-east-1" },
    "partner": { "provider": "aws-sm", "profile": "sandbox-proj2", "region": "eu-west-1" }
  },
  "vars": {
    "DB_PASSWORD":   { "source": "dev",     "key": "sandbox/app/db", "property": "password" },
    "DB_HOST":       { "source": "dev",     "key": "sandbox/app/db", "property": "host" },
    "PARTNER_TOKEN": { "source": "partner", "key": "partner/token" }
  },
  "varsFrom": [{ "source": "dev", "key": "sandbox/app/env", "prefix": "DB_" }],
  "target": "env"
}
```

Reference fields: `source` (required), `key` (required), `property`, `versionStage`, `versionId`, `default`, `encoding`; `varsFrom` entries take `prefix` instead of `property`/`default`/`encoding`.

## Settings

| Before | After |
|---|---|
| `externalSecrets.aws.profile`, `externalSecrets.aws.region` | **`envref.sources`** — object, default `{}`. Same shape as the block's `sources`. Merged with the block's, block wins on name collision. |
| `externalSecrets.cache.ttlSeconds` | `envref.cache.ttlSeconds` (unchanged semantics) |
| `externalSecrets.log.level` | `envref.log.level` (unchanged semantics) |
| `externalSecrets.terminal.namedSets` | `envref.namedSets` (drops `terminal.`: it serves the terminal *and* the `.env` export) |

`envref.sources` is load-bearing, not cosmetic: with `source` mandatory and no inline config, it is what keeps `tasks.json` inputs terse.

---

### Task 1: Vocabulary and provider schema

**Files:**
- Modify: `src/types.ts` (rewrite of the vocabulary section)
- Modify: `src/providers/provider.ts`
- Modify: `src/providers/awsSecretsManager.ts`
- Create: `test/unit/awsProvider.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ProviderId = string`; `SourceConfig { provider: ProviderId; config: Record<string, string> }`; `SourceMap = Record<string, SourceConfig>`; `VarRef { varName, sourceName, source, key, property?, versionStage?, versionId?, fallback?, encoding, path }`; `BulkRef { sourceName, source, key, prefix?, versionStage?, versionId?, path }`; `ParsedBlock { refs: VarRef[]; bulk: BulkRef[]; target?: EnvTarget }`; `ResolveFailure { kind, message, path, varName?, key, sourceName, config }`; `FetchRequest { key, config, versionStage?, versionId? }`; `SecretProvider { id, configKeys, fetch }`; `AwsSecretsManagerProvider.scopeOf(request: FetchRequest): ClientScope`.

- [ ] **Step 1: Write the failing test** — `test/unit/awsProvider.test.ts` asserting `configKeys === ['profile','region']`, that `scopeOf` reads profile/region from `request.config`, and that an empty config yields an empty scope.
- [ ] **Step 2: Run it and watch it fail** — `npx vitest run test/unit/awsProvider.test.ts`
- [ ] **Step 3: Rewrite the vocabulary in `src/types.ts`** — delete `SUPPORTED_PROVIDERS`, `SecretRef`, `SecretBulkRef`, `BlockDefaults`; add `SourceConfig`, `SourceMap`, `VarRef`, `BulkRef`; `ResolveFailure.source` becomes `path` and gains `sourceName` + `config`. `ResolveOutcome`, `LogLevel`, `Logger`, `silentLogger` unchanged.
- [ ] **Step 4: Add `config` to `FetchRequest` and `configKeys` to `SecretProvider`**
- [ ] **Step 5: Read the scope out of `request.config`** in `AwsSecretsManagerProvider`, keeping `this.defaults` as the fallback and the conditional-spread idiom.
- [ ] **Step 6: Run the test and watch it pass** (3 tests)
- [ ] **Step 7: Commit** — `refactor: carry provider config on the fetch request`

---

### Task 2: Parse `sources` and resolve references against them

**Files:**
- Modify: `src/refs/parse.ts` (full rewrite)
- Modify: `test/unit/parse.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `SourceConfig`, `SourceMap`, `VarRef`, `BulkRef`, `ParsedBlock`, `Encoding`, `EnvTarget` (Task 1).
- Produces: `ProviderSchema { configKeys: readonly string[] }`; `ParseOptions { schemas: Map<ProviderId, ProviderSchema>; settingsSources?: SourceMap; rootPath?: string }`; `parseBlock(block: unknown, options: ParseOptions): ParsedBlock`; `ParseError` with `issues`.

Keep `ParseIssue`, `ParseError`, `IssueCollector.string` and `IssueCollector.unknownKeys`; delete `IssueCollector.provider`. `BLOCK_KEYS` becomes `['sources','vars','varsFrom','target']`, `REF_KEYS` gains `source` and loses `provider`/`profile`/`region`, same for `BULK_KEYS`.

- [ ] **Step 1: Write the failing test** — 19 cases: binding to a named source, settings sources, block shadowing settings, `source` required, no defaulting to a lone source, unknown source listing the declared ones, provider config rejected on a reference, at least one source required, unknown provider listing the registered ones, unknown source field, provider required per source, variable name in the error path, plain strings rejected, all issues collected at once, `varsFrom` with/without prefix, `vars` or `varsFrom` required, `versionStage` rejected at block level, `versionStage`/`versionId` kept on the reference, `target` validation.
- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Rewrite `src/refs/parse.ts`** — `parseSources` validates each entry against its provider's `configKeys`; `bindSource` resolves `source` and reports the declared names when it misses; `parseRef`/`parseBulkRef` no longer merge defaults; `parseBlock` merges `settingsSources` under the block's own.
- [ ] **Step 4: Run the test and watch it pass** (19 tests)
- [ ] **Step 5: Commit** — `feat: reference secrets through named sources`

---

### Task 3: Parse the `envref.sources` setting

**Files:**
- Modify: `src/config/defaults.ts` (full rewrite)
- Modify: `test/unit/defaults.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `SourceMap`, `ProviderId` (Task 1); `ProviderSchema` (Task 2).
- Produces: `sourcesFromSettings(raw: unknown, schemas: Map<ProviderId, ProviderSchema>): SourceMap`; `nonEmptyString` (kept).

Settings are user input and may be malformed, so this never throws: a bad entry is skipped rather than aborting a launch that may not even use it. Malformed *block* sources still throw, via Task 2.

- [ ] **Step 1: Write the failing test** — 7 cases: well-formed entry, entry with no provider config, unknown provider dropped, unusable provider dropped, unaccepted fields ignored, blank/non-string values dropped, non-object input yields `{}`.
- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Rewrite `src/config/defaults.ts`**
- [ ] **Step 4: Run the test and watch it pass** (7 tests)
- [ ] **Step 5: Commit** — `feat: declare reusable sources in settings`

---

### Task 4: Key the resolver cache on the source config

**Files:**
- Modify: `src/resolve/resolver.ts`
- Modify: `test/unit/resolver.test.ts`
- Modify: `test/unit/fakeProvider.ts`

**Interfaces:**
- Consumes: `VarRef`, `BulkRef`, `SourceConfig`, `ParsedBlock`, `ResolveFailure` (Task 1); `parseBlock`/`ProviderSchema` (Task 2).
- Produces: `EnvRefResolver` with `setTtlMs`, `clearCache`, `resolve(block)`, and `schemas(): Map<ProviderId, ProviderSchema>` — how the vscode shell hands provider metadata to `parseBlock` without a second registry, including providers added through the public `registerProvider` API.

- [ ] **Step 1: Write the failing test** — `fakeProvider` gains `configKeys` and exports a `schemas` map; every `parseBlock` call moves to `{ sources, vars }`. Two cache cases: three differently-configured sources cause three fetches; two identically-configured sources share one.
- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Adapt the resolver** — rename to `EnvRefResolver`, add `schemas()`, `fetch(source, request)` keyed on the sorted config entries, `requestOf` passes `ref.source.config`, `toFailure(error, ref, varName?)` carries `path`/`sourceName`/`config`, and the two hints mention `vars`/`varsFrom`.
- [ ] **Step 4: Run the test and watch it pass** (13 tests)
- [ ] **Step 5: Run the whole unit suite** — 6 files, 43 tests. `typecheck` still red; Task 5 closes it.
- [ ] **Step 6: Commit** — `refactor: key the cache on the resolved source`

---

### Task 5: Rename the VS Code shell

**Files:**
- Modify: `src/debug/configurationProvider.ts`
- Rename: `src/commands/sources.ts` → `src/commands/sets.ts` (`git mv`)
- Modify: `src/commands/openTerminal.ts`, `src/commands/exportEnvFile.ts`, `src/commands/resolveInput.ts`
- Modify: `src/ui/errors.ts`, `src/log.ts`, `src/extension.ts`, `package.json`

**Interfaces:**
- Consumes: `EnvRefResolver.schemas()` (Task 4); `sourcesFromSettings` (Task 3); `parseBlock`/`ParseOptions` (Task 2).
- Produces: `BLOCK_KEY = 'envRef'`; `EnvRefConfigurationProvider`; `EnvRefApi`; and in `src/commands/sets.ts`: `CommandDeps { resolver; logger; settingsSources(folder): SourceMap }`, `VarSet`, `pickFolder`, `collectSets`, `pickSet`, `resolveSet`.

- [ ] **Step 1: `git mv` `sources.ts` to `sets.ts`** and rename its exports; `getConfiguration('envref').get('namedSets')`; block lookup `record['envRef']`; `parseBlock` called with `{ schemas: deps.resolver.schemas(), settingsSources, rootPath }`.
- [ ] **Step 2: Update the debug configuration provider** — `BLOCK_KEY`, class name, messages. Keep the substring `was not started`, which the integration suite asserts.
- [ ] **Step 3: Update the three commands** — `resolveInput` wraps `{ vars: { value: args } }` and its guidance names `envref.resolveInput`, `source`, and the `envref.sources` setting.
- [ ] **Step 4: Update the two reporting surfaces** — `log.failure` prints `source=` and the config pairs; `errors.ts` reads `config['profile']` for the SSO action.
- [ ] **Step 5: Rewire `src/extension.ts`** — channel `EnvRef`, `EnvRefApi`, `EnvRefResolver`, `envref` settings, five `envref.*` commands, `settingsSourcesFor`.
- [ ] **Step 6: Rewrite the manifest contributions in `package.json`** — name, displayName, repository, description, keywords, activation events, five commands, four settings.
- [ ] **Step 7: Verify the tree is green again** — `npm test` (lint + typecheck + 43 unit tests). First point since Task 1 where `typecheck` passes.
- [ ] **Step 8: Commit** — `refactor: rename the extension to EnvRef`

---

### Task 6: Fixture and integration suite

**Files:**
- Modify: `test/fixtures/workspace/.vscode/launch.json`
- Modify: `test/integration/extension.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: no new interfaces.

- [ ] **Step 1: Point the fixture at a named source** — `envRef` block with one source `fixture`. The second configuration stays untouched: it proves a config without the block is passed through.
- [ ] **Step 2: Update the integration suite** — new imports, `StubProvider.configKeys`, `settingsSources: () => ({})`, extension id `mniak.vscode-envref`, five `envref.*` commands, `collectSets`, and a broken-config case that is still invalid for the missing `key`.
- [ ] **Step 3: Run the integration suite** — 6 tests in `EnvRef extension` plus 1 in `Backward compatibility`.
- [ ] **Step 4: Commit** — `test: exercise named sources end to end`

---

### Task 7: Documentation

**Files:**
- Modify: `README.md` (full rewrite)
- Modify: `CHANGELOG.md`
- Rename: `docs/superpowers/specs/2026-09-17-external-secrets-launch-json.md` → `...-envref-launch-json.md` (`git mv`)

**Interfaces:**
- Consumes: the final shapes from Tasks 1-6.
- Produces: no code.

- [ ] **Step 1: Rewrite `README.md`** — title `# EnvRef for VS Code`. The ExternalSecrets Operator appears once, as an analogy, with no claim of affiliation. New sections: `sources`, "Several accounts in one launch", the reference-field table marking `provider`/`profile`/`region` as *not* reference fields, the four settings, and the `tasks.json` example using `envref.resolveInput`.
- [ ] **Step 2: Rewrite the `0.1.0` entry in `CHANGELOG.md`** — describe the shipped design, not the history of it: nothing was published, so there is no rename to announce.
- [ ] **Step 3: `git mv` the spec and top it** with a note pointing at this plan as superseding it on the name and the block shape. Its research table about competing extensions stays intact.
- [ ] **Step 4: Verify no stale vocabulary survives** — `rg -i 'externalSecrets|external.secrets|SecretSource|collectSources|pickSource|resolveSource|SUPPORTED_PROVIDERS|BlockDefaults|SecretResolver'` matches only inside the specs directory, where the superseded spec is allowed to keep its history.
- [ ] **Step 5: Commit** — `docs: describe EnvRef and its named sources`

---

### Task 8: Rename the working directory

**Files:**
- Rename: the repository directory itself, `vscode-external-secrets` → `vscode-envref`

Last, deliberately: it invalidates the path of any open editor or shell. The GitHub repository does not exist yet (404 on `mniak/vscode-envref` and on the old name), so nothing remote needs updating.

- [ ] **Step 1: Delete the stale package** — `rm -f vscode-external-secrets-0.1.0.vsix`, built under the old name and ignored by git.
- [ ] **Step 2: Confirm the tree is clean and green** — `git status --short` empty, `npm test` passing.
- [ ] **Step 3: Rename the directory** from the parent: `mv vscode-external-secrets vscode-envref`.
- [ ] **Step 4: Rebuild in the new location** — `npm run package` produces `vscode-envref-0.1.0.vsix`.
