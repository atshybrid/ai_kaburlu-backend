import prisma from '../../lib/prisma';

interface PlanContext {
  planId: string;
  hierarchyLevel?: string; // volunteer hierarchy level (NHRC..VILLAGE)
  stateId?: string;
  districtId?: string;
  mandalId?: string;
}

/**
 * Validate that a plan is active and applicable to the provided volunteer context.
 * Currently hierarchyLevel on plan is a single TeamScopeLevel or null (global). If plan has location scoping (state/district/mandal), all must match.
 * Future: support multi-level allowedHierarchyLevels via join/meta table.
 */
export async function validatePlanApplicability(ctx: PlanContext) {
  const { planId, hierarchyLevel, stateId, districtId, mandalId } = ctx;
  const plan = await (prisma as any).hrcIdCardPlan.findUnique({ where: { id: planId } });
  if (!plan) return { ok: false, reason: 'Plan not found' } as const;
  if (!plan.active) return { ok: false, reason: 'Plan inactive' } as const;

  // Location scoping: if plan has any of these set they must equal volunteer context
  if (plan.stateId && plan.stateId !== stateId) return { ok: false, reason: 'State mismatch' } as const;
  if (plan.districtId && plan.districtId !== districtId) return { ok: false, reason: 'District mismatch' } as const;
  if (plan.mandalId && plan.mandalId !== mandalId) return { ok: false, reason: 'Mandal mismatch' } as const;

  // Hierarchy scoping: if plan.hierarchyLevel set ensure volunteer fits (approximate mapping)
  if (plan.hierarchyLevel) {
    if (!hierarchyLevel) return { ok: false, reason: 'Volunteer hierarchy missing for scoped plan' } as const;
    // Map volunteer level to TeamScopeLevel
    const map: Record<string,string> = { NHRC: 'COUNTRY', SHRC: 'STATE', DISTRICT: 'DISTRICT', MANDAL: 'MANDAL', VILLAGE: 'MANDAL' };
    const volunteerScope = map[hierarchyLevel] || 'GLOBAL';
    if (volunteerScope !== plan.hierarchyLevel) return { ok: false, reason: 'Hierarchy level mismatch' } as const;
  }

  return { ok: true, plan } as const;
}
