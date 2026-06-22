import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateLetterReplyDto } from './letter-replies.dto';
import { LetterRepliesService } from './letter-replies.service';

@Controller('letter-replies')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LetterRepliesController {
  constructor(private letterRepliesService: LetterRepliesService) {}

  @Post()
  @Roles(UserRole.EMPLOYEE)
  reply(
    @Body() dto: CreateLetterReplyDto,
    @CurrentUser() user: { employeeId?: string | null },
  ) {
    return this.letterRepliesService.reply(dto, user.employeeId!);
  }

  @Get('letter/:letterId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_MANAGER, UserRole.BRANCH_HR)
  findRepliesByLetter(@Param('letterId') letterId: string) {
    return this.letterRepliesService.findRepliesByLetter(letterId);
  }

  @Get('my')
  @Roles(UserRole.EMPLOYEE)
  findMyReplies(@CurrentUser() user: { employeeId?: string | null }) {
    return this.letterRepliesService.findMyReplies(user.employeeId!);
  }
}
