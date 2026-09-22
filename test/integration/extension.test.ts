import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { VarSet, collectSets } from '../../src/commands/sets';
import { BLOCK_KEY, EnvRefConfigurationProvider } from '../../src/debug/configurationProvider';
import { ChannelLogger } from '../../src/log';
import { ProviderError, SecretProvider } from '../../src/providers/provider';
import { EnvRefResolver } from '../../src/resolve/resolver';
import { ProviderId } from '../../src/types';

const DB_JSON = JSON.stringify({ password: 's3cr3t', host: 'db.internal' });

class StubProvider implements SecretProvider {
  readonly id: ProviderId = 'aws-sm';
  readonly configKeys = ['profile', 'region'] as const;

  constructor(private readonly failing = false) {}

  async fetch(request: { key: string }): Promise<{ kind: 'string'; value: string }> {
    if (this.failing) {
      throw new ProviderError('auth', 'The SSO session has expired.');
    }
    if (request.key !== 'fixture/db') {
      throw new ProviderError('not-found', `Secret "${request.key}" was not found.`);
    }
    return { kind: 'string', value: DB_JSON };
  }
}

function providerFor(failing = false): EnvRefConfigurationProvider {
  const stub = new StubProvider(failing);
  const logger = new ChannelLogger(vscode.window.createOutputChannel('EnvRef (test)'));
  return new EnvRefConfigurationProvider({
    resolver: new EnvRefResolver(new Map<ProviderId, SecretProvider>([[stub.id, stub]]), { logger }),
    logger,
    settingsSources: () => ({}),
  });
}

function fixtureConfig(): vscode.DebugConfiguration {
  return {
    type: 'node',
    request: 'launch',
    name: 'fixture with secrets',
    program: 'app.js',
    env: { LOG_LEVEL: 'debug' },
    [BLOCK_KEY]: {
      sources: {
        fixture: { provider: 'aws-sm', profile: 'fixture', region: 'us-east-1' },
      },
      vars: { DB_PASSWORD: { source: 'fixture', key: 'fixture/db', property: 'password' } },
    },
  };
}

suite('EnvRef extension', () => {
  test('activates and exposes its commands', async () => {
    const extension = vscode.extensions.getExtension('mniak.vscode-envref');
    assert.ok(extension, 'extension not found in the test host');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      'envref.clearCache',
      'envref.showLog',
      'envref.openTerminal',
      'envref.exportEnvFile',
      'envref.resolveInput',
    ]) {
      assert.ok(commands.includes(command), `${command} is not registered`);
    }
  });

  test('reads the block from the fixture launch.json', () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const sets = collectSets(folder);
    const set = sets.find((candidate: VarSet) => candidate.label === 'fixture with secrets');
    assert.ok(set, 'launch configuration with an envRef block was not found');
    assert.equal(set.description, 'launch configuration');
    assert.equal(
      sets.some((candidate: VarSet) => candidate.label === 'fixture without secrets'),
      false,
    );
  });

  test('injects string values into env and hides the block from the adapter', async () => {
    const resolved = await providerFor().resolveDebugConfigurationWithSubstitutedVariables(
      vscode.workspace.workspaceFolders?.[0],
      fixtureConfig(),
    );

    assert.ok(resolved);
    assert.equal(BLOCK_KEY in resolved, false, 'the envRef block reached the adapter');
    assert.deepEqual(resolved['env'], { LOG_LEVEL: 'debug', DB_PASSWORD: 's3cr3t' });
    for (const value of Object.values(resolved['env'] as Record<string, unknown>)) {
      assert.equal(typeof value, 'string');
    }
  });

  test('leaves a configuration without the block untouched', async () => {
    const config: vscode.DebugConfiguration = { type: 'node', request: 'launch', name: 'plain' };
    const resolved = await providerFor().resolveDebugConfigurationWithSubstitutedVariables(
      vscode.workspace.workspaceFolders?.[0],
      config,
    );
    assert.equal(resolved, config);
  });

  test('aborts the session when a secret cannot be resolved', async () => {
    const original = vscode.window.showErrorMessage;
    const shown: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vscode.window as any).showErrorMessage = async (message: string): Promise<undefined> => {
      shown.push(message);
      return undefined;
    };

    try {
      const resolved = await providerFor(true).resolveDebugConfigurationWithSubstitutedVariables(
        vscode.workspace.workspaceFolders?.[0],
        fixtureConfig(),
      );
      assert.equal(resolved, undefined, 'the session should have been aborted');
      assert.equal(shown.length, 1);
      assert.ok(shown[0]?.includes('was not started'));
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (vscode.window as any).showErrorMessage = original;
    }
  });

  test('reports invalid configuration without contacting a provider', async () => {
    const original = vscode.window.showErrorMessage;
    const shown: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vscode.window as any).showErrorMessage = async (message: string): Promise<undefined> => {
      shown.push(message);
      return undefined;
    };

    try {
      const resolved = await providerFor().resolveDebugConfigurationWithSubstitutedVariables(
        vscode.workspace.workspaceFolders?.[0],
        {
          type: 'node',
          request: 'launch',
          name: 'broken',
          [BLOCK_KEY]: {
            sources: { fixture: { provider: 'aws-sm' } },
            vars: { DB_PASSWORD: { source: 'fixture', property: 'password' } },
          },
        },
      );
      assert.equal(resolved, undefined);
      assert.ok(shown[0]?.includes('invalid configuration'));
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (vscode.window as any).showErrorMessage = original;
    }
  });
});

suite('Backward compatibility', () => {
  test('a debug adapter starts a session even with an unknown launch attribute', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);

    const terminated = new Promise<void>((resolve) => {
      const subscription = vscode.debug.onDidTerminateDebugSession(() => {
        subscription.dispose();
        resolve();
      });
    });

    const started = await vscode.debug.startDebugging(folder, {
      type: 'node',
      request: 'launch',
      name: 'unknown attribute',
      program: `${folder.uri.fsPath}/app.js`,
      internalConsoleOptions: 'neverOpen',
      unknownAttributeThatNoAdapterKnows: { vars: { A: { source: 'dev', key: 'k' } } },
    } as vscode.DebugConfiguration);

    assert.equal(started, true, 'the adapter refused a configuration with an unknown attribute');
    await terminated;
  });
});
