import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePakistanPhone } from '../whatsapp/phone.util';
import {
  PortalWhatsAppSharesQueryDto,
  UpdateUserPasswordDto,
  UserPasswordsQueryDto,
} from './user-passwords.dto';

export type PortalWhatsAppShareItem = {
  userId: string;
  employeeId: string | null;
  employeeName: string;
  employeeCode: string | null;
  email: string;
  password: string;
  phone: string | null;
  phoneE164: string | null;
  ready: boolean;
  skipReason: string | null;
  message: string | null;
  waUrl: string | null;
};

@Injectable()
export class UserPasswordsService {
  constructor(private prisma: PrismaService) {}

  findAll(query: UserPasswordsQueryDto = {}) {
    const where: Prisma.UserPasswordWhereInput = {};

    if (query.systemOnly === 'true') {
      where.user = {
        employeeId: null,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.projectId
          ? { branch: { projectId: query.projectId } }
          : {}),
      };
    } else if (query.employeeOnly === 'true') {
      where.user = {
        employeeId: { not: null },
        ...(query.branchId
          ? {
              OR: [
                { branchId: query.branchId },
                { employee: { currentBranchId: query.branchId } },
              ],
            }
          : {}),
        ...(query.projectId
          ? {
              OR: [
                { branch: { projectId: query.projectId } },
                {
                  employee: {
                    currentBranch: { projectId: query.projectId },
                  },
                },
              ],
            }
          : {}),
      };
    } else if (query.branchId || query.projectId) {
      where.user = {
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.projectId
          ? { branch: { projectId: query.projectId } }
          : {}),
      };
    }

    return this.prisma.userPassword.findMany({
      where,
      select: {
        id: true,
        userId: true,
        plainText: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            email: true,
            role: true,
            isActive: true,
            branchId: true,
            employeeId: true,
            employee: {
              select: {
                fullName: true,
                employeeCode: true,
                biometricId: true,
                phone: true,
              },
            },
            branch: {
              select: {
                id: true,
                name: true,
                address: true,
                projectId: true,
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: [
        { user: { branch: { name: 'asc' } } },
        { user: { email: 'asc' } },
      ],
    });
  }

  /**
   * Build WhatsApp Web (wa.me) share links with portal email + password
   * for employee-linked accounts. Super Admin opens each link manually —
   * no Meta Cloud API send.
   */
  async buildPortalWhatsAppShares(
    query: PortalWhatsAppSharesQueryDto = {},
    actingUserId?: string,
  ) {
    const portalBase = (
      query.portalBaseUrl ||
      process.env.PORTAL_PUBLIC_URL ||
      process.env.PUBLIC_PORTAL_URL ||
      'https://hrms-portal.ycdo.org.pk'
    ).replace(/\/$/, '');
    const loginUrl = `${portalBase}/login`;

    const where: Prisma.UserPasswordWhereInput = {
      user: {
        employeeId: { not: null },
        isActive: true,
        role: { in: [UserRole.EMPLOYEE, UserRole.ADMIN_MANAGER] },
        ...(query.branchId
          ? {
              OR: [
                { branchId: query.branchId },
                { employee: { currentBranchId: query.branchId } },
              ],
            }
          : {}),
        ...(query.projectId
          ? {
              OR: [
                { branch: { projectId: query.projectId } },
                {
                  employee: {
                    currentBranch: { projectId: query.projectId },
                  },
                },
              ],
            }
          : {}),
      },
    };

    const rows = await this.prisma.userPassword.findMany({
      where,
      select: {
        userId: true,
        plainText: true,
        user: {
          select: {
            email: true,
            employeeId: true,
            employee: {
              select: {
                fullName: true,
                employeeCode: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: [{ user: { employee: { fullName: 'asc' } } }],
    });

    const items: PortalWhatsAppShareItem[] = rows.map((row) => {
      const emp = row.user.employee;
      const name = emp?.fullName?.trim() || row.user.email;
      const code = emp?.employeeCode ?? null;
      const phoneRaw = emp?.phone ?? null;
      const phoneE164 = normalizePakistanPhone(phoneRaw);
      const password = row.plainText?.trim() ?? '';

      if (!password) {
        return {
          userId: row.userId,
          employeeId: row.user.employeeId,
          employeeName: name,
          employeeCode: code,
          email: row.user.email,
          password: '',
          phone: phoneRaw,
          phoneE164: null,
          ready: false,
          skipReason: 'No stored portal password',
          message: null,
          waUrl: null,
        };
      }

      if (!phoneE164) {
        return {
          userId: row.userId,
          employeeId: row.user.employeeId,
          employeeName: name,
          employeeCode: code,
          email: row.user.email,
          password,
          phone: phoneRaw,
          phoneE164: null,
          ready: false,
          skipReason: phoneRaw
            ? 'Phone number is invalid'
            : 'No phone number on employee profile',
          message: null,
          waUrl: null,
        };
      }

      const message = this.buildPortalCredentialsMessage({
        name,
        employeeCode: code,
        email: row.user.email,
        password,
        loginUrl,
      });
      const waUrl = `https://wa.me/${phoneE164}?text=${encodeURIComponent(message)}`;

      return {
        userId: row.userId,
        employeeId: row.user.employeeId,
        employeeName: name,
        employeeCode: code,
        email: row.user.email,
        password,
        phone: phoneRaw,
        phoneE164,
        ready: true,
        skipReason: null,
        message,
        waUrl,
      };
    });

    if (actingUserId) {
      await this.prisma.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'PORTAL_CREDENTIALS_WHATSAPP_SHARES',
          entity: 'UserPassword',
          entityId: actingUserId,
          changes: {
            total: items.length,
            ready: items.filter((i) => i.ready).length,
            branchId: query.branchId ?? null,
            projectId: query.projectId ?? null,
          },
        },
      });
    }

    return {
      portalUrl: loginUrl,
      total: items.length,
      ready: items.filter((i) => i.ready).length,
      skipped: items.filter((i) => !i.ready).length,
      items,
    };
  }

  async buildOnePortalWhatsAppShare(
    userId: string,
    portalBaseUrl?: string,
    actingUserId?: string,
  ) {
    const portalBase = (
      portalBaseUrl ||
      process.env.PORTAL_PUBLIC_URL ||
      process.env.PUBLIC_PORTAL_URL ||
      'https://hrms-portal.ycdo.org.pk'
    ).replace(/\/$/, '');
    const loginUrl = `${portalBase}/login`;

    const row = await this.prisma.userPassword.findFirst({
      where: {
        userId,
        user: { employeeId: { not: null } },
      },
      select: {
        userId: true,
        plainText: true,
        user: {
          select: {
            email: true,
            employeeId: true,
            employee: {
              select: {
                fullName: true,
                employeeCode: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundException(
        'No portal login found for this user (employee account required)',
      );
    }

    const emp = row.user.employee;
    const name = emp?.fullName?.trim() || row.user.email;
    const code = emp?.employeeCode ?? null;
    const phoneRaw = emp?.phone ?? null;
    const phoneE164 = normalizePakistanPhone(phoneRaw);
    const password = row.plainText?.trim() ?? '';

    let item: PortalWhatsAppShareItem;
    if (!password) {
      item = {
        userId: row.userId,
        employeeId: row.user.employeeId,
        employeeName: name,
        employeeCode: code,
        email: row.user.email,
        password: '',
        phone: phoneRaw,
        phoneE164: null,
        ready: false,
        skipReason: 'No stored portal password',
        message: null,
        waUrl: null,
      };
    } else if (!phoneE164) {
      item = {
        userId: row.userId,
        employeeId: row.user.employeeId,
        employeeName: name,
        employeeCode: code,
        email: row.user.email,
        password,
        phone: phoneRaw,
        phoneE164: null,
        ready: false,
        skipReason: phoneRaw
          ? 'Phone number is invalid'
          : 'No phone number on employee profile',
        message: null,
        waUrl: null,
      };
    } else {
      const message = this.buildPortalCredentialsMessage({
        name,
        employeeCode: code,
        email: row.user.email,
        password,
        loginUrl,
      });
      item = {
        userId: row.userId,
        employeeId: row.user.employeeId,
        employeeName: name,
        employeeCode: code,
        email: row.user.email,
        password,
        phone: phoneRaw,
        phoneE164,
        ready: true,
        skipReason: null,
        message,
        waUrl: `https://wa.me/${phoneE164}?text=${encodeURIComponent(message)}`,
      };
    }

    if (actingUserId && item.ready) {
      await this.prisma.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'PORTAL_CREDENTIALS_WHATSAPP_SHARE',
          entity: 'User',
          entityId: userId,
        },
      });
    }

    return { portalUrl: loginUrl, item };
  }

  private buildPortalCredentialsMessage(params: {
    name: string;
    employeeCode: string | null;
    email: string;
    password: string;
    loginUrl: string;
  }): string {
    const RLI = '\u2067';
    const LRI = '\u2066';
    const PDI = '\u2069';
    const codeLine = params.employeeCode
      ? ` (${params.employeeCode})`
      : '';

    const urdu = [
      `السلام علیکم ${params.name}${codeLine}،`,
      '',
      'آپ کے YCDO Employee Portal کے لاگ اِن تفصیلات یہ ہیں:',
      `ای میل: ${params.email}`,
      `پاس ورڈ: ${params.password}`,
      '',
      'پورٹل لنک:',
      params.loginUrl,
      '',
      'براہ کرم پہلی لاگ اِن کے بعد پاس ورڈ تبدیل کر لیں۔',
    ].join('\n');

    const english = [
      `Assalam-o-Alaikum ${params.name}${codeLine},`,
      '',
      'Your YCDO Employee Portal login credentials:',
      `Email: ${params.email}`,
      `Password: ${params.password}`,
      '',
      'Portal link:',
      params.loginUrl,
      '',
      'Please change your password after first login.',
    ].join('\n');

    return `${RLI}${urdu}${PDI}\n\n${LRI}${english}${PDI}`;
  }

  async update(userId: string, dto: UpdateUserPasswordDto, actingUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    const hashed = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: hashed },
      }),
      this.prisma.userPassword.upsert({
        where: { userId },
        update: { plainText: dto.newPassword },
        create: { userId, plainText: dto.newPassword },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actingUserId,
          action: 'UPDATE_USER_PASSWORD',
          entity: 'User',
          entityId: userId,
        },
      }),
    ]);

    return { message: 'Password updated' };
  }
}
