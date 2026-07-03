import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { AcknowledgeDto } from './acknowledgements.dto';

@Injectable()
export class AcknowledgementsService {
  constructor(private prisma: PrismaService) {}

  async acknowledge(
    dto: AcknowledgeDto,
    employeeId: string,
    userId: string,
    ipAddress: string,
  ) {
    const letter = await this.prisma.letter.findUnique({
      where: { id: dto.letterId },
      include: {
        acknowledgement: true,
        employee: {
          select: { fullName: true },
        },
      },
    });

    if (!letter) {
      throw new NotFoundException(`Letter with id ${dto.letterId} not found`);
    }

    if (letter.employeeId !== employeeId) {
      throw new ForbiddenException('You can only acknowledge your own letters');
    }

    if (!letter.requiresAcknowledgement) {
      throw new BadRequestException(
        'This letter does not require acknowledgement',
      );
    }

    if (letter.acknowledgement) {
      throw new BadRequestException(
        'You have already acknowledged this letter',
      );
    }

    const refNumber = this.extractRefNumber(letter.fileUrl);
    const employeeName = letter.employee.fullName;

    return this.prisma.$transaction(async (tx) => {
      const acknowledgement = await tx.allegationAcknowledgement.create({
        data: {
          letterId: dto.letterId,
          employeeId,
          ipAddress,
          acknowledgedAt: new Date(),
        },
      });

      const hrUsers = await tx.user.findMany({
        where: {
          role: UserRole.HR_MANAGER,
          isActive: true,
          employeeId: { not: null },
        },
      });

      for (const user of hrUsers) {
        if (user.employeeId) {
          await tx.notification.create({
            data: {
              employeeId: user.employeeId,
              type: 'LETTER_ACKNOWLEDGED',
              message: `${employeeName} has acknowledged letter ${refNumber}`,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'LETTER_ACKNOWLEDGED',
          entity: 'AllegationAcknowledgement',
          entityId: acknowledgement.id,
          changes: {
            letterId: dto.letterId,
            ipAddress,
          },
        },
      });

      return acknowledgement;
    });
  }

  findByEmployee(employeeId: string) {
    return this.prisma.allegationAcknowledgement.findMany({
      where: { employeeId },
      include: {
        letter: {
          select: {
            id: true,
            letterType: true,
            content: true,
            generatedAt: true,
            requiresAcknowledgement: true,
          },
        },
      },
      orderBy: { acknowledgedAt: 'desc' },
    });
  }

  async findByLetter(letterId: string) {
    const acknowledgement =
      await this.prisma.allegationAcknowledgement.findUnique({
        where: { letterId },
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              employeeCode: true,
            },
          },
        },
      });

    if (!acknowledgement) {
      throw new NotFoundException(
        `Acknowledgement for letter ${letterId} not found`,
      );
    }

    return acknowledgement;
  }

  getPendingAcknowledgements(employeeId: string) {
    return this.prisma.letter.findMany({
      where: {
        employeeId,
        requiresAcknowledgement: true,
        acknowledgement: null,
      },
      select: {
        id: true,
        letterType: true,
        content: true,
        generatedAt: true,
        replyDeadline: true,
        fileUrl: true,
      },
      orderBy: { generatedAt: 'desc' },
    });
  }

  private extractRefNumber(fileUrl: string | null): string {
    if (!fileUrl) {
      return 'N/A';
    }

    const filename = path.basename(fileUrl, '.pdf');
    return filename.replace(/_/g, '/');
  }
}
