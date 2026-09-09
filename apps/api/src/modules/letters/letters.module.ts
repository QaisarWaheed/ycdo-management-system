import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { LettersController } from './letters.controller';
import { LettersService } from './letters.service';
import { AppointmentMappingsService } from './appointment-mappings.service';
import { ShowCauseScheduler } from './show-cause.scheduler';

@Module({
  imports: [AuthModule, WhatsAppModule],
  controllers: [LettersController],
  providers: [LettersService, AppointmentMappingsService, ShowCauseScheduler],
  exports: [LettersService],
})
export class LettersModule {}
