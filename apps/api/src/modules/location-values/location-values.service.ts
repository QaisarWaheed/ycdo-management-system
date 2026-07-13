import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateLocationValueDto } from './location-values.dto';

@Injectable()
export class LocationValuesService {
  constructor(private prisma: PrismaService) {}

  findAll(type: string, search?: string) {
    return this.prisma.locationValue.findMany({
      where: {
        type,
        ...(search
          ? { value: { contains: search, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { value: 'asc' },
    });
  }

  create(type: string, value: string, province?: string, city?: string) {
    return this.prisma.locationValue.upsert({
      where: {
        type_value: { type, value },
      },
      update: {
        ...(province !== undefined ? { province } : {}),
        ...(city !== undefined ? { city } : {}),
      },
      create: {
        type,
        value,
        province,
        city,
      },
    });
  }

  async update(id: string, dto: UpdateLocationValueDto) {
    const current = await this.prisma.locationValue.findUnique({
      where: { id },
    });
    if (!current) {
      throw new NotFoundException('Location value not found');
    }

    const nextValue = dto.value?.trim() ?? current.value;
    if (nextValue !== current.value) {
      const duplicate = await this.prisma.locationValue.findUnique({
        where: {
          type_value: { type: current.type, value: nextValue },
        },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(
          `A ${current.type} named "${nextValue}" already exists`,
        );
      }
    }

    return this.prisma.locationValue.update({
      where: { id },
      data: {
        value: nextValue,
        province: dto.province !== undefined ? dto.province || null : undefined,
        city: dto.city !== undefined ? dto.city || null : undefined,
      },
    });
  }

  async remove(id: string) {
    const current = await this.prisma.locationValue.findUnique({
      where: { id },
    });
    if (!current) {
      throw new NotFoundException('Location value not found');
    }
    await this.prisma.locationValue.delete({ where: { id } });
    return { success: true };
  }
}
