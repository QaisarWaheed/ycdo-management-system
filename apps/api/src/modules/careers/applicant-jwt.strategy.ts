import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface ApplicantJwtPayload {
  sub: string;
  email: string;
  client: 'applicant';
}

@Injectable()
export class ApplicantJwtStrategy extends PassportStrategy(Strategy, 'applicant-jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  validate(payload: ApplicantJwtPayload) {
    if (payload.client !== 'applicant') {
      throw new UnauthorizedException('Invalid token type');
    }
    return { id: payload.sub, email: payload.email, client: 'applicant' };
  }
}
