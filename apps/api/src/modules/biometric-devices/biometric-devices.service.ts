import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateBiometricDeviceDto,
  UpdateBiometricDeviceDto,
} from './biometric-devices.dto';

@Injectable()
export class BiometricDevicesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.biometricDevice.findMany({
      include: {
        branch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateBiometricDeviceDto) {
    const existing = await this.prisma.biometricDevice.findUnique({
      where: { deviceId: dto.deviceId },
    });

    if (existing) {
      throw new ConflictException(
        `Device ID "${dto.deviceId}" is already registered`,
      );
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branchId },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with id ${dto.branchId} not found`);
    }

    return this.prisma.biometricDevice.create({
      data: {
        deviceId: dto.deviceId,
        branchId: dto.branchId,
        label: dto.label,
      },
      include: {
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: string, dto: UpdateBiometricDeviceDto) {
    const device = await this.prisma.biometricDevice.findUnique({
      where: { id },
    });

    if (!device) {
      throw new NotFoundException(`Biometric device with id ${id} not found`);
    }

    if (dto.deviceId && dto.deviceId !== device.deviceId) {
      const duplicate = await this.prisma.biometricDevice.findUnique({
        where: { deviceId: dto.deviceId },
      });
      if (duplicate) {
        throw new ConflictException(
          `Device ID "${dto.deviceId}" is already registered`,
        );
      }
    }

    if (dto.branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: dto.branchId },
      });
      if (!branch) {
        throw new NotFoundException(`Branch with id ${dto.branchId} not found`);
      }
    }

    return this.prisma.biometricDevice.update({
      where: { id },
      data: {
        deviceId: dto.deviceId,
        branchId: dto.branchId,
        label: dto.label,
      },
      include: {
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async remove(id: string) {
    const device = await this.prisma.biometricDevice.findUnique({
      where: { id },
    });

    if (!device) {
      throw new NotFoundException(`Biometric device with id ${id} not found`);
    }

    await this.prisma.biometricDevice.delete({ where: { id } });
    return { message: 'Biometric device deleted' };
  }
}
