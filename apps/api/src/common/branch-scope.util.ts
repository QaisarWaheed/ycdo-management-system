import { UserRole } from '@prisma/client';

export type BranchScopedUser = {
  role: UserRole | string;
  branchId?: string | null;
};

export function enforceBranchScope(
  filters: { branchId?: string },
  actingUser?: BranchScopedUser,
): void {
  if (
    actingUser?.role === UserRole.ADMIN_MANAGER &&
    actingUser.branchId
  ) {
    filters.branchId = actingUser.branchId;
  }
}
