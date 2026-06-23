import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AcknowledgementsController } from './acknowledgements.controller';
import { AcknowledgementsService } from './acknowledgements.service';

@Module({
  imports: [AuthModule],
  controllers: [AcknowledgementsController],
  providers: [AcknowledgementsService],
  exports: [AcknowledgementsService],
})
export class AcknowledgementsModule {}
