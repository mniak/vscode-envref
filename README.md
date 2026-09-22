<div align="center">

<img src="https://raw.githubusercontent.com/mniak/vscode-envref/main/images/icon.png" alt="EnvRef" width="112" height="112">

# EnvRef

**Reference secrets in `launch.json` instead of pasting them.**
Resolved from a named source with your local credentials, at the moment you press `F5`.

[![CI](https://github.com/mniak/vscode-envref/actions/workflows/ci.yml/badge.svg)](https://github.com/mniak/vscode-envref/actions/workflows/ci.yml)
[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/mniak.vscode-envref?label=marketplace)](https://marketplace.visualstudio.com/items?itemName=mniak.vscode-envref)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/mniak.vscode-envref)](https://marketplace.visualstudio.com/items?itemName=mniak.vscode-envref)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

Keep values out of `launch.json`. Reference them instead, and let the extension fetch them from
a named source with your local credentials at the moment you hit `F5`.

A source is a name bound to a provider and its configuration — an AWS profile and region today,
a vault address or a file path as providers are added. Each variable names the source it comes
from, so one configuration can span several accounts, regions or providers at once.

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
      "envRef": {
        "sources": {
          "dev": { "provider": "aws-sm", "profile": "dev-ext", "region": "us-east-1" }
        },
        "vars": {
          "DB_PASSWORD": { "source": "dev", "key": "dev-ext/cards/db", "property": "password" },
          "DB_HOST": { "source": "dev", "key": "dev-ext/cards/db", "property": "host" },
          "API_TOKEN": { "source": "dev", "key": "dev-ext/cards/token" }
        }
      }
    }
  ]
}
```

If you run [ExternalSecrets Operator](https://external-secrets.io/) in your cluster, the idea will
be familiar: there your app receives credentials from a secret store, here your debug session
receives them from one, mapped field by field into environment variables. EnvRef is an independent
project and is not affiliated with it.

## Why a separate `envRef` block

The references live in their own block, not inside `env`, so the file keeps working for people who
do not have the extension. The Debug Adapter Protocol declares the arguments of the `launch` request
[implementation specific](https://microsoft.github.io/debug-adapter-protocol/specification), and
adapters ignore attributes they do not know — without the extension the block is dropped and the
session starts normally, just without those variables. An object inside `env` would not degrade: the
adapter would receive an object where it expects a string.

## Sources

A `sources` entry is a name, a `provider`, and whatever that provider needs. `aws-sm` is the only
provider today and it accepts `profile` and `region`; both are optional, and omitting them falls back
to the AWS SDK credential chain (`AWS_PROFILE`, `AWS_REGION`, env credentials, SSO cache, instance
role, …).

```jsonc
"sources": {
  "dev":   { "provider": "aws-sm", "profile": "dev-ext", "region": "us-east-1" },
  "chain": { "provider": "aws-sm" }
}
```

Declare sources once in your settings to reuse them from every launch configuration:

```jsonc
// .vscode/settings.json
"envref.sources": {
  "dev":     { "provider": "aws-sm", "profile": "dev-ext",     "region": "us-east-1" },
  "partner": { "provider": "aws-sm", "profile": "prod-nonpci", "region": "eu-west-1" }
}
```

A source declared in an `envRef` block shadows a settings source of the same name.

A profile without a valid SSO session produces an error dialog with a **Run aws sso login** button
that opens a terminal with `aws sso login --profile <profile>`.

## Several accounts in one launch

Each variable names its own source, so one configuration can span accounts, regions and providers.
Two sources with identical configuration still share a single `GetSecretValue` call.

```jsonc
"envRef": {
  "sources": {
    "dev":     { "provider": "aws-sm", "profile": "dev-ext",     "region": "us-east-1" },
    "partner": { "provider": "aws-sm", "profile": "prod-nonpci", "region": "eu-west-1" }
  },
  "vars": {
    "DB_PASSWORD":   { "source": "dev",     "key": "dev-ext/cards/db", "property": "password" },
    "PARTNER_TOKEN": { "source": "partner", "key": "partner/token" }
  }
}
```

## Reference fields

| Field | Required | Description |
|---|---|---|
| `source` | yes | Name of an entry in `sources`, here or in `envref.sources` |
| `key` | yes | Secret name or ARN |
| `property` | no | Field of the secret's JSON. Dotted paths (`db.password`) work for nested objects. Without it the whole `SecretString` is used |
| `versionStage` | no | Defaults to `AWSCURRENT` |
| `versionId` | no | Exact version; takes precedence over `versionStage` |
| `default` | no | Used **only** when the secret or the field does not exist. It never masks a credential or permission error |
| `encoding` | no | `utf8` (default) or `base64`, for secrets stored as `SecretBinary` |

`provider`, `profile` and `region` are **not** reference fields — they belong to the source. That is
what makes a reference portable: it names *where* the value comes from, and the source decides *how*
to get there.

### `varsFrom`: every field of a secret

When the secret is already modelled with the variable names, import all of its fields (the equivalent
of `dataFrom` in ExternalSecrets):

```jsonc
"envRef": {
  "sources": { "dev": { "provider": "aws-sm", "profile": "dev-ext" } },
  "varsFrom": [
    { "source": "dev", "key": "dev-ext/cards/env" },
    { "source": "dev", "key": "dev-ext/cards/db", "prefix": "DB_" }
  ]
}
```

### Adapters that use `environment`

`cppdbg` and `lldb` take an array instead of a map. The extension detects the shape of the
configuration and writes to `environment` as `[{ "name": ..., "value": ... }]`. Force it with
`"target": "environment"` (or `"env"`) inside the block.

## Errors

Any failure aborts the launch — the app never starts with a missing or empty variable. The dialog
lists each variable that failed with its source and reason, plus buttons to log in, to open
`launch.json` at the offending reference, or to show the log.

## Other surfaces

- **`tasks.json` and any string**: the command `envref.resolveInput` works as a
  [command input variable](https://code.visualstudio.com/docs/reference/variables-reference). Declare
  the source in `envref.sources` and the input stays a one-liner:

  ```jsonc
  {
    "version": "2.0.0",
    "inputs": [
      {
        "id": "dbPass",
        "type": "command",
        "command": "envref.resolveInput",
        "args": { "source": "dev", "key": "dev-ext/cards/db", "property": "password" }
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

- **`EnvRef: Open Terminal With Variables`** — a terminal whose environment already has the variables
  of a launch configuration or of a named set.
- **`EnvRef: Export .env File`** — writes the resolved values to a file, behind an explicit
  confirmation, with permissions `0600` and an offer to add it to `.gitignore`. This is the only
  feature that puts values on disk.
- **`EnvRef: Clear Cache`** — drops the in-memory cache (after rotating a secret).

Both commands also accept sets declared in settings:

```jsonc
"envref.namedSets": {
  "cards": {
    "sources": { "dev": { "provider": "aws-sm", "profile": "dev-ext", "region": "us-east-1" } },
    "vars": { "DB_PASSWORD": { "source": "dev", "key": "dev-ext/cards/db", "property": "password" } }
  }
}
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `envref.sources` | `{}` | Named sources reusable from any launch configuration |
| `envref.cache.ttlSeconds` | `300` | In-memory cache lifetime. `0` disables it |
| `envref.log.level` | `info` | `error`, `warn`, `info` or `debug` |
| `envref.namedSets` | `{}` | Named sets of references, for the terminal and `.env` commands |

## Security

- Values live only in memory, for the configured TTL. Nothing is written to disk or to
  `SecretStorage` (except the `.env` you explicitly export).
- No resolved value is ever logged — the output channel only records variable names, keys, the source
  name and its configuration, and status.
- Values are injected *after* VS Code's variable substitution, so one containing `${...}` is neither
  expanded nor leaked into the substitution engine.
- Several variables pointing at the same secret cost a single `GetSecretValue` call, and so do two
  sources whose configuration is identical.

## Known caveat: schema warning

Some debuggers ship a closed JSON schema, so `launch.json` may show
`Property envRef is not allowed`
([microsoft/vscode#48844](https://github.com/microsoft/vscode/issues/48844)) — an extension can only
contribute attributes for its own debug type. It is cosmetic: at runtime the extra attribute is valid
per the DAP and the launch works with or without the extension.

## Development

```bash
npm install
npm run build             # bundle to dist/extension.js
npm test                  # lint + typecheck + unit tests
npm run test:integration  # build + VS Code test host
npm run package           # .vsix
```

`F5` in this repo opens an Extension Development Host with the extension loaded.
