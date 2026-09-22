import * as vscode from 'vscode';
import { CommandDeps, collectSets, pickFolder, pickSet, resolveSet } from './sets';

export async function openTerminal(deps: CommandDeps): Promise<void> {
  const folder = await pickFolder();
  const set = await pickSet(collectSets(folder));
  if (set === undefined) {
    return;
  }

  const values = await resolveSet(set, deps);
  if (values === undefined) {
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: `envref: ${set.label}`,
    ...(folder === undefined ? {} : { cwd: folder.uri }),
    env: Object.fromEntries(values),
  });
  terminal.show();
  deps.logger.info(
    `Opened a terminal for "${set.label}" with ${values.size} variable(s): ${[...values.keys()].join(', ')}.`,
  );
}
