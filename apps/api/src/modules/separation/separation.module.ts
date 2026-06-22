import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LettersModule } from '../letters/letters.module';
import { PayrollModule } from '../payroll/payroll.module';
import { SeparationController } from './separation.controller';
import { SeparationService } from './separation.service';

@Module({
  imports: [AuthModule, LettersModule, PayrollModule],
  controllers: [SeparationController],
  providers: [SeparationService],
  exports: [SeparationService],
})
export class SeparationModule {}
