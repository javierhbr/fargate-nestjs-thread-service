/**
 * File Metadata Value Object
 * Encapsulates file validation rules and metadata
 */
export interface FileMetadataProps {
  fileName: string;
  downloadUrl: string;
  expectedSize?: number;
  checksum?: string;
  checksumAlgorithm?: 'SHA-256' | 'MD5';
}

export class FileMetadataVO {
  private readonly _fileName: string;
  private readonly _downloadUrl: string;
  private readonly _expectedSize?: number;
  private readonly _checksum?: string;
  private readonly _checksumAlgorithm?: 'SHA-256' | 'MD5';

  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
  private static readonly VALID_URL_PATTERN = /^https?:\/\/.+/;

  private constructor(props: FileMetadataProps) {
    this._fileName = props.fileName;
    this._downloadUrl = props.downloadUrl;
    this._expectedSize = props.expectedSize;
    this._checksum = props.checksum;
    this._checksumAlgorithm = props.checksumAlgorithm;
  }

  static create(props: FileMetadataProps): FileMetadataVO {
    FileMetadataVO.validate(props);
    return new FileMetadataVO(props);
  }

  private static validate(props: FileMetadataProps): void {
    if (!props.fileName || props.fileName.trim().length === 0) {
      throw new Error('File name cannot be empty');
    }

    if (!props.downloadUrl || !FileMetadataVO.VALID_URL_PATTERN.test(props.downloadUrl)) {
      throw new Error('Invalid download URL');
    }

    if (props.expectedSize !== undefined) {
      if (props.expectedSize < 0) {
        throw new Error('Expected file size cannot be negative');
      }
      if (props.expectedSize > FileMetadataVO.MAX_FILE_SIZE) {
        throw new Error(`File size exceeds maximum allowed size of ${FileMetadataVO.MAX_FILE_SIZE} bytes`);
      }
    }

    if (props.checksum && !props.checksumAlgorithm) {
      throw new Error('Checksum algorithm must be specified when checksum is provided');
    }
  }

  get fileName(): string {
    return this._fileName;
  }

  get downloadUrl(): string {
    return this._downloadUrl;
  }

  get expectedSize(): number | undefined {
    return this._expectedSize;
  }

  get checksum(): string | undefined {
    return this._checksum;
  }

  get checksumAlgorithm(): 'SHA-256' | 'MD5' | undefined {
    return this._checksumAlgorithm;
  }

  hasChecksum(): boolean {
    return this._checksum !== undefined && this._checksumAlgorithm !== undefined;
  }

  validateFileSize(actualSize: number): boolean {
    if (this._expectedSize === undefined) {
      return actualSize <= FileMetadataVO.MAX_FILE_SIZE;
    }
    return actualSize === this._expectedSize;
  }

  toJSON() {
    return {
      fileName: this._fileName,
      downloadUrl: this._downloadUrl,
      expectedSize: this._expectedSize,
      checksum: this._checksum,
      checksumAlgorithm: this._checksumAlgorithm,
    };
  }
}
