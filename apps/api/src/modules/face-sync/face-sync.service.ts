import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { cloudinary } from '../../config/cloudinary.config';
import { ReportResultDto } from './face-sync.dto';

function extractFpid(biometricId: string | null | undefined): string | null {
  if (!biometricId) return null;
  const digits = biometricId.replace(/\D/g, '').replace(/^0+/, '');
  return digits || '0';
}

@Injectable()
export class FaceSyncService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  private resolvePublicUrl(path: string): string {
    if (path.startsWith('http')) return path;
    const base =
      this.configService.get<string>('PUBLIC_API_URL') ??
      this.configService.get<string>('API_PUBLIC_URL') ??
      'https://hrms-api.ycdo.org.pk';
    return `${base.replace(/\/$/, '')}${path}`;
  }

  private getSignedPrivatePhotoUrl(employeeId: string): string {
    return cloudinary.utils.private_download_url(
      `ycdo-hrms/private-biometric/private_${employeeId}`,
      'jpg',
      {
        resource_type: 'image',
        type: 'authenticated',
        expires_at: Math.floor(Date.now() / 1000) + 10 * 60,
        attachment: false,
      },
    );
  }

  async createSyncJob(employeeId: string, photoUrl: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { photoUrl: true, privatePhotoUrl: true },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    const selectedPhotoUrl =
      employee.privatePhotoUrl || photoUrl || employee.photoUrl;
    if (!selectedPhotoUrl) {
      throw new BadRequestException('Employee has no photo uploaded');
    }

    const resolvedPhotoUrl = selectedPhotoUrl.startsWith('/uploads')
      ? this.resolvePublicUrl(selectedPhotoUrl)
      : selectedPhotoUrl;

    return this.prisma.faceSyncJob.create({
      data: {
        employeeId,
        photoUrl: resolvedPhotoUrl,
        status: 'PENDING',
      },
    });
  }

  async createSyncJobForEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        photoUrl: true,
        privatePhotoUrl: true,
        fullName: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    if (!employee.privatePhotoUrl && !employee.photoUrl) {
      throw new BadRequestException('Employee has no photo uploaded');
    }

    return this.createSyncJob(
      employeeId,
      employee.privatePhotoUrl || employee.photoUrl!,
    );
  }

  async getPendingJobs(deviceId: string) {
    if (!deviceId?.trim()) {
      throw new BadRequestException(
        'deviceId query parameter is required',
      );
    }

    const device = await this.prisma.biometricDevice.findUnique({
      where: { deviceId },
      include: { branch: true },
    });

    if (!device) {
      throw new NotFoundException(
        `Device "${deviceId}" not found. Register it under Biometric Devices in HRMS.`,
      );
    }

    const jobs = await this.prisma.faceSyncJob.findMany({
      where: {
        status: 'PENDING',
        results: {
          none: {
            deviceId,
            status: 'SUCCESS',
          },
        },
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            biometricId: true,
            photoUrl: true,
            privatePhotoUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    const seen = new Set<string>();
    const uniqueJobs = jobs.filter((job) => {
      if (seen.has(job.employeeId)) return false;
      seen.add(job.employeeId);
      return true;
    });

    const formatted = uniqueJobs
      .map((job) => {
        const fpid = extractFpid(job.employee.biometricId);
        const hasPrivatePhoto = Boolean(job.employee.privatePhotoUrl);
        const photoPath = hasPrivatePhoto
          ? this.getSignedPrivatePhotoUrl(job.employee.id)
          : job.photoUrl || job.employee.photoUrl;
        if (!fpid || !photoPath) return null;

        return {
          jobId: job.id,
          employeeId: job.employee.id,
          fullName: job.employee.fullName,
          biometricId: job.employee.biometricId,
          fpid,
          photoUrl: hasPrivatePhoto
            ? photoPath
            : this.resolvePublicUrl(photoPath),
        };
      })
      .filter((job): job is NonNullable<typeof job> => job !== null);

    return { jobs: formatted };
  }

  async reportResult(dto: ReportResultDto) {
    const device = await this.prisma.biometricDevice.findUnique({
      where: { deviceId: dto.deviceId },
    });

    if (!device) {
      throw new NotFoundException(`Device ${dto.deviceId} not found`);
    }

    const branchId = dto.branchId || device.branchId;

    const job = await this.prisma.faceSyncJob.findUnique({
      where: { id: dto.jobId },
    });

    if (!job) {
      throw new NotFoundException(`Face sync job ${dto.jobId} not found`);
    }

    await this.prisma.faceSyncResult.upsert({
      where: {
        jobId_deviceId: {
          jobId: dto.jobId,
          deviceId: dto.deviceId,
        },
      },
      create: {
        jobId: dto.jobId,
        deviceId: dto.deviceId,
        branchId,
        status: dto.status,
        error: dto.error ?? null,
      },
      update: {
        branchId,
        status: dto.status,
        error: dto.error ?? null,
        syncedAt: new Date(),
      },
    });

    const allDevices = await this.prisma.biometricDevice.count();
    const successCount = await this.prisma.faceSyncResult.count({
      where: { jobId: dto.jobId, status: 'SUCCESS' },
    });
    const failedCount = await this.prisma.faceSyncResult.count({
      where: { jobId: dto.jobId, status: 'FAILED' },
    });
    const reportedCount = successCount + failedCount;

    let jobStatus = 'PENDING';
    if (allDevices > 0 && successCount === allDevices) {
      jobStatus = 'SYNCED';
    } else if (allDevices > 0 && reportedCount === allDevices) {
      jobStatus = successCount > 0 ? 'PARTIAL' : 'FAILED';
    } else if (failedCount > 0 && successCount === 0) {
      jobStatus = 'FAILED';
    } else if (successCount > 0) {
      jobStatus = 'PARTIAL';
    }

    await this.prisma.faceSyncJob.update({
      where: { id: dto.jobId },
      data: { status: jobStatus },
    });

    return { message: 'Result recorded' };
  }

  async syncAllEmployees(_actingUserId: string) {
    const employees = await this.prisma.employee.findMany({
      where: {
        OR: [
          { privatePhotoUrl: { not: null } },
          { photoUrl: { not: null } },
        ],
        status: {
          in: [
            EmployeeStatus.ACTIVE,
            EmployeeStatus.APPOINTED,
            EmployeeStatus.TRAINEE,
          ],
        },
      },
      select: { id: true, photoUrl: true, privatePhotoUrl: true },
    });

    let created = 0;
    for (const emp of employees) {
      const existing = await this.prisma.faceSyncJob.findFirst({
        where: { employeeId: emp.id, status: 'PENDING' },
      });
      const photoUrl = emp.privatePhotoUrl || emp.photoUrl;
      if (!existing && photoUrl) {
        await this.createSyncJob(emp.id, photoUrl);
        created++;
      }
    }

    return {
      message: `Created ${created} sync jobs`,
      created,
      total: employees.length,
    };
  }

  async getBiometricRegistrationSummary(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { biometricId: true },
    });

    const devices = await this.prisma.biometricDevice.findMany({
      select: {
        deviceId: true,
        label: true,
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const successResults = await this.prisma.faceSyncResult.findMany({
      where: {
        status: 'SUCCESS',
        job: { employeeId },
      },
      select: {
        deviceId: true,
        syncedAt: true,
      },
      orderBy: { syncedAt: 'desc' },
    });

    const latestSuccessByDevice = new Map<string, Date>();
    for (const result of successResults) {
      if (!latestSuccessByDevice.has(result.deviceId)) {
        latestSuccessByDevice.set(result.deviceId, result.syncedAt);
      }
    }

    const deviceSummaries = devices.map((device) => ({
      deviceId: device.deviceId,
      label: device.label,
      branchName: device.branch.name,
      registered: latestSuccessByDevice.has(device.deviceId),
      lastSyncedAt:
        latestSuccessByDevice.get(device.deviceId)?.toISOString() ?? null,
    }));

    const registeredDeviceCount = deviceSummaries.filter(
      (device) => device.registered,
    ).length;
    const totalDevices = devices.length;
    const biometricIdAssigned = Boolean(employee?.biometricId);

    let registrationStatus: 'NOT_REGISTERED' | 'PARTIAL' | 'REGISTERED' =
      'NOT_REGISTERED';
    if (totalDevices > 0 && registeredDeviceCount === totalDevices) {
      registrationStatus = 'REGISTERED';
    } else if (registeredDeviceCount > 0) {
      registrationStatus = 'PARTIAL';
    }

    return {
      biometricId: employee?.biometricId ?? null,
      biometricIdAssigned,
      registeredDeviceCount,
      totalDevices,
      registrationStatus,
      devices: deviceSummaries,
    };
  }

  async getStats(employeeId?: string) {
    if (employeeId) {
      const [latestJob, registration] = await Promise.all([
        this.prisma.faceSyncJob.findFirst({
          where: { employeeId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        this.getBiometricRegistrationSummary(employeeId),
      ]);

      return { latestJob, registration };
    }

    const [total, pending, synced, failed, partial] = await Promise.all([
      this.prisma.faceSyncJob.count(),
      this.prisma.faceSyncJob.count({ where: { status: 'PENDING' } }),
      this.prisma.faceSyncJob.count({ where: { status: 'SYNCED' } }),
      this.prisma.faceSyncJob.count({ where: { status: 'FAILED' } }),
      this.prisma.faceSyncJob.count({ where: { status: 'PARTIAL' } }),
    ]);

    return { total, pending, synced, failed, partial };
  }

  async listJobs() {
    const deviceCount = await this.prisma.biometricDevice.count();
    const jobs = await this.prisma.faceSyncJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            photoUrl: true,
            privatePhotoUrl: true,
            hideProfilePhoto: true,
          },
        },
        results: {
          include: {
            branch: { select: { name: true } },
          },
        },
      },
    });

    return jobs.map((job) => {
      const hasPrivatePhoto = Boolean(job.employee.privatePhotoUrl);
      return {
        id: job.id,
        employeeId: job.employeeId,
        photoUrl: hasPrivatePhoto ? null : job.photoUrl,
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        employee: {
          id: job.employee.id,
          fullName: job.employee.fullName,
          employeeCode: job.employee.employeeCode,
          photoUrl: hasPrivatePhoto ? null : job.employee.photoUrl,
          hideProfilePhoto: job.employee.hideProfilePhoto,
          hasPrivatePhoto,
        },
        results: job.results,
        successCount: job.results.filter((r) => r.status === 'SUCCESS').length,
        deviceCount,
      };
    });
  }

  async countEmployeesWithPhotos() {
    return this.prisma.employee.count({
      where: {
        OR: [
          { privatePhotoUrl: { not: null } },
          { photoUrl: { not: null } },
        ],
        status: {
          in: [
            EmployeeStatus.ACTIVE,
            EmployeeStatus.APPOINTED,
            EmployeeStatus.TRAINEE,
          ],
        },
      },
    });
  }
}
