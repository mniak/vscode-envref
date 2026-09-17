import * as vscode from 'vscode';
import { SecretsManagerClientFactory } from './aws/credentials';
import { exportEnvFile } from './commands/exportEnvFile';
import { openTerminal } from './commands/openTerminal';
import { resolveInput } from './commands/resolveInput';
import { CommandDeps } from './commands/sources';
import { ExternalSecretsConfigurationProvider } from './debug/configurationProvider';
import { ChannelLogger } from './log';
import { AwsSecretsManagerProvider } from './providers/awsSecretsManager';
import { SecretProvider } from './providers/provider';
import { SecretResolver } from './resolve/resolver';
import { BlockDefaults, LogLevel, ProviderId } from './types';

export interface ExternalSecretsApi {
  registerProvider(provider: SecretProvider): void;
  clearCache(): void;
}

export function activate(context: vscode.ExtensionContext): ExternalSecretsApi {
  const channel = vscode.window.createOutputChannel('External Secrets');
  const logger = new ChannelLogger(channel);
  context.subscriptions.push(channel);

  const factory = new SecretsManagerClientFactory();
  const aws = new AwsSecretsManagerProvider({ factory, logger });
  const providers = new Map<ProviderId, SecretProvider>([[aws.id, aws]]);
  const resolver = new SecretResolver(providers, { logger });

  const applySettings = (): void => {
    const settings = vscode.workspace.getConfiguration('externalSecrets');
    logger.setLevel(settings.get<LogLevel>('log.level', 'info'));
    resolver.setTtlMs(Math.max(0, settings.get<number>('cache.ttlSeconds', 300)) * 1000);
  };
  applySettings();

  const settingsFor = (folder: vscode.WorkspaceFolder | undefined): BlockDefaults => {
    const settings = vscode.workspace.getConfiguration('externalSecrets', folder ?? null);
    const defaults: BlockDefaults = {};
    const profile = settings.get<string>('aws.profile');
    const region = settings.get<string>('aws.region');
    if (profile !== undefined && profile !== '') {
      defaults.profile = profile;
    }
    if (region !== undefined && region !== '') {
      defaults.region = region;
    }
    return defaults;
  };

  const deps: CommandDeps = { resolver, logger, settings: settingsFor };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('externalSecrets')) {
        applySettings();
      }
    }),
    vscode.debug.registerDebugConfigurationProvider(
      '*',
      new ExternalSecretsConfigurationProvider(deps),
    ),
    vscode.commands.registerCommand('externalSecrets.clearCache', () => {
      resolver.clearCache();
      void vscode.window.showInformationMessage('External Secrets: cache cleared.');
    }),
    vscode.commands.registerCommand('externalSecrets.showLog', () => logger.show()),
    vscode.commands.registerCommand('externalSecrets.openTerminal', () => openTerminal(deps)),
    vscode.commands.registerCommand('externalSecrets.exportEnvFile', () => exportEnvFile(deps)),
    vscode.commands.registerCommand('externalSecrets.resolveInput', (args: unknown) => resolveInput(deps, args)),
    { dispose: () => factory.dispose() },
  );

  logger.info('External Secrets activated.');

  return {
    registerProvider(provider: SecretProvider): void {
      providers.set(provider.id, provider);
      logger.info(`Registered provider "${provider.id}".`);
    },
    clearCache(): void {
      resolver.clearCache();
    },
  };
}

export function deactivate(): void {
  // nothing to clean up beyond the disposables registered in activate
}
