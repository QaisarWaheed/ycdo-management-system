import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Permission, UserRole } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { assertCanDownloadEmployeeFiles } from './employee-files.util';
import {
  DocumentsService,
  resolveUploadPath,
} from '../modules/documents/documents.service';

describe('assertCanDownloadEmployeeFiles', () => {
  const perms = (allowed: boolean) => ({
    userHasPermission: jest.fn(() => Promise.resolve(allowed)),
  });

  it('lets the owning employee through without the permission', async () => {
    const p = perms(false);
    await expect(
      assertCanDownloadEmployeeFiles(
        p,
        { id: 'u1', role: UserRole.EMPLOYEE, employeeId: 'e1' },
        'e1',
      ),
    ).resolves.toBeUndefined();
    expect(p.userHasPermission).not.toHaveBeenCalled();
  });

  it('refuses another employee and non-HR logins without EMPLOYEES_EXPORT', async () => {
    await expect(
      assertCanDownloadEmployeeFiles(
        perms(false),
        { id: 'u1', role: UserRole.EMPLOYEE, employeeId: 'e1' },
        'e2',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      assertCanDownloadEmployeeFiles(perms(false), {
        id: 'u2',
        role: UserRole.PAYROLL_OFFICER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows logins holding EMPLOYEES_EXPORT for any employee', async () => {
    const p = perms(true);
    await assertCanDownloadEmployeeFiles(
      p,
      { id: 'u3', role: UserRole.HR_MANAGER },
      'e9',
    );
    expect(p.userHasPermission).toHaveBeenCalledWith(
      'u3',
      UserRole.HR_MANAGER,
      Permission.EMPLOYEES_EXPORT,
    );
  });
});

describe('resolveUploadPath', () => {
  const dir = path.join(process.cwd(), 'uploads', 'documents', '__spec__');
  const file = path.join(dir, 'a.pdf');
  beforeAll(() => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, 'x');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('maps a stored URL to the file on disk', () => {
    expect(resolveUploadPath('/uploads/documents/__spec__/a.pdf')).toBe(file);
  });

  it('zips the chosen documents, de-duplicating names and skipping lost files', async () => {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          employeeCode: 'E1',
          fullName: 'Ali',
        }),
      },
      employeeDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            documentType: 'CNIC',
            fileName: 'a.pdf',
            fileUrl: '/uploads/documents/__spec__/a.pdf',
          },
          {
            documentType: 'CNIC',
            fileName: 'a.pdf',
            fileUrl: '/uploads/documents/__spec__/a.pdf',
          },
          {
            documentType: 'OTHER',
            fileName: 'gone.pdf',
            fileUrl: '/uploads/documents/__spec__/gone.pdf',
          },
        ]),
      },
    };
    const service = new DocumentsService(prisma as never);
    const { stream, filename } = await service.zipFiles('e1', ['d1']);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const zip = Buffer.concat(chunks).toString('latin1');

    expect(filename).toBe('E1-Ali-documents.zip');
    expect(zip.startsWith('PK')).toBe(true);
    expect(zip).toContain('CNIC-a.pdf');
    expect(zip).toContain('CNIC-a (2).pdf');
    expect(zip).not.toContain('gone.pdf');
    expect(prisma.employeeDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { employeeId: 'e1', id: { in: ['d1'] } },
      }),
    );
  });

  it('refuses paths escaping uploads/ and missing files', () => {
    expect(() => resolveUploadPath('/uploads/../package.json')).toThrow(
      NotFoundException,
    );
    expect(() =>
      resolveUploadPath('/uploads/documents/__spec__/missing.pdf'),
    ).toThrow(NotFoundException);
  });
});
