import * as vscode from 'vscode';
import { LogLevel, Logger, ResolveFailure } from './types';

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export class ChannelLogger implements Logger {
  private level: LogLevel = 'info';

  constructor(private readonly channel: vscode.OutputChannel) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  show(): void {
    this.channel.show(true);
  }

  error(message: string): void {
    this.write('error', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  info(message: string): void {
    this.write('info', message);
  }

  debug(message: string): void {
    this.write('debug', message);
  }

  failure(failure: ResolveFailure): void {
    const where = failure.varName === undefined ? failure.path : `${failure.path} → ${failure.varName}`;
    const config = Object.entries(failure.config)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    this.error(
      `${where}: [${failure.kind}] ${failure.message} (source=${failure.sourceName} key=${failure.key}${config === '' ? '' : ` ${config}`})`,
    );
  }

  private write(level: LogLevel, message: string): void {
    if (ORDER[level] > ORDER[this.level]) {
      return;
    }
    const stamp = new Date().toISOString();
    this.channel.appendLine(`[${stamp}] [${level}] ${message}`);
  }
}
