import * as fs from 'fs';
import * as path from 'path';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
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
import { BranchShift, UserRole } from '@prisma/client';
import { fileResponse } from '../../common/employee-files.util';
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
  labCollection: number;

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

class BranchShiftRowDto {
  @IsUUID()
  branchId: string;

  @IsEnum(BranchShift)
  shift: BranchShift;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  patients: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  labCollection: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  collection: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class SaveBranchPerformanceDto {
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
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BranchShiftRowDto)
  rows: BranchShiftRowDto[];
}

/** Branch progress reports: private folder (blocked in main.ts), PDF or image, 10 MB. */
const REPORT_DIR = path.join(process.cwd(), 'uploads', 'branch-reports');
const REPORT_EXT = ['.pdf', '.jpg', '.jpeg', '.png'];
const reportUpload = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      cb(null, REPORT_DIR);
    },
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    cb: (error: Error | null, accept: boolean) => void,
  ) =>
    REPORT_EXT.includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new BadRequestException('Only PDF, JPG or PNG files'), false),
  limits: { fileSize: 10 * 1024 * 1024 },
};

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

  /** Branch Day / Night figures, progress reports and Admin Officers. */
  @Get('branches')
  @StrictRoles()
  @Roles(UserRole.PAYROLL_OFFICER, ...EXECUTIVES, UserRole.SUPER_ADMIN)
  branches(@Query() q: MonthQueryDto) {
    return this.performance.branches(q.year, q.month);
  }

  /** Finance enters branch figures per shift. */
  @Put('branches')
  @StrictRoles()
  @Roles(UserRole.PAYROLL_OFFICER, UserRole.SUPER_ADMIN)
  saveBranches(
    @Body() dto: SaveBranchPerformanceDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.performance.saveBranches(dto.year, dto.month, dto.rows, user);
  }

  /** Finance uploads the branch's monthly progress report. */
  @Post('branches/:branchId/report')
  @StrictRoles()
  @Roles(UserRole.PAYROLL_OFFICER, UserRole.SUPER_ADMIN)
  @UseInterceptors(FileInterceptor('file', reportUpload))
  uploadReport(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() q: MonthQueryDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: { id: string },
  ) {
    if (!file) throw new BadRequestException('Choose a file');
    return this.performance.saveReport(branchId, q.year, q.month, file, user);
  }

  @Get('branches/report/:id')
  @StrictRoles()
  @Roles(UserRole.PAYROLL_OFFICER, ...EXECUTIVES, UserRole.SUPER_ADMIN)
  async report(@Param('id', ParseUUIDPipe) id: string) {
    const { fileName, stream } = await this.performance.openReport(id);
    return fileResponse(stream, fileName);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [DoctorPerformanceController],
  providers: [DoctorPerformanceService],
})
export class DoctorPerformanceModule {}
