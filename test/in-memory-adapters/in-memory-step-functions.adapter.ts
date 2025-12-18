import { Injectable } from '@nestjs/common';
import {
  StepFunctionsPort,
  StepFunctionsTaskSuccessOutput,
  StepFunctionsTaskFailure,
} from '../../src/application/ports/output/step-functions.port';

interface CallbackRecord {
  type: 'success' | 'failure';
  taskToken: string;
  timestamp: Date;
  output?: StepFunctionsTaskSuccessOutput;
  failure?: StepFunctionsTaskFailure;
}

/**
 * In-Memory Step Functions Adapter
 * For ATDD testing - captures Step Functions callbacks for verification
 */
@Injectable()
export class InMemoryStepFunctionsAdapter implements StepFunctionsPort {
  private callbacks: CallbackRecord[] = [];

  async sendTaskSuccess(
    taskToken: string,
    output: StepFunctionsTaskSuccessOutput,
  ): Promise<void> {
    this.callbacks.push({
      type: 'success',
      taskToken,
      timestamp: new Date(),
      output,
    });
  }

  async sendTaskFailure(
    taskToken: string,
    failure: StepFunctionsTaskFailure,
  ): Promise<void> {
    this.callbacks.push({
      type: 'failure',
      taskToken,
      timestamp: new Date(),
      failure,
    });
  }

  // Test helper methods

  /**
   * Get all callbacks
   */
  getAllCallbacks(): CallbackRecord[] {
    return [...this.callbacks];
  }

  /**
   * Get success callbacks
   */
  getSuccessCallbacks(): CallbackRecord[] {
    return this.callbacks.filter((cb) => cb.type === 'success');
  }

  /**
   * Get failure callbacks
   */
  getFailureCallbacks(): CallbackRecord[] {
    return this.callbacks.filter((cb) => cb.type === 'failure');
  }

  /**
   * Get callback for a specific task token
   */
  getCallbackForToken(taskToken: string): CallbackRecord | null {
    const callback = this.callbacks.find((cb) => cb.taskToken === taskToken);
    return callback || null;
  }

  /**
   * Check if success was sent for a task token
   */
  wasSuccessSent(taskToken: string): boolean {
    return this.callbacks.some(
      (cb) => cb.taskToken === taskToken && cb.type === 'success',
    );
  }

  /**
   * Check if failure was sent for a task token
   */
  wasFailureSent(taskToken: string): boolean {
    return this.callbacks.some(
      (cb) => cb.taskToken === taskToken && cb.type === 'failure',
    );
  }

  /**
   * Get the success output for a task token
   */
  getSuccessOutput(taskToken: string): StepFunctionsTaskSuccessOutput | null {
    const callback = this.callbacks.find(
      (cb) => cb.taskToken === taskToken && cb.type === 'success',
    );
    return callback?.output || null;
  }

  /**
   * Get the failure details for a task token
   */
  getFailureDetails(taskToken: string): StepFunctionsTaskFailure | null {
    const callback = this.callbacks.find(
      (cb) => cb.taskToken === taskToken && cb.type === 'failure',
    );
    return callback?.failure || null;
  }

  /**
   * Get callback count
   */
  getCallbackCount(): number {
    return this.callbacks.length;
  }

  /**
   * Get success callback count
   */
  getSuccessCount(): number {
    return this.callbacks.filter((cb) => cb.type === 'success').length;
  }

  /**
   * Get failure callback count
   */
  getFailureCount(): number {
    return this.callbacks.filter((cb) => cb.type === 'failure').length;
  }

  /**
   * Clear all callbacks
   */
  clear(): void {
    this.callbacks = [];
  }

  /**
   * Get callbacks in chronological order
   */
  getCallbacksInOrder(): CallbackRecord[] {
    return [...this.callbacks].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
  }

  /**
   * Get the last callback
   */
  getLastCallback(): CallbackRecord | null {
    return this.callbacks.length > 0 ? this.callbacks[this.callbacks.length - 1] : null;
  }

  /**
   * Check if any callback was sent
   */
  hasCallbacks(): boolean {
    return this.callbacks.length > 0;
  }
}
