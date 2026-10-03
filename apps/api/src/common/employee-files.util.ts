import { ForbiddenException, StreamableFile } from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';
import * as path from 'path';
import type { Readable } from 'stream';
import type { PermissionsService } from '../modules/permissions/permissions.service';

export type FileActor = {
  id: string;
  role: UserRole;
  employeeId?: string | null;
};

/**
 * Employee files (documents, photo, personal-details export) are open to the
 * employee who owns them and to logins holding EMPLOYEES_EXPORT (core HR by
 * default; IT can Allow/Deny per user).
 */
export async function assertCanDownloadEmployeeFiles(
  permissionsService: Pick<PermissionsService, 'userHasPermission'>,
  user: FileActor,
  employeeId?: string,
): Promise<void> {
  if (employeeId && user.employeeId === employeeId) return;
  const allowed = await permissionsService.userHasPermission(
    user.id,
    user.role,
    Permission.EMPLOYEES_EXPORT,
  );
  if (!allowed) {
    throw new ForbiddenException(
      'You do not have permission to download employee files',
    );
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function fileResponse(
  body: Readable | Buffer,
  filename: string,
): StreamableFile {
  const options = {
    type:
      CONTENT_TYPES[path.extname(filename).toLowerCase()] ??
      'application/octet-stream',
    disposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
  return Buffer.isBuffer(body)
    ? new StreamableFile(body, options)
    : new StreamableFile(body, options);
}
