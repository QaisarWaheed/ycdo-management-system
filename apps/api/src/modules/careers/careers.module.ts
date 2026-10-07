import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ApplicantJwtStrategy } from './applicant-jwt.strategy';
import { ApplicantAuthGuard } from './applicant-auth.guard';
import { CareersController } from './careers.controller';
import { CareersService } from './careers.service';

@Module({
  imports: [PassportModule, AuthModule, PrismaModule],
  controllers: [CareersController],
  providers: [CareersService, ApplicantJwtStrategy, ApplicantAuthGuard],
})
export class CareersModule {}
