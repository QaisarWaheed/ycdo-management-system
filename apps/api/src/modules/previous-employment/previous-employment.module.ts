import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PreviousEmploymentController } from './previous-employment.controller';
import { PreviousEmploymentService } from './previous-employment.service';

@Module({
  imports: [AuthModule],
  controllers: [PreviousEmploymentController],
  providers: [PreviousEmploymentService],
  exports: [PreviousEmploymentService],
})
export class PreviousEmploymentModule {}
