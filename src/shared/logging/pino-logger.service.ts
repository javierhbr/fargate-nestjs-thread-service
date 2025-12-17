import { Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pino, { Logger } from 'pino';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class PinoLoggerService implements LoggerService {
  private logger: Logger;
  private context?: string;

  constructor(private readonly configService: ConfigService<AppConfig>) {
    const logLevel = this.configService.get('logLevel', { infer: true }) || 'info';
    const nodeEnv = this.configService.get('nodeEnv', { infer: true });

    this.logger = pino({
      level: logLevel,
      ...(nodeEnv === 'development' && {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        },
      }),
      formatters: {
        level: (label) => ({ level: label }),
      },
      base: {
        service: 'export-service',
        env: nodeEnv,
      },
    });
  }

  setContext(context: string): void {
    this.context = context;
  }

  private formatMessage(
    message: string,
    context?: string,
  ): { msg: string; context?: string } {
    return {
      msg: message,
      context: context || this.context,
    };
  }

  log(message: string, context?: string): void {
    this.logger.info(this.formatMessage(message, context));
  }

  info(message: string): void;
  info(obj: Record<string, unknown>, message: string): void;
  info(objOrMessage: Record<string, unknown> | string, message?: string): void {
    if (typeof objOrMessage === 'string') {
      this.logger.info(this.formatMessage(objOrMessage));
    } else {
      this.logger.info({ ...objOrMessage, context: this.context }, message || '');
    }
  }

  error(
    message: string | Record<string, unknown>,
    trace?: string,
    context?: string,
  ): void {
    if (typeof message === 'object') {
      this.logger.error({ ...message, context: this.context }, trace || '');
    } else {
      this.logger.error({ trace, ...this.formatMessage(message, context) }, message);
    }
  }

  warn(message: string | Record<string, unknown>, context?: string): void {
    if (typeof message === 'object') {
      this.logger.warn({ ...message, context: this.context }, context || '');
    } else {
      this.logger.warn(this.formatMessage(message, context));
    }
  }

  debug(message: string | Record<string, unknown>, context?: string): void {
    if (typeof message === 'object') {
      this.logger.debug({ ...message, context: this.context }, context || '');
    } else {
      this.logger.debug(this.formatMessage(message, context));
    }
  }

  verbose(message: string, context?: string): void {
    this.logger.trace(this.formatMessage(message, context));
  }

  child(bindings: Record<string, unknown>): PinoLoggerService {
    const childLogger = Object.create(this);
    childLogger.logger = this.logger.child(bindings);
    return childLogger;
  }

  withCorrelationId(correlationId: string): PinoLoggerService {
    return this.child({ correlationId });
  }

  withJobId(jobId: string): PinoLoggerService {
    return this.child({ jobId });
  }

  withTaskId(taskId: string): PinoLoggerService {
    return this.child({ taskId });
  }
}
