import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateJobDto,
  LoginApplicantDto,
  RegisterApplicantDto,
  SubmitApplicationDto,
  UpdateApplicationStatusDto,
  UpdateJobDto,
} from './careers.dto';

const JOB_SELECT = {
  id: true,
  title: true,
  department: true,
  location: true,
  description: true,
  requirements: true,
  deadline: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { applications: true } },
};

const APP_SELECT = {
  id: true,
  status: true,
  fatherName: true,
  dateOfBirth: true,
  gender: true,
  cnic: true,
  address: true,
  city: true,
  academicRecords: true,
  experiences: true,
  coverLetter: true,
  createdAt: true,
  updatedAt: true,
  job: { select: { id: true, title: true, department: true, location: true } },
  applicant: { select: { id: true, fullName: true, email: true, phone: true } },
} as const;

@Injectable()
export class CareersService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // ── Applicant Auth ──────────────────────────────────────

  async register(dto: RegisterApplicantDto) {
    const existing = await this.prisma.applicant.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const applicant = await this.prisma.applicant.create({
      data: {
        fullName: dto.fullName,
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        passwordHash,
      },
      select: { id: true, fullName: true, email: true, phone: true, createdAt: true },
    });

    const token = this.issueToken(applicant.id, applicant.email);
    return { applicant, token };
  }

  async login(dto: LoginApplicantDto) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!applicant) throw new UnauthorizedException('Invalid email or password');

    const match = await bcrypt.compare(dto.password, applicant.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid email or password');

    const { passwordHash: _, ...safe } = applicant;
    const token = this.issueToken(applicant.id, applicant.email);
    return { applicant: safe, token };
  }

  private issueToken(sub: string, email: string) {
    return this.jwtService.sign({ sub, email, client: 'applicant' });
  }

  // ── Public: Jobs ────────────────────────────────────────

  async listPublicJobs() {
    return this.prisma.jobPosting.findMany({
      where: { status: 'OPEN' },
      select: JOB_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPublicJob(id: string) {
    const job = await this.prisma.jobPosting.findUnique({
      where: { id },
      select: JOB_SELECT,
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  // ── Applicant: Applications ─────────────────────────────

  async submitApplication(jobId: string, applicantId: string, dto: SubmitApplicationDto) {
    const job = await this.prisma.jobPosting.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== 'OPEN') throw new BadRequestException('This job is no longer accepting applications');

    const existing = await this.prisma.careerApplication.findUnique({
      where: { jobId_applicantId: { jobId, applicantId } },
    });
    if (existing) throw new ConflictException('You have already applied for this job');

    return this.prisma.careerApplication.create({
      data: {
        jobId,
        applicantId,
        fatherName: dto.fatherName,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        gender: dto.gender,
        cnic: dto.cnic,
        address: dto.address,
        city: dto.city,
        academicRecords: (dto.academicRecords ?? []) as unknown as any,
        experiences: (dto.experiences ?? []) as unknown as any,
        coverLetter: dto.coverLetter,
      },
      select: APP_SELECT,
    });
  }

  async myApplications(applicantId: string) {
    return this.prisma.careerApplication.findMany({
      where: { applicantId },
      select: APP_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── HR: Job Management ──────────────────────────────────

  async createJob(dto: CreateJobDto) {
    return this.prisma.jobPosting.create({
      data: {
        title: dto.title,
        department: dto.department,
        location: dto.location,
        description: dto.description,
        requirements: dto.requirements,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        status: (dto.status as any) ?? 'OPEN',
      },
      select: JOB_SELECT,
    });
  }

  async listAllJobs(status?: string) {
    return this.prisma.jobPosting.findMany({
      where: status ? { status: status as any } : undefined,
      select: JOB_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateJob(id: string, dto: UpdateJobDto) {
    await this.assertJob(id);
    return this.prisma.jobPosting.update({
      where: { id },
      data: {
        title: dto.title,
        department: dto.department,
        location: dto.location,
        description: dto.description,
        requirements: dto.requirements,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        status: dto.status as any,
      },
      select: JOB_SELECT,
    });
  }

  async deleteJob(id: string) {
    await this.assertJob(id);
    await this.prisma.jobPosting.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ── HR: Applications ─────────────────────────────────────

  async listApplications(jobId?: string, status?: string) {
    return this.prisma.careerApplication.findMany({
      where: {
        ...(jobId ? { jobId } : {}),
        ...(status ? { status: status as any } : {}),
      },
      select: APP_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getApplication(id: string) {
    const app = await this.prisma.careerApplication.findUnique({
      where: { id },
      select: APP_SELECT,
    });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }

  async updateApplicationStatus(id: string, dto: UpdateApplicationStatusDto) {
    const app = await this.prisma.careerApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('Application not found');
    return this.prisma.careerApplication.update({
      where: { id },
      data: { status: dto.status as any },
      select: APP_SELECT,
    });
  }

  private async assertJob(id: string) {
    const job = await this.prisma.jobPosting.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }
}
