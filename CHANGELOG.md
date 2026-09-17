# Changelog

## 0.1.0

- `envRef` block in `launch.json` mapping values from a secret store to environment variables, with
  `property` (including dotted paths), `default`, `encoding`, `versionStage` and `versionId`.
- `sources`: named entries binding a provider to its own configuration. Every reference names the
  source it reads from, so one configuration can span several accounts, regions or providers.
- `envref.sources` setting to declare sources once and reuse them from every launch configuration;
  a source declared in the block shadows a settings source of the same name.
- `varsFrom` to import every field of a secret, with optional `prefix`.
- Support for adapters that use `env` (map) and `environment` (array).
- AWS Secrets Manager provider (`aws-sm`), taking `profile` and `region` from its source and falling
  back to the AWS SDK credential chain.
- Launch aborted with a per-variable error report and an `aws sso login` action.
- In-memory cache with configurable TTL, deduplicated `GetSecretValue` calls — including across two
  sources whose configuration is identical — and the `EnvRef: Clear Cache` command.
- `envref.resolveInput` for `${input:}` in `tasks.json`, plus the `EnvRef: Open Terminal With
  Variables` and `EnvRef: Export .env File` commands.
