import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ApplicationQueryDto,
  AcceptCandidateDto,
  SubmitApplicationDto,
  UpdateApplicationStatusDto,
} from './recruitment.dto';
import { RecruitmentService } from './recruitment.service';

@Controller('recruitment')
export class RecruitmentController {
  constructor(private recruitmentService: RecruitmentService) {}

  @Post('apply')
  submit(@Body() dto: SubmitApplicationDto) {
    return this.recruitmentService.submit(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.BRANCH_HR)
  findAll(@Query() query: ApplicationQueryDto) {
    return this.recruitmentService.findAll(query);
  }

  @Post(':id/accept')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  acceptCandidate(@Param('id') id: string, @Body() dto: AcceptCandidateDto) {
    return this.recruitmentService.acceptCandidate(id, dto);
  }

  @Post(':id/convert')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER)
  convertToEmployee(@Param('id') id: string) {
    return this.recruitmentService.convertToEmployee(id);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.BRANCH_HR)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationStatusDto,
  ) {
    return this.recruitmentService.updateStatus(id, dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.BRANCH_HR)
  findOne(@Param('id') id: string) {
    return this.recruitmentService.findOne(id);
  }
}
