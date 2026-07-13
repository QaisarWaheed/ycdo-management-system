import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { LettersModule } from '../letters/letters.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [AuthModule, LettersModule, FaceSyncModule, PermissionsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
