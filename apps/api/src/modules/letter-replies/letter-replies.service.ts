import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LetterType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLetterReplyDto } from './letter-replies.dto';

@Injectable()
export class LetterRepliesService {
  constructor(private prisma: PrismaService) {}

  async reply(dto: CreateLetterReplyDto, employeeId: string) {
    if (!employeeId) {
      throw new ForbiddenException('Employee account required');
    }

    const letter = await this.prisma.letter.findUnique({
      where: { id: dto.letterId },
      include: {
        employee: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    if (!letter) {
      throw new NotFoundException(`Letter with id ${dto.letterId} not found`);
    }

    if (letter.employeeId !== employeeId) {
      throw new ForbiddenException('You can only reply to your own letters');
    }

    if (letter.letterType !== LetterType.SHOW_CAUSE) {
      throw new BadRequestException('Only show cause letters require a reply');
    }

    if (letter.isReplied) {
      throw new BadRequestException('You have already replied to this letter');
    }

    if (letter.replyDeadline && letter.replyDeadline < new Date()) {
      throw new BadRequestException('Reply deadline has passed');
    }

    const refNumber = letter.fileUrl
      ? letter.fileUrl.split('/').pop()?.replace(/\.pdf$/i, '').replace(/_/g, '/')
      : letter.id;

    return this.prisma.$transaction(async (tx) => {
      const reply = await tx.letterReply.create({
        data: {
          letterId: dto.letterId,
          employeeId,
          replyText: dto.replyText,
        },
      });

      await tx.letter.update({
        where: { id: dto.letterId },
        data: { isReplied: true },
      });

      const hrManagers = await tx.user.findMany({
        where: { role: UserRole.HR_MANAGER, isActive: true },
      });

      const employeeName = `${letter.employee.firstName} ${letter.employee.lastName}`;

      for (const hr of hrManagers) {
        if (hr.employeeId) {
          await tx.notification.create({
            data: {
              employeeId: hr.employeeId,
              message: `${employeeName} has replied to show cause letter ${refNumber}`,
              type: 'SHOW_CAUSE_REPLY',
            },
          });
        }
      }

      return reply;
    });
  }

  async findRepliesByLetter(letterId: string) {
    const letter = await this.prisma.letter.findUnique({
      where: { id: letterId },
    });

    if (!letter) {
      throw new NotFoundException(`Letter with id ${letterId} not found`);
    }

    return this.prisma.letterReply.findMany({
      where: { letterId },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
      },
      orderBy: { repliedAt: 'desc' },
    });
  }

  findMyReplies(employeeId: string) {
    return this.prisma.letterReply.findMany({
      where: { employeeId },
      include: {
        letter: {
          select: {
            id: true,
            letterType: true,
            generatedAt: true,
            fileUrl: true,
            replyDeadline: true,
            isReplied: true,
          },
        },
      },
      orderBy: { repliedAt: 'desc' },
    });
  }
}
