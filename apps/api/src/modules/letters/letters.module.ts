import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { PayrollModule } from '../payroll/payroll.module';
import { BulkReverseController, BulkReverseService } from './bulk-reverse.service';
import { LettersController } from './letters.controller';
import { LettersService } from './letters.service';
import { AppointmentMappingsService } from './appointment-mappings.service';
import { ShowCauseScheduler } from './show-cause.scheduler';
import { FineAuditController, FineAuditService } from './fine-audit.service';

@Module({
  imports: [AuthModule, WhatsAppModule, PayrollModule],
  controllers: [LettersController, FineAuditController, BulkReverseController],
  providers: [LettersService, AppointmentMappingsService, ShowCauseScheduler, FineAuditService, BulkReverseService],
  exports: [LettersService],
})
export class LettersModule {}
