import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UserAccessService } from './user-access.service';

function setup(primary: UserRole = UserRole.HR_OPERATIONS_MANAGER) {
  const tx = {
    user: { update: jest.fn() },
    userAdditionalRole: { deleteMany: jest.fn(), createMany: jest.fn() },
    userPermission: { deleteMany: jest.fn(), upsert: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: primary, employeeId: null }) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const service = new UserAccessService(prisma as never, {} as never, {} as never);
  jest.spyOn(service, 'findOne').mockResolvedValue({} as never);
  return { service, tx };
}

describe('extra roles on a login', () => {
  it('IT gives HR Operations the HR Executive role as an extra role', async () => {
    const { service, tx } = setup();
    await service.update('u1', { additionalRoles: [UserRole.HR_EXECUTIVE] }, 'it', UserRole.IT_ADMIN);
    expect(tx.userAdditionalRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', role: { notIn: [UserRole.HR_EXECUTIVE] } },
    });
    expect(tx.userAdditionalRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', role: UserRole.HR_EXECUTIVE }],
      skipDuplicates: true,
    });
  });

  it('the primary role is never stored as an extra role', async () => {
    const { service, tx } = setup();
    await service.update('u1', { additionalRoles: [UserRole.HR_OPERATIONS_MANAGER] }, 'it', UserRole.IT_ADMIN);
    expect(tx.userAdditionalRole.createMany).toHaveBeenCalledWith({ data: [], skipDuplicates: true });
  });

  it('only a Super Admin can grant Super Admin', async () => {
    const { service } = setup();
    await expect(
      service.update('u1', { additionalRoles: [UserRole.SUPER_ADMIN] }, 'it', UserRole.IT_ADMIN),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
