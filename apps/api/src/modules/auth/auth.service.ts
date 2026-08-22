import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildEffectiveRoles,
  canAccessHrms,
  hasAnyRole,
} from '../../common/user-roles.util';
import { PermissionsService } from '../permissions/permissions.service';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  ResendLoginOtpDto,
  ResetPasswordDto,
  VerifyLoginOtpDto,
} from './auth.dto';
import {
  sendOtpEmail,
  superAdminOtpDestination,
} from './otp-email.helper';

type UserWithoutPassword = Omit<User, 'password'>;

const OTP_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private permissionsService: PermissionsService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { additionalRoles: { select: { role: true } } },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const roles = buildEffectiveRoles(user.role, user.additionalRoles);

    if (dto.client === 'hrms') {
      // Employee-linked accounts may use HRMS only when they hold a staff/system role.
      if (user.employeeId && !canAccessHrms(roles)) {
        throw new ForbiddenException(
          'Employee accounts without staff roles cannot sign in to HRMS. Use the Employee Portal.',
        );
      }
    }

    if (dto.client === 'portal') {
      const isExecutive = hasAnyRole(roles, [
        UserRole.FOUNDER,
        UserRole.CHAIRMAN,
        UserRole.PRESIDENT,
      ]);
      // Executives may use the portal for mobile onboarding approvals
      // even without a linked employee profile.
      if (!user.employeeId && !isExecutive) {
        throw new ForbiddenException(
          'System accounts cannot sign in to the Employee Portal. Use HRMS.',
        );
      }
    }

    if (hasAnyRole(roles, [UserRole.SUPER_ADMIN])) {
      return this.startSuperAdminOtpChallenge(user);
    }

    return this.issueSession(user, roles, dto.client);
  }

  async verifyLoginOtp(dto: VerifyLoginOtpDto) {
    const challenge = await this.prisma.loginOtpChallenge.findUnique({
      where: { id: dto.challengeId },
      include: {
        user: { include: { additionalRoles: { select: { role: true } } } },
      },
    });

    if (!challenge || challenge.consumedAt) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('OTP has expired. Please sign in again.');
    }

    const valid = await bcrypt.compare(dto.otp.trim(), challenge.codeHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid OTP');
    }

    await this.prisma.loginOtpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    const user = challenge.user;
    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    const roles = buildEffectiveRoles(user.role, user.additionalRoles);
    if (!hasAnyRole(roles, [UserRole.SUPER_ADMIN])) {
      throw new ForbiddenException('OTP verification is only for Super Admin');
    }

    return this.issueSession(user, roles, 'hrms');
  }

  async resendLoginOtp(dto: ResendLoginOtpDto) {
    const existing = await this.prisma.loginOtpChallenge.findUnique({
      where: { id: dto.challengeId },
      include: { user: true },
    });

    if (!existing || existing.consumedAt) {
      throw new UnauthorizedException('Invalid or expired OTP challenge');
    }

    if (!existing.user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    return this.startSuperAdminOtpChallenge(existing.user, existing.id);
  }

  private async startSuperAdminOtpChallenge(
    user: User,
    replaceChallengeId?: string,
  ) {
    const code = String(randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, 10);
    const sentTo = superAdminOtpDestination();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    let challengeId = replaceChallengeId;

    if (replaceChallengeId) {
      await this.prisma.loginOtpChallenge.update({
        where: { id: replaceChallengeId },
        data: { codeHash, sentTo, expiresAt, consumedAt: null },
      });
    } else {
      // Invalidate prior open challenges for this user.
      await this.prisma.loginOtpChallenge.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      const created = await this.prisma.loginOtpChallenge.create({
        data: {
          userId: user.id,
          codeHash,
          sentTo,
          expiresAt,
        },
      });
      challengeId = created.id;
    }

    try {
      await sendOtpEmail({
        to: sentTo,
        code,
        loginEmail: user.email,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Email send failed';
      console.error('[OTP] Failed to send Super Admin OTP email:', message);
      throw new UnauthorizedException(
        'Could not send login OTP email. Check SMTP configuration.',
      );
    }

    const masked = this.maskEmail(sentTo);

    return {
      requiresOtp: true as const,
      challengeId: challengeId!,
      message: `A verification code was sent to ${masked}`,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    };
  }

  private async issueSession(
    user: User,
    roles: UserRole[],
    client?: string,
  ) {
    const now = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLogin: now,
        ...(client === 'portal' ? { lastPortalLogin: now } : {}),
      },
    });

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      roles,
      employeeId: user.employeeId,
      branchId: user.branchId,
    };

    const permissions = await this.getGrantedPermissions(user.id, user.role);

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        roles,
        employeeId: user.employeeId,
        branchId: user.branchId,
        permissions,
      },
    };
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***';
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}***@${domain}`;
  }

  async getMe(userId: string) {
    const user = await this.validateUser(userId);
    const roles = await this.permissionsService.getUserEffectiveRoles(userId);
    const permissions = await this.getGrantedPermissions(user.id, user.role);
    return { ...user, roles, permissions };
  }

  private async getGrantedPermissions(
    userId: string,
    role: User['role'],
  ): Promise<string[]> {
    const effective = await this.permissionsService.getEffectivePermissions(
      userId,
      role,
    );
    return effective.filter((p) => p.effective).map((p) => p.permission);
  }

  async register(dto: RegisterDto): Promise<UserWithoutPassword> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        role: dto.role,
        employeeId: dto.employeeId,
      },
    });

    return this.omitPassword(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { message: 'Password changed successfully' };
  }

  async resetPassword(dto: ResetPasswordDto, actingUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException(`User with id ${dto.userId} not found`);
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: dto.userId },
        data: { password: hashedPassword },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'PASSWORD_RESET',
          entity: 'User',
          entityId: dto.userId,
        },
      });
    });

    return { message: 'Password reset successfully' };
  }

  async validateUser(userId: string): Promise<UserWithoutPassword> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return this.omitPassword(user);
  }

  private omitPassword(user: User): UserWithoutPassword {
    const { password: _password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}
