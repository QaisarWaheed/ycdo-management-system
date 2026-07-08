import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BiometricDevicesController } from './biometric-devices.controller';
import { BiometricDevicesService } from './biometric-devices.service';

@Module({
  imports: [AuthModule],
  controllers: [BiometricDevicesController],
  providers: [BiometricDevicesService],
  exports: [BiometricDevicesService],
})
export class BiometricDevicesModule {}
