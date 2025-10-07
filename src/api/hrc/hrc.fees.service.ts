import prisma from '../../lib/prisma';

export type PaymentPurpose = 'ID_CARD_ISSUE' | 'ID_CARD_RENEW' | 'DONATION' | 'OTHER';

export interface FeeResolutionInput {
  purpose: PaymentPurpose;
  teamId?: string;
  mandalId?: string;
  districtId?: string;
  stateId?: string;
}

export interface ResolvedFee {
  amountMinor: number;
  currency: string;
  renewalIntervalMonths?: number | null;
  source: 'TEAM' | 'MANDAL' | 'DISTRICT' | 'STATE' | 'GLOBAL';
  configId: string;
}

/**
 * Resolve fee by descending specificity.
 * Order: team > mandal > district > state > global (null scope / no location).
 */
export async function resolveFee(input: FeeResolutionInput): Promise<ResolvedFee | null> {
  const { purpose, teamId, mandalId, districtId, stateId } = input;

  // 1. Team specific
  if (teamId) {
  const cfg = await (prisma as any).paymentFeeConfig.findFirst({ where: { purpose, active: true, teamId }, orderBy: { createdAt: 'asc' } });
    if (cfg) return toResolved(cfg, 'TEAM');
  }
  // 2. Mandal
  if (mandalId) {
  const cfg = await (prisma as any).paymentFeeConfig.findFirst({ where: { purpose, active: true, mandalId }, orderBy: { createdAt: 'asc' } });
    if (cfg) return toResolved(cfg, 'MANDAL');
  }
  // 3. District
  if (districtId) {
  const cfg = await (prisma as any).paymentFeeConfig.findFirst({ where: { purpose, active: true, districtId }, orderBy: { createdAt: 'asc' } });
    if (cfg) return toResolved(cfg, 'DISTRICT');
  }
  // 4. State
  if (stateId) {
  const cfg = await (prisma as any).paymentFeeConfig.findFirst({ where: { purpose, active: true, stateId }, orderBy: { createdAt: 'asc' } });
    if (cfg) return toResolved(cfg, 'STATE');
  }
  // 5. Global fallback (no team/location linked)
  const globalCfg = await (prisma as any).paymentFeeConfig.findFirst({ where: { purpose, active: true, teamId: null, stateId: null, districtId: null, mandalId: null }, orderBy: { createdAt: 'asc' } });
  if (globalCfg) return toResolved(globalCfg, 'GLOBAL');

  return null;
}

function toResolved(cfg: any, source: ResolvedFee['source']): ResolvedFee {
  return {
    amountMinor: cfg.amountMinor,
    currency: cfg.currency,
    renewalIntervalMonths: cfg.renewalIntervalMonths,
    source,
    configId: cfg.id
  };
}
