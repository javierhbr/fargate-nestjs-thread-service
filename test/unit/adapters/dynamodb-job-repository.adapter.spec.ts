import { describe, it, expect, beforeEach } from 'vitest';
import { DynamoDbJobRepositoryAdapter } from '../../../src/infrastructure/adapters/persistence/dynamodb-job-repository.adapter';
import { ExportJobEntity } from '../../../src/domain/entities/export-job.entity';
import { JobStateVO } from '../../../src/domain/value-objects/job-state.vo';
import { JobStatusVO } from '../../../src/domain/value-objects/job-status.vo';
import {
  createMockDynamoDBService,
  createMockLogger,
  createBlockingDetector,
} from '../helpers/mock-factories';

describe('DynamoDbJobRepositoryAdapter', () => {
  let adapter: DynamoDbJobRepositoryAdapter;
  let mockDynamoDb: ReturnType<typeof createMockDynamoDBService>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let blockingDetector: ReturnType<typeof createBlockingDetector>;

  const createMockJobState = () => ({
    jobId: 'job-123',
    exportId: 'export-123',
    userId: 'user-123',
    status: 'PENDING',
    totalTasks: 10,
    completedTasks: 0,
    failedTasks: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    metadata: {},
  });

  const createMockJob = () => {
    const jobState = JobStateVO.create({
      totalTasks: 10,
      completedTasks: 0,
      failedTasks: 0,
      status: JobStatusVO.pending(),
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    return ExportJobEntity.create({
      jobId: 'job-123',
      exportId: 'export-123',
      userId: 'user-123',
      jobState,
      metadata: {},
    });
  };

  beforeEach(() => {
    mockDynamoDb = createMockDynamoDBService() as any;
    mockLogger = createMockLogger();
    blockingDetector = createBlockingDetector();

    // Create adapter directly (no NestJS testing utilities)
    adapter = new DynamoDbJobRepositoryAdapter(mockDynamoDb as any);

    // Replace logger with mock
    (adapter as any).logger = mockLogger;
  });

  describe('save', () => {
    it('should save job to DynamoDB successfully', async () => {
      const job = createMockJob();
      mockDynamoDb.createJobState.mockResolvedValue(undefined);

      const trackEnd = blockingDetector.track('save');
      await adapter.save(job);
      trackEnd();

      expect(mockDynamoDb.createJobState).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-123',
          exportId: 'export-123',
          userId: 'user-123',
          status: 'PENDING',
          totalTasks: 10,
          completedTasks: 0,
          failedTasks: 0,
        }),
      );
      expect(mockLogger.log).toHaveBeenCalledWith('Saved job job-123 to DynamoDB');

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should not mutate job entity during save', async () => {
      const job = createMockJob();
      const originalJobStateJson = JSON.parse(JSON.stringify(job.jobState));

      mockDynamoDb.createJobState.mockResolvedValue(undefined);

      await adapter.save(job);

      // Validate job state was not mutated by comparing serialized forms
      const currentJobStateJson = JSON.parse(JSON.stringify(job.jobState));
      expect(currentJobStateJson).toEqual(originalJobStateJson);
    });

    it('should include taskToken when present', async () => {
      const jobState = JobStateVO.create({
        totalTasks: 10,
        completedTasks: 0,
        failedTasks: 0,
        status: JobStatusVO.pending(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      });

      const job = ExportJobEntity.create({
        jobId: 'job-123',
        exportId: 'export-123',
        userId: 'user-123',
        jobState,
        taskToken: 'task-token-abc',
      });

      mockDynamoDb.createJobState.mockResolvedValue(undefined);

      await adapter.save(job);

      expect(mockDynamoDb.createJobState).toHaveBeenCalledWith(
        expect.objectContaining({
          taskToken: 'task-token-abc',
        }),
      );
    });

    it('should include error when present in job state', async () => {
      const jobState = JobStateVO.create({
        totalTasks: 10,
        completedTasks: 0,
        failedTasks: 1,
        status: JobStatusVO.failed(),
        errorMessage: 'Test error',
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      });

      const job = ExportJobEntity.create({
        jobId: 'job-123',
        exportId: 'export-123',
        userId: 'user-123',
        jobState,
      });

      mockDynamoDb.createJobState.mockResolvedValue(undefined);

      await adapter.save(job);

      expect(mockDynamoDb.createJobState).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            code: 'JOB_ERROR',
            message: 'Test error',
          },
        }),
      );
    });
  });

  describe('findById', () => {
    it('should find job by ID successfully', async () => {
      const mockJobState = createMockJobState();
      mockDynamoDb.getJobState.mockResolvedValue(mockJobState);

      const trackEnd = blockingDetector.track('findById');
      const job = await adapter.findById('job-123');
      trackEnd();

      expect(job).not.toBeNull();
      expect(job?.jobId).toBe('job-123');
      expect(job?.exportId).toBe('export-123');
      expect(job?.userId).toBe('user-123');
      expect(job?.totalTasks).toBe(10);
      expect(mockDynamoDb.getJobState).toHaveBeenCalledWith('job-123');

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should return null when job not found', async () => {
      mockDynamoDb.getJobState.mockResolvedValue(null);

      const job = await adapter.findById('non-existent-job');

      expect(job).toBeNull();
    });

    it('should create immutable domain entity from database state', async () => {
      const mockJobState = createMockJobState();
      mockDynamoDb.getJobState.mockResolvedValue(mockJobState);

      const job = await adapter.findById('job-123');

      // Verify entity mutation methods return new instances (immutability via Immer)
      const originalJobId = job?.jobId;
      const updatedJob = job?.incrementCompletedTasks();

      // Original job should be unchanged
      expect(job?.jobId).toBe(originalJobId);
      expect(job?.completedTasks).toBe(0);

      // Updated job should be a new instance with changes
      expect(updatedJob).not.toBe(job);
      expect(updatedJob?.completedTasks).toBe(1);
    });
  });

  describe('updateJobState', () => {
    it('should update job state successfully', async () => {
      const newJobState = JobStateVO.create({
        totalTasks: 10,
        completedTasks: 5,
        failedTasks: 0,
        status: JobStatusVO.processing(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-02'),
      });

      const updatedMockJobState = {
        ...createMockJobState(),
        completedTasks: 5,
        status: 'PROCESSING',
        updatedAt: '2025-01-02T00:00:00.000Z',
      };

      mockDynamoDb.updateJobStatus.mockResolvedValue(undefined);
      mockDynamoDb.getJobState.mockResolvedValue(updatedMockJobState);

      const trackEnd = blockingDetector.track('updateJobState');
      const updatedJob = await adapter.updateJobState('job-123', newJobState);
      trackEnd();

      expect(mockDynamoDb.updateJobStatus).toHaveBeenCalledWith(
        'job-123',
        'PROCESSING',
        expect.objectContaining({
          totalTasks: 10,
          completedTasks: 5,
          failedTasks: 0,
        }),
      );
      expect(updatedJob.completedTasks).toBe(5);
      expect(updatedJob.status.toString()).toBe('PROCESSING');

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should include error message when present', async () => {
      const newJobState = JobStateVO.create({
        totalTasks: 10,
        completedTasks: 0,
        failedTasks: 1,
        status: JobStatusVO.failed(),
        errorMessage: 'Processing failed',
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      });

      mockDynamoDb.updateJobStatus.mockResolvedValue(undefined);
      mockDynamoDb.getJobState.mockResolvedValue(createMockJobState());

      await adapter.updateJobState('job-123', newJobState);

      expect(mockDynamoDb.updateJobStatus).toHaveBeenCalledWith(
        'job-123',
        'FAILED',
        expect.objectContaining({
          error: {
            code: 'JOB_ERROR',
            message: 'Processing failed',
          },
        }),
      );
    });

    it('should throw error when job not found after update', async () => {
      const newJobState = JobStateVO.create({
        totalTasks: 10,
        completedTasks: 0,
        failedTasks: 0,
        status: JobStatusVO.pending(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      });

      mockDynamoDb.updateJobStatus.mockResolvedValue(undefined);
      mockDynamoDb.getJobState.mockResolvedValue(null);

      await expect(adapter.updateJobState('job-123', newJobState)).rejects.toThrow(
        'Job job-123 not found after update',
      );
    });
  });

  describe('incrementCompletedTasks', () => {
    it('should increment completed tasks successfully', async () => {
      const updatedMockJobState = {
        ...createMockJobState(),
        completedTasks: 1,
      };

      mockDynamoDb.incrementTaskCount.mockResolvedValue(undefined);
      mockDynamoDb.getJobState.mockResolvedValue(updatedMockJobState);

      const trackEnd = blockingDetector.track('incrementCompletedTasks');
      const updatedJob = await adapter.incrementCompletedTasks('job-123');
      trackEnd();

      expect(mockDynamoDb.incrementTaskCount).toHaveBeenCalledWith(
        'job-123',
        'completedTasks',
      );
      expect(updatedJob.completedTasks).toBe(1);

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should throw error when job not found after increment', async () => {
      mockDynamoDb.incrementTaskCount.mockResolvedValue(undefined);
      mockDynamoDb.getJobState.mockResolvedValue(null);

      await expect(adapter.incrementCompletedTasks('job-123')).rejects.toThrow(
        'Job job-123 not found after increment',
      );
    });
  });

  describe('incrementFailedTasks', () => {
    it('should increment failed tasks without error message', async () => {
      const updatedMockJobState = {
        ...createMockJobState(),
        failedTasks: 1,
      };

      mockDynamoDb.incrementTaskCount.mockResolvedValue(undefined);
      mockDynamoDb.getJobState.mockResolvedValue(updatedMockJobState);

      const trackEnd = blockingDetector.track('incrementFailedTasks');
      const updatedJob = await adapter.incrementFailedTasks('job-123');
      trackEnd();

      expect(mockDynamoDb.incrementTaskCount).toHaveBeenCalledWith(
        'job-123',
        'failedTasks',
      );
      expect(mockDynamoDb.updateJobStatus).not.toHaveBeenCalled();
      expect(updatedJob.failedTasks).toBe(1);

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should increment failed tasks with error message', async () => {
      const updatedMockJobState = {
        ...createMockJobState(),
        failedTasks: 1,
        status: 'FAILED',
        error: { code: 'TASK_ERROR', message: 'Task processing failed' },
      };

      mockDynamoDb.incrementTaskCount.mockResolvedValue(undefined);
      mockDynamoDb.updateJobStatus.mockResolvedValue(undefined);
      mockDynamoDb.getJobState.mockResolvedValue(updatedMockJobState);

      const updatedJob = await adapter.incrementFailedTasks(
        'job-123',
        'Task processing failed',
      );

      expect(mockDynamoDb.incrementTaskCount).toHaveBeenCalledWith(
        'job-123',
        'failedTasks',
      );
      expect(mockDynamoDb.updateJobStatus).toHaveBeenCalledWith('job-123', 'FAILED', {
        error: {
          code: 'TASK_ERROR',
          message: 'Task processing failed',
        },
      });
      expect(updatedJob.failedTasks).toBe(1);
    });
  });

  describe('setTotalTasks', () => {
    it('should set total tasks successfully', async () => {
      const updatedMockJobState = {
        ...createMockJobState(),
        totalTasks: 20,
      };

      mockDynamoDb.setTotalTasks.mockResolvedValue(undefined);
      mockDynamoDb.getJobState.mockResolvedValue(updatedMockJobState);

      const trackEnd = blockingDetector.track('setTotalTasks');
      const updatedJob = await adapter.setTotalTasks('job-123', 20);
      trackEnd();

      expect(mockDynamoDb.setTotalTasks).toHaveBeenCalledWith('job-123', 20);
      expect(updatedJob.totalTasks).toBe(20);

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should throw error when job not found after setTotalTasks', async () => {
      mockDynamoDb.setTotalTasks.mockResolvedValue(undefined);
      mockDynamoDb.getJobState.mockResolvedValue(null);

      await expect(adapter.setTotalTasks('job-123', 20)).rejects.toThrow(
        'Job job-123 not found after setTotalTasks',
      );
    });
  });

  describe('delete', () => {
    it('should delete job successfully', async () => {
      mockDynamoDb.deleteJobState.mockResolvedValue(undefined);

      const trackEnd = blockingDetector.track('delete');
      await adapter.delete('job-123');
      trackEnd();

      expect(mockDynamoDb.deleteJobState).toHaveBeenCalledWith('job-123');
      expect(mockLogger.log).toHaveBeenCalledWith('Deleted job job-123 from DynamoDB');

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });
  });

  describe('findByStatus', () => {
    it('should find jobs by status successfully', async () => {
      const mockJobStates = [
        { ...createMockJobState(), jobId: 'job-1' },
        { ...createMockJobState(), jobId: 'job-2' },
      ];

      mockDynamoDb.getJobsByStatus.mockResolvedValue(mockJobStates);

      const trackEnd = blockingDetector.track('findByStatus');
      const jobs = await adapter.findByStatus('PENDING');
      trackEnd();

      expect(jobs).toHaveLength(2);
      expect(jobs[0].jobId).toBe('job-1');
      expect(jobs[1].jobId).toBe('job-2');
      expect(mockDynamoDb.getJobsByStatus).toHaveBeenCalledWith('PENDING', undefined);

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should find jobs by status with limit', async () => {
      const mockJobStates = [{ ...createMockJobState(), jobId: 'job-1' }];

      mockDynamoDb.getJobsByStatus.mockResolvedValue(mockJobStates);

      const jobs = await adapter.findByStatus('PENDING', 10);

      expect(jobs).toHaveLength(1);
      expect(mockDynamoDb.getJobsByStatus).toHaveBeenCalledWith('PENDING', 10);
    });

    it('should return empty array when no jobs found', async () => {
      mockDynamoDb.getJobsByStatus.mockResolvedValue([]);

      const jobs = await adapter.findByStatus('COMPLETED');

      expect(jobs).toEqual([]);
    });

    it('should map status values correctly', async () => {
      mockDynamoDb.getJobsByStatus.mockResolvedValue([]);

      await adapter.findByStatus('PROCESSING');
      expect(mockDynamoDb.getJobsByStatus).toHaveBeenCalledWith('PROCESSING', undefined);

      await adapter.findByStatus('POLLING');
      expect(mockDynamoDb.getJobsByStatus).toHaveBeenCalledWith('POLLING', undefined);

      await adapter.findByStatus('DOWNLOADING');
      expect(mockDynamoDb.getJobsByStatus).toHaveBeenCalledWith('DOWNLOADING', undefined);
    });
  });

  describe('Immutability Validation', () => {
    it('should not mutate job entity when converting to JobState', async () => {
      const job = createMockJob();
      const originalJobData = JSON.parse(JSON.stringify(job));

      mockDynamoDb.createJobState.mockResolvedValue(undefined);

      await adapter.save(job);

      // Validate job was not mutated by comparing serialized forms
      const currentJobData = JSON.parse(JSON.stringify(job));
      expect(currentJobData).toEqual(originalJobData);
    });

    it('should create new immutable entities from database', async () => {
      const mockJobState = createMockJobState();
      mockDynamoDb.getJobState.mockResolvedValue(mockJobState);

      const job = await adapter.findById('job-123');

      // Verify mutation methods return new instances, not modify in place
      const updatedJob = job?.setTotalTasks(20);

      // Original job should be unchanged
      expect(job?.totalTasks).toBe(10);

      // Updated job should be a new instance with changes
      expect(updatedJob).not.toBe(job);
      expect(updatedJob?.totalTasks).toBe(20);
    });

    it('should not mutate JobStateVO during updates', async () => {
      const jobState = JobStateVO.create({
        totalTasks: 10,
        completedTasks: 5,
        failedTasks: 0,
        status: JobStatusVO.processing(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-02'),
      });

      const originalJobStateJson = JSON.parse(JSON.stringify(jobState));

      mockDynamoDb.updateJobStatus.mockResolvedValue(undefined);
      mockDynamoDb.getJobState.mockResolvedValue(createMockJobState());

      await adapter.updateJobState('job-123', jobState);

      // Validate JobStateVO was not mutated by comparing serialized forms
      const currentJobStateJson = JSON.parse(JSON.stringify(jobState));
      expect(currentJobStateJson).toEqual(originalJobStateJson);
    });
  });

  describe('Blocking Operations Detection', () => {
    it('should not have any synchronous blocking operations', async () => {
      const mockJobState = createMockJobState();
      const job = createMockJob();
      const newJobState = JobStateVO.create({
        totalTasks: 10,
        completedTasks: 5,
        failedTasks: 0,
        status: JobStatusVO.processing(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-02'),
      });

      // Mock all DynamoDB operations
      mockDynamoDb.createJobState.mockResolvedValue(undefined);
      mockDynamoDb.getJobState.mockResolvedValue(mockJobState);
      mockDynamoDb.updateJobStatus.mockResolvedValue(undefined);
      mockDynamoDb.incrementTaskCount.mockResolvedValue(undefined);
      mockDynamoDb.setTotalTasks.mockResolvedValue(undefined);
      mockDynamoDb.deleteJobState.mockResolvedValue(undefined);
      mockDynamoDb.getJobsByStatus.mockResolvedValue([mockJobState]);

      const detector = createBlockingDetector();

      // Test save
      let trackEnd = detector.track('save');
      await adapter.save(job);
      trackEnd();

      // Test findById
      trackEnd = detector.track('findById');
      await adapter.findById('job-123');
      trackEnd();

      // Test updateJobState
      trackEnd = detector.track('updateJobState');
      await adapter.updateJobState('job-123', newJobState);
      trackEnd();

      // Test incrementCompletedTasks
      trackEnd = detector.track('incrementCompletedTasks');
      await adapter.incrementCompletedTasks('job-123');
      trackEnd();

      // Test incrementFailedTasks
      trackEnd = detector.track('incrementFailedTasks');
      await adapter.incrementFailedTasks('job-123');
      trackEnd();

      // Test setTotalTasks
      trackEnd = detector.track('setTotalTasks');
      await adapter.setTotalTasks('job-123', 20);
      trackEnd();

      // Test delete
      trackEnd = detector.track('delete');
      await adapter.delete('job-123');
      trackEnd();

      // Test findByStatus
      trackEnd = detector.track('findByStatus');
      await adapter.findByStatus('PENDING');
      trackEnd();

      // Assert: No blocking operations detected
      expect(detector.hasBlockingCalls()).toBe(false);
      expect(detector.getBlockingCalls()).toHaveLength(0);
    });
  });
});
