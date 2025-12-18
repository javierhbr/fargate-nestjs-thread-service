import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { PinoLoggerService } from './shared/logging/pino-logger.service';

/**
 * Bootstrap the NestJS microservice
 * This is an SQS consumer-based microservice (no HTTP server)
 */
async function bootstrap() {
  // Create NestJS application context (microservice mode - no HTTP)
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  // Get services
  const configService = app.get(ConfigService<AppConfig>);
  const logger = app.get(PinoLoggerService);

  // Use custom logger
  app.useLogger(logger);
  logger.setContext('Bootstrap');

  // Get configuration
  const nodeEnv = configService.get('nodeEnv', { infer: true });
  const sqsConfig = configService.get('sqs', { infer: true });

  // Enable graceful shutdown
  app.enableShutdownHooks();

  // Register shutdown handlers
  const shutdownHandler = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal, stopping consumers...');
    await app.close();
    logger.info('All consumers stopped, application shut down gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
    process.exit(1);
  });

  // Log startup
  logger.info(
    {
      nodeEnv,
      pid: process.pid,
      queues: {
        exportJobs: sqsConfig?.exportJobsUrl,
        downloadTasks: sqsConfig?.downloadTasksUrl,
      },
    },
    'Export Processing Microservice started - listening to SQS queues',
  );

  // Keep the process alive
  // The SQS consumers will automatically start via OnModuleInit lifecycle hooks
}

bootstrap().catch((error) => {
  console.error('Failed to start microservice:', error);
  process.exit(1);
});
