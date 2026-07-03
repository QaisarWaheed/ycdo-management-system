import { Module } from '@nestjs/common';
import { AdvanceLoanController } from './advance-loan.controller';
import { AdvanceLoanService } from './advance-loan.service';

@Module({
  controllers: [AdvanceLoanController],
  providers: [AdvanceLoanService],
  exports: [AdvanceLoanService],
})
export class AdvanceLoanModule {}
