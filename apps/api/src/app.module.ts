import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as path from 'path';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AcknowledgementsModule } from './modules/acknowledgements/acknowledgements.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuthModule } from './modules/auth/auth.module';
import { BiometricDevicesModule } from './modules/biometric-devices/biometric-devices.module';
import { BranchesModule } from './modules/branches/branches.module';
import { BroadcastsModule } from './modules/broadcasts/broadcasts.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { DesignationsModule } from './modules/designations/designations.module';
import { DisciplinaryModule } from './modules/disciplinary/disciplinary.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EmployeeOnboardingModule } from './modules/employee-onboarding/employee-onboarding.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { LeaveModule } from './modules/leave/leave.module';
import { LetterRepliesModule } from './modules/letter-replies/letter-replies.module';
import { LettersModule } from './modules/letters/letters.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OutstationModule } from './modules/outstation/outstation.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { PreviousEmploymentModule } from './modules/previous-employment/previous-employment.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { QualificationsModule } from './modules/qualifications/qualifications.module';
import { RecruitmentModule } from './modules/recruitment/recruitment.module';
import { SeparationModule } from './modules/separation/separation.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { StipendReceiptsModule } from './modules/stipend-receipts/stipend-receipts.module';
import { IncentivesModule } from './modules/incentives/incentives.module';
import { UserAccessModule } from './modules/user-access/user-access.module';
import { UserPasswordsModule } from './modules/user-passwords/user-passwords.module';
import { FaceSyncModule } from './modules/face-sync/face-sync.module';
import { LocationValuesModule } from './modules/location-values/location-values.module';
import { MutualSwapModule } from './modules/mutual-swap/mutual-swap.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
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
    PermissionsModule,
    AuditLogsModule,
    AuthModule,
    BranchesModule,
    BiometricDevicesModule,
    DepartmentsModule,
    DesignationsModule,
    EmployeesModule,
    EmployeeOnboardingModule,
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
    QualificationsModule,
    PreviousEmploymentModule,
    OutstationModule,
    AcknowledgementsModule,
    StipendReceiptsModule,
    IncentivesModule,
    UserPasswordsModule,
    UserAccessModule,
    FaceSyncModule,
    LocationValuesModule,
    MutualSwapModule,
  ],
})
export class AppModule {}
