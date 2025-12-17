import { JobStatusVO } from './job-status.vo';

/**
 * Job State Value Object
 * Represents the persistent state of an export job
 */
export interface JobStateProps {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  status: JobStatusVO;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class JobStateVO {
  private readonly _totalTasks: number;
  private readonly _completedTasks: number;
  private readonly _failedTasks: number;
  private readonly _status: JobStatusVO;
  private readonly _errorMessage?: string;
  private readonly _createdAt: Date;
  private readonly _updatedAt: Date;

  private constructor(props: JobStateProps) {
    this._totalTasks = props.totalTasks;
    this._completedTasks = props.completedTasks;
    this._failedTasks = props.failedTasks;
    this._status = props.status;
    this._errorMessage = props.errorMessage;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
  }

  static create(props: Partial<JobStateProps> = {}): JobStateVO {
    const now = new Date();
    const defaultProps: JobStateProps = {
      totalTasks: props.totalTasks ?? 0,
      completedTasks: props.completedTasks ?? 0,
      failedTasks: props.failedTasks ?? 0,
      status: props.status ?? JobStatusVO.pending(),
      errorMessage: props.errorMessage,
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now,
    };

    JobStateVO.validate(defaultProps);
    return new JobStateVO(defaultProps);
  }

  private static validate(props: JobStateProps): void {
    if (props.totalTasks < 0) {
      throw new Error('Total tasks cannot be negative');
    }
    if (props.completedTasks < 0) {
      throw new Error('Completed tasks cannot be negative');
    }
    if (props.failedTasks < 0) {
      throw new Error('Failed tasks cannot be negative');
    }
    if (props.completedTasks > props.totalTasks) {
      throw new Error('Completed tasks cannot exceed total tasks');
    }
    if (props.failedTasks > props.totalTasks) {
      throw new Error('Failed tasks cannot exceed total tasks');
    }
    if (props.completedTasks + props.failedTasks > props.totalTasks) {
      throw new Error('Sum of completed and failed tasks cannot exceed total tasks');
    }
  }

  get totalTasks(): number {
    return this._totalTasks;
  }

  get completedTasks(): number {
    return this._completedTasks;
  }

  get failedTasks(): number {
    return this._failedTasks;
  }

  get status(): JobStatusVO {
    return this._status;
  }

  get errorMessage(): string | undefined {
    return this._errorMessage;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get pendingTasks(): number {
    return this._totalTasks - this._completedTasks - this._failedTasks;
  }

  get progressPercentage(): number {
    if (this._totalTasks === 0) return 0;
    return Math.floor((this._completedTasks / this._totalTasks) * 100);
  }

  isComplete(): boolean {
    return (
      this._completedTasks + this._failedTasks === this._totalTasks &&
      this._totalTasks > 0
    );
  }

  hasFailures(): boolean {
    return this._failedTasks > 0;
  }

  allTasksSucceeded(): boolean {
    return this.isComplete() && this._failedTasks === 0;
  }

  withIncrementedCompleted(): JobStateVO {
    return JobStateVO.create({
      totalTasks: this._totalTasks,
      completedTasks: this._completedTasks + 1,
      failedTasks: this._failedTasks,
      status: this._status,
      errorMessage: this._errorMessage,
      createdAt: this._createdAt,
      updatedAt: new Date(),
    });
  }

  withIncrementedFailed(errorMessage?: string): JobStateVO {
    return JobStateVO.create({
      totalTasks: this._totalTasks,
      completedTasks: this._completedTasks,
      failedTasks: this._failedTasks + 1,
      status: this._status,
      errorMessage: errorMessage ?? this._errorMessage,
      createdAt: this._createdAt,
      updatedAt: new Date(),
    });
  }

  withStatus(newStatus: JobStatusVO, errorMessage?: string): JobStateVO {
    if (!this._status.canTransitionTo(newStatus)) {
      throw new Error(`Invalid status transition from ${this._status} to ${newStatus}`);
    }

    return JobStateVO.create({
      totalTasks: this._totalTasks,
      completedTasks: this._completedTasks,
      failedTasks: this._failedTasks,
      status: newStatus,
      errorMessage: errorMessage ?? this._errorMessage,
      createdAt: this._createdAt,
      updatedAt: new Date(),
    });
  }

  withTotalTasks(totalTasks: number): JobStateVO {
    return JobStateVO.create({
      totalTasks,
      completedTasks: this._completedTasks,
      failedTasks: this._failedTasks,
      status: this._status,
      errorMessage: this._errorMessage,
      createdAt: this._createdAt,
      updatedAt: new Date(),
    });
  }

  toJSON() {
    return {
      totalTasks: this._totalTasks,
      completedTasks: this._completedTasks,
      failedTasks: this._failedTasks,
      pendingTasks: this.pendingTasks,
      status: this._status.toString(),
      errorMessage: this._errorMessage,
      progressPercentage: this.progressPercentage,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
