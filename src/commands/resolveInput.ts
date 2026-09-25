import * as vscode from 'vscode';
import { ParseError, parseBlock } from '../refs/parse';
import { reportError, reportFailures } from '../ui/errors';
import { withStatus } from '../ui/progress';
import { CommandDeps } from './sets';

const VAR_NAME = 'value';

export async function resolveInput(deps: CommandDeps, args: unknown): Promise<string | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];

  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    await reportError(
      'EnvRef: input variable without arguments.',
      'Pass the reference in "args", for example:\n"inputs": [{ "id": "dbPass", "type": "command", "command": "envref.resolveInput", "args": { "source": "dev", "key": "sandbox/cards/db", "property": "password" } }]\nDeclare "dev" in the "envref.sources" setting.',
      deps.logger,
      folder,
    );
    return undefined;
  }

  const record = args as Record<string, unknown>;
  const block = 'vars' in record ? record : { vars: { [VAR_NAME]: record } };

  let parsed;
  try {
    parsed = parseBlock(block, {
      schemas: deps.resolver.schemas(),
      settingsSources: deps.settingsSources(folder),
      rootPath: 'envref.resolveInput',
    });
  } catch (error) {
    if (error instanceof ParseError) {
      await reportError('EnvRef: invalid input variable.', error.message, deps.logger, folder);
      return undefined;
    }
    throw error;
  }

  if (parsed.refs.length !== 1) {
    await reportError(
      'EnvRef: invalid input variable.',
      'An input variable resolves exactly one reference.',
      deps.logger,
      folder,
    );
    return undefined;
  }

  const outcome = await withStatus('EnvRef: resolving input variable…', () => deps.resolver.resolve(parsed));
  if (outcome.failures.length > 0) {
    await reportFailures('EnvRef: could not resolve the input variable.', outcome.failures, deps.logger, folder);
    return undefined;
  }

  const ref = parsed.refs[0];
  deps.logger.info(`Resolved input variable from ${ref?.key}.`);
  return outcome.values.get(ref?.varName ?? VAR_NAME);
}
