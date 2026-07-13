import { Module } from '@nestjs/common';
import { LettersModule } from '../letters/letters.module';
import { EmployeeOnboardingController } from './employee-onboarding.controller';
import { EmployeeOnboardingService } from './employee-onboarding.service';

@Module({
  imports: [LettersModule],
  controllers: [EmployeeOnboardingController],
  providers: [EmployeeOnboardingService],
  exports: [EmployeeOnboardingService],
})
export class EmployeeOnboardingModule {}
