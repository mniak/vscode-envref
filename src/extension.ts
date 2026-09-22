import * as vscode from 'vscode';
import { SecretsManagerClientFactory } from './aws/credentials';
import { exportEnvFile } from './commands/exportEnvFile';
import { openTerminal } from './commands/openTerminal';
import { resolveInput } from './commands/resolveInput';
import { CommandDeps } from './commands/sets';
import { sourcesFromSettings } from './config/defaults';
import { EnvRefConfigurationProvider } from './debug/configurationProvider';
import { ChannelLogger } from './log';
import { AwsSecretsManagerProvider } from './providers/awsSecretsManager';
import { SecretProvider } from './providers/provider';
import { EnvRefResolver } from './resolve/resolver';
import { LogLevel, ProviderId, SourceMap } from './types';

export interface EnvRefApi {
  registerProvider(provider: SecretProvider): void;
  clearCache(): void;
}

export function activate(context: vscode.ExtensionContext): EnvRefApi {
  const channel = vscode.window.createOutputChannel('EnvRef');
  const logger = new ChannelLogger(channel);
  context.subscriptions.push(channel);

  const factory = new SecretsManagerClientFactory();
  const aws = new AwsSecretsManagerProvider({ factory, logger });
  const providers = new Map<ProviderId, SecretProvider>([[aws.id, aws]]);
  const resolver = new EnvRefResolver(providers, { logger });

  const applySettings = (): void => {
    const settings = vscode.workspace.getConfiguration('envref');
    logger.setLevel(settings.get<LogLevel>('log.level', 'info'));
    resolver.setTtlMs(Math.max(0, settings.get<number>('cache.ttlSeconds', 300)) * 1000);
  };
  applySettings();

  const settingsSourcesFor = (folder: vscode.WorkspaceFolder | undefined): SourceMap =>
    sourcesFromSettings(
      vscode.workspace.getConfiguration('envref', folder ?? null).get('sources'),
      resolver.schemas(),
    );

  const deps: CommandDeps = { resolver, logger, settingsSources: settingsSourcesFor };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('envref')) {
        applySettings();
      }
    }),
    vscode.debug.registerDebugConfigurationProvider('*', new EnvRefConfigurationProvider(deps)),
    vscode.commands.registerCommand('envref.clearCache', () => {
      resolver.clearCache();
      void vscode.window.showInformationMessage('EnvRef: cache cleared.');
    }),
    vscode.commands.registerCommand('envref.showLog', () => logger.show()),
    vscode.commands.registerCommand('envref.openTerminal', () => openTerminal(deps)),
    vscode.commands.registerCommand('envref.exportEnvFile', () => exportEnvFile(deps)),
    vscode.commands.registerCommand('envref.resolveInput', (args: unknown) => resolveInput(deps, args)),
    { dispose: () => factory.dispose() },
  );

  logger.info('EnvRef activated.');

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
