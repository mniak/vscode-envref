import * as vscode from 'vscode';
import { CommandDeps, collectSources, pickFolder, pickSource, resolveSource } from './sources';

export async function openTerminal(deps: CommandDeps): Promise<void> {
  const folder = await pickFolder();
  const source = await pickSource(collectSources(folder));
  if (source === undefined) {
    return;
  }

  const values = await resolveSource(source, deps);
  if (values === undefined) {
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: `secrets: ${source.label}`,
    ...(folder === undefined ? {} : { cwd: folder.uri }),
    env: Object.fromEntries(values),
  });
  terminal.show();
  deps.logger.info(`Opened a terminal for "${source.label}" with ${values.size} variable(s): ${[...values.keys()].join(', ')}.`);
}
