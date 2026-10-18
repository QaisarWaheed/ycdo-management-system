import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { accessWindowError } from '../../common/access-window.util';

/** Access window per user, re-read at most this often (ms). */
const WINDOW_CACHE_MS = 30_000;

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  roles?: string[];
  client?: string;
  employeeId?: string | null;
  branchId?: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // ponytail: per-process cache; a changed window or end time takes effect within 30 s.
  private windows = new Map<
    string,
    { at: number; accessFrom: Date | null; accessUntil: Date | null }
  >();

  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: JwtPayload) {
    const roles = (payload.roles?.length
      ? payload.roles
      : [payload.role]
    ).filter(Boolean) as UserRole[];

    // Req 20: an expired access window ends sessions that are already open.
    let w = this.windows.get(payload.sub);
    if (!w || Date.now() - w.at > WINDOW_CACHE_MS) {
      const u = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { accessFrom: true, accessUntil: true },
      });
      if (!u) throw new UnauthorizedException('Account not found');
      w = { at: Date.now(), ...u };
      this.windows.set(payload.sub, w);
    }
    const blocked = accessWindowError(w, roles);
    if (blocked) throw new UnauthorizedException(blocked);

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      roles,
      client: payload.client,
      employeeId: payload.employeeId,
      branchId: payload.branchId,
    };
  }
}
