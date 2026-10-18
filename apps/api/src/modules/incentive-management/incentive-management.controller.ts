import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
import { PaySuggestionKind, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, StrictRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DECIDE_ROLES, IncentiveManagementService, SUGGEST_ROLES } from './incentive-management.service';

class MonthQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month: number;
  @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year: number;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
}

class SuggestDto {
  @IsUUID() employeeId: string;
  @IsEnum(PaySuggestionKind) kind: PaySuggestionKind;
  @IsUUID() typeId: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month: number;
  @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year: number;
  @Type(() => Number) @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class ApplyItem {
  @IsUUID() employeeId: string;
  @IsEnum(PaySuggestionKind) kind: PaySuggestionKind;
  @IsUUID() typeId: string;
  @Type(() => Number) @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class ApplyDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month: number;
  @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ApplyItem)
  items: ApplyItem[];
}

class RejectDto {
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) suggestionIds: string[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

type JwtUser = { id: string; role: UserRole; roles?: UserRole[] };
const actor = (u: JwtUser) => ({ id: u.id, role: u.role, roles: u.roles?.length ? u.roles : [u.role] });

/** Phase 2 Req 7 & 8: suggested / previous / current incentives and allowances. */
@Controller('incentive-management')
@UseGuards(JwtAuthGuard, RolesGuard)
@StrictRoles()
export class IncentiveManagementController {
  constructor(private service: IncentiveManagementService) {}

  @Get()
  @Roles(...SUGGEST_ROLES, ...DECIDE_ROLES)
  board(@Query() q: MonthQuery, @CurrentUser() user: JwtUser) {
    return this.service.board(actor(user), q);
  }

  @Post('suggestions')
  @Roles(...SUGGEST_ROLES)
  suggest(@Body() dto: SuggestDto, @CurrentUser() user: JwtUser) {
    return this.service.suggest(actor(user), dto);
  }

  @Post('apply')
  @Roles(...DECIDE_ROLES)
  apply(@Body() dto: ApplyDto, @CurrentUser() user: JwtUser) {
    return this.service.apply(actor(user), dto);
  }

  @Post('reject')
  @Roles(...DECIDE_ROLES)
  reject(@Body() dto: RejectDto, @CurrentUser() user: JwtUser) {
    return this.service.reject(actor(user), dto);
  }
}
