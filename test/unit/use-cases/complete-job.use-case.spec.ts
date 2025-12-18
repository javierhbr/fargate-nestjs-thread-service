import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CompleteJobUseCase } from '../../../src/application/use-cases/complete-job.use-case';
import { ExportJobEntity } from '../../../src/domain/entities/export-job.entity';
import { JobStateVO } from '../../../src/domain/value-objects/job-state.vo';
import { JobStatusVO } from '../../../src/domain/value-objects/job-status.vo';
import {
  createMockJobRepository,
  createMockEventPublisher,
  createMockStepFunctions,
  createMockLogger,
  createBlockingDetector,
} from '../helpers/mock-factories';

describe('CompleteJobUseCase', () => {
  let useCase: CompleteJobUseCase;
  let mockJobRepository: ReturnType<typeof createMockJobRepository>;
  let mockEventPublisher: ReturnType<typeof createMockEventPublisher>;
  let mockStepFunctions: ReturnType<typeof createMockStepFunctions>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let blockingDetector: ReturnType<typeof createBlockingDetector>;

  const createMockJob = (
    totalTasks: number,
    completedTasks: number,
    failedTasks: number,
    taskToken?: string,
  ) => {
    const jobState = JobStateVO.create({
      totalTasks,
      completedTasks,
      failedTasks,
      status: JobStatusVO.downloading(),
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T01:00:00Z'),
    });

    return ExportJobEntity.create({
      jobId: 'job-123',
      exportId: 'export-123',
      userId: 'user-123',
      jobState,
      taskToken,
    });
  };

  beforeEach(() => {
    mockJobRepository = createMockJobRepository() as any;
    mockEventPublisher = createMockEventPublisher() as any;
    mockStepFunctions = createMockStepFunctions() as any;
    mockLogger = createMockLogger();
    blockingDetector = createBlockingDetector();

    // Create use case directly (no NestJS testing utilities)
    useCase = new CompleteJobUseCase(
      mockJobRepository as any,
      mockEventPublisher as any,
      mockStepFunctions as any,
    );

    // Replace logger with mock
    (useCase as any).logger = mockLogger;

    // Setup default mocks
    mockEventPublisher.publish.mockResolvedValue(undefined);
    mockEventPublisher.publishAsync = vi.fn().mockResolvedValue(undefined);
    mockStepFunctions.sendTaskSuccess.mockResolvedValue(undefined);
  });

  describe('Successful Task Completion', () => {
    it('should increment completed tasks when task succeeds', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
      };

      const job = createMockJob(10, 0, 0);
      const updatedJob = createMockJob(10, 1, 0);

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(updatedJob);

      const trackEnd = blockingDetector.track('execute');
      const result = await useCase.execute(command);
      trackEnd();

      expect(mockJobRepository.incrementCompletedTasks).toHaveBeenCalledWith('job-123');
      expect(mockEventPublisher.publishAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          jobId: 'job-123',
        }),
      );

      expect(result.job.completedTasks).toBe(1);
      expect(result.isJobComplete).toBe(false);

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should complete job when all tasks succeeded', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
      };

      const job = createMockJob(2, 1, 0);
      const updatedJobAfterIncrement = createMockJob(2, 2, 0);
      const completedJob = updatedJobAfterIncrement.transitionToCompleted();

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(
        updatedJobAfterIncrement,
      );
      mockJobRepository.updateJobState.mockResolvedValue(completedJob);

      const result = await useCase.execute(command);

      // Should transition to COMPLETED
      expect(mockJobRepository.updateJobState).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          status: expect.objectContaining({ value: JobStatusVO.completed().value }),
        }),
      );

      // Should publish job completed event
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            jobId: 'job-123',
            exportId: 'export-123',
            totalTasks: 2,
            completedTasks: 2,
            failedTasks: 0,
            success: true,
          }),
        }),
      );

      expect(result.isJobComplete).toBe(true);
      expect(result.allTasksSucceeded).toBe(true);
    });
  });

  describe('Failed Task Completion', () => {
    it('should increment failed tasks when task fails', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-456',
        success: false,
        errorMessage: 'Download failed',
      };

      const job = createMockJob(10, 5, 0);
      const updatedJob = createMockJob(10, 5, 1);

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementFailedTasks.mockResolvedValue(updatedJob);

      const trackEnd = blockingDetector.track('execute');
      const result = await useCase.execute(command);
      trackEnd();

      expect(mockJobRepository.incrementFailedTasks).toHaveBeenCalledWith(
        'job-123',
        'Download failed',
      );

      expect(mockEventPublisher.publishAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'task-456',
            jobId: 'job-123',
            errorMessage: 'Download failed',
            willRetry: false,
          }),
        }),
      );

      expect(result.job.failedTasks).toBe(1);
      expect(result.isJobComplete).toBe(false);

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should complete job with partial failures', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: false,
        errorMessage: 'Processing error',
      };

      const job = createMockJob(10, 9, 0);
      const updatedJobAfterIncrement = createMockJob(10, 9, 1);
      const completedJob = updatedJobAfterIncrement.transitionToCompleted();

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementFailedTasks.mockResolvedValue(updatedJobAfterIncrement);
      mockJobRepository.updateJobState.mockResolvedValue(completedJob);

      const result = await useCase.execute(command);

      // Should mark as complete even with failures
      expect(result.isJobComplete).toBe(true);
      expect(result.allTasksSucceeded).toBe(false);

      // Should publish job completed event with success=false
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            success: false,
            completedTasks: 9,
            failedTasks: 1,
          }),
        }),
      );
    });
  });

  describe('Step Functions Integration', () => {
    it('should send Step Functions callback when job completes with taskToken', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
      };

      const taskToken = 'task-token-abc';
      const job = createMockJob(1, 0, 0, taskToken);
      const updatedJobAfterIncrement = createMockJob(1, 1, 0, taskToken);
      const completedJob = updatedJobAfterIncrement.transitionToCompleted();

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(
        updatedJobAfterIncrement,
      );
      mockJobRepository.updateJobState.mockResolvedValue(completedJob);

      await useCase.execute(command);

      expect(mockStepFunctions.sendTaskSuccess).toHaveBeenCalledWith(
        taskToken,
        expect.objectContaining({
          jobId: 'job-123',
          exportId: 'export-123',
          status: 'COMPLETED',
          totalTasks: 1,
          completedTasks: 1,
          failedTasks: 0,
        }),
      );

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Sent Step Functions success callback'),
      );
    });

    it('should send callback for partial success', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
      };

      const taskToken = 'task-token-xyz';
      const job = createMockJob(10, 8, 1, taskToken);
      const updatedJobAfterIncrement = createMockJob(10, 9, 1, taskToken);
      const completedJob = updatedJobAfterIncrement.transitionToCompleted();

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(
        updatedJobAfterIncrement,
      );
      mockJobRepository.updateJobState.mockResolvedValue(completedJob);

      await useCase.execute(command);

      // Should send success callback with failedTasks count
      expect(mockStepFunctions.sendTaskSuccess).toHaveBeenCalledWith(
        taskToken,
        expect.objectContaining({
          failedTasks: 1,
        }),
      );

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('partial success: 1 failed tasks'),
      );
    });

    it('should not send callback when job completes without taskToken', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
      };

      const job = createMockJob(1, 0, 0); // No taskToken
      const updatedJobAfterIncrement = createMockJob(1, 1, 0);
      const completedJob = updatedJobAfterIncrement.transitionToCompleted();

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(
        updatedJobAfterIncrement,
      );
      mockJobRepository.updateJobState.mockResolvedValue(completedJob);

      await useCase.execute(command);

      expect(mockStepFunctions.sendTaskSuccess).not.toHaveBeenCalled();
    });

    it('should not fail job when Step Functions callback fails', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
      };

      const taskToken = 'task-token-abc';
      const job = createMockJob(1, 0, 0, taskToken);
      const updatedJobAfterIncrement = createMockJob(1, 1, 0, taskToken);
      const completedJob = updatedJobAfterIncrement.transitionToCompleted();

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(
        updatedJobAfterIncrement,
      );
      mockJobRepository.updateJobState.mockResolvedValue(completedJob);

      const callbackError = new Error('Step Functions API error');
      mockStepFunctions.sendTaskSuccess.mockRejectedValue(callbackError);

      // Should not throw
      const result = await useCase.execute(command);

      expect(result.isJobComplete).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send Step Functions callback'),
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw error when job not found', async () => {
      const command = {
        jobId: 'non-existent-job',
        taskId: 'task-123',
        success: true,
      };

      mockJobRepository.findById.mockResolvedValue(null);

      await expect(useCase.execute(command)).rejects.toThrow(
        'Job non-existent-job not found',
      );
    });

    it('should handle repository errors', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
      };

      const job = createMockJob(10, 5, 0);
      mockJobRepository.findById.mockResolvedValue(job);

      const repoError = new Error('Database connection lost');
      mockJobRepository.incrementCompletedTasks.mockRejectedValue(repoError);

      await expect(useCase.execute(command)).rejects.toThrow('Database connection lost');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to complete job'),
        repoError,
      );
    });

    it('should handle event publisher errors gracefully', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
      };

      const job = createMockJob(10, 5, 0);
      const updatedJob = createMockJob(10, 6, 0);

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(updatedJob);

      // Event publisher should not throw (async fire-and-forget)
      mockEventPublisher.publishAsync.mockRejectedValue(
        new Error('Event publish failed'),
      );

      // Should still succeed
      const result = await useCase.execute(command);
      expect(result.job.completedTasks).toBe(6);
    });
  });

  describe('Progress Tracking', () => {
    it('should track progress correctly', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
      };

      const job = createMockJob(10, 4, 1);
      const updatedJob = createMockJob(10, 5, 1);

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(updatedJob);

      await useCase.execute(command);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Progress: 5/10'),
      );
    });

    it('should log failed task progress', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-456',
        success: false,
        errorMessage: 'Network error',
      };

      const job = createMockJob(10, 7, 1);
      const updatedJob = createMockJob(10, 7, 2);

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementFailedTasks.mockResolvedValue(updatedJob);

      await useCase.execute(command);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Progress: 7/10 (2 failed)'),
      );
    });
  });

  describe('Immutability Validation', () => {
    it('should not mutate command object', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
        errorMessage: 'Test error',
      };

      const originalCommand = JSON.parse(JSON.stringify(command));
      const job = createMockJob(10, 5, 0);
      const updatedJob = createMockJob(10, 6, 0);

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(updatedJob);

      await useCase.execute(command);

      expect(command).toEqual(originalCommand);
    });
  });

  describe('Blocking Operations Detection', () => {
    it('should not have synchronous blocking operations', async () => {
      const detector = createBlockingDetector();

      // Test successful task flow
      let command = { jobId: 'job-123', taskId: 'task-1', success: true };
      let job = createMockJob(5, 0, 0);
      let updatedJob = createMockJob(5, 1, 0);

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(updatedJob);

      let trackEnd = detector.track('success-task');
      await useCase.execute(command);
      trackEnd();

      // Test failed task flow
      command = {
        jobId: 'job-456',
        taskId: 'task-2',
        success: false,
        errorMessage: 'Error',
      };
      job = createMockJob(5, 2, 0);
      updatedJob = createMockJob(5, 2, 1);

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementFailedTasks.mockResolvedValue(updatedJob);

      trackEnd = detector.track('failed-task');
      await useCase.execute(command);
      trackEnd();

      // Test job completion flow
      command = { jobId: 'job-789', taskId: 'task-3', success: true };
      job = createMockJob(2, 1, 0);
      updatedJob = createMockJob(2, 2, 0);
      const completedJob = updatedJob.transitionToCompleted();

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(updatedJob);
      mockJobRepository.updateJobState.mockResolvedValue(completedJob);

      trackEnd = detector.track('job-completion');
      await useCase.execute(command);
      trackEnd();

      // Assert: No blocking operations detected
      expect(detector.hasBlockingCalls()).toBe(false);
      expect(detector.getBlockingCalls()).toHaveLength(0);
    });
  });

  describe('Logging', () => {
    it('should log task completion information', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
      };

      const job = createMockJob(10, 5, 0);
      const updatedJob = createMockJob(10, 6, 0);

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(updatedJob);

      await useCase.execute(command);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Processing task completion'),
      );
    });

    it('should log job completion summary', async () => {
      const command = {
        jobId: 'job-123',
        taskId: 'task-123',
        success: true,
      };

      const job = createMockJob(10, 9, 0);
      const updatedJob = createMockJob(10, 10, 0);
      const completedJob = updatedJob.transitionToCompleted();

      mockJobRepository.findById.mockResolvedValue(job);
      mockJobRepository.incrementCompletedTasks.mockResolvedValue(updatedJob);
      mockJobRepository.updateJobState.mockResolvedValue(completedJob);

      await useCase.execute(command);

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Job job-123 completed'),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Total: 10, Completed: 10, Failed: 0'),
      );
    });
  });
});
