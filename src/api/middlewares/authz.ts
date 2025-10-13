import passport from 'passport';
import { Request, Response, NextFunction } from 'express';

export const requireAuth = passport.authenticate('jwt', { session: false });

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const user: any = (req as any).user;
    const roleName = user?.role?.name?.toString()?.toLowerCase();
    if (roleName === 'admin' || roleName === 'superadmin') return next();
    return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Admin or Superadmin required' });
  } catch (e: any) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }
}

// HRCI admin guard: Only allow HRCI_ADMIN (and SUPER_ADMIN for global overrides)
export function requireHrcAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const user: any = (req as any).user;
    const roleName = user?.role?.name?.toString()?.toLowerCase();
    if (roleName === 'hrci_admin' || roleName === 'superadmin') return next();
    return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'HRCI_ADMIN (or Superadmin) required' });
  } catch (e: any) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }
}
