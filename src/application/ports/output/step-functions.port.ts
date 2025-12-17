/**
 * Step Functions Task Success Output
 */
export interface StepFunctionsTaskSuccessOutput {
  jobId: string;
  exportId: string;
  userId: string;
  status: 'COMPLETED';
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  s3Files?: string[];
  completedAt: string;
  durationMs: number;
}

/**
 * Step Functions Task Failure Details
 */
export interface StepFunctionsTaskFailure {
  error: string;
  cause: string;
  jobId?: string;
  exportId?: string;
  totalTasks?: number;
  completedTasks?: number;
  failedTasks?: number;
}

/**
 * Step Functions Port (Driven Port)
 * Interface for sending task token callbacks to AWS Step Functions
 */
export interface StepFunctionsPort {
  /**
   * Send task success callback to Step Functions
   * @param taskToken - The task token received from Step Functions
   * @param output - The success output data
   */
  sendTaskSuccess(
    taskToken: string,
    output: StepFunctionsTaskSuccessOutput,
  ): Promise<void>;

  /**
   * Send task failure callback to Step Functions
   * @param taskToken - The task token received from Step Functions
   * @param failure - The failure details
   */
  sendTaskFailure(taskToken: string, failure: StepFunctionsTaskFailure): Promise<void>;
}
