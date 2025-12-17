# ATDD Test Suite - TODO

## Implemented ✅

### Infrastructure
- [x] Cucumber configuration
- [x] NPM scripts for running tests
- [x] Test directory structure
- [x] Cucumber World class
- [x] Before/After hooks
- [x] Test reports configuration

### In-Memory Adapters (7/7)
- [x] InMemoryJobRepositoryAdapter
- [x] InMemoryExportApiAdapter
- [x] InMemoryFileStorageAdapter
- [x] InMemoryMessageQueueAdapter
- [x] InMemoryWorkerPoolAdapter
- [x] InMemoryEventPublisherAdapter
- [x] InMemoryStepFunctionsAdapter

### Use Case Tests (2/5)
- [x] StartExportJobUseCase
  - [x] Export immediately ready
  - [x] Export needs polling
  - [x] Export already failed
  - [x] Export expired
  - [x] Custom metadata
  - [x] Step Functions task token
- [x] CompleteJobUseCase
  - [x] Task completion tracking
  - [x] Job completion detection
  - [x] Partial failures
  - [x] Step Functions callbacks
  - [x] Concurrent tasks
- [x] End-to-End Workflows
  - [x] Complete workflow - immediate success
  - [x] Workflow with polling
  - [x] Workflow with failures
  - [x] Domain invariant validation

### Documentation
- [x] Main README
- [x] Quick Start Guide
- [x] Architecture Documentation
- [x] ATDD Setup Summary

## Pending ⏳

### Use Case Tests (3/5 remaining)

#### PollExportStatusUseCase
- [ ] Create feature file: `poll-export-status.feature`
- [ ] Create step definitions: `poll-export-status-steps.ts`
- [ ] Test scenarios:
  - [ ] Export becomes READY after polling
  - [ ] Export FAILS during polling
  - [ ] Export EXPIRES during polling
  - [ ] Max polling attempts reached
  - [ ] Job already in terminal state
  - [ ] Poll interval configuration

#### DispatchDownloadTasksUseCase
- [ ] Create feature file: `dispatch-download-tasks.feature`
- [ ] Create step definitions: `dispatch-download-tasks-steps.ts`
- [ ] Test scenarios:
  - [ ] All tasks fit in worker pool
  - [ ] Tasks overflow to queue
  - [ ] Mixed distribution (pool + queue)
  - [ ] Set total tasks correctly
  - [ ] Empty download URLs
  - [ ] Worker pool full scenario

#### ProcessFileUseCase
- [ ] Create feature file: `process-file.feature`
- [ ] Create step definitions: `process-file-steps.ts`
- [ ] Test scenarios:
  - [ ] Successful download and upload
  - [ ] File size validation
  - [ ] Checksum validation
  - [ ] Download failure handling
  - [ ] Upload failure handling
  - [ ] Retry logic

### Additional Test Scenarios

#### Error Handling
- [ ] Network timeout scenarios
- [ ] Invalid export ID
- [ ] Missing required fields
- [ ] Invalid file formats
- [ ] Checksum mismatch
- [ ] S3 upload errors
- [ ] Queue send failures

#### Edge Cases
- [ ] Zero tasks to process
- [ ] Very large file counts (1000+)
- [ ] Concurrent job processing
- [ ] Job cancellation
- [ ] Retry exhaustion
- [ ] Duplicate task completion

#### Domain Invariants
- [ ] JobStateVO invariants
  - [ ] completedTasks + failedTasks <= totalTasks
  - [ ] Non-negative task counts
  - [ ] Valid timestamp ordering
- [ ] FileMetadataVO validation
  - [ ] File size limits (5GB max)
  - [ ] URL pattern validation
  - [ ] Checksum format validation
- [ ] JobStatusVO transitions
  - [ ] Valid state transitions only
  - [ ] Terminal states cannot transition

#### Performance Tests
- [ ] Large job with many tasks (100+)
- [ ] Concurrent task completions
- [ ] Worker pool saturation
- [ ] Queue message batching
- [ ] Event publishing performance

### Integration Scenarios

#### Multi-Job Workflows
- [ ] Multiple jobs running concurrently
- [ ] Job priority handling
- [ ] Queue overflow management
- [ ] Resource contention

#### Failure Recovery
- [ ] Partial job completion
- [ ] Task retry mechanisms
- [ ] Job restart after failure
- [ ] Cleanup after errors

### Documentation

#### Test Examples
- [ ] Add example of testing error scenarios
- [ ] Add example of testing concurrent operations
- [ ] Add example of testing domain invariants
- [ ] Add example of custom assertions

#### Advanced Patterns
- [ ] Testing with custom matchers
- [ ] Parameterized scenarios
- [ ] Scenario outlines with examples
- [ ] Background steps optimization

### Tooling Improvements

#### Test Helpers
- [ ] Create test data builders for entities
- [ ] Add assertion helpers for common checks
- [ ] Create scenario context helpers
- [ ] Add debug utilities

#### Reports
- [ ] HTML report generation
- [ ] Test coverage metrics
- [ ] Scenario tagging (@smoke, @regression)
- [ ] CI/CD integration guide

## Quick Add New Use Case Template

```bash
# 1. Create feature file
touch test/acceptance/features/my-use-case.feature

# 2. Write scenarios in Gherkin

# 3. Create step definitions
touch test/acceptance/step-definitions/my-use-case-steps.ts

# 4. Run to see undefined steps
npm run test:atdd

# 5. Implement steps using in-memory adapters

# 6. Run until green
npm run test:atdd:watch
```

## Priority Order

### High Priority
1. PollExportStatusUseCase - Core workflow component
2. DispatchDownloadTasksUseCase - Distribution logic
3. ProcessFileUseCase - File handling
4. Error handling scenarios - Robustness

### Medium Priority
1. Edge case testing - Boundary conditions
2. Performance tests - Scalability validation
3. Multi-job workflows - Real-world scenarios
4. Domain invariant tests - Data integrity

### Low Priority
1. Advanced documentation - Nice to have
2. Tooling improvements - Quality of life
3. CI/CD integration - Automation

## Notes

- Each use case should have 5-10 scenarios minimum
- Test both happy path and failure scenarios
- Always verify domain events are published
- Check state invariants after each operation
- Use data tables for complex test data
- Keep scenarios independent and isolated

## Contribution Guidelines

When adding new tests:

1. Follow existing patterns in step definitions
2. Reuse common steps when possible
3. Add descriptive scenario names
4. Include test data in fixtures when appropriate
5. Document new adapter features
6. Update this TODO when completing items
7. Run full test suite before committing

## Questions to Answer with Tests

- [ ] What happens when export API is unavailable?
- [ ] How does the system handle partial S3 upload failures?
- [ ] What if a task is completed twice?
- [ ] How are race conditions handled in concurrent operations?
- [ ] What's the behavior with malformed download URLs?
- [ ] How does retry logic work with transient failures?
- [ ] What happens when Step Functions callback fails?
- [ ] How are orphaned jobs cleaned up?

---

**Next Step**: Implement PollExportStatusUseCase tests
**Status**: Foundation complete, ready for expansion
**Last Updated**: 2025-12-17
