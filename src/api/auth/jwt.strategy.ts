
import { Strategy, ExtractJwt } from 'passport-jwt';
import { PassportStatic } from 'passport';
import { findUserById } from '../users/users.service';
import prisma from '../../lib/prisma';

const options = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET || 'your-default-secret',
};

export default (passport: PassportStatic) => {
  passport.use(
    new Strategy(options, async (payload: any, done) => {
      try {
        if (payload.subType === 'device') {
          const device = await prisma.device.findUnique({ where: { id: payload.sub } });
          if (!device) return done(null, false);
            // Attach role if available
          let role: any = null;
          if ((device as any).roleId) {
            role = await prisma.role.findUnique({ where: { id: (device as any).roleId } });
          }
          const principal: Express.User = {
            kind: 'device',
            id: device.id,
            role: role ? { name: role.name, permissions: role.permissions } : undefined,
            languageId: (device as any).languageId ?? undefined,
            userId: device.userId ?? undefined,
          };
          return done(null, principal);
        }

        // Default: user principal
        const user = await findUserById(payload.sub);
        if (user) {
          const principal: Express.User = {
            kind: 'user',
            id: user.id,
            role: user.role ? { name: user.role.name, permissions: (user.role as any).permissions } : undefined,
            languageId: (user as any).languageId,
          };
          return done(null, principal);
        }
        return done(null, false);
      } catch (error) {
        return done(error, false);
      }
    }),
  );
};
