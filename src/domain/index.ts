/**
 * Domain Layer Barrel Export
 *
 * This file provides a convenient way to import domain objects.
 * The domain layer is the core of the application and has no external dependencies.
 */

// Entities
export { ExportJobEntity, type ExportJobEntityData } from './entities/export-job.entity';
export {
  DownloadTaskEntity,
  type DownloadTaskEntityData,
  type DownloadTaskProps,
} from './entities/download-task.entity';

// Value Objects
export { JobStateVO, type JobStateProps } from './value-objects/job-state.vo';
export { JobStatusVO, JobStatus } from './value-objects/job-status.vo';
export { ExportStatusVO, ExportStatus } from './value-objects/export-status.vo';
export { FileMetadataVO, type FileMetadataProps } from './value-objects/file-metadata.vo';

// Events
export * from './events';
