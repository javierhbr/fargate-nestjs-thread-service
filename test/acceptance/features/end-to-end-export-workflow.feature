Feature: End-to-End Export Workflow
  As a system
  I want to complete a full export job workflow
  So that users can successfully export and download their data

  Background:
    Given the export service is initialized

  Scenario: Complete export workflow - immediate success
    # Start the export job
    Given an export "export-e2e-001" for user "user-999" is already READY with download URLs:
      | https://api.example.com/files/file1.csv |
      | https://api.example.com/files/file2.csv |
    And the file storage is configured
    And the message queue is ready
    When I start an export job with:
      | jobId     | job-e2e-001    |
      | exportId  | export-e2e-001 |
      | userId    | user-999       |
      | taskToken | token-e2e-abc  |
    Then the job should be created successfully
    And the job status should be "DOWNLOADING"
    And the export should not need polling

    # Verify events published
    Then a "job.created" event should be published

    # Complete all tasks successfully
    When I complete task "task-001" for job "job-e2e-001" with success
    Then the job should have 1 completed tasks
    And the job should not be marked as complete

    When I complete task "task-002" for job "job-e2e-001" with success
    Then the job should have 2 completed tasks
    And the job should be marked as complete
    And the job status should be "COMPLETED"
    And all tasks should have succeeded

    # Verify Step Functions callback
    Then a Step Functions success callback should be sent
    And the success callback should include the job completion details

    # Verify all events published
    And a "job.completed" event should be published
    And exactly 2 "task.completed" events should be published

  Scenario: Complete export workflow - with polling
    # Start export that needs polling
    Given an export "export-e2e-002" for user "user-999" will transition to READY after polling
    When I start an export job with:
      | jobId    | job-e2e-002    |
      | exportId | export-e2e-002 |
      | userId   | user-999       |
    Then the job should be created successfully
    And the job status should be "POLLING"
    And the export should need polling

    # Poll the export status
    When I poll the export status for job "job-e2e-002"
    Then the job status should be "DOWNLOADING"
    And download URLs should be available

    # Verify job updated with download tasks
    Then the job should have total tasks set

  Scenario: Complete export workflow - with partial failures
    # Start the export job
    Given an export "export-e2e-003" for user "user-999" is already READY with download URLs:
      | https://api.example.com/files/file1.csv |
      | https://api.example.com/files/file2.csv |
      | https://api.example.com/files/file3.csv |
    When I start an export job with:
      | jobId     | job-e2e-003    |
      | exportId  | export-e2e-003 |
      | userId    | user-999       |
      | taskToken | token-e2e-xyz  |
    Then the job should be created successfully

    # Complete tasks with one failure
    When I complete the following tasks for job "job-e2e-003":
      | taskId   | success | errorMessage     |
      | task-001 | true    |                  |
      | task-002 | false   | Download timeout |
      | task-003 | true    |                  |

    Then the job should have 2 completed tasks
    And the job should have 1 failed task
    And the job should be marked as complete
    And not all tasks should have succeeded

    # Verify Step Functions callback still sent (with failure info)
    Then a Step Functions success callback should be sent
    And the success callback should indicate partial success

    # Verify events
    And a "job.completed" event should be published
    And exactly 2 "task.completed" events should be published
    And exactly 1 "task.failed" events should be published

  Scenario: Export workflow - complete failure during polling
    # Start export that will fail during polling
    Given an export "export-e2e-004" for user "user-999" will fail during polling with error "Data source unavailable"
    When I start an export job with:
      | jobId    | job-e2e-004    |
      | exportId | export-e2e-004 |
      | userId   | user-999       |
    Then the job should be created successfully
    And the job status should be "POLLING"

    # Poll and discover failure
    When I poll the export status for job "job-e2e-004"
    Then the job status should be "FAILED"
    And the job should have error message "Data source unavailable"
    And a "job.failed" event should be published

  Scenario: Validate domain invariants throughout workflow
    Given an export "export-e2e-005" for user "user-999" is already READY with download URLs:
      | https://api.example.com/files/file1.csv |
    When I start an export job with:
      | jobId    | job-e2e-005    |
      | exportId | export-e2e-005 |
      | userId   | user-999       |

    # Verify initial state invariants
    Then the job should have valid state:
      | totalTasks     | 1 |
      | completedTasks | 0 |
      | failedTasks    | 0 |

    # Complete the task
    When I complete task "task-001" for job "job-e2e-005" with success

    # Verify final state invariants
    Then the job should have valid state:
      | totalTasks     | 1 |
      | completedTasks | 1 |
      | failedTasks    | 0 |

    # Verify completed + failed <= total invariant holds
    And the job state invariants should be valid
