# Changelog

## 0.1.0

- `externalSecrets` block in `launch.json` mapping AWS Secrets Manager secrets to environment
  variables, with `property` (including dotted paths), `default`, `encoding`, `versionStage`
  and `versionId`.
- `provider`, `profile` and `region` as block defaults, overridable per variable.
- `envFrom` to import every field of a secret, with optional `prefix`.
- Support for adapters that use `env` (map) and `environment` (array).
- Credential cascade: variable, block, settings, default AWS SDK chain.
- Launch aborted with a per-variable error report and an `aws sso login` action.
- In-memory cache with configurable TTL, deduplicated `GetSecretValue` calls, and the
  `External Secrets: Clear Cache` command.
- `externalSecrets.resolveInput` for `${input:}` in `tasks.json`, plus the
  `Open Terminal with Secrets` and `Export .env File` commands.
