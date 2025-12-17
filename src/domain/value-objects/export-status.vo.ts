/**
 * Export Status Value Object
 * Represents the status of an export in the external API
 */
export enum ExportStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

export class ExportStatusVO {
  private constructor(private readonly _value: ExportStatus) {}

  static fromString(value: string): ExportStatusVO {
    const normalizedValue = value.toUpperCase();
    if (!Object.values(ExportStatus).includes(normalizedValue as ExportStatus)) {
      throw new Error(`Invalid export status: ${value}`);
    }
    return new ExportStatusVO(normalizedValue as ExportStatus);
  }

  static pending(): ExportStatusVO {
    return new ExportStatusVO(ExportStatus.PENDING);
  }

  static processing(): ExportStatusVO {
    return new ExportStatusVO(ExportStatus.PROCESSING);
  }

  static ready(): ExportStatusVO {
    return new ExportStatusVO(ExportStatus.READY);
  }

  static failed(): ExportStatusVO {
    return new ExportStatusVO(ExportStatus.FAILED);
  }

  static expired(): ExportStatusVO {
    return new ExportStatusVO(ExportStatus.EXPIRED);
  }

  get value(): ExportStatus {
    return this._value;
  }

  isTerminal(): boolean {
    return [ExportStatus.READY, ExportStatus.FAILED, ExportStatus.EXPIRED].includes(this._value);
  }

  isReady(): boolean {
    return this._value === ExportStatus.READY;
  }

  isFailed(): boolean {
    return this._value === ExportStatus.FAILED;
  }

  isExpired(): boolean {
    return this._value === ExportStatus.EXPIRED;
  }

  isPending(): boolean {
    return this._value === ExportStatus.PENDING || this._value === ExportStatus.PROCESSING;
  }

  equals(other: ExportStatusVO): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
