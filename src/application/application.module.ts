import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Use Cases
import {
  StartExportJobUseCase,
  PollExportStatusUseCase,
  DispatchDownloadTasksUseCase,
  ProcessFileUseCase,
  CompleteJobUseCase,
} from './use-cases';

/**
 * Application Module
 * Contains all use cases and application services
 *
 * This module depends on output ports (interfaces) but not on their implementations.
 * The implementations (adapters) are provided by the InfrastructureModule.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    // Use Cases
    StartExportJobUseCase,
    PollExportStatusUseCase,
    DispatchDownloadTasksUseCase,
    ProcessFileUseCase,
    CompleteJobUseCase,
  ],
  exports: [
    // Export use cases so they can be used by driving adapters (controllers, consumers)
    StartExportJobUseCase,
    PollExportStatusUseCase,
    DispatchDownloadTasksUseCase,
    ProcessFileUseCase,
    CompleteJobUseCase,
  ],
})
export class ApplicationModule {}
