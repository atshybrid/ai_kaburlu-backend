import { PrismaClient } from '@prisma/client';

// Fallback literal union types because enum exports not present in generated client runtime typing.
export type OrgLevel = 'NATIONAL' | 'ZONE' | 'STATE' | 'DISTRICT' | 'MANDAL';
export type MembershipStatus = 'PENDING_PAYMENT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export type MembershipPaymentStatus = 'NOT_REQUIRED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
export type IdCardStatus = 'NOT_CREATED' | 'GENERATED' | 'REVOKED' | 'EXPIRED';
export type HrcZone = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | 'CENTRAL';

const prisma = new PrismaClient();
const p: any = prisma;

export interface AvailabilityQuery {
  cellCodeOrName: string;
  designationCode: string;
  level: OrgLevel;
  zone?: HrcZone;
  hrcCountryId?: string;
  hrcStateId?: string;
  hrcDistrictId?: string;
  hrcMandalId?: string;
}

export interface JoinRequest extends AvailabilityQuery {
  userId: string;
}

export async function getAvailability(q: AvailabilityQuery) {
  const cell = await p.cell.findFirst({ where: { OR: [ { id: q.cellCodeOrName }, { code: q.cellCodeOrName }, { name: q.cellCodeOrName } ] } });
  if (!cell) throw new Error('CELL_NOT_FOUND');
  const designation = await p.designation.findFirst({ where: { OR: [ { code: q.designationCode }, { id: q.designationCode } ] } });
  if (!designation) throw new Error('DESIGNATION_NOT_FOUND');

  // Fetch aggregate level capacity (optional)
  const levelCap = await p.cellLevelCapacity.findFirst({
    where: {
      cellId: cell.id,
      level: q.level,
      zone: q.level === 'ZONE' ? q.zone : null,
      hrcStateId: null,
      hrcDistrictId: null,
      hrcMandalId: null
    }
  });

  const where: any = {
    cellId: cell.id,
    designationId: designation.id,
    level: q.level,
  status: { in: ['PENDING_PAYMENT','PENDING_APPROVAL','ACTIVE'] }
  };
  if (q.level === 'ZONE') where.zone = q.zone;
  if (q.level === 'NATIONAL') where.hrcCountryId = q.hrcCountryId; // optional
  if (q.level === 'STATE') where.hrcStateId = q.hrcStateId;
  if (q.level === 'DISTRICT') where.hrcDistrictId = q.hrcDistrictId;
  if (q.level === 'MANDAL') where.hrcMandalId = q.hrcMandalId;

  const used = await p.membership.count({ where });
  const designationRemaining = designation.defaultCapacity - used;
  // Also compute aggregate usage across all designations for this cell+level if level cap exists
  let aggregate: any = undefined;
  if (levelCap) {
    const aggregateWhere: any = { cellId: cell.id, level: q.level, status: { in: ['PENDING_PAYMENT','PENDING_APPROVAL','ACTIVE'] } };
    if (q.level === 'ZONE') aggregateWhere.zone = q.zone;
    if (q.level === 'NATIONAL') aggregateWhere.hrcCountryId = q.hrcCountryId;
    if (q.level === 'STATE') aggregateWhere.hrcStateId = q.hrcStateId;
    if (q.level === 'DISTRICT') aggregateWhere.hrcDistrictId = q.hrcDistrictId;
    if (q.level === 'MANDAL') aggregateWhere.hrcMandalId = q.hrcMandalId;
    const aggregateUsed = await p.membership.count({ where: aggregateWhere });
    aggregate = {
      capacity: levelCap.capacity,
      used: aggregateUsed,
      remaining: Math.max(0, levelCap.capacity - aggregateUsed)
    };
  }
  return {
    designation: {
      capacity: designation.defaultCapacity,
      used,
      remaining: Math.max(0, designationRemaining),
      fee: designation.idCardFee,
      validityDays: designation.validityDays
    },
    levelAggregate: aggregate || null
  };
}

