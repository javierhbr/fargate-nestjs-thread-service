/**
 * Job Status Value Object
 * Represents the internal status of an export job
 */
export enum JobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  POLLING = 'POLLING',
  DOWNLOADING = 'DOWNLOADING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export class JobStatusVO {
  private constructor(private readonly _value: JobStatus) {}

  static fromString(value: string): JobStatusVO {
    const normalizedValue = value.toUpperCase();
    if (!Object.values(JobStatus).includes(normalizedValue as JobStatus)) {
      throw new Error(`Invalid job status: ${value}`);
    }
    return new JobStatusVO(normalizedValue as JobStatus);
  }

  static pending(): JobStatusVO {
    return new JobStatusVO(JobStatus.PENDING);
  }

  static processing(): JobStatusVO {
    return new JobStatusVO(JobStatus.PROCESSING);
  }

  static polling(): JobStatusVO {
    return new JobStatusVO(JobStatus.POLLING);
  }

  static downloading(): JobStatusVO {
    return new JobStatusVO(JobStatus.DOWNLOADING);
  }

  static completed(): JobStatusVO {
    return new JobStatusVO(JobStatus.COMPLETED);
  }

  static failed(): JobStatusVO {
    return new JobStatusVO(JobStatus.FAILED);
  }

  get value(): JobStatus {
    return this._value;
  }

  isTerminal(): boolean {
    return [JobStatus.COMPLETED, JobStatus.FAILED].includes(this._value);
  }

  isPending(): boolean {
    return this._value === JobStatus.PENDING;
  }

  isCompleted(): boolean {
    return this._value === JobStatus.COMPLETED;
  }

  isFailed(): boolean {
    return this._value === JobStatus.FAILED;
  }

  canTransitionTo(newStatus: JobStatusVO): boolean {
    const transitions: Record<JobStatus, JobStatus[]> = {
      [JobStatus.PENDING]: [JobStatus.PROCESSING, JobStatus.POLLING, JobStatus.FAILED],
      [JobStatus.PROCESSING]: [
        JobStatus.DOWNLOADING,
        JobStatus.POLLING,
        JobStatus.FAILED,
      ],
      [JobStatus.POLLING]: [JobStatus.DOWNLOADING, JobStatus.FAILED],
      [JobStatus.DOWNLOADING]: [JobStatus.COMPLETED, JobStatus.FAILED],
      [JobStatus.COMPLETED]: [],
      [JobStatus.FAILED]: [],
    };

    return transitions[this._value]?.includes(newStatus._value) ?? false;
  }

  equals(other: JobStatusVO): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
