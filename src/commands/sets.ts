import * as vscode from 'vscode';
import { ChannelLogger } from '../log';
import { ParseError, parseBlock } from '../refs/parse';
import { EnvRefResolver } from '../resolve/resolver';
import { SourceMap } from '../types';
import { reportError, reportFailures } from '../ui/errors';
import { withStatus } from '../ui/progress';

export interface CommandDeps {
  resolver: EnvRefResolver;
  logger: ChannelLogger;
  settingsSources(folder: vscode.WorkspaceFolder | undefined): SourceMap;
}

export interface VarSet {
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

export function collectSets(folder: vscode.WorkspaceFolder | undefined): VarSet[] {
  const sets: VarSet[] = [];

  const namedSets = vscode.workspace
    .getConfiguration('envref', folder ?? null)
    .get<Record<string, unknown>>('namedSets', {});
  for (const [name, block] of Object.entries(namedSets)) {
    sets.push({ label: name, description: 'named set', block, folder });
  }

  const configurations = vscode.workspace
    .getConfiguration('launch', folder ?? null)
    .get<unknown[]>('configurations', []);
  for (const configuration of configurations) {
    if (typeof configuration !== 'object' || configuration === null) {
      continue;
    }
    const record = configuration as Record<string, unknown>;
    const block = record['envRef'];
    if (block === undefined) {
      continue;
    }
    sets.push({
      label: typeof record['name'] === 'string' ? record['name'] : '(unnamed configuration)',
      description: 'launch configuration',
      block,
      folder,
    });
  }

  return sets;
}

export async function pickSet(sets: VarSet[]): Promise<VarSet | undefined> {
  if (sets.length === 0) {
    void vscode.window.showWarningMessage(
      'EnvRef: no launch configuration with an "envRef" block and no named set in settings.',
    );
    return undefined;
  }
  if (sets.length === 1) {
    return sets[0];
  }
  const picked = await vscode.window.showQuickPick(
    sets.map((set) => ({ label: set.label, description: set.description, set })),
    { placeHolder: 'Which set of variables?' },
  );
  return picked?.set;
}

export async function resolveSet(set: VarSet, deps: CommandDeps): Promise<Map<string, string> | undefined> {
  let parsed;
  try {
    parsed = parseBlock(set.block, {
      schemas: deps.resolver.schemas(),
      settingsSources: deps.settingsSources(set.folder),
      rootPath: `envRef (${set.label})`,
    });
  } catch (error) {
    if (error instanceof ParseError) {
      await reportError(
        `EnvRef: invalid configuration in "${set.label}".`,
        error.message,
        deps.logger,
        set.folder,
      );
      return undefined;
    }
    throw error;
  }

  const outcome = await withStatus(`EnvRef: resolving variables for "${set.label}"…`, () =>
    deps.resolver.resolve(parsed),
  );
  if (outcome.failures.length > 0) {
    await reportFailures(
      `EnvRef: could not resolve ${outcome.failures.length} variable(s) for "${set.label}".`,
      outcome.failures,
      deps.logger,
      set.folder,
    );
    return undefined;
  }

  return outcome.values;
}
