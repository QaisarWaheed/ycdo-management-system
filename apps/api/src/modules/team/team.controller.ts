import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TeamService } from './team.service';

class PairDto {
  @IsUUID()
  departmentId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  designation: string;
}

class AssignDto {
  @IsUUID()
  userId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PairDto)
  pairs: PairDto[];
}

class MonthQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year: number;
}

class ProgressDto extends MonthQuery {
  @IsUUID()
  employeeId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

/** Team In-charge: IT hands out department + designation pairs; the in-charge rates that team. */
@Controller('team')
@UseGuards(JwtAuthGuard, RolesGuard)
@StrictRoles()
export class TeamController {
  constructor(private team: TeamService) {}

  @Get('assignments')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  options() {
    return this.team.options();
  }

  @Post('assignments')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  assign(@Body() dto: AssignDto, @CurrentUser() user: { id: string }) {
    return this.team.assign(user.id, dto.userId, dto.pairs);
  }

  @Delete('assignments/:id')
  @Roles(UserRole.IT_ADMIN, UserRole.SUPER_ADMIN)
  unassign(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.team.unassign(user.id, id);
  }

  @Get('my')
  @Roles(UserRole.TEAM_INCHARGE)
  my(@Query() q: MonthQuery, @CurrentUser() user: { id: string }) {
    return this.team.my(user.id, q.month, q.year);
  }

  @Put('progress')
  @Roles(UserRole.TEAM_INCHARGE)
  saveProgress(@Body() dto: ProgressDto, @CurrentUser() user: { id: string }) {
    return this.team.saveProgress(user.id, dto);
  }
}
