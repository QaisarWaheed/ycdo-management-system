import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as path from 'path';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
import { BroadcastsModule } from './modules/broadcasts/broadcasts.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { DisciplinaryModule } from './modules/disciplinary/disciplinary.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { LeaveModule } from './modules/leave/leave.module';
import { LetterRepliesModule } from './modules/letter-replies/letter-replies.module';
import { LettersModule } from './modules/letters/letters.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RecruitmentModule } from './modules/recruitment/recruitment.module';
import { SeparationModule } from './modules/separation/separation.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: path.join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    PrismaModule,
    AuthModule,
    BranchesModule,
    DepartmentsModule,
    EmployeesModule,
    DocumentsModule,
    AttendanceModule,
    LeaveModule,
    PayrollModule,
    LettersModule,
    DisciplinaryModule,
    SeparationModule,
    RecruitmentModule,
    NotificationsModule,
    ProjectsModule,
    ShiftsModule,
    LetterRepliesModule,
    BroadcastsModule,
  ],
})
export class AppModule {}
