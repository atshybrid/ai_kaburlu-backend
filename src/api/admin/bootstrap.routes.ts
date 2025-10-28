import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const router = Router();
const prisma = new PrismaClient();

// Simple header-based guard for initial bootstrap (no JWT required)
function requireBootstrapToken(req: any, res: any, next: any) {
  const token = req.header('x-admin-bootstrap-token') || req.query.token;
  const expected = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!expected) {
    return res.status(403).json({ success: false, error: 'Bootstrap disabled', message: 'ADMIN_BOOTSTRAP_TOKEN not set' });
  }
  if (token && expected && token === expected) return next();
  return res.status(403).json({ success: false, error: 'Forbidden' });
}

async function ensureRole(name: string, permissions: any = ["*"]) {
  const upper = name.trim().toUpperCase();
  const existing = await prisma.role.findUnique({ where: { name: upper } });
  if (existing) return existing;
  return prisma.role.create({ data: { name: upper, permissions } });
}

async function resolveLanguageId(preferredCode?: string) {
  if (preferredCode) {
    const byCode = await prisma.language.findUnique({ where: { code: preferredCode } as any });
    if (byCode) return byCode.id;
  }
  // Try English by code
  const en = await prisma.language.findFirst({ where: { code: { in: ['en', 'EN'] } } });
  if (en) return en.id;
  // Otherwise first language
  const first = await prisma.language.findFirst();
  return first?.id;
}

type AccountInput = {
  mobileNumber: string;
  email?: string;
  fullName?: string;
  mpin?: string; // optional 4-digit pin
  languageCode?: string; // optional (defaults to 'en' or first language)
};

/**
 * POST /api/v1/admin/bootstrap-accounts
 * Headers: x-admin-bootstrap-token: <ADMIN_BOOTSTRAP_TOKEN>
 * Body: { superadmin?: AccountInput, hrciAdmins?: AccountInput[] }
 */
router.post('/bootstrap-accounts', requireBootstrapToken, async (req, res) => {
  try {
    const { superadmin, hrciAdmins } = req.body || {};
    if (!superadmin && (!hrciAdmins || !Array.isArray(hrciAdmins) || hrciAdmins.length === 0)) {
      return res.status(400).json({ success: false, error: 'No accounts provided' });
    }

    // Ensure required roles
    const superRole = await ensureRole('SUPERADMIN', ['*']);
    const hrciRole = await ensureRole('HRCI_ADMIN', ['*']);

    const results: any = { rolesEnsured: [superRole.name, hrciRole.name], users: [] };

    async function upsertAccount(input: AccountInput, roleId: string) {
      if (!input?.mobileNumber && !input?.email) {
        throw new Error('mobileNumber or email required');
      }
      const languageId = await resolveLanguageId(input.languageCode);
      if (!languageId) {
        throw new Error('No language found in DB; seed languages first');
      }
      const where: any = input.email ? { email: input.email } : { mobileNumber: input.mobileNumber };
      let existing = await prisma.user.findFirst({ where: { OR: [ { mobileNumber: input.mobileNumber || '' }, { email: input.email || '' } ] } });
      const dataBase: any = {
        roleId,
        languageId,
        status: 'ACTIVE'
      };
      if (input.mobileNumber) dataBase.mobileNumber = input.mobileNumber;
      if (input.email) dataBase.email = input.email;
      if (input.mpin) {
        // Store hashed; if your app uses mpin (plain) elsewhere, adjust accordingly
        const saltRounds = 10;
        const hash = await bcrypt.hash(input.mpin, saltRounds);
        dataBase.mpinHash = hash;
        dataBase.mpin = undefined; // do not store plaintext
      }

      let user;
      if (existing) {
        user = await prisma.user.update({ where: { id: existing.id }, data: dataBase });
      } else {
        user = await prisma.user.create({ data: dataBase });
      }

      // Profile upsert for fullName
      if (input.fullName) {
        await prisma.userProfile.upsert({
          where: { userId: user.id },
          create: { userId: user.id, fullName: input.fullName },
          update: { fullName: input.fullName }
        });
      }

      results.users.push({ id: user.id, mobileNumber: user.mobileNumber, email: user.email, roleId: user.roleId });
    }

    if (superadmin) {
      await upsertAccount(superadmin, superRole.id);
    }
    if (Array.isArray(hrciAdmins)) {
      for (const a of hrciAdmins) {
        await upsertAccount(a, hrciRole.id);
      }
    }

    return res.json({ success: true, ...results });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'Bootstrap failed', message: e?.message });
  }
});

export default router;
