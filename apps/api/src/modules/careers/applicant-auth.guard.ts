import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class ApplicantAuthGuard extends AuthGuard('applicant-jwt') {}
