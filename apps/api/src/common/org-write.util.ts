import { ConflictException, NotFoundException } from '@nestjs/common';
/** Turn concurrent rename/delete conflicts into actionable responses, never a generic 500. */
export function orgWriteError(error: unknown): never {
  const code = (error as {code?: string})?.code;
  if (code === 'P2002') throw new ConflictException('This name already exists. Refresh the list and edit the existing record.');
  if (code === 'P2025') throw new NotFoundException('This record no longer exists. Refresh the list.');
  if (code === 'P2003' || code === 'P2034') throw new ConflictException('This record changed or is still in use. Refresh and try again.');
  throw error;
}
