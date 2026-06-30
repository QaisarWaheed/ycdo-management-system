import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
}
