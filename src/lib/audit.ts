import prisma from './prisma';

export type AdminAuditTarget = { type?: string; id?: string };

export async function logAdminAction(opts: {
  req?: any;
  action: string;
  actorUserId?: string | null;
  target?: AdminAuditTarget;
  payload?: any;
  response?: any;
  success?: boolean;
  errorMessage?: string | null;
}) {
  const { req, action, actorUserId, target, payload, response } = opts;
  const success = opts.success !== false;
  const errorMessage = opts.errorMessage || null;
  try {
    await (prisma as any).adminAuditLog.create({
      data: {
        action,
        actorUserId: actorUserId || (req?.user?.id ?? null),
        targetType: target?.type,
        targetId: target?.id,
        requestPath: req?.originalUrl || req?.url,
        requestMethod: req?.method,
        ip: req?.ip || req?.headers?.['x-forwarded-for'] || null,
        userAgent: req?.headers?.['user-agent'] || null,
        payload: payload as any,
        response: response as any,
        success,
        errorMessage,
      },
    });
  } catch (e) {
    // Swallow audit errors; don't break main flow
    // Optionally console log in dev
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('AdminAuditLog write failed:', (e as any)?.message);
    }
  }
}
