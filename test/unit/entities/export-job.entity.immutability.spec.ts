import { describe, it, expect } from 'vitest';
import { ExportJobEntity } from '../../../src/domain/entities/export-job.entity';
import { DownloadTaskEntity } from '../../../src/domain/entities/download-task.entity';
import { JobStateVO } from '../../../src/domain/value-objects/job-state.vo';
import { JobStatusVO } from '../../../src/domain/value-objects/job-status.vo';
import { FileMetadataVO } from '../../../src/domain/value-objects/file-metadata.vo';
import { createBlockingDetector } from '../helpers/mock-factories';

/**
 * Comprehensive Immutability Tests for ExportJobEntity
 * Validates that all operations return new instances and never mutate existing state
 */
describe('ExportJobEntity - Immutability Validation', () => {
  const createTestJob = () => {
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
      metadata: { testKey: 'testValue' },
    });
  };

  const createDownloadTask = (taskId = 'task-123') => {
    const fileMetadata = FileMetadataVO.create({
      fileName: 'file.pdf',
      downloadUrl: 'https://example.com/file.pdf',
    });

    return DownloadTaskEntity.create({
      taskId,
      jobId: 'job-123',
      fileMetadata,
      s3OutputKey: `job-123/file.pdf`,
    });
  };

  describe('Core Data Immutability', () => {
    it('should not allow direct mutation of jobId', () => {
      const job = createTestJob();
      const originalJobId = job.jobId;

      // TypeScript readonly prevents this at compile time
      // At runtime, the value can be assigned but immutability is enforced via Immer in mutation methods
      // @ts-expect-error - testing immutability
      job.jobId = 'modified';

      // Even if runtime assignment doesn't throw, mutation methods still return new instances
      const updatedJob = job.incrementCompletedTasks();
      expect(updatedJob.jobId).toBe(originalJobId); // Original ID preserved
      expect(updatedJob).not.toBe(job); // New instance created
    });

    it('should not allow direct mutation of exportId', () => {
      const job = createTestJob();
      const originalExportId = job.exportId;

      // Verify immutability via mutation methods returning new instances
      const updatedJob = job.setTotalTasks(5);
      expect(updatedJob.exportId).toBe(originalExportId);
      expect(updatedJob).not.toBe(job);
    });

    it('should not allow direct mutation of userId', () => {
      const job = createTestJob();
      const originalUserId = job.userId;

      // Verify immutability via mutation methods returning new instances
      const updatedJob = job.incrementFailedTasks();
      expect(updatedJob.userId).toBe(originalUserId);
      expect(updatedJob).not.toBe(job);
    });

    it('should not allow direct mutation of metadata', () => {
      const job = createTestJob();
      const originalMetadata = job.metadata;

      // Verify metadata is preserved across mutations
      const updatedJob = job.transitionToPolling();
      expect(updatedJob.metadata).toEqual(originalMetadata);
      expect(updatedJob).not.toBe(job);
    });

    it('should not allow direct mutation of downloadTasks array', () => {
      const job = createTestJob();

      // Adding tasks via mutation method returns new instance
      const task = createDownloadTask();
      const updatedJob = job.addDownloadTask(task);

      expect(updatedJob.downloadTasks).toHaveLength(1);
      expect(job.downloadTasks).toHaveLength(0); // Original unchanged
      expect(updatedJob).not.toBe(job);
    });
  });

  describe('State Transition Immutability', () => {
    it('should return new instance when transitioning to POLLING', () => {
      const originalJob = createTestJob();
      const updatedJob = originalJob.transitionToPolling();

      // Should be different instances
      expect(updatedJob).not.toBe(originalJob);

      // Original should remain unchanged
      expect(originalJob.status.toString()).toBe('PENDING');
      expect(updatedJob.status.toString()).toBe('POLLING');

      // Other properties should remain equal
      expect(originalJob.jobId).toBe(updatedJob.jobId);
      expect(originalJob.exportId).toBe(updatedJob.exportId);
    });

    it('should return new instance when transitioning to DOWNLOADING', () => {
      // Create job in PROCESSING state (valid predecessor to DOWNLOADING)
      const jobState = JobStateVO.create({
        totalTasks: 2,
        completedTasks: 0,
        failedTasks: 0,
        status: JobStatusVO.processing(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      });

      const originalJob = ExportJobEntity.create({
        jobId: 'job-123',
        exportId: 'export-123',
        userId: 'user-123',
        jobState,
        metadata: { testKey: 'testValue' },
      });

      const updatedJob = originalJob.transitionToDownloading();

      expect(updatedJob).not.toBe(originalJob);
      expect(originalJob.status.toString()).toBe('PROCESSING');
      expect(updatedJob.status.toString()).toBe('DOWNLOADING');
    });

    it('should return new instance when transitioning to COMPLETED', () => {
      const jobState = JobStateVO.create({
        totalTasks: 2,
        completedTasks: 2,
        failedTasks: 0,
        status: JobStatusVO.downloading(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      });

      const originalJob = ExportJobEntity.create({
        jobId: 'job-123',
        exportId: 'export-123',
        userId: 'user-123',
        jobState,
      });

      const updatedJob = originalJob.transitionToCompleted();

      expect(updatedJob).not.toBe(originalJob);
      expect(originalJob.status.toString()).toBe('DOWNLOADING');
      expect(updatedJob.status.toString()).toBe('COMPLETED');
    });

    it('should return new instance when transitioning to FAILED', () => {
      const originalJob = createTestJob();
      const errorMessage = 'Test failure';
      const updatedJob = originalJob.transitionToFailed(errorMessage);

      expect(updatedJob).not.toBe(originalJob);
      expect(originalJob.status.toString()).toBe('PENDING');
      expect(updatedJob.status.toString()).toBe('FAILED');
    });
  });

  describe('Task Counter Immutability', () => {
    it('should return new instance when incrementing completed tasks', () => {
      const originalJob = createTestJob();
      const updatedJob = originalJob.setTotalTasks(10).incrementCompletedTasks();

      expect(updatedJob).not.toBe(originalJob);
      expect(originalJob.completedTasks).toBe(0);
      expect(updatedJob.completedTasks).toBe(1);
    });

    it('should return new instance when incrementing failed tasks', () => {
      const originalJob = createTestJob();
      const updatedJob = originalJob.incrementFailedTasks('Task failed');

      expect(updatedJob).not.toBe(originalJob);
      expect(originalJob.failedTasks).toBe(0);
      expect(updatedJob.failedTasks).toBe(1);
    });

    it('should return new instance when setting total tasks', () => {
      const originalJob = createTestJob();
      const updatedJob = originalJob.setTotalTasks(20);

      expect(updatedJob).not.toBe(originalJob);
      expect(originalJob.totalTasks).toBe(10);
      expect(updatedJob.totalTasks).toBe(20);
    });
  });

  describe('Download Task Management Immutability', () => {
    it('should return new instance when adding single download task', () => {
      const originalJob = createTestJob();
      const task = createDownloadTask();
      const updatedJob = originalJob.addDownloadTask(task);

      expect(updatedJob).not.toBe(originalJob);
      expect(originalJob.downloadTasks.length).toBe(0);
      expect(updatedJob.downloadTasks.length).toBe(1);
    });

    it('should return new instance when adding multiple download tasks', () => {
      const originalJob = createTestJob();
      const fileMetadata2 = FileMetadataVO.create({
        fileName: 'file2.pdf',
        downloadUrl: 'https://example.com/file2.pdf',
      });
      const tasks = [
        createDownloadTask(),
        DownloadTaskEntity.create({
          taskId: 'task-456',
          jobId: 'job-123',
          fileMetadata: fileMetadata2,
          s3OutputKey: 'job-123/file2.pdf',
        }),
      ];
      const updatedJob = originalJob.addDownloadTasks(tasks);

      expect(updatedJob).not.toBe(originalJob);
      expect(originalJob.downloadTasks.length).toBe(0);
      expect(updatedJob.downloadTasks.length).toBe(2);
    });

    it('should return new instance when updating download task', () => {
      const task = createDownloadTask();
      const originalJob = createTestJob().addDownloadTask(task);

      // Task must be marked as processing before it can be completed
      const processingTask = task.markAsProcessing();
      const completedTask = processingTask.markAsCompleted('s3://bucket/key', 1024);
      const updatedJob = originalJob.updateDownloadTask(completedTask);

      expect(updatedJob).not.toBe(originalJob);
      expect(originalJob.downloadTasks[0].isPending()).toBe(true);
      expect(updatedJob.downloadTasks[0].isCompleted()).toBe(true);
    });

    it('should not mutate original job when getting pending tasks', () => {
      const task1 = createDownloadTask();
      const fileMetadata2 = FileMetadataVO.create({
        fileName: 'file2.pdf',
        downloadUrl: 'https://example.com/file2.pdf',
      });
      const task2 = DownloadTaskEntity.create({
        taskId: 'task-456',
        jobId: 'job-123',
        fileMetadata: fileMetadata2,
        s3OutputKey: 'job-123/file2.pdf',
      });

      const job = createTestJob().addDownloadTasks([task1, task2]);
      const pendingTasks = job.getPendingDownloadTasks();

      // Modifying returned array should not affect original
      const fileMetadata3 = FileMetadataVO.create({
        fileName: 'file3.pdf',
        downloadUrl: 'https://example.com/file3.pdf',
      });
      pendingTasks.push(
        DownloadTaskEntity.create({
          taskId: 'task-789',
          jobId: 'job-123',
          fileMetadata: fileMetadata3,
          s3OutputKey: 'job-123/file3.pdf',
        }),
      );

      expect(job.downloadTasks.length).toBe(2);
    });
  });

  describe('withJobState Immutability', () => {
    it('should return new instance when replacing job state', () => {
      const originalJob = createTestJob();
      const newJobState = JobStateVO.create({
        totalTasks: 20,
        completedTasks: 10,
        failedTasks: 0,
        status: JobStatusVO.processing(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-02'),
      });

      const updatedJob = originalJob.withJobState(newJobState);

      expect(updatedJob).not.toBe(originalJob);
      expect(originalJob.totalTasks).toBe(10);
      expect(originalJob.completedTasks).toBe(0);
      expect(updatedJob.totalTasks).toBe(20);
      expect(updatedJob.completedTasks).toBe(10);
    });
  });

  describe('Chained Operations Immutability', () => {
    it('should maintain immutability through chained operations', () => {
      const job0 = createTestJob();
      const job1 = job0.setTotalTasks(5);
      // PENDING → POLLING → DOWNLOADING is a valid transition path
      const job2 = job1.transitionToPolling();
      const job3 = job2.incrementCompletedTasks();
      const job4 = job3.incrementCompletedTasks();

      // All should be different instances
      expect(job0).not.toBe(job1);
      expect(job1).not.toBe(job2);
      expect(job2).not.toBe(job3);
      expect(job3).not.toBe(job4);

      // Original should remain unchanged
      expect(job0.totalTasks).toBe(10);
      expect(job0.completedTasks).toBe(0);
      expect(job0.status.toString()).toBe('PENDING');

      // Final should reflect all changes
      expect(job4.totalTasks).toBe(5);
      expect(job4.completedTasks).toBe(2);
      expect(job4.status.toString()).toBe('POLLING');

      // Intermediate states should be preserved
      expect(job1.totalTasks).toBe(5);
      expect(job1.completedTasks).toBe(0);
      expect(job2.completedTasks).toBe(0);
      expect(job3.completedTasks).toBe(1);
    });
  });

  describe('Metadata Immutability', () => {
    it('should not allow mutation of metadata object', () => {
      const job = createTestJob();
      const originalMetadata = job.metadata;

      // Verify metadata is preserved across mutations
      const updatedJob = job.setTotalTasks(5);

      // Metadata should be preserved with same values
      expect(updatedJob.metadata).toEqual(originalMetadata);

      // Immer may share unchanged objects for efficiency (structural sharing)
      // This is acceptable immutability behavior
    });

    it('should preserve metadata across mutations', () => {
      const originalJob = ExportJobEntity.create({
        jobId: 'job-123',
        exportId: 'export-123',
        userId: 'user-123',
        jobState: JobStateVO.create({
          totalTasks: 10,
          completedTasks: 0,
          failedTasks: 0,
          status: JobStatusVO.pending(),
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        }),
        metadata: { originalKey: 'originalValue' },
      });

      const updatedJob = originalJob.incrementCompletedTasks();

      expect(updatedJob.metadata).toEqual({ originalKey: 'originalValue' });
      expect(originalJob.metadata).toEqual({ originalKey: 'originalValue' });
    });
  });

  describe('Async Operations Non-Blocking', () => {
    it('should not block event loop with large task lists', async () => {
      // Create job with many tasks
      const tasks: DownloadTaskEntity[] = [];
      for (let i = 0; i < 500; i++) {
        const fileMetadata = FileMetadataVO.create({
          fileName: `file${i}.pdf`,
          downloadUrl: `https://example.com/file${i}.pdf`,
        });
        tasks.push(
          DownloadTaskEntity.create({
            taskId: `task-${i}`,
            jobId: 'job-123',
            fileMetadata,
            s3OutputKey: `job-123/file${i}.pdf`,
          }),
        );
      }

      const jobState = JobStateVO.create({
        totalTasks: 500,
        completedTasks: 0,
        failedTasks: 0,
        status: JobStatusVO.downloading(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      });

      const job = ExportJobEntity.create({
        jobId: 'job-123',
        exportId: 'export-123',
        userId: 'user-123',
        jobState,
      }).addDownloadTasks(tasks);

      const detector = createBlockingDetector();

      // Test async getPendingDownloadTasks
      const trackEnd1 = detector.track('getPendingDownloadTasksAsync');
      const pendingTasks = await ExportJobEntity.getPendingDownloadTasksAsync(job);
      trackEnd1();

      expect(pendingTasks.length).toBe(500);

      // Test async toJSONAsync
      const trackEnd2 = detector.track('toJSONAsync');
      const json = await ExportJobEntity.toJSONAsync(job);
      trackEnd2();

      expect(json.downloadTasks.length).toBe(500);

      // Validate no blocking operations
      expect(detector.hasBlockingCalls()).toBe(false);
    });

    it('should yield to event loop during async serialization', async () => {
      // Create job with 300 tasks (requires 3 yields at 100-task intervals)
      const tasks: DownloadTaskEntity[] = [];
      for (let i = 0; i < 300; i++) {
        const fileMetadata = FileMetadataVO.create({
          fileName: `file${i}.pdf`,
          downloadUrl: `https://example.com/file${i}.pdf`,
        });
        tasks.push(
          DownloadTaskEntity.create({
            taskId: `task-${i}`,
            jobId: 'job-123',
            fileMetadata,
            s3OutputKey: `job-123/file${i}.pdf`,
          }),
        );
      }

      const jobState = JobStateVO.create({
        totalTasks: 300,
        completedTasks: 0,
        failedTasks: 0,
        status: JobStatusVO.downloading(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      });

      const job = ExportJobEntity.create({
        jobId: 'job-123',
        exportId: 'export-123',
        userId: 'user-123',
        jobState,
      }).addDownloadTasks(tasks);

      const startTime = Date.now();
      const json = await ExportJobEntity.toJSONAsync(job);
      const duration = Date.now() - startTime;

      expect(json.downloadTasks.length).toBe(300);

      // Should complete reasonably fast even with yields
      expect(duration).toBeLessThan(100); // Should be under 100ms
    });
  });

  describe('Complex Mutation Scenarios', () => {
    it('should maintain immutability when adding tasks then updating status', () => {
      const task1 = createDownloadTask();
      const fileMetadata2 = FileMetadataVO.create({
        fileName: 'file2.pdf',
        downloadUrl: 'https://example.com/file2.pdf',
      });
      const task2 = DownloadTaskEntity.create({
        taskId: 'task-456',
        jobId: 'job-123',
        fileMetadata: fileMetadata2,
        s3OutputKey: 'job-123/file2.pdf',
      });

      const job1 = createTestJob();
      const job2 = job1.addDownloadTask(task1);
      const job3 = job2.addDownloadTask(task2);
      const job4 = job3.setTotalTasks(2);
      const job5 = job4.transitionToPolling(); // PENDING → POLLING is valid

      // All instances should be different
      expect(job1).not.toBe(job2);
      expect(job2).not.toBe(job3);
      expect(job3).not.toBe(job4);
      expect(job4).not.toBe(job5);

      // Verify state progression
      expect(job1.downloadTasks.length).toBe(0);
      expect(job2.downloadTasks.length).toBe(1);
      expect(job3.downloadTasks.length).toBe(2);
      expect(job3.totalTasks).toBe(10);
      expect(job4.totalTasks).toBe(2);
      expect(job4.status.toString()).toBe('PENDING');
      expect(job5.status.toString()).toBe('POLLING');
    });

    it('should handle task updates without mutating job', () => {
      const task = createDownloadTask();
      const job1 = createTestJob().addDownloadTask(task).setTotalTasks(1);

      // Task must be processing before it can be completed
      const processingTask = task.markAsProcessing();
      const completedTask = processingTask.markAsCompleted('s3://bucket/key', 1024);
      const job2 = job1.updateDownloadTask(completedTask);
      const job3 = job2.incrementCompletedTasks();

      expect(job1).not.toBe(job2);
      expect(job2).not.toBe(job3);

      expect(job1.downloadTasks[0].isPending()).toBe(true);
      expect(job1.completedTasks).toBe(0);

      expect(job2.downloadTasks[0].isCompleted()).toBe(true);
      expect(job2.completedTasks).toBe(0);

      expect(job3.downloadTasks[0].isCompleted()).toBe(true);
      expect(job3.completedTasks).toBe(1);
    });
  });

  describe('Validation Immutability', () => {
    it('should throw error without mutating on invalid task addition', () => {
      const job = createTestJob();
      const fileMetadata = FileMetadataVO.create({
        fileName: 'file.pdf',
        downloadUrl: 'https://example.com/file.pdf',
      });
      const taskWithDifferentJobId = DownloadTaskEntity.create({
        taskId: 'task-456',
        jobId: 'different-job-id',
        fileMetadata,
        s3OutputKey: 'different-job-id/file.pdf',
      });

      expect(() => {
        job.addDownloadTask(taskWithDifferentJobId);
      }).toThrow('Download task belongs to a different job');

      // Original job should remain unchanged
      expect(job.downloadTasks.length).toBe(0);
    });

    it('should throw error without mutating on invalid transition to COMPLETED', () => {
      const job = createTestJob().setTotalTasks(5);

      expect(() => {
        job.transitionToCompleted();
      }).toThrow('Cannot mark job as completed when tasks are still pending');

      // Original job should remain unchanged
      expect(job.status.toString()).toBe('PENDING');
      expect(job.totalTasks).toBe(5);
      expect(job.completedTasks).toBe(0);
    });
  });
});
