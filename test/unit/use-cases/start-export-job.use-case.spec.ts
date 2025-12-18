import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StartExportJobUseCase } from '../../../src/application/use-cases/start-export-job.use-case';
import { ExportStatusVO } from '../../../src/domain/value-objects/export-status.vo';
import { JobStatusVO } from '../../../src/domain/value-objects/job-status.vo';
import {
  createMockJobRepository,
  createMockExportApi,
  createMockEventPublisher,
  createMockLogger,
  createBlockingDetector,
} from '../helpers/mock-factories';

describe('StartExportJobUseCase', () => {
  let useCase: StartExportJobUseCase;
  let mockJobRepository: ReturnType<typeof createMockJobRepository>;
  let mockExportApi: ReturnType<typeof createMockExportApi>;
  let mockEventPublisher: ReturnType<typeof createMockEventPublisher>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let blockingDetector: ReturnType<typeof createBlockingDetector>;

  const createCommand = () => ({
    jobId: 'job-123',
    exportId: 'export-123',
    userId: 'user-123',
    metadata: { testKey: 'testValue' },
    taskToken: 'task-token-abc',
  });

  beforeEach(() => {
    mockJobRepository = createMockJobRepository() as any;
    mockExportApi = createMockExportApi() as any;
    mockEventPublisher = createMockEventPublisher() as any;
    mockLogger = createMockLogger();
    blockingDetector = createBlockingDetector();

    // Create use case directly (no NestJS testing utilities)
    useCase = new StartExportJobUseCase(
      mockJobRepository as any,
      mockExportApi as any,
      mockEventPublisher as any,
    );

    // Replace logger with mock
    (useCase as any).logger = mockLogger;

    // Setup default mocks
    mockJobRepository.save.mockResolvedValue(undefined);
    mockJobRepository.updateJobState.mockResolvedValue({} as any);
    mockEventPublisher.publish.mockResolvedValue(undefined);
  });

  describe('Export Ready - Immediate Download', () => {
    it('should start job with ready export and transition to DOWNLOADING', async () => {
      const command = createCommand();
      const exportStatus = {
        exportId: 'export-123',
        status: ExportStatusVO.ready(),
        downloadUrls: [
          { url: 'https://example.com/file1.pdf', fileName: 'file1.pdf' },
          { url: 'https://example.com/file2.pdf', fileName: 'file2.pdf' },
        ],
      };

      mockExportApi.getExportStatus.mockResolvedValue(exportStatus);

      const trackEnd = blockingDetector.track('execute');
      const result = await useCase.execute(command);
      trackEnd();

      // Should save initial job
      expect(mockJobRepository.save).toHaveBeenCalledTimes(1);
      expect(mockJobRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-123',
          exportId: 'export-123',
          userId: 'user-123',
        }),
      );

      // Should publish job created event
      expect(mockEventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-123',
          exportId: 'export-123',
        }),
      );

      // Should check export status
      expect(mockExportApi.getExportStatus).toHaveBeenCalledWith('export-123');

      // Should update job state to DOWNLOADING
      expect(mockJobRepository.updateJobState).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          status: expect.objectContaining({ value: JobStatusVO.downloading().value }),
          totalTasks: 2,
        }),
      );

      // Validate result
      expect(result.needsPolling).toBe(false);
      expect(result.canStartDownloading).toBe(true);
      expect(result.job.status.toString()).toBe('DOWNLOADING');
      expect(result.job.totalTasks).toBe(2);

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should handle ready export with no download URLs', async () => {
      const command = createCommand();
      const exportStatus = {
        exportId: 'export-123',
        status: ExportStatusVO.ready(),
        downloadUrls: [],
      };

      mockExportApi.getExportStatus.mockResolvedValue(exportStatus);

      const result = await useCase.execute(command);

      expect(result.needsPolling).toBe(false);
      expect(result.canStartDownloading).toBe(true);
      expect(result.job.status.toString()).toBe('DOWNLOADING');
      expect(result.job.totalTasks).toBe(0); // Default from initial state
    });
  });

  describe('Export Pending - Needs Polling', () => {
    it('should transition to POLLING when export is pending', async () => {
      const command = createCommand();
      const exportStatus = {
        exportId: 'export-123',
        status: ExportStatusVO.pending(),
      };

      mockExportApi.getExportStatus.mockResolvedValue(exportStatus);

      const trackEnd = blockingDetector.track('execute');
      const result = await useCase.execute(command);
      trackEnd();

      // Should update job state to POLLING
      expect(mockJobRepository.updateJobState).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          status: expect.objectContaining({ value: JobStatusVO.polling().value }),
        }),
      );

      // Validate result
      expect(result.needsPolling).toBe(true);
      expect(result.canStartDownloading).toBe(false);
      expect(result.job.status.toString()).toBe('POLLING');

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });
  });

  describe('Export Failed/Expired', () => {
    it('should handle failed export', async () => {
      const command = createCommand();
      const exportStatus = {
        exportId: 'export-123',
        status: ExportStatusVO.failed(),
        errorMessage: 'Export generation failed',
      };

      mockExportApi.getExportStatus.mockResolvedValue(exportStatus);

      const trackEnd = blockingDetector.track('execute');
      const result = await useCase.execute(command);
      trackEnd();

      // Should update job state to FAILED
      expect(mockJobRepository.updateJobState).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          status: expect.objectContaining({ value: JobStatusVO.failed().value }),
          errorMessage: 'Export generation failed',
        }),
      );

      // Should publish job failed event
      expect(mockEventPublisher.publish).toHaveBeenCalledTimes(2); // created + failed
      expect(mockEventPublisher.publish).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          payload: expect.objectContaining({
            jobId: 'job-123',
            errorMessage: 'Export generation failed',
            failureReason: 'export_failed',
          }),
        }),
      );

      // Validate result
      expect(result.needsPolling).toBe(false);
      expect(result.canStartDownloading).toBe(false);
      expect(result.job.status.toString()).toBe('FAILED');

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should handle expired export', async () => {
      const command = createCommand();
      const exportStatus = {
        exportId: 'export-123',
        status: ExportStatusVO.expired(),
      };

      mockExportApi.getExportStatus.mockResolvedValue(exportStatus);

      const result = await useCase.execute(command);

      // Should update job state to FAILED with expired message
      expect(mockJobRepository.updateJobState).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          status: expect.objectContaining({ value: JobStatusVO.failed().value }),
          errorMessage: 'Export expired',
        }),
      );

      // Should publish job failed event with expired reason
      expect(mockEventPublisher.publish).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          payload: expect.objectContaining({
            failureReason: 'export_expired',
          }),
        }),
      );

      expect(result.job.status.toString()).toBe('FAILED');
    });
  });

  describe('Error Handling', () => {
    it('should handle export API errors', async () => {
      const command = createCommand();
      const apiError = new Error('Export API unavailable');

      mockExportApi.getExportStatus.mockRejectedValue(apiError);

      await expect(useCase.execute(command)).rejects.toThrow('Export API unavailable');

      // Should attempt to save failed state
      expect(mockJobRepository.updateJobState).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          status: expect.objectContaining({ value: JobStatusVO.failed().value }),
          errorMessage: 'Export API unavailable',
        }),
      );
    });

    it('should handle repository save errors', async () => {
      const command = createCommand();
      const repoError = new Error('Database connection failed');

      mockJobRepository.save.mockRejectedValue(repoError);

      await expect(useCase.execute(command)).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should handle errors when updating failed state fails', async () => {
      const command = createCommand();
      const apiError = new Error('Export API error');
      const repoError = new Error('Repository update failed');

      mockExportApi.getExportStatus.mockRejectedValue(apiError);
      mockJobRepository.updateJobState.mockRejectedValue(repoError);

      // Should still throw original error
      await expect(useCase.execute(command)).rejects.toThrow('Export API error');

      // Should log repository error
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update job state'),
        repoError,
      );
    });

    it('should handle non-Error exceptions', async () => {
      const command = createCommand();
      mockExportApi.getExportStatus.mockRejectedValue('String error');

      await expect(useCase.execute(command)).rejects.toBe('String error');

      // Should handle unknown error message
      expect(mockJobRepository.updateJobState).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          errorMessage: 'Unknown error',
        }),
      );
    });
  });

  describe('Immutability Validation', () => {
    it('should not mutate command object', async () => {
      const command = createCommand();
      const originalCommand = JSON.parse(JSON.stringify(command));

      const exportStatus = {
        exportId: 'export-123',
        status: ExportStatusVO.ready(),
        downloadUrls: [],
      };

      mockExportApi.getExportStatus.mockResolvedValue(exportStatus);

      await useCase.execute(command);

      // Command should not be mutated
      expect(command).toEqual(originalCommand);
    });

    it('should not mutate metadata in command', async () => {
      const command = createCommand();
      const originalMetadata = { ...command.metadata };

      const exportStatus = {
        exportId: 'export-123',
        status: ExportStatusVO.pending(),
      };

      mockExportApi.getExportStatus.mockResolvedValue(exportStatus);

      await useCase.execute(command);

      expect(command.metadata).toEqual(originalMetadata);
    });
  });

  describe('Blocking Operations Detection', () => {
    it('should not have synchronous blocking operations', async () => {
      const command = createCommand();
      const exportStatus = {
        exportId: 'export-123',
        status: ExportStatusVO.ready(),
        downloadUrls: [{ url: 'https://example.com/file.pdf', fileName: 'file.pdf' }],
      };

      mockExportApi.getExportStatus.mockResolvedValue(exportStatus);

      const detector = createBlockingDetector();

      // Test ready export flow
      let trackEnd = detector.track('ready-export');
      await useCase.execute(command);
      trackEnd();

      // Test pending export flow
      mockExportApi.getExportStatus.mockResolvedValue({
        exportId: 'export-123',
        status: ExportStatusVO.pending(),
      });

      trackEnd = detector.track('pending-export');
      await useCase.execute({ ...command, jobId: 'job-456' });
      trackEnd();

      // Test failed export flow
      mockExportApi.getExportStatus.mockResolvedValue({
        exportId: 'export-123',
        status: ExportStatusVO.failed(),
        errorMessage: 'Test failure',
      });

      trackEnd = detector.track('failed-export');
      await useCase.execute({ ...command, jobId: 'job-789' });
      trackEnd();

      // Assert: No blocking operations detected
      expect(detector.hasBlockingCalls()).toBe(false);
      expect(detector.getBlockingCalls()).toHaveLength(0);
    });
  });

  describe('Logging', () => {
    it('should log start and status information', async () => {
      const command = createCommand();
      const exportStatus = {
        exportId: 'export-123',
        status: ExportStatusVO.ready(),
        downloadUrls: [
          { url: 'https://example.com/file1.pdf', fileName: 'file1.pdf' },
          { url: 'https://example.com/file2.pdf', fileName: 'file2.pdf' },
        ],
      };

      mockExportApi.getExportStatus.mockResolvedValue(exportStatus);

      await useCase.execute(command);

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Starting export job: job-123'),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Export export-123 status: READY'),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Set total tasks to 2 for job job-123'),
      );
    });

    it('should log errors', async () => {
      const command = createCommand();
      const error = new Error('Test error');

      mockExportApi.getExportStatus.mockRejectedValue(error);

      await expect(useCase.execute(command)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to start export job job-123'),
        error,
      );
    });
  });

  describe('State Machine Transitions', () => {
    it('should follow correct state transitions for ready export', async () => {
      const command = createCommand();
      const exportStatus = {
        exportId: 'export-123',
        status: ExportStatusVO.ready(),
        downloadUrls: [],
      };

      mockExportApi.getExportStatus.mockResolvedValue(exportStatus);

      const result = await useCase.execute(command);

      // Should start as PENDING, transition to PROCESSING, then DOWNLOADING
      expect(result.job.status.toString()).toBe('DOWNLOADING');

      // Should have been saved initially then updated
      expect(mockJobRepository.save).toHaveBeenCalledTimes(1);
      expect(mockJobRepository.updateJobState).toHaveBeenCalledTimes(1);
    });

    it('should transition directly to POLLING when export pending', async () => {
      const command = createCommand();
      const exportStatus = {
        exportId: 'export-123',
        status: ExportStatusVO.pending(),
      };

      mockExportApi.getExportStatus.mockResolvedValue(exportStatus);

      const result = await useCase.execute(command);

      // Should go PENDING → POLLING
      expect(result.job.status.toString()).toBe('POLLING');
    });
  });
});
