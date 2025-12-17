import { Before, After, AfterAll, BeforeAll, Status } from '@cucumber/cucumber';
import { ExportJobWorld } from './world';
import { clearEndToEndAdapters } from '../step-definitions/end-to-end-steps';
import { clearCompleteJobAdapters } from '../step-definitions/complete-job-steps';

BeforeAll(async function () {
  // Global setup - runs once before all scenarios
  console.log('Starting ATDD test suite...');
});

Before(async function (this: ExportJobWorld) {
  // Reset context before each scenario
  this.reset();

  // Clear all in-memory adapters to prevent state leakage between scenarios
  clearEndToEndAdapters();
  clearCompleteJobAdapters();
});

After(async function (this: ExportJobWorld, { result }) {
  // Cleanup after each scenario
  if (this.context.testingModule) {
    await this.context.testingModule.close();
    this.context.testingModule = null;
  }

  // Log failures for debugging
  if (result?.status === Status.FAILED) {
    console.error('Scenario failed:', result.message);
    if (this.context.lastError) {
      console.error('Last error:', this.context.lastError);
    }
  }
});

AfterAll(async function () {
  // Global teardown - runs once after all scenarios
  console.log('ATDD test suite completed.');
});
