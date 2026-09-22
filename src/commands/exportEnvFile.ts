import * as vscode from 'vscode';
import { CommandDeps, collectSets, pickFolder, pickSet, resolveSet } from './sets';

export async function exportEnvFile(deps: CommandDeps): Promise<void> {
  const folder = await pickFolder();
  const set = await pickSet(collectSets(folder));
  if (set === undefined) {
    return;
  }

  const target = await vscode.window.showSaveDialog({
    title: 'Export resolved variables',
    saveLabel: 'Export',
    ...(folder === undefined ? {} : { defaultUri: vscode.Uri.joinPath(folder.uri, '.env') }),
    filters: { 'Environment file': ['env'] },
  });
  if (target === undefined) {
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    'Write resolved values to disk?',
    {
      modal: true,
      detail: `The resolved values of "${set.label}" will be written in plain text to ${target.fsPath} (permissions 0600). Never commit this file.`,
    },
    'Write file',
  );
  if (confirmed !== 'Write file') {
    return;
  }

  const values = await resolveSet(set, deps);
  if (values === undefined) {
    return;
  }

  const body = [...values].map(([name, value]) => `${name}=${quote(value)}`).join('\n');
  await vscode.workspace.fs.writeFile(target, Buffer.from(`${body}\n`, 'utf8'));
  await restrictPermissions(target, deps);

  deps.logger.info(`Exported ${values.size} variable(s) to ${target.fsPath}: ${[...values.keys()].join(', ')}.`);
  await offerGitignore(target, folder);
  void vscode.window.showInformationMessage(`EnvRef: wrote ${values.size} variable(s) to ${target.fsPath}.`);
}

function quote(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

async function restrictPermissions(target: vscode.Uri, deps: CommandDeps): Promise<void> {
  if (target.scheme !== 'file') {
    return;
  }
  try {
    const { chmod } = await import('node:fs/promises');
    await chmod(target.fsPath, 0o600);
  } catch (error) {
    deps.logger.warn(`Could not set 0600 on ${target.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function offerGitignore(target: vscode.Uri, folder: vscode.WorkspaceFolder | undefined): Promise<void> {
  if (folder === undefined || !target.fsPath.startsWith(folder.uri.fsPath)) {
    return;
  }
  const relative = target.fsPath.slice(folder.uri.fsPath.length + 1).split('\\').join('/');
  const gitignore = vscode.Uri.joinPath(folder.uri, '.gitignore');

  let current = '';
  try {
    current = Buffer.from(await vscode.workspace.fs.readFile(gitignore)).toString('utf8');
  } catch {
    current = '';
  }
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(relative) || lines.includes(`/${relative}`)) {
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `${relative} is not in .gitignore.`,
    'Add to .gitignore',
    'Leave it',
  );
  if (choice !== 'Add to .gitignore') {
    return;
  }
  const suffix = current === '' || current.endsWith('\n') ? '' : '\n';
  await vscode.workspace.fs.writeFile(gitignore, Buffer.from(`${current}${suffix}${relative}\n`, 'utf8'));
}
