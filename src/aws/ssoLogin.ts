import * as vscode from 'vscode';

const TERMINAL_NAME = 'aws sso login';

export function runSsoLogin(profile: string | undefined): void {
  const existing = vscode.window.terminals.find((terminal) => terminal.name === TERMINAL_NAME);
  const terminal = existing ?? vscode.window.createTerminal(TERMINAL_NAME);
  terminal.show(true);
  terminal.sendText(profile === undefined ? 'aws sso login' : `aws sso login --profile ${profile}`);
}
