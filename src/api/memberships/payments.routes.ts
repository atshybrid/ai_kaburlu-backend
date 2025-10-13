import { Router } from 'express';
import prisma from '../../lib/prisma';
import { generateNextIdCardNumber } from '../../lib/idCardNumber';

// DEPRECATED: This entire file is deprecated - use pay-first flow instead
// No Swagger documentation to keep it out of API docs
const router = Router();

// DEPRECATED - Use /memberships/payfirst/orders instead
router.post('/orders', async (req, res) => {
  try {
    const { membershipId } = req.body || {};
    if (!membershipId) return res.status(400).json({ success: false, error: 'membershipId required' });
    const m = await prisma.membership.findUnique({ where: { id: String(membershipId) }, include: { designation: true, payments: true } as any });
    if (!m) return res.status(404).json({ success: false, error: 'MEMBERSHIP_NOT_FOUND' });
    const fee = (m as any).designation?.idCardFee ?? 0;
    if (fee <= 0) return res.json({ success: true, data: { order: null, amount: 0, currency: 'INR' } });
    // Ensure there is a pending payment row and attach a fresh unique orderId
    const pending = (m as any).payments?.find((p: any) => p.status === 'PENDING');
    const orderId = `rzp_${m.id}_${Date.now().toString(36)}`; // unique per call
    const currency = 'INR';
    if (pending) {
      const meta = Object.assign({}, pending.meta || {});
      const orders = Array.isArray((meta as any).orders) ? (meta as any).orders : [];
      orders.push({ orderId, ts: new Date().toISOString(), amount: fee, currency });
      (meta as any).lastOrderId = orderId;
      (meta as any).orders = orders;
      await prisma.membershipPayment.update({ where: { id: pending.id }, data: { meta } });
    }
    const order = { orderId, amount: fee, currency };
    return res.json({ success: true, data: { order } });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'ORDER_CREATE_FAILED', message: e?.message }); }
});

// DEPRECATED - Use /memberships/payfirst/confirm instead
router.post('/confirm', async (req, res) => {
  try {
    const { membershipId, providerRef, status, razorpay } = req.body || {};
    if (!membershipId || !status) return res.status(400).json({ success: false, error: 'membershipId and status required' });
    const m = await prisma.membership.findUnique({ where: { id: String(membershipId) } });
    if (!m) return res.status(404).json({ success: false, error: 'MEMBERSHIP_NOT_FOUND' });
    const lastPayment = await prisma.membershipPayment.findFirst({ where: { membershipId: m.id }, orderBy: { createdAt: 'desc' } });
    if (status === 'SUCCESS') {
      if (lastPayment) {
        const meta = Object.assign({}, lastPayment.meta || {});
        (meta as any).razorpay = razorpay || null;
        await prisma.membershipPayment.update({ where: { id: lastPayment.id }, data: { status: 'SUCCESS', providerRef: providerRef || null, meta } });
      }
      await prisma.membership.update({ where: { id: m.id }, data: { status: 'ACTIVE', paymentStatus: 'SUCCESS', activatedAt: new Date() } });
      const existingCard = await prisma.iDCard.findUnique({ where: { membershipId: m.id } }).catch(() => null);
      let idCardCreated = false; let idCardReason: string | null = null;
      if (!existingCard) {
        // Enforce profile with photo before issuing card
        const user = await prisma.user.findUnique({ where: { id: m.userId }, include: { profile: true } });
        const hasPhoto = !!(user?.profile?.profilePhotoUrl || user?.profile?.profilePhotoMediaId);
        if (!user?.profile || !hasPhoto) {
          idCardCreated = false; idCardReason = 'PROFILE_PHOTO_REQUIRED';
        } else {
          const cardNumber = await generateNextIdCardNumber(prisma);
          // Snapshot fields
          let fullName: string | undefined = user.profile.fullName || undefined;
          let mobileNumber: string | undefined = user.mobileNumber || undefined;
          let designationName: string | undefined; let cellName: string | undefined;
          try {
            const mem = await prisma.membership.findUnique({ where: { id: m.id }, include: { designation: true, cell: true } });
            designationName = (mem as any)?.designation?.name || undefined;
            cellName = (mem as any)?.cell?.name || undefined;
          } catch {}
          await prisma.iDCard.create({ data: { membershipId: m.id, cardNumber, expiresAt: new Date(Date.now() + 365*24*60*60*1000), fullName, mobileNumber, designationName, cellName } as any });
          idCardCreated = true;
        }
      }
      return res.json({ success: true, data: { status: 'ACTIVE', idCardCreated, idCardReason } });
    } else if (status === 'FAILED') {
      if (lastPayment) {
        const meta = Object.assign({}, lastPayment.meta || {});
        (meta as any).razorpay = razorpay || null;
        await prisma.membershipPayment.update({ where: { id: lastPayment.id }, data: { status: 'FAILED', providerRef: providerRef || null, meta } });
      }
      await prisma.membership.update({ where: { id: m.id }, data: { paymentStatus: 'FAILED' } });
      return res.json({ success: true, data: { status: 'FAILED', idCardCreated: false, idCardReason: 'PAYMENT_FAILED' } });
    } else {
      return res.status(400).json({ success: false, error: 'INVALID_STATUS' });
    }
  } catch (e: any) { return res.status(500).json({ success: false, error: 'CONFIRM_FAILED', message: e?.message }); }
});

export default router;
