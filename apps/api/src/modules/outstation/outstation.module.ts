import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OutstationController } from './outstation.controller';
import { OutstationService } from './outstation.service';

@Module({
  imports: [AuthModule],
  controllers: [OutstationController],
  providers: [OutstationService],
  exports: [OutstationService],
})
export class OutstationModule {}
