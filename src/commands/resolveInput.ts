import * as vscode from 'vscode';
import { ParseError, parseBlock } from '../refs/parse';
import { reportError, reportFailures } from '../ui/errors';
import { withStatus } from '../ui/progress';
import { CommandDeps } from './sources';

const VAR_NAME = 'value';

export async function resolveInput(deps: CommandDeps, args: unknown): Promise<string | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];

  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    await reportError(
      'External Secrets: input variable without arguments.',
      'Pass the secret reference in "args", for example:\n"inputs": [{ "id": "dbPass", "type": "command", "command": "externalSecrets.resolveInput", "args": { "provider": "aws-sm", "key": "dev-ext/cards/db", "property": "password" } }]',
      deps.logger,
      folder,
    );
    return undefined;
  }

  const record = args as Record<string, unknown>;
  const block = 'env' in record || 'envFrom' in record ? record : { env: { [VAR_NAME]: record } };

  let parsed;
  try {
    parsed = parseBlock(block, deps.settings(folder), 'externalSecrets.resolveInput');
  } catch (error) {
    if (error instanceof ParseError) {
      await reportError('External Secrets: invalid input variable.', error.message, deps.logger, folder);
      return undefined;
    }
    throw error;
  }

  if (parsed.refs.length !== 1 || parsed.bulk.length > 0) {
    await reportError(
      'External Secrets: invalid input variable.',
      'An input variable resolves exactly one secret reference.',
      deps.logger,
      folder,
    );
    return undefined;
  }

  const outcome = await withStatus('External Secrets: resolving input variable…', () =>
    deps.resolver.resolve(parsed),
  );
  if (outcome.failures.length > 0) {
    await reportFailures(
      'External Secrets: could not resolve the input variable.',
      outcome.failures,
      deps.logger,
      folder,
    );
    return undefined;
  }

  const ref = parsed.refs[0];
  deps.logger.info(`Resolved input variable from ${ref?.key}.`);
  return outcome.values.get(ref?.varName ?? VAR_NAME);
}
