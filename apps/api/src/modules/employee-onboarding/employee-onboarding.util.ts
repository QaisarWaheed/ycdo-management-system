import {
  EmployeeApproverTarget,
  EmployeeOnboardingStatus,
  EmployeeStatus,
  UserRole,
} from '@prisma/client';

export function approverTargetForUserRole(
  role: UserRole | string,
): EmployeeApproverTarget | null {
  switch (role) {
    case UserRole.PRESIDENT:
      return EmployeeApproverTarget.PRESIDENT;
    case UserRole.FOUNDER:
      return EmployeeApproverTarget.FOUNDER;
    case UserRole.CHAIRMAN:
      return EmployeeApproverTarget.CHAIRMAN_ADMIN;
    default:
      return null;
  }
}

export const APPROVER_TARGET_LABELS: Record<EmployeeApproverTarget, string> = {
  [EmployeeApproverTarget.PRESIDENT]: 'President',
  [EmployeeApproverTarget.FOUNDER]: 'Founder',
  [EmployeeApproverTarget.CHAIRMAN_ADMIN]: 'Chairman Admin',
};

export function canReviewApproval(
  userRole: UserRole | string,
  approverTarget: EmployeeApproverTarget,
): boolean {
  if (userRole === UserRole.SUPER_ADMIN) return true;
  return approverTargetForUserRole(userRole) === approverTarget;
}

export { EmployeeOnboardingStatus, EmployeeApproverTarget, EmployeeStatus };
