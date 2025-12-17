import { Injectable, Logger } from '@nestjs/common';
import {
  StepFunctionsPort,
  StepFunctionsTaskSuccessOutput,
  StepFunctionsTaskFailure,
} from '../../../application/ports/output/step-functions.port';
import { StepFunctionsService } from '../../../shared/aws/step-functions/step-functions.service';

/**
 * Step Functions Adapter
 * Implements StepFunctionsPort using AWS Step Functions service
 */
@Injectable()
export class StepFunctionsAdapter implements StepFunctionsPort {
  private readonly logger = new Logger(StepFunctionsAdapter.name);

  constructor(private readonly stepFunctionsService: StepFunctionsService) {}

  async sendTaskSuccess(
    taskToken: string,
    output: StepFunctionsTaskSuccessOutput,
  ): Promise<void> {
    this.logger.log(`Sending task success to Step Functions for job ${output.jobId}`);

    try {
      await this.stepFunctionsService.sendTaskSuccess(taskToken, output);
      this.logger.log(`Successfully sent task success for job ${output.jobId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send task success for job ${output.jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Re-throw to allow caller to handle
      throw error;
    }
  }

  async sendTaskFailure(
    taskToken: string,
    failure: StepFunctionsTaskFailure,
  ): Promise<void> {
    this.logger.warn(`Sending task failure to Step Functions: ${failure.error}`);

    try {
      await this.stepFunctionsService.sendTaskFailure(
        taskToken,
        failure.error,
        failure.cause,
      );
      this.logger.log(`Successfully sent task failure: ${failure.error}`);
    } catch (error) {
      this.logger.error(
        `Failed to send task failure: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Re-throw to allow caller to handle
      throw error;
    }
  }
}
