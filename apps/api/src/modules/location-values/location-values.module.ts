import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationValuesController } from './location-values.controller';
import { LocationValuesService } from './location-values.service';

@Module({
  imports: [AuthModule],
  controllers: [LocationValuesController],
  providers: [LocationValuesService],
  exports: [LocationValuesService],
})
export class LocationValuesModule {}
