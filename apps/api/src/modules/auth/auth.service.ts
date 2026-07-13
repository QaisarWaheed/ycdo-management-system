import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './auth.dto';

type UserWithoutPassword = Omit<User, 'password'>;

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

    if (dto.client === 'hrms' && user.employeeId) {
      throw new ForbiddenException(
        'Employee accounts cannot sign in to HRMS. Use the Employee Portal.',
      );
    }

    if (dto.client === 'portal' && !user.employeeId) {
      throw new ForbiddenException(
        'System accounts cannot sign in to the Employee Portal. Use HRMS.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
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
        employeeId: user.employeeId,
        branchId: user.branchId,
        permissions,
      },
    };
  }

  async getMe(userId: string) {
    const user = await this.validateUser(userId);
    const permissions = await this.getGrantedPermissions(user.id, user.role);
    return { ...user, permissions };
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
