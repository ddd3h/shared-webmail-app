// Input checks for the organisation APIs that need the database (everything else is plain zod).
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { CAPABILITY_KEYS, wouldCreateCycle } from '@/lib/org';
import { loadUnits } from '@/lib/org-server';

export const unitSchema = z.object({
  name: z.string().trim().min(1).max(60),
  parent_id: z.string().min(1).nullable().default(null),
  head_user_id: z.string().min(1).nullable().default(null),
  sort: z.number().int().min(0).max(9999).default(0),
});
export type UnitInput = z.infer<typeof unitSchema>;

/** A reason code when the unit can't be saved as asked, otherwise null. `unitId` is null for a new unit. */
export async function unitProblem(unitId: string | null, d: UnitInput): Promise<string | null> {
  if (d.parent_id) {
    if (!(await prisma.org_units.findUnique({ where: { id: d.parent_id }, select: { id: true } }))) return 'parent_not_found';
    if (unitId && wouldCreateCycle(await loadUnits(), unitId, d.parent_id)) return 'parent_loop';
  }
  if (d.head_user_id && !(await prisma.users.findUnique({ where: { id: d.head_user_id }, select: { id: true } }))) return 'head_not_found';
  return null;
}

export const positionSchema = z.object({
  name: z.string().trim().min(1).max(40),
  level: z.number().int().min(0).max(100).default(0),
  permissions: z.array(z.enum(CAPABILITY_KEYS as [string, ...string[]])).max(CAPABILITY_KEYS.length).default([]),
});

export const memberSchema = z.object({ org_unit_id: z.string().min(1).nullable(), position_id: z.string().min(1).nullable() });
