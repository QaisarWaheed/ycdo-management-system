import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployeesModule } from '../employees/employees.module';
import { LettersModule } from '../letters/letters.module';
import { DisciplinaryController } from './disciplinary.controller';
import { DisciplinaryService } from './disciplinary.service';

@Module({
  imports: [AuthModule, LettersModule, EmployeesModule],
  controllers: [DisciplinaryController],
  providers: [DisciplinaryService],
  exports: [DisciplinaryService],
})
export class DisciplinaryModule {}