export async function joinSeat(req: JoinRequest) {
  return await p.$transaction(async (tx: any) => {
    const cell = await tx.cell.findFirst({ where: { OR: [ { id: req.cellCodeOrName }, { code: req.cellCodeOrName }, { name: req.cellCodeOrName } ] } });
    if (!cell) throw new Error('CELL_NOT_FOUND');
    const designation = await tx.designation.findFirst({ where: { OR: [ { code: req.designationCode }, { id: req.designationCode } ] } });
    if (!designation) throw new Error('DESIGNATION_NOT_FOUND');

    const where: any = {
      cellId: cell.id,
      designationId: designation.id,
      level: req.level,
  status: { in: ['PENDING_PAYMENT','PENDING_APPROVAL','ACTIVE'] }
    };
  if (req.level === 'ZONE') where.zone = req.zone;
  if (req.level === 'NATIONAL') where.hrcCountryId = req.hrcCountryId;
  if (req.level === 'STATE') where.hrcStateId = req.hrcStateId;
  if (req.level === 'DISTRICT') where.hrcDistrictId = req.hrcDistrictId;
  if (req.level === 'MANDAL') where.hrcMandalId = req.hrcMandalId;

    const count = await tx.membership.count({ where });
    if (count >= designation.defaultCapacity) {
      return { accepted: false, reason: 'NO_SEATS_DESIGNATION', remaining: 0 };
    }

    // Enforce cell-level aggregate cap if present
    const levelCap = await tx.cellLevelCapacity.findFirst({
      where: {
        cellId: cell.id,
        level: req.level,
        zone: req.level === 'ZONE' ? req.zone : null,
        hrcStateId: null,
        hrcDistrictId: null,
        hrcMandalId: null
      }
    });
    if (levelCap) {
      const aggregateWhere: any = { cellId: cell.id, level: req.level, status: { in: ['PENDING_PAYMENT','PENDING_APPROVAL','ACTIVE'] } };
      if (req.level === 'ZONE') aggregateWhere.zone = req.zone;
      if (req.level === 'NATIONAL') aggregateWhere.hrcCountryId = req.hrcCountryId;
      if (req.level === 'STATE') aggregateWhere.hrcStateId = req.hrcStateId;
      if (req.level === 'DISTRICT') aggregateWhere.hrcDistrictId = req.hrcDistrictId;
      if (req.level === 'MANDAL') aggregateWhere.hrcMandalId = req.hrcMandalId;
      const aggregateUsed = await tx.membership.count({ where: aggregateWhere });
      if (aggregateUsed >= levelCap.capacity) {
        return { accepted: false, reason: 'NO_SEATS_LEVEL_AGGREGATE', remaining: 0 };
      }
    }

    const requiresPayment = designation.idCardFee > 0;

    const membership = await tx.membership.create({
      data: {
        userId: req.userId,
        cellId: cell.id,
        designationId: designation.id,
        level: req.level,
  zone: req.level === 'ZONE' ? req.zone : undefined,
  hrcCountryId: req.level === 'NATIONAL' ? req.hrcCountryId : null,
  hrcStateId: req.level === 'STATE' ? req.hrcStateId : null,
  hrcDistrictId: req.level === 'DISTRICT' ? req.hrcDistrictId : null,
  hrcMandalId: req.level === 'MANDAL' ? req.hrcMandalId : null,
  status: (requiresPayment ? 'PENDING_PAYMENT' : 'PENDING_APPROVAL'),
  paymentStatus: (requiresPayment ? 'PENDING' : 'NOT_REQUIRED'),
        seatSequence: count + 1,
        lockedAt: new Date()
      }
    });

    if (requiresPayment) {
      await tx.membershipPayment.create({
        data: { membershipId: membership.id, amount: designation.idCardFee, status: 'PENDING' }
      });
    }

    return { accepted: true, membershipId: membership.id, requiresPayment, fee: designation.idCardFee };
  });
}

// Aggregated export for convenience in route handlers
export const membershipService = {
  getAvailability,
  joinSeat
};
