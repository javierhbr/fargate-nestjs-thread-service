Feature: Start Export Job
  As a system user
  I want to start an export job
  So that I can retrieve exported data from the external API

  Background:
    Given the export service is initialized

  Scenario: Export is immediately ready with download URLs
    Given an export "export-123" for user "user-456" is already READY with download URLs
    When I start an export job with:
      | jobId    | job-001    |
      | exportId | export-123 |
      | userId   | user-456   |
    Then the job should be created successfully
    And the job status should be "DOWNLOADING"
    And the export should not need polling
    And the system should be ready to start downloading
    And a "job.created" event should be published

  Scenario: Export needs polling to become ready
    Given an export "export-124" for user "user-456" is in PROCESSING state
    And the export will become READY after 3 polls
    When I start an export job with:
      | jobId    | job-002    |
      | exportId | export-124 |
      | userId   | user-456   |
    Then the job should be created successfully
    And the job status should be "POLLING"
    And the export should need polling
    And the system should not be ready to start downloading yet
    And a "job.created" event should be published

  Scenario: Export has already failed
    Given an export "export-125" for user "user-456" has FAILED with error "Data extraction failed"
    When I start an export job with:
      | jobId    | job-003    |
      | exportId | export-125 |
      | userId   | user-456   |
    Then the job should be created successfully
    And the job status should be "FAILED"
    And the job should have error message "Data extraction failed"
    And a "job.created" event should be published
    And a "job.failed" event should be published

  Scenario: Export has expired
    Given an export "export-126" for user "user-456" has EXPIRED
    When I start an export job with:
      | jobId    | job-004    |
      | exportId | export-126 |
      | userId   | user-456   |
    Then the job should be created successfully
    And the job status should be "FAILED"
    And the job should have error message containing "expired"
    And a "job.created" event should be published
    And a "job.failed" event should be published

  Scenario: Start export with custom metadata
    Given an export "export-127" for user "user-456" is already READY with download URLs
    When I start an export job with:
      | jobId    | job-005    |
      | exportId | export-127 |
      | userId   | user-456   |
      | metadata | {"type": "full", "format": "csv"} |
    Then the job should be created successfully
    And the job should have metadata:
      | type   | full |
      | format | csv  |

  Scenario: Start export with Step Functions task token
    Given an export "export-128" for user "user-456" is already READY with download URLs
    When I start an export job with:
      | jobId     | job-006    |
      | exportId  | export-128 |
      | userId    | user-456   |
      | taskToken | token-abc-123 |
    Then the job should be created successfully
    And the job should have task token "token-abc-123"
    And the job status should be "DOWNLOADING"
