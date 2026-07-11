import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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

  async createSyncJob(employeeId: string, photoUrl: string) {
    return this.prisma.faceSyncJob.create({
      data: {
        employeeId,
        photoUrl,
        status: 'PENDING',
      },
    });
  }

  async createSyncJobForEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, photoUrl: true, fullName: true },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with id ${employeeId} not found`);
    }

    if (!employee.photoUrl) {
      throw new BadRequestException('Employee has no photo uploaded');
    }

    return this.createSyncJob(employeeId, employee.photoUrl);
  }

  async getPendingJobs(deviceId: string) {
    const device = await this.prisma.biometricDevice.findUnique({
      where: { deviceId },
      include: { branch: true },
    });

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
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
        const photoPath = job.photoUrl || job.employee.photoUrl;
        if (!fpid || !photoPath) return null;

        return {
          jobId: job.id,
          employeeId: job.employee.id,
          fullName: job.employee.fullName,
          biometricId: job.employee.biometricId,
          fpid,
          photoUrl: this.resolvePublicUrl(photoPath),
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
        photoUrl: { not: null },
        status: {
          in: [
            EmployeeStatus.ACTIVE,
            EmployeeStatus.APPOINTED,
            EmployeeStatus.TRAINEE,
          ],
        },
      },
      select: { id: true, photoUrl: true },
    });

    let created = 0;
    for (const emp of employees) {
      const existing = await this.prisma.faceSyncJob.findFirst({
        where: { employeeId: emp.id, status: 'PENDING' },
      });
      if (!existing && emp.photoUrl) {
        await this.prisma.faceSyncJob.create({
          data: {
            employeeId: emp.id,
            photoUrl: emp.photoUrl,
            status: 'PENDING',
          },
        });
        created++;
      }
    }

    return {
      message: `Created ${created} sync jobs`,
      created,
      total: employees.length,
    };
  }

  async getStats(employeeId?: string) {
    if (employeeId) {
      const latestJob = await this.prisma.faceSyncJob.findFirst({
        where: { employeeId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { latestJob };
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
          },
        },
        results: {
          include: {
            branch: { select: { name: true } },
          },
        },
      },
    });

    return jobs.map((job) => ({
      id: job.id,
      employeeId: job.employeeId,
      photoUrl: job.photoUrl,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      employee: job.employee,
      results: job.results,
      successCount: job.results.filter((r) => r.status === 'SUCCESS').length,
      deviceCount,
    }));
  }

  async countEmployeesWithPhotos() {
    return this.prisma.employee.count({
      where: {
        photoUrl: { not: null },
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
