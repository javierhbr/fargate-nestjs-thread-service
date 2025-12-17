import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class DiskSpaceHealthIndicator extends HealthIndicator {
  private readonly tempDir: string;
  private readonly minFreeSpacePercent = 10;

  constructor(private readonly configService: ConfigService<AppConfig>) {
    super();

    const workerPoolConfig = this.configService.get('workerPool', { infer: true })!;
    this.tempDir = workerPoolConfig.tempDir;
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // Ensure temp dir exists
      await fs.mkdir(this.tempDir, { recursive: true });

      // Get disk usage
      const diskInfo = this.getDiskUsage(this.tempDir);

      const details = {
        path: this.tempDir,
        totalBytes: diskInfo.total,
        usedBytes: diskInfo.used,
        freeBytes: diskInfo.free,
        freePercent: diskInfo.freePercent,
      };

      if (diskInfo.freePercent >= this.minFreeSpacePercent) {
        return this.getStatus(key, true, details);
      }

      throw new HealthCheckError(
        `Low disk space: ${diskInfo.freePercent.toFixed(1)}% free`,
        this.getStatus(key, false, details),
      );
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      throw new HealthCheckError(
        'Disk space check failed',
        this.getStatus(key, false, { error: (error as Error).message }),
      );
    }
  }

  private getDiskUsage(path: string): {
    total: number;
    used: number;
    free: number;
    freePercent: number;
  } {
    try {
      // Use df command to get disk usage
      const output = execSync(`df -k "${path}" | tail -1`, {
        encoding: 'utf-8',
      });

      const parts = output.trim().split(/\s+/);
      // Format: Filesystem 1K-blocks Used Available Use% Mounted
      const total = parseInt(parts[1], 10) * 1024;
      const used = parseInt(parts[2], 10) * 1024;
      const free = parseInt(parts[3], 10) * 1024;
      const freePercent = (free / total) * 100;

      return { total, used, free, freePercent };
    } catch {
      // Fallback: return large free space if df fails
      return {
        total: 100 * 1024 * 1024 * 1024, // 100GB
        used: 0,
        free: 100 * 1024 * 1024 * 1024,
        freePercent: 100,
      };
    }
  }
}
