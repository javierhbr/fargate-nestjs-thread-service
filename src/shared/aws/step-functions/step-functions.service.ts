import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SFNClient,
  SendTaskSuccessCommand,
  SendTaskFailureCommand,
} from '@aws-sdk/client-sfn';
import { AppConfig } from '../../../config/configuration';
import { PinoLoggerService } from '../../logging/pino-logger.service';

/**
 * Step Functions Service
 * Handles AWS Step Functions task token callbacks
 */
@Injectable()
export class StepFunctionsService implements OnModuleDestroy {
  private readonly client: SFNClient;

  constructor(
    private readonly configService: ConfigService<AppConfig>,
    private readonly logger: PinoLoggerService,
  ) {
    const awsConfig = this.configService.get('aws', { infer: true })!;

    this.client = new SFNClient({
      region: awsConfig.region,
      ...(awsConfig.endpoint && { endpoint: awsConfig.endpoint }),
      ...(awsConfig.credentials && { credentials: awsConfig.credentials }),
    });

    this.logger.setContext(StepFunctionsService.name);
  }

  /**
   * Send task success callback to Step Functions
   * @param taskToken - The task token received from Step Functions
   * @param output - The output data to send (will be JSON stringified)
   */
  async sendTaskSuccess(
    taskToken: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    try {
      const command = new SendTaskSuccessCommand({
        taskToken,
        output: JSON.stringify(output),
      });

      await this.client.send(command);

      this.logger.info(
        {
          taskToken: this.maskTaskToken(taskToken),
          outputKeys: Object.keys(output),
        },
        'Step Functions task success sent',
      );
    } catch (error) {
      this.logger.error(
        {
          taskToken: this.maskTaskToken(taskToken),
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to send Step Functions task success',
      );
      throw error;
    }
  }

  /**
   * Send task failure callback to Step Functions
   * @param taskToken - The task token received from Step Functions
   * @param error - Error name/type
   * @param cause - Detailed error message/cause
   */
  async sendTaskFailure(taskToken: string, error: string, cause: string): Promise<void> {
    try {
      const command = new SendTaskFailureCommand({
        taskToken,
        error,
        cause,
      });

      await this.client.send(command);

      this.logger.info(
        {
          taskToken: this.maskTaskToken(taskToken),
          error,
          cause,
        },
        'Step Functions task failure sent',
      );
    } catch (err) {
      this.logger.error(
        {
          taskToken: this.maskTaskToken(taskToken),
          error: err instanceof Error ? err.message : 'Unknown error',
        },
        'Failed to send Step Functions task failure',
      );
      throw err;
    }
  }

  /**
   * Mask task token for logging (show only first and last 8 characters)
   */
  private maskTaskToken(taskToken: string): string {
    if (taskToken.length <= 16) {
      return '***';
    }
    return `${taskToken.substring(0, 8)}...${taskToken.substring(taskToken.length - 8)}`;
  }

  onModuleDestroy() {
    this.client.destroy();
  }
}
