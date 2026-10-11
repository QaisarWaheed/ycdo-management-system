import {
  Body,
  Controller,
  Get,
  Module,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DoctorPerformanceService } from './doctor-performance.service';

class MonthQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

class PerformanceRowDto {
  @IsUUID()
  employeeId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  opdPatients: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  indoorPatients: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  surgeries: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  labTests: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  collection: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class SavePerformanceDto {
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PerformanceRowDto)
  rows: PerformanceRowDto[];
}

const EXECUTIVES = [UserRole.PRESIDENT, UserRole.FOUNDER, UserRole.CHAIRMAN];

@Controller('doctor-performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DoctorPerformanceController {
  constructor(private performance: DoctorPerformanceService) {}

  /** Finance and executives: this month vs last month for every doctor. */
  @Get()
  @StrictRoles()
  @Roles(UserRole.PAYROLL_OFFICER, ...EXECUTIVES, UserRole.SUPER_ADMIN)
  list(@Query() q: MonthQueryDto) {
    return this.performance.list(q.year, q.month, q.branchId);
  }

  /** Finance enters the month's figures. */
  @Put()
  @StrictRoles()
  @Roles(UserRole.PAYROLL_OFFICER, UserRole.SUPER_ADMIN)
  save(@Body() dto: SavePerformanceDto, @CurrentUser() user: { id: string }) {
    return this.performance.save(dto.year, dto.month, dto.rows, user);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [DoctorPerformanceController],
  providers: [DoctorPerformanceService],
})
export class DoctorPerformanceModule {}
