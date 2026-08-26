import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployeesModule } from '../employees/employees.module';
import { LettersModule } from '../letters/letters.module';
import { DisciplinaryController } from './disciplinary.controller';
import { DisciplinaryService } from './disciplinary.service';
import { InquiryDeadlineScheduler } from './inquiry-deadline.scheduler';
import { InquiryDecisionService } from './inquiry-decision.service';
import { SuspensionRequestService } from './suspension-request.service';

@Module({
  imports: [AuthModule, LettersModule, EmployeesModule],
  controllers: [DisciplinaryController],
  providers: [
    DisciplinaryService,
    SuspensionRequestService,
    InquiryDecisionService,
    InquiryDeadlineScheduler,
  ],
  exports: [
    DisciplinaryService,
    SuspensionRequestService,
    InquiryDecisionService,
  ],
})
export class DisciplinaryModule {}
