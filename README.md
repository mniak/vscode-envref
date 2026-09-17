# External Secrets for VS Code

Keep secrets out of `launch.json`. Reference them instead, and let the extension fetch the
values from AWS Secrets Manager with your local AWS credentials at the moment you hit `F5`.

It is the local equivalent of the
[ExternalSecrets Operator](https://external-secrets.io/): in the cluster your app receives
credentials from a secret store; here your debug session receives them from the same store,
mapped field by field into environment variables.

```jsonc
// .vscode/launch.json — safe to commit: only references, never values
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "go",
      "request": "launch",
      "name": "api",
      "program": "${workspaceFolder}/cmd/api",
      "env": {
        "LOG_LEVEL": "debug"
      },
      "externalSecrets": {
        "provider": "aws-sm",
        "profile": "dev-ext",
        "region": "us-east-1",
        "env": {
          "DB_PASSWORD": { "key": "dev-ext/cards/db", "property": "password" },
          "DB_HOST": { "key": "dev-ext/cards/db", "property": "host" },
          "API_TOKEN": { "key": "dev-ext/cards/token" }
        }
      }
    }
  ]
}
```

## Why a separate `externalSecrets` block

The references live in their own block, not inside `env`, so the file keeps working for
people who do not have the extension. The Debug Adapter Protocol declares the arguments of
the `launch` request
[implementation specific](https://microsoft.github.io/debug-adapter-protocol/specification),
and adapters ignore attributes they do not know — without the extension the block is
dropped and the session starts normally, just without those variables. An object inside
`env` would not degrade: the adapter would receive an object where it expects a string.

## Reference fields

| Field | Required | Description |
|---|---|---|
| `key` | yes | Secret name or ARN |
| `provider` | on the reference or on the block | `aws-sm` is the only value today |
| `property` | no | Field of the secret's JSON. Dotted paths (`db.password`) work for nested objects. Without it the whole `SecretString` is used |
| `profile` | no | AWS profile for this variable |
| `region` | no | AWS region for this variable |
| `versionStage` | no | Defaults to `AWSCURRENT` |
| `versionId` | no | Exact version; takes precedence over `versionStage` |
| `default` | no | Used **only** when the secret or the field does not exist. It never masks a credential or permission error |
| `encoding` | no | `utf8` (default) or `base64`, for secrets stored as `SecretBinary` |

`provider`, `profile`, `region`, `versionStage` and `versionId` can be set once on the block
as defaults and overridden per variable — two variables in the same configuration can come
from different accounts and regions:

```jsonc
"externalSecrets": {
  "provider": "aws-sm",
  "profile": "dev-ext",
  "region": "us-east-1",
  "env": {
    "DB_PASSWORD": { "key": "dev-ext/cards/db", "property": "password" },
    "PARTNER_TOKEN": {
      "key": "prod-nonpci/partner/token",
      "property": "value",
      "profile": "prod-nonpci",
      "region": "eu-west-1"
    }
  }
}
```

### `envFrom`: every field of a secret

When the secret is already modelled with the variable names, import all of its fields
(the equivalent of `dataFrom` in ExternalSecrets):

```jsonc
"externalSecrets": {
  "provider": "aws-sm",
  "envFrom": [
    { "key": "dev-ext/cards/env" },
    { "key": "dev-ext/cards/db", "prefix": "DB_" }
  ]
}
```

### Adapters that use `environment`

`cppdbg` and `lldb` take an array instead of a map. The extension detects the shape of the
configuration and writes to `environment` as `[{ "name": ..., "value": ... }]`. Force it
with `"target": "environment"` (or `"env"`) inside the block.

## Credentials

Resolution order, most specific first:

1. `profile` / `region` on the variable
2. `profile` / `region` on the `externalSecrets` block
3. `externalSecrets.aws.profile` / `externalSecrets.aws.region` in workspace or user settings
4. the default AWS SDK credential chain (`AWS_PROFILE`, `AWS_REGION`, env credentials,
   SSO cache, instance role, …)

A profile without a valid SSO session produces an error dialog with a **Run aws sso login**
button that opens a terminal with `aws sso login --profile <profile>`.

## Errors

Any failure aborts the launch — the app never starts with a missing or empty variable. The
dialog lists each variable that failed with its reason, plus buttons to log in, to open
`launch.json` at the offending reference, or to show the log.

## Other surfaces

- **`tasks.json` and any string**: the command `externalSecrets.resolveInput` works as a
  [command input variable](https://code.visualstudio.com/docs/reference/variables-reference):

  ```jsonc
  {
    "version": "2.0.0",
    "inputs": [
      {
        "id": "dbPass",
        "type": "command",
        "command": "externalSecrets.resolveInput",
        "args": { "provider": "aws-sm", "key": "dev-ext/cards/db", "property": "password" }
      }
    ],
    "tasks": [
      {
        "label": "migrate",
        "type": "shell",
        "command": "./migrate.sh",
        "options": { "env": { "DB_PASSWORD": "${input:dbPass}" } }
      }
    ]
  }
  ```

- **`External Secrets: Open Terminal with Secrets`** — a terminal whose environment already
  has the variables of a launch configuration or of a named set.
- **`External Secrets: Export .env File`** — writes the resolved values to a file, behind an
  explicit confirmation, with permissions `0600` and an offer to add it to `.gitignore`.
  This is the only feature that puts secrets on disk.
- **`External Secrets: Clear Cache`** — drops the in-memory cache (after rotating a secret).

Both commands also accept sets declared in settings:

```jsonc
"externalSecrets.terminal.namedSets": {
  "cards": {
    "provider": "aws-sm",
    "profile": "dev-ext",
    "region": "us-east-1",
    "env": { "DB_PASSWORD": { "key": "dev-ext/cards/db", "property": "password" } }
  }
}
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `externalSecrets.aws.profile` | — | Fallback AWS profile |
| `externalSecrets.aws.region` | — | Fallback AWS region |
| `externalSecrets.cache.ttlSeconds` | `300` | In-memory cache lifetime. `0` disables it |
| `externalSecrets.log.level` | `info` | `error`, `warn`, `info` or `debug` |
| `externalSecrets.terminal.namedSets` | `{}` | Named sets of references |

## Security

- Values live only in memory, for the configured TTL. Nothing is written to disk or to
  `SecretStorage` (except the `.env` you explicitly export).
- No secret value is ever logged — the output channel only records variable names, secret
  keys, profile, region and status.
- Secrets are injected *after* VS Code's variable substitution, so a value containing
  `${...}` is neither expanded nor leaked into the substitution engine.
- Several variables pointing at the same secret cost a single `GetSecretValue` call.

## Known caveat: schema warning

Some debuggers ship a closed JSON schema, so `launch.json` may show
`Property externalSecrets is not allowed`
([microsoft/vscode#48844](https://github.com/microsoft/vscode/issues/48844)) — an extension
can only contribute attributes for its own debug type. It is cosmetic: at runtime the extra
attribute is valid per the DAP and the launch works with or without the extension.

## Development

```bash
npm install
npm run build            # bundle to dist/extension.js
npm test                 # lint + typecheck + unit tests
npm run test:integration  # VS Code test host
npm run package          # .vsix
```

`F5` in this repo opens an Extension Development Host with the extension loaded.
