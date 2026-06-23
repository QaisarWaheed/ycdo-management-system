import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LettersModule } from '../letters/letters.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [AuthModule, LettersModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
