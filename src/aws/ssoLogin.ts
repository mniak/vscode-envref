import * as vscode from 'vscode';
import { nonEmptyString } from '../config/defaults';

const TERMINAL_NAME = 'aws sso login';

export function runSsoLogin(profile: string | null | undefined): void {
  const existing = vscode.window.terminals.find((terminal) => terminal.name === TERMINAL_NAME);
  const terminal = existing ?? vscode.window.createTerminal(TERMINAL_NAME);
  terminal.show(true);
  const target = nonEmptyString(profile);
  terminal.sendText(target === undefined ? 'aws sso login' : `aws sso login --profile ${target}`);
}
