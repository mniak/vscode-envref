import * as vscode from 'vscode';
import { ChannelLogger } from '../log';
import { mergeValues } from '../refs/merge';
import { ParseError, parseBlock } from '../refs/parse';
import { SecretResolver } from '../resolve/resolver';
import { BlockDefaults } from '../types';
import { reportError, reportFailures } from '../ui/errors';

export const BLOCK_KEY = 'externalSecrets';

export interface ConfigurationProviderDeps {
  resolver: SecretResolver;
  logger: ChannelLogger;
  settings(folder: vscode.WorkspaceFolder | undefined): BlockDefaults;
}

export class ExternalSecretsConfigurationProvider implements vscode.DebugConfigurationProvider {
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
    logger.info(`Resolving external secrets for ${label}.`);

    let parsed;
    try {
      parsed = parseBlock(block, this.deps.settings(folder));
    } catch (error) {
      if (error instanceof ParseError) {
        await reportError(`External Secrets: invalid configuration in ${label}.`, error.message, logger, folder);
        return undefined;
      }
      throw error;
    }

    const outcome = await resolver.resolve(parsed);
    if (outcome.failures.length > 0) {
      await reportFailures(
        `External Secrets: could not resolve ${outcome.failures.length} secret(s) for ${label}. The session was not started.`,
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
