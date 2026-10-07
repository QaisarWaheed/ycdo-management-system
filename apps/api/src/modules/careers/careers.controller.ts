import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApplicantAuthGuard } from './applicant-auth.guard';
import { CareersService } from './careers.service';
import {
  CreateJobDto,
  LoginApplicantDto,
  RegisterApplicantDto,
  SubmitApplicationDto,
  UpdateApplicationStatusDto,
  UpdateJobDto,
} from './careers.dto';

@Controller('careers')
export class CareersController {
  constructor(private readonly careersService: CareersService) {}

  // ── Public: Applicant Auth ──────────────────────────────

  @Post('auth/register')
  register(@Body() dto: RegisterApplicantDto) {
    return this.careersService.register(dto);
  }

  @Post('auth/login')
  loginApplicant(@Body() dto: LoginApplicantDto) {
    return this.careersService.login(dto);
  }

  // ── Public: Jobs ────────────────────────────────────────

  @Get('jobs')
  listPublicJobs() {
    return this.careersService.listPublicJobs();
  }

  @Get('jobs/:id')
  getPublicJob(@Param('id') id: string) {
    return this.careersService.getPublicJob(id);
  }

  // ── Applicant: Apply ────────────────────────────────────

  @UseGuards(ApplicantAuthGuard)
  @Post('jobs/:id/apply')
  apply(
    @Param('id') jobId: string,
    @Body() dto: SubmitApplicationDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.careersService.submitApplication(jobId, req.user.id, dto);
  }

  @UseGuards(ApplicantAuthGuard)
  @Get('my-applications')
  myApplications(@Request() req: { user: { id: string } }) {
    return this.careersService.myApplications(req.user.id);
  }

  // ── HR: Job Management ──────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('admin/jobs')
  createJob(@Body() dto: CreateJobDto) {
    return this.careersService.createJob(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/jobs')
  listAllJobs(@Query('status') status?: string) {
    return this.careersService.listAllJobs(status);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('admin/jobs/:id')
  updateJob(@Param('id') id: string, @Body() dto: UpdateJobDto) {
    return this.careersService.updateJob(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('admin/jobs/:id')
  deleteJob(@Param('id') id: string) {
    return this.careersService.deleteJob(id);
  }

  // ── HR: Applications ─────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('admin/applications')
  listApplications(
    @Query('jobId') jobId?: string,
    @Query('status') status?: string,
  ) {
    return this.careersService.listApplications(jobId, status);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/applications/:id')
  getApplication(@Param('id') id: string) {
    return this.careersService.getApplication(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('admin/applications/:id/status')
  updateApplicationStatus(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationStatusDto,
  ) {
    return this.careersService.updateApplicationStatus(id, dto);
  }
}
