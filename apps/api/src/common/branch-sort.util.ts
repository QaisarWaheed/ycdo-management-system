import { ProjectType } from '@prisma/client';

export const PROJECT_PRIORITY: Record<ProjectType, number> = {
  HOSPITAL: 1,
  VTI: 2,
  KITCHEN: 3,
  SOFTWARE_HOUSE: 4,
};

export function sortBranchesByHierarchy<
  T extends {
    sortOrder?: number | null;
    project?: { type: ProjectType } | null;
  },
>(branches: T[]): T[] {
  return [...branches].sort((a, b) => {
    const ap = a.project?.type ? PROJECT_PRIORITY[a.project.type] : 99;
    const bp = b.project?.type ? PROJECT_PRIORITY[b.project.type] : 99;
    if (ap !== bp) return ap - bp;
    return (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
  });
}

export function sortProjectsByType<
  T extends { type: ProjectType },
>(projects: T[]): T[] {
  return [...projects].sort(
    (a, b) => PROJECT_PRIORITY[a.type] - PROJECT_PRIORITY[b.type],
  );
}
