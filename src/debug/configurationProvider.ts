import * as vscode from 'vscode';
import { ChannelLogger } from '../log';
import { mergeValues } from '../refs/merge';
import { ParseError, parseBlock } from '../refs/parse';
import { EnvRefResolver } from '../resolve/resolver';
import { SourceMap } from '../types';
import { reportError, reportFailures } from '../ui/errors';
import { withStatus } from '../ui/progress';

export const BLOCK_KEY = 'envRef';

export interface ConfigurationProviderDeps {
  resolver: EnvRefResolver;
  logger: ChannelLogger;
  settingsSources(folder: vscode.WorkspaceFolder | undefined): SourceMap;
}

export class EnvRefConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(private readonly deps: ConfigurationProviderDeps) {}

  async resolveDebugConfigurationWithSubstitutedVariables(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): Promise<vscode.DebugConfiguration | undefined> {
    const record = config as unknown as Record<string, unknown>;
    const block = record[BLOCK_KEY];
    if (block === undefined) {
      return config;
    }

    delete record[BLOCK_KEY];

    const { logger, resolver } = this.deps;
    const label = `launch config "${config.name}"`;
    logger.info(`Resolving envRef variables for ${label}.`);

    let parsed;
    try {
      parsed = parseBlock(block, {
        schemas: resolver.schemas(),
        settingsSources: this.deps.settingsSources(folder),
      });
    } catch (error) {
      if (error instanceof ParseError) {
        await reportError(`EnvRef: invalid configuration in ${label}.`, error.message, logger, folder);
        return undefined;
      }
      throw error;
    }

    const outcome = await withStatus(`EnvRef: resolving variables for ${label}…`, () => resolver.resolve(parsed));
    if (outcome.failures.length > 0) {
      await reportFailures(
        `EnvRef: could not resolve ${outcome.failures.length} variable(s) for ${label}. The session was not started.`,
        outcome.failures,
        logger,
        folder,
      );
      return undefined;
    }

    mergeValues(record, outcome.values, { ...(parsed.target === undefined ? {} : { target: parsed.target }), logger });
    return config;
  }
}
