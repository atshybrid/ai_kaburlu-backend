import { Request, Response, NextFunction } from 'express';

/**
 * Simple role guard for early scaffold.
 * Will expand with granular permission checks (e.g., TEAM_ADMIN) later.
 */
export function ensureSuperAdminOrManager(req: any, res: Response, next: NextFunction) {
  const roleName = (req.user?.role?.name || '').toUpperCase();
  if (['SUPER_ADMIN', 'SUPERADMIN', 'NEWS_DESK_ADMIN', 'LANGUAGE_ADMIN'].includes(roleName)) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: insufficient role' });
}
