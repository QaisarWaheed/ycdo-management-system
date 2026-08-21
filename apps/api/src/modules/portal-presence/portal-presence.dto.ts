import { IsIn, IsOptional, IsString } from 'class-validator';

export const PORTAL_PRESENCE_STATUSES = [
  'ONLINE',
  'OFFLINE',
  'NEVER_LOGGED_IN',
] as const;

export type PortalPresenceStatus = (typeof PORTAL_PRESENCE_STATUSES)[number];

export class PortalPresenceQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsIn([...PORTAL_PRESENCE_STATUSES])
  status?: PortalPresenceStatus;
}

/** Minutes after last portal login while still counted as "online". */
export const PORTAL_ONLINE_WINDOW_MINUTES = 30;
