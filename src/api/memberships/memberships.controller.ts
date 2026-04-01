import { Request, Response } from 'express';
import { listAdminMemberships } from './memberships.service';

export async function getAdminMemberships(req: Request, res: Response) {
  try {
    const {
      search,
      name,
      status,
      level,
      userId,
      cellId,
      designationId,
      mobileNumber,
      paymentStatus,
      idCardStatus,
      cursor,
      limit,
    } = req.query as Record<string, string | undefined>;

    const result = await listAdminMemberships({
      search,
      name,
      status,
      level,
      userId,
      cellId,
      designationId,
      mobileNumber,
      paymentStatus,
      idCardStatus,
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return res.status(200).json({
      success: true,
      count: result.count,
      nextCursor: result.nextCursor,
      data: result.data,
    });
  } catch (error) {
    console.error('[getAdminMemberships] error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
