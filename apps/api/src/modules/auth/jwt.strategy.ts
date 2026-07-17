import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  roles?: string[];
  employeeId?: string | null;
  branchId?: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  validate(payload: JwtPayload) {
    const roles = (payload.roles?.length
      ? payload.roles
      : [payload.role]
    ).filter(Boolean) as UserRole[];

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      roles,
      employeeId: payload.employeeId,
      branchId: payload.branchId,
    };
  }
}
