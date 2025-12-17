import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { PinoLoggerService } from './shared/logging/pino-logger.service';

async function bootstrap() {
  // Create Fastify adapter with custom options
  const fastifyAdapter = new FastifyAdapter({
    logger: false, // We use our own Pino logger
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024, // 10MB
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
    {
      bufferLogs: true,
    },
  );

  // Get services
  const configService = app.get(ConfigService<AppConfig>);
  const logger = app.get(PinoLoggerService);

  // Use custom logger
  app.useLogger(logger);
  logger.setContext('Bootstrap');

  // Get configuration
  const port = configService.get('port', { infer: true }) || 3000;
  const nodeEnv = configService.get('nodeEnv', { infer: true });

  // Enable graceful shutdown
  app.enableShutdownHooks();

  // Register shutdown handlers
  const shutdownHandler = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');
    await app.close();
    logger.info('Application shut down gracefully');
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

  // Start server
  await app.listen(port, '0.0.0.0');

  logger.info(
    {
      port,
      nodeEnv,
      pid: process.pid,
    },
    `Export Processing Service started on port ${port}`,
  );
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
