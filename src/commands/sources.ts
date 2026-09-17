import * as vscode from 'vscode';
import { ChannelLogger } from '../log';
import { ParseError, parseBlock } from '../refs/parse';
import { SecretResolver } from '../resolve/resolver';
import { BlockDefaults } from '../types';
import { reportError, reportFailures } from '../ui/errors';

export interface CommandDeps {
  resolver: SecretResolver;
  logger: ChannelLogger;
  settings(folder: vscode.WorkspaceFolder | undefined): BlockDefaults;
}

export interface SecretSource {
  label: string;
  description: string;
  block: unknown;
  folder: vscode.WorkspaceFolder | undefined;
}

export async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) {
    return folders[0];
  }
  return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Which folder?' });
}

export function collectSources(folder: vscode.WorkspaceFolder | undefined): SecretSource[] {
  const sources: SecretSource[] = [];

  const namedSets = vscode.workspace
    .getConfiguration('externalSecrets', folder ?? null)
    .get<Record<string, unknown>>('terminal.namedSets', {});
  for (const [name, block] of Object.entries(namedSets)) {
    sources.push({ label: name, description: 'named set', block, folder });
  }

  const configurations = vscode.workspace
    .getConfiguration('launch', folder ?? null)
    .get<unknown[]>('configurations', []);
  for (const configuration of configurations) {
    if (typeof configuration !== 'object' || configuration === null) {
      continue;
    }
    const record = configuration as Record<string, unknown>;
    const block = record['externalSecrets'];
    if (block === undefined) {
      continue;
    }
    sources.push({
      label: typeof record['name'] === 'string' ? record['name'] : '(unnamed configuration)',
      description: 'launch configuration',
      block,
      folder,
    });
  }

  return sources;
}

export async function pickSource(sources: SecretSource[]): Promise<SecretSource | undefined> {
  if (sources.length === 0) {
    void vscode.window.showWarningMessage(
      'External Secrets: no launch configuration with an "externalSecrets" block and no named set in settings.',
    );
    return undefined;
  }
  if (sources.length === 1) {
    return sources[0];
  }
  const picked = await vscode.window.showQuickPick(
    sources.map((source) => ({ label: source.label, description: source.description, source })),
    { placeHolder: 'Which set of secrets?' },
  );
  return picked?.source;
}

export async function resolveSource(
  source: SecretSource,
  deps: CommandDeps,
): Promise<Map<string, string> | undefined> {
  let parsed;
  try {
    parsed = parseBlock(source.block, deps.settings(source.folder), `externalSecrets (${source.label})`);
  } catch (error) {
    if (error instanceof ParseError) {
      await reportError(
        `External Secrets: invalid configuration in "${source.label}".`,
        error.message,
        deps.logger,
        source.folder,
      );
      return undefined;
    }
    throw error;
  }

  const outcome = await deps.resolver.resolve(parsed);
  if (outcome.failures.length > 0) {
    await reportFailures(
      `External Secrets: could not resolve ${outcome.failures.length} secret(s) for "${source.label}".`,
      outcome.failures,
      deps.logger,
      source.folder,
    );
    return undefined;
  }

  return outcome.values;
}
