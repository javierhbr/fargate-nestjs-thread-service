Feature: Complete Job
  As a system
  I want to update job completion status when tasks finish
  So that I can track progress and finalize jobs

  Background:
    Given the export service is initialized
    And a job "job-100" exists with 3 total tasks

  Scenario: Task completes successfully - job not yet complete
    Given the job has 1 completed task and 0 failed tasks
    When I complete task "task-001" for job "job-100" with success
    Then the job should have 2 completed tasks
    And the job should not be marked as complete
    And the job status should be "DOWNLOADING"
    And a "task.completed" event should be published

  Scenario: Last task completes successfully - job completes
    Given the job has 2 completed tasks and 0 failed tasks
    When I complete task "task-003" for job "job-100" with success
    Then the job should have 3 completed tasks
    And the job should be marked as complete
    And the job status should be "COMPLETED"
    And all tasks should have succeeded
    And a "task.completed" event should be published
    And a "job.completed" event should be published

  Scenario: Task fails - job not yet complete
    Given the job has 1 completed task and 0 failed tasks
    When I complete task "task-002" for job "job-100" with failure and error "Download failed"
    Then the job should have 1 failed task
    And the job should not be marked as complete
    And the job status should be "DOWNLOADING"
    And a "task.failed" event should be published

  Scenario: Last task completes with some failures - job completes
    Given the job has 1 completed task and 1 failed task
    When I complete task "task-003" for job "job-100" with success
    Then the job should have 2 completed tasks
    And the job should have 1 failed task
    And the job should be marked as complete
    And the job status should be "COMPLETED"
    And not all tasks should have succeeded
    And a "task.completed" event should be published
    And a "job.completed" event should be published

  Scenario: Job completion with Step Functions callback - all successful
    Given the job has a task token "token-xyz-789"
    And the job has 2 completed tasks and 0 failed tasks
    When I complete task "task-003" for job "job-100" with success
    Then the job should be marked as complete
    And a Step Functions success callback should be sent
    And the success callback should include the job completion details

  Scenario: Job completion with Step Functions callback - with failures
    Given the job has a task token "token-xyz-999"
    And the job has 1 completed task and 1 failed task
    When I complete task "task-003" for job "job-100" with failure and error "Checksum mismatch"
    Then the job should be marked as complete
    And a Step Functions success callback should be sent
    And the success callback should indicate partial success

  Scenario: Multiple tasks complete concurrently
    Given the job has 0 completed tasks and 0 failed tasks
    When I complete the following tasks for job "job-100":
      | taskId   | success | errorMessage |
      | task-001 | true    |              |
      | task-002 | true    |              |
      | task-003 | false   | Network timeout |
    Then the job should have 2 completed tasks
    And the job should have 1 failed task
    And the job should be marked as complete
    And the job status should be "COMPLETED"
