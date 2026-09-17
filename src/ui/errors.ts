import * as vscode from 'vscode';
import { runSsoLogin } from '../aws/ssoLogin';
import { ChannelLogger } from '../log';
import { ResolveFailure } from '../types';

const SSO_LOGIN = 'Run aws sso login';
const OPEN_LAUNCH = 'Open launch.json';
const SHOW_LOG = 'Show Log';

export async function reportFailures(
  title: string,
  failures: ResolveFailure[],
  logger: ChannelLogger,
  folder?: vscode.WorkspaceFolder,
): Promise<void> {
  for (const failure of failures) {
    logger.failure(failure);
  }

  const detail = failures.map(describe).join('\n');
  const authFailure = failures.find((failure) => failure.kind === 'auth');
  const configFailure = failures.find((failure) => failure.kind === 'not-found' || failure.kind === 'invalid');

  const actions: string[] = [];
  if (authFailure !== undefined) {
    actions.push(SSO_LOGIN);
  }
  if (configFailure !== undefined) {
    actions.push(OPEN_LAUNCH);
  }
  actions.push(SHOW_LOG);

  const choice = await vscode.window.showErrorMessage(title, { modal: true, detail }, ...actions);
  if (choice === SSO_LOGIN) {
    runSsoLogin(authFailure?.config['profile']);
    return;
  }
  if (choice === OPEN_LAUNCH) {
    await openLaunchJson(folder, configFailure?.key);
    return;
  }
  if (choice === SHOW_LOG) {
    logger.show();
  }
}

export async function reportError(
  title: string,
  detail: string,
  logger: ChannelLogger,
  folder?: vscode.WorkspaceFolder,
): Promise<void> {
  logger.error(`${title} ${detail}`);
  const choice = await vscode.window.showErrorMessage(title, { modal: true, detail }, OPEN_LAUNCH, SHOW_LOG);
  if (choice === OPEN_LAUNCH) {
    await openLaunchJson(folder);
  } else if (choice === SHOW_LOG) {
    logger.show();
  }
}

export async function openLaunchJson(folder?: vscode.WorkspaceFolder, needle?: string): Promise<void> {
  if (folder === undefined) {
    await vscode.commands.executeCommand('workbench.action.debug.configure');
    return;
  }

  const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'launch.json');
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch {
    await vscode.commands.executeCommand('workbench.action.debug.configure');
    return;
  }

  const editor = await vscode.window.showTextDocument(document);
  if (needle === undefined) {
    return;
  }
  const offset = document.getText().indexOf(needle);
  if (offset < 0) {
    return;
  }
  const position = document.positionAt(offset);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

function describe(failure: ResolveFailure): string {
  const subject = failure.varName === undefined ? failure.key : `${failure.varName} (${failure.key})`;
  return `• ${subject} [source ${failure.sourceName}]: ${failure.message}`;
}
