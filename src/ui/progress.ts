import * as vscode from 'vscode';

export function withStatus<T>(title: string, task: () => Promise<T>): Promise<T> {
  return Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, task));
}
