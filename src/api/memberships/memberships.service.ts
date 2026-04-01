import prisma from '../../lib/prisma';

export interface ListAdminMembershipsOptions {
  search?: string;       // fullName or mobileNumber LIKE
  name?: string;         // alias for search
  status?: string;
  level?: string;
  userId?: string;
  cellId?: string;
  designationId?: string;
  mobileNumber?: string;
  paymentStatus?: string;
  idCardStatus?: string;
  cursor?: string;       // last item id from previous page
  limit?: number;
}

export async function listAdminMemberships(opts: ListAdminMembershipsOptions) {
  const {
    status,
    level,
    userId,
    cellId,
    designationId,
    paymentStatus,
    idCardStatus,
    cursor,
  } = opts;

  const limit = Math.min(opts.limit ?? 20, 50);
  const searchTerm = opts.search || opts.name || undefined;

  // Build the Prisma where clause
  const where: any = {};

  if (status) where.status = status;
  if (level) where.level = level;
  if (userId) where.userId = userId;
  if (cellId) where.cellId = cellId;
  if (designationId) where.designationId = designationId;
  if (paymentStatus) where.paymentStatus = paymentStatus;
  if (idCardStatus) where.idCardStatus = idCardStatus;

  // search / name: LIKE filter on user.mobileNumber OR user.profile.fullName
  if (searchTerm) {
    where.User = {
      OR: [
        { mobileNumber: { contains: searchTerm, mode: 'insensitive' } },
        { profile: { fullName: { contains: searchTerm, mode: 'insensitive' } } },
      ],
    };
  }

  // mobileNumber exact/partial search (separate from general search)
  const mobFilter = opts.mobileNumber;
  if (mobFilter && !searchTerm) {
    where.User = {
      mobileNumber: { contains: mobFilter },
    };
  }

  // Cursor-based keyset pagination on id (cursor = last id from previous page)
  if (cursor) {
    where.id = { gt: cursor };
  }

  const rows = await prisma.membership.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    include: {
      User: {
        select: {
          id: true,
          mobileNumber: true,
          profile: {
            select: {
              fullName: true,
              profilePhotoUrl: true,
            },
          },
        },
      },
      Cell: {
        select: { id: true, name: true, code: true },
      },
      Designation: {
        select: { id: true, name: true, code: true },
      },
      IDCard: {
        select: { cardNumber: true, issuedAt: true, expiresAt: true, status: true },
      },
      HrcState: {
        select: { id: true, name: true, code: true },
      },
      HrcDistrict: {
        select: { id: true, name: true },
      },
      HrcMandal: {
        select: { id: true, name: true },
      },
    },
  });

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

  // Shape response to match frontend expectation
  const data = items.map((m) => ({
    id: m.id,
    status: m.status,
    level: m.level,
    zone: m.zone,
    paymentStatus: m.paymentStatus,
    idCardStatus: m.idCardStatus,
    activatedAt: m.activatedAt,
    expiresAt: m.expiresAt,
    createdAt: m.createdAt,
    user: m.User
      ? {
          id: m.User.id,
          mobileNumber: m.User.mobileNumber,
          profile: m.User.profile
            ? {
                fullName: m.User.profile.fullName,
                profilePhotoUrl: m.User.profile.profilePhotoUrl,
              }
            : null,
        }
      : null,
    cell: m.Cell
      ? { id: m.Cell.id, name: m.Cell.name, code: m.Cell.code }
      : null,
    designation: m.Designation
      ? { id: m.Designation.id, name: m.Designation.name, code: m.Designation.code }
      : null,
    idCard: m.IDCard
      ? {
          cardNumber: m.IDCard.cardNumber,
          issuedAt: m.IDCard.issuedAt,
          expiresAt: m.IDCard.expiresAt,
          status: m.IDCard.status,
        }
      : null,
    hrci: {
      state: m.HrcState ? { id: m.HrcState.id, name: m.HrcState.name, code: m.HrcState.code } : null,
      district: m.HrcDistrict ? { id: m.HrcDistrict.id, name: m.HrcDistrict.name } : null,
      mandal: m.HrcMandal ? { id: m.HrcMandal.id, name: m.HrcMandal.name } : null,
    },
  }));

  return { data, count: items.length, nextCursor };
}
