import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { PinoLoggerService } from './pino-logger.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PinoLoggerService],
  exports: [PinoLoggerService],
})
export class LoggingModule {}
